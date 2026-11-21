/**
 * The run state of one appliance, read on its power (spec 001).
 *
 * off ──P ≥ 1 W──▶ ready ──P > startW──▶ running ──P < endW for endDelay──▶ finished
 *  ▲                                        │                                  │
 *  └──────────────────── P < 1 W, from any state ◀─────────────────────────────┘
 *
 * `finished` is kept apart from `ready` so that "the cycle is over" fires once,
 * at the end, and not when the machine is switched on to be loaded. The end
 * delay is a timer started on the first sample below `endW`: a plug that stops
 * reporting while the power is flat still ends the cycle.
 *
 * A washing machine switches itself off 160 s to 5 min after its cycle, often
 * before the end delay runs out. Switched off while the delay runs, it goes
 * through `finished`, held `FINISHED_HOLD_MS` before `off`: two changes in the
 * same second would lose the second one twice over, to the core's 1 s burst
 * dedup of recipe notifications (the alarm never resets) and to InfluxDB's 1 s
 * precision (the `finished` point is overwritten). Switched off mid-cycle (no
 * delay running), it goes straight to `off`.
 *
 * Imports nothing from Sowel: replayed in tests against recorded cycles.
 */

export type CycleState = "off" | "ready" | "running" | "finished";

export const CYCLE_STATES: readonly CycleState[] = ["off", "ready", "running", "finished"];

export interface CycleThresholds {
  /** Running above this (W). */
  startW: number;
  /** Finished once below this for `endDelayMs` (W). */
  endW: number;
  endDelayMs: number;
}

/** From five recorded cycles: idle display ≤ 6.4 W, longest mid-cycle dip below 10 W 100 s. */
export const DEFAULT_THRESHOLDS: CycleThresholds = {
  startW: 15,
  endW: 10,
  endDelayMs: 5 * 60_000,
};

/** Below this the machine is switched off (a plug reads 0 W, an idle display ~6 W). */
export const OFF_W = 1;

export const FINISHED_HOLD_MS = 5_000;

export interface CycleStep {
  state: CycleState;
  /** Pass through `finished` before `off` (switched off during the end delay). */
  finishedFirst: boolean;
  /** Start the end delay (running, first sample below `endW`). */
  armEndDelay: boolean;
  /** Drop a running end delay. */
  cancelEndDelay: boolean;
}

/** The FR3 table: where one power sample takes a state. Pure; the delay is the caller's timer. */
export function nextCycleState(
  state: CycleState,
  power: number,
  thresholds: CycleThresholds,
  endDelayRunning: boolean,
): CycleStep {
  const step = (
    next: CycleState,
    armEndDelay: boolean,
    cancelEndDelay: boolean,
    finishedFirst = false,
  ): CycleStep => ({ state: next, finishedFirst, armEndDelay, cancelEndDelay });

  if (power < OFF_W) return step("off", false, true, state === "running" && endDelayRunning);
  if (state === "running") {
    return power < thresholds.endW ? step("running", true, false) : step("running", false, true);
  }
  if (power > thresholds.startW) return step("running", false, true);
  return step(state === "off" ? "ready" : state, false, false);
}

/** The state a reading implies with no history (start, restart). Never `finished`. */
export function coldCycleState(power: number, thresholds: CycleThresholds): CycleState {
  if (power < OFF_W) return "off";
  if (power > thresholds.startW) return "running";
  return "ready";
}

/** Why a threshold set is refused, or `null` (spec 001 FR1). */
export function validateThresholds(t: CycleThresholds): string | null {
  if (![t.startW, t.endW, t.endDelayMs].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return "startW, endW and endDelay must be numbers";
  }
  if (t.endW <= OFF_W) return `endW must be above ${OFF_W} W`;
  if (t.endW > t.startW) return "endW must not exceed startW";
  if (t.startW > 5000) return "startW must not exceed 5000 W";
  if (t.endDelayMs < 30_000 || t.endDelayMs > 60 * 60_000) {
    return "endDelay must be between 30 s and 60 min";
  }
  return null;
}

type Timer = ReturnType<typeof setTimeout>;

export interface CycleMachineOptions {
  thresholds: CycleThresholds;
  /** Called on every change of state, after it is applied. */
  onTransition: (next: CycleState, previous: CycleState) => void;
  now?: () => number;
}

/** One machine's state, its end-delay timer and its finished-hold timer. */
export class CycleMachine {
  private current: CycleState | null = null;
  private since: number | null = null;
  private started: number | null = null;
  private endTimer: Timer | null = null;
  private holdTimer: Timer | null = null;
  private stopped = false;
  private readonly now: () => number;

  constructor(private readonly options: CycleMachineOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The current state, `null` before the first reading. */
  get state(): CycleState | null {
    return this.current;
  }

  /** Epoch ms the current cycle started, when its start was seen. */
  get runningSince(): number | null {
    return this.started;
  }

  /** Epoch ms of the last change of state (or of the cold start). */
  get stateSince(): number | null {
    return this.since;
  }

  /**
   * Set the state from a reading with no history (FR4). No transition is
   * reported: the caller publishes the cold state itself.
   */
  start(power: number): CycleState {
    this.clearTimers();
    this.current = coldCycleState(power, this.options.thresholds);
    this.since = this.now();
    this.started = null;
    return this.current;
  }

  /** A new power sample. A machine never started takes it as its cold start. */
  onPower(power: number): void {
    if (this.stopped || !Number.isFinite(power)) return;
    if (this.current === null) {
      this.start(power);
      return;
    }
    // While `finished` is held before `off`, another 0 W sample changes
    // nothing; a reading again means the machine is on: the hold is dropped.
    if (this.holdTimer) {
      if (power < OFF_W) return;
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    const step = nextCycleState(
      this.current,
      power,
      this.options.thresholds,
      this.endTimer !== null,
    );
    if (step.cancelEndDelay) this.clearEndTimer();
    if (step.armEndDelay && !this.endTimer) this.armEndTimer();
    if (step.finishedFirst) {
      this.transition("finished");
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (!this.stopped && this.current === "finished") this.transition("off");
      }, FINISHED_HOLD_MS);
      return;
    }
    if (step.state !== this.current) this.transition(step.state);
  }

  /** Clear every timer. Idempotent; later samples are ignored. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  private armEndTimer(): void {
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      if (!this.stopped && this.current === "running") this.transition("finished");
    }, this.options.thresholds.endDelayMs);
  }

  private clearEndTimer(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearEndTimer();
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private transition(next: CycleState): void {
    const previous = this.current ?? "off";
    const now = this.now();
    if (next === "running") this.started = now;
    this.current = next;
    this.since = now;
    this.options.onTransition(next, previous);
  }
}

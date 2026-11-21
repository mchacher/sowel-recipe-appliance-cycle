import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CycleMachine,
  DEFAULT_THRESHOLDS,
  FINISHED_HOLD_MS,
  coldCycleState,
  nextCycleState,
  validateThresholds,
  type CycleState,
  type CycleThresholds,
} from "./cycle.js";
import { CYCLE_2026_11_11, CYCLE_2026_11_13 } from "./__fixtures__/cycles.js";

const D = DEFAULT_THRESHOLDS;

describe("nextCycleState", () => {
  it("off → ready on an idle display, ready → running above startW, off → running", () => {
    expect(nextCycleState("off", 6, D, false).state).toBe("ready");
    expect(nextCycleState("ready", 21, D, false).state).toBe("running");
    expect(nextCycleState("off", 1900, D, false).state).toBe("running");
  });

  it("running below endW arms the end delay, above it cancels", () => {
    expect(nextCycleState("running", 6, D, false)).toMatchObject({
      state: "running",
      armEndDelay: true,
    });
    expect(nextCycleState("running", 90, D, true)).toMatchObject({
      state: "running",
      cancelEndDelay: true,
    });
  });

  it("finished stays at 5 W, goes off at 0 W", () => {
    expect(nextCycleState("finished", 5, D, false).state).toBe("finished");
    expect(nextCycleState("finished", 0, D, false).state).toBe("off");
  });

  it("running → off at 0 W mid-cycle; through finished when the delay runs", () => {
    expect(nextCycleState("running", 0, D, false)).toMatchObject({
      state: "off",
      finishedFirst: false,
    });
    expect(nextCycleState("running", 0, D, true)).toMatchObject({
      state: "off",
      finishedFirst: true,
    });
  });

  it("custom thresholds: 30 W does not start a cycle with startW 50", () => {
    expect(
      nextCycleState("ready", 30, { startW: 50, endW: 20, endDelayMs: 60_000 }, false).state,
    ).toBe("ready");
  });
});

describe("coldCycleState", () => {
  it("never starts as finished", () => {
    expect(coldCycleState(5, D)).toBe("ready");
    expect(coldCycleState(0, D)).toBe("off");
    expect(coldCycleState(1900, D)).toBe("running");
  });
});

describe("validateThresholds", () => {
  it("accepts the defaults", () => {
    expect(validateThresholds(D)).toBeNull();
  });
  it.each([
    [{ ...D, endW: 20 }, "endW"],
    [{ ...D, endW: 0.5 }, "endW"],
    [{ ...D, endDelayMs: 10_000 }, "endDelay"],
    [{ ...D, startW: 6000 }, "startW"],
    [{ ...D, startW: Number.NaN }, "numbers"],
  ])("refuses %o, naming %s", (t, field) => {
    expect(validateThresholds(t as CycleThresholds)).toContain(field);
  });
});

describe("CycleMachine", () => {
  let events: { next: CycleState; previous: CycleState; at: number }[];
  let thresholds: CycleThresholds;
  let machine: CycleMachine;

  const make = () =>
    new CycleMachine({
      thresholds,
      onTransition: (next, previous) => events.push({ next, previous, at: Date.now() }),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    thresholds = D;
    machine = make();
  });

  afterEach(() => {
    machine.stop();
    vi.useRealTimers();
  });

  const states = () => events.map((e) => e.next);

  /** Feed [seconds, watts] samples, advancing the clock between them. */
  function replay(samples: ReadonlyArray<readonly [number, number]>, tailS = 600): void {
    let at = 0;
    for (const [t, w] of samples) {
      vi.advanceTimersByTime((t - at) * 1000);
      at = t;
      machine.onPower(w);
    }
    vi.advanceTimersByTime(tailS * 1000);
  }

  function intoCycle(): void {
    machine.onPower(6);
    machine.onPower(90);
  }

  it("takes the first sample as a cold start, not a transition", () => {
    machine.onPower(6);
    expect(events).toEqual([]);
    expect(machine.state).toBe("ready");
  });

  it("keeps running through a dip shorter than the delay", () => {
    intoCycle();
    events = [];
    machine.onPower(6);
    vi.advanceTimersByTime(D.endDelayMs - 1_000);
    machine.onPower(90);
    vi.advanceTimersByTime(D.endDelayMs * 2);
    expect(events).toEqual([]);
    expect(machine.state).toBe("running");
  });

  it("ends the cycle after the delay even when the plug stops reporting", () => {
    intoCycle();
    machine.onPower(5);
    vi.advanceTimersByTime(D.endDelayMs - 1_000);
    expect(machine.state).toBe("running");
    vi.advanceTimersByTime(1_000);
    expect(states()).toEqual(["running", "finished"]);
  });

  it("holds finished 5 s before off when switched off during the end delay", () => {
    intoCycle();
    machine.onPower(5);
    vi.advanceTimersByTime(160_000);
    machine.onPower(0);
    expect(states()).toEqual(["running", "finished"]);
    machine.onPower(0); // another 0 W sample during the hold changes nothing
    vi.advanceTimersByTime(FINISHED_HOLD_MS);
    expect(states()).toEqual(["running", "finished", "off"]);
    const [finished, off] = events.slice(-2);
    expect(off!.at - finished!.at).toBeGreaterThan(1_000);
  });

  it("drops the hold when the machine reads again", () => {
    intoCycle();
    machine.onPower(5);
    machine.onPower(0);
    machine.onPower(1900);
    vi.advanceTimersByTime(FINISHED_HOLD_MS * 2);
    expect(states()).toEqual(["running", "finished", "running"]);
  });

  it("goes straight off when switched off mid-cycle", () => {
    intoCycle();
    machine.onPower(0);
    expect(states()).toEqual(["running", "off"]);
  });

  it("stays finished at 5 W, then off at 0 W", () => {
    intoCycle();
    machine.onPower(5);
    vi.advanceTimersByTime(D.endDelayMs);
    machine.onPower(5);
    machine.onPower(0);
    expect(states()).toEqual(["running", "finished", "off"]);
  });

  it("replays the 2026-11-13 cycle: one run, announced, then off", () => {
    replay(CYCLE_2026_11_13);
    expect(states()).toEqual(["running", "finished", "off"]);
  });

  it("replays the 2026-11-11 cycle: the 100 s dip does not split it", () => {
    replay(CYCLE_2026_11_11);
    expect(states().filter((s) => s === "running")).toHaveLength(1);
    expect(states()).toContain("finished");
    expect(states().at(-1)).toBe("off");
  });

  it("remembers when the cycle started", () => {
    machine.onPower(6);
    vi.advanceTimersByTime(60_000);
    const before = Date.now();
    machine.onPower(90);
    expect(machine.runningSince).toBe(before);
  });

  it("ignores a value that is not a finite number", () => {
    intoCycle();
    machine.onPower(Number.NaN);
    expect(machine.state).toBe("running");
  });

  it("stop clears both timers: no late event", () => {
    intoCycle();
    machine.onPower(5);
    machine.stop();
    vi.advanceTimersByTime(D.endDelayMs * 2);
    machine = make();
    intoCycle();
    machine.onPower(5);
    machine.onPower(0);
    machine.stop();
    vi.advanceTimersByTime(FINISHED_HOLD_MS * 2);
    expect(states()).toEqual(["running", "running", "finished"]);
  });
});

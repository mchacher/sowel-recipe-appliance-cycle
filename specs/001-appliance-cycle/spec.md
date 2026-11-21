# Spec 001 — An appliance's cycle, read on its power

**Status**: Draft 2026-11-21.
**Depends on**: Sowel core spec 214 (a recipe publishes data on an equipment), merged in
`mchacher/sowel` #1273, not released at the time of writing.

## Context

The maintainer's washing machine (`Lave-linge`, an `appliance`) got its run state from the
SmartThings plugin, whose API goes behind a paid plan around 2026-12-15. The machine is metered by
a SONOFF S60ZBTPF Zigbee plug bound to the equipment's `power`. Five cycles recorded on the plug
(2026-11-11 → 11-21), compared with the SmartThings state of the same cycles:

| Start (local) | Length | Energy   | Heating | Longest stretch < 10 W mid-cycle |
| ------------- | ------ | -------- | ------- | -------------------------------- |
| 11-11 14:12   | 83 min | 1.05 kWh | 31 min  | 100 s                            |
| 11-13 07:28   | 72 min | 0.32 kWh | 7 min   | 38 s                             |
| 11-13 12:13   | 70 min | 0.36 kWh | 8 min   | 38 s                             |
| 11-15 16:01   | 66 min | 0.34 kWh | 8 min   | 46 s                             |

- Off: 0 W. Switched on, idle (display): about 6 W, never above 6.4 W.
- Inside a cycle the power never drops below about 5 W and never reaches 0 W. The plug reports
  every 30 to 40 s while the power moves (largest gap 150 s).
- At the end the power sits at about 5 W, then the machine switches itself off: 0 W 160 s to
  5 min after the last sample above 10 W, often before a 5-minute delay would run out.

A first version of this logic lived in the core (spec 213), and was reverted before release: the
logic of a kind of machine belongs to a recipe, the state it yields to the equipment. Core spec
214 gives recipes that channel (`publishes` + `ctx.helpers.equipmentData.publish`). This recipe is
its first user.

Decisions taken with the maintainer (2026-11-21):

- **One instance per machine.** The recipe publishes the state and raises its own end-of-cycle
  alarm; the notification is bound to that alarm. No `state-watch` instance is needed (option B).
- **In production from its release**, and the SmartThings plugin is removed entirely (the Samsung
  TV loses its integration, accepted).

## Goals

1. For one `appliance` with a numeric `power`, publish a `state` (`off` / `ready` / `running` /
   `finished`) on the equipment, read on its power with three settable thresholds.
2. Announce every completed cycle once: an alarm raised at the end, which a notification binds to.
3. Say where the machine stands in one line on the recipe's row (state summary, core spec 198).

## Non-Goals

- Phase, progress, remaining time: not derivable from power.
- A `paused` state: a pause looks like a mid-cycle dip.
- Energy or cost per cycle (the plug's `energy` is already historized).
- A delay or a time window on the alarm: a `state-watch` on `finished` does that when needed.
- Several machines in one instance (one instance per machine).

## Functional Requirements

### FR1 — Slots

| Id          | Type        | Required | Default | Meaning                                                  |
| ----------- | ----------- | -------- | ------- | -------------------------------------------------------- |
| `zone`      | `zone`      | yes      |         | Zone of the machine                                      |
| `equipment` | `equipment` | yes      |         | The machine, constrained to `appliance`                  |
| `startW`    | `number`    | no       | 15      | Running above this (W)                                   |
| `endW`      | `number`    | no       | 10      | Finished once below this for `endDelay` (W)              |
| `endDelay`  | `duration`  | no       | `5m`    | How long the power must stay below `endW` to end a cycle |

Validation (an instance is refused with the message): the equipment exists, is in the zone, is an
`appliance` and has a `power` binding of type `number`; `1 < endW ≤ startW ≤ 5000`;
`30 s ≤ endDelay ≤ 60 min`.

### FR2 — The published state

`publishes`: slot `equipment`, alias `state`, type `enum`, category `appliance_state`,
`enumValues: ["off", "ready", "running", "finished"]`. The core refuses the instance when the
machine already has a `state` from a device (core spec 214 FR2).

### FR3 — The state machine

On each `power` value `P` (W) of the equipment, with `OFF_W = 1`:

| From                       | Condition                                      | To                               |
| -------------------------- | ---------------------------------------------- | -------------------------------- |
| any                        | `P < OFF_W`, no end delay running              | `off`                            |
| `running`, delay running   | `P < OFF_W`                                    | `finished`, then `off` after 5 s |
| `off`                      | `OFF_W ≤ P ≤ startW`                           | `ready`                          |
| `off`, `ready`, `finished` | `P > startW`                                   | `running`                        |
| `running`                  | `P < endW` without interruption for `endDelay` | `finished`                       |
| `running`                  | `P ≥ endW` while the delay runs                | `running`, delay cancelled       |
| `ready`, `finished`        | `OFF_W ≤ P ≤ startW`                           | unchanged                        |

1. The end delay is a timer started on the first sample below `endW`: a plug that stops
   reporting while the power is flat still ends the cycle.
2. **Switched off during the end delay**, the machine goes through `finished`, held 5 s
   (`FINISHED_HOLD_MS`) before `off`. Two state changes in the same second lose the second one to
   the core's 1 s burst dedup of recipe notifications (the alarm would never reset) and to
   InfluxDB's 1 s precision (the `finished` point would be overwritten). A 0 W sample during the
   hold changes nothing; a reading of 1 W or more drops it and applies normally.
3. Switched off with no delay running (mid-cycle, by hand): straight to `off`, no `finished`.
4. A `power` value that is not a finite number is ignored.
5. Each change of state is published once (`ctx.helpers.equipmentData.publish`); an unchanged
   state publishes nothing.

### FR4 — Start and restart

1. At start the state is rebuilt from the equipment's current power: `> startW` → `running`,
   `< OFF_W` → `off`, otherwise `ready`. Never `finished`: the end of a cycle that straddles a
   restart can be missed, never announced twice.
2. A power reading older than its freshness budget (`freshnessBudgetMs` on the binding, core spec 175) is no ground to start from: the state is published `null` until the plug reports again.
3. No power value yet: `null` until the first one.

### FR5 — The alarm

1. `state.alarm` is `true` while the state is `finished`, `false` otherwise. It is set on each
   transition, never left `undefined` after start.
2. The maintainer binds the "lessive terminée" notification to this instance's `alarm`: a boolean
   recipe source notifies on activation only, so once per cycle.
3. The alarm is logged with `ctx.log` at `info` ("Cycle terminé (84 min)").

### FR6 — Summary

`state.summary` is one French phrase, updated on each transition (core spec 198):

| State      | Summary                                |
| ---------- | -------------------------------------- |
| `off`      | `Éteint`                               |
| `ready`    | `Allumé, en attente`                   |
| `running`  | `En cours depuis 14:12`                |
| `finished` | `Terminé à 15:36 (84 min)`             |
| `null`     | `En attente d'une mesure de puissance` |

Times are local `HH:MM`. A cycle length is known only for a cycle whose start was seen.

### FR7 — Stop

`stop()` clears every timer and unsubscribes. The core removes the published binding and clears
its value (core spec 214 FR4.3). Idempotent.

## Acceptance Criteria

- [ ] Replaying the recorded 2026-11-13 07:28 cycle publishes `running → finished → off`, the
      `finished` held 5 s, and raises the alarm once.
- [ ] Replaying the 2026-11-11 cycle (100 s dip at 14:04 UTC) yields one `running` only.
- [ ] A dip below `endW` shorter than `endDelay` does not end the cycle.
- [ ] An instance on a non-appliance, or without a numeric `power`, or with `endW > startW`, is
      refused with a message naming the problem.
- [ ] After a restart the state starts from the current power and is never `finished`.
- [ ] `state.summary` and `state.alarm` follow the table above.
- [ ] Installed on a core with spec 214, the machine's card shows the state and the history keeps
      it (checked in production after release).

## Edge Cases

- **Delayed start**: the machine waits at about 6 W → `ready` until the cycle draws.
- **The machine does not switch itself off**: it stays `finished` (alarm up) until switched off
  or started again.
- **The plug goes offline mid-cycle**: no new sample; the state stays where it was. If it was in
  the end delay, the delay still ends the cycle.
- **Equipment edited to lose its `power` binding**: samples stop; the state stays. The instance
  is refused at its next start (validation).
- **Instance parameters changed**: the core restarts the instance (stop, start): FR4 applies.

## Docs Delta

- `README.md`: what the recipe does, its slots, the end-of-cycle notification, the thresholds
  derived from the recorded cycles.
- `docs/specs-index.md`: row for this spec.
- Core repo: `plugins/registry.json` entry at release (sha256, owner), through the core's
  `chore(registry)` PR; `docs/technical/recipe-development.md` "Existing Recipes" row.

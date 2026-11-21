# Spec 001 — Plan

## Slices

### Slice A — Repository

- [ ] Tooling copied from `sowel-plugin-simulator` (CLAUDE.md, skills, CI, gitleaks, husky,
      Prettier, ESLint, specs checks), adapted to a recipe; `docs/specs-index.md`.
- [ ] GitHub repo `mchacher/sowel-recipe-appliance-cycle`, `main-protection` ruleset.

### Slice B — The recipe

- [ ] `src/cycle.ts` + tests (fixtures from the core's 608f2dd8).
- [ ] `src/summary.ts` + tests.
- [ ] `src/index.ts` + tests (validation, start, publish, alarm, summary, stop).
- [ ] `manifest.json`, `README.md`.

### Slice C — Release (maintainer's go)

- [ ] Core release carrying spec 214; `sowelVersion` set to it.
- [ ] Tag `v0.1.0`; core `chore(registry)` PR with the entry and its sha256.

## Test Plan

| Module  | Scenario                                                        | Expected                                                   |
| ------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| cycle   | `off`, 6 W / `ready`, 21 W / `off`, 1900 W                      | `ready` / `running` / `running`                            |
| cycle   | `running` below `endW`, then above before the delay             | delay armed, then cancelled, no transition                 |
| cycle   | `running`, 5 W, no further sample for `endDelay`                | `finished` at the delay, once                              |
| cycle   | `running`, delay armed, 0 W                                     | `finished`, then `off` 5 s later; more than 1 s apart      |
| cycle   | 1900 W during the hold                                          | hold dropped, `running`                                    |
| cycle   | `running`, 0 W, no delay                                        | `off`, no `finished`                                       |
| cycle   | `finished`, 5 W / 0 W                                           | stays / `off`                                              |
| cycle   | replay 2026-11-13                                               | `running → finished → off`                                 |
| cycle   | replay 2026-11-11 (100 s dip)                                   | one `running`                                              |
| cycle   | custom thresholds `{50, 20, 60 s}`, 30 W from `ready`           | stays `ready`                                              |
| cycle   | `coldCycleState` 5 W / 0 W / 1900 W                             | `ready` / `off` / `running`, never `finished`              |
| cycle   | `stop()` with a delay and a hold armed                          | no late transition                                         |
| cycle   | `validateThresholds`: `endW > startW`, `endW = 0.5`, delay 10 s | message naming the field                                   |
| summary | each state, with and without a seen start                       | the FR6 phrase                                             |
| index   | validate: not an appliance / no numeric power / bad thresholds  | throws naming the problem                                  |
| index   | start at 6 W                                                    | publishes `ready`, `alarm` false, summary set              |
| index   | start on an outdated power reading                              | publishes `null`                                           |
| index   | power events through a cycle                                    | publishes each transition once; `alarm` true on `finished` |
| index   | power event of another equipment / another alias                | ignored                                                    |
| index   | `stop()`                                                        | unsubscribed, timers cleared, idempotent                   |

The core scenario (the end comes after the delay, not before) is checked failing once with the
timer set one second short.

## Validation Plan

- `npm run validate` (typecheck, tests, lint, format, build, specs index).
- On a local core at `main` (spec 214): install from a personal source, bind a fake numeric power,
  replay a fixture; the card shows the state, the history writes it, the alarm rises once.

## Production deployment (maintainer)

1. Core release with spec 214, recipe release, registry entry.
2. Remove the SmartThings plugin (washer `state`, `job_phase`, `progress`, `remaining_time`, and the
   Samsung TV).
3. Create the `appliance-cycle` instance on Lave-linge.
4. Bind the "lessive terminée" notification to the instance's `alarm`; delete the `state-watch`
   instance 6a613540.
5. Check the next cycle: one notification at the end, the state on the card and in history.

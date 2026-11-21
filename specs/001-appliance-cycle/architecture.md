# Spec 001 — Architecture

## Flow

```
SONOFF plug → zigbee2mqtt → Sowel core
  → equipment.data.changed { equipmentId: <machine>, alias: "power", value: W }
     → this recipe (eventBus.onType)
          CycleMachine.onPower(W)              pure state + timers
            → on transition:
                 ctx.helpers.equipmentData.publish(machine, "state", next)
                 ctx.state.set("alarm", next === "finished")
                 ctx.state.set("summary", …)
                 ctx.log on finished
  core: virtual binding `virtual:recipe:<instance>:state` on the machine
        → card, panel, history, notification on the recipe's `alarm`
```

## Components

### `src/cycle.ts` — the state machine (no Sowel import)

Lifted from the reverted core spec 213 (`mchacher/sowel` commit 608f2dd8,
`src/equipments/appliance-cycle-tracker.ts`), reshaped for one machine:

- `type CycleState = "off" | "ready" | "running" | "finished"`.
- `CYCLE_STATES`, `OFF_W = 1`, `FINISHED_HOLD_MS = 5000`, `DEFAULT_THRESHOLDS`.
- `nextCycleState(state, power, thresholds, endDelayRunning)`: pure FR3 table.
- `coldCycleState(power, thresholds)`: FR4.1.
- `validateThresholds(t)`: FR1 rules, returns a message or `null`.
- `class CycleMachine` — one machine:
  - `constructor({ thresholds, onTransition(next, previous, at), now?, setTimer?, clearTimer? })`.
  - `start(power: number | null)`: cold state (no transition callback; the caller publishes it).
  - `onPower(power)`: applies FR3, arms / clears the end-delay timer, the 5 s hold.
  - `state`, `runningSince`, `stop()` (clears timers, idempotent).

### `src/summary.ts`

`buildSummary(state, { runningSince, finishedAt })` → the FR6 phrase; local `HH:MM`.

### `src/index.ts` — `createRecipe()`

- Definition: `id: "appliance-cycle"`, slots (FR1), `publishes` (FR2), i18n EN/FR.
- `validate(params, ctx)`: FR1 checks through `ctx.equipmentManager.getByIdWithDetails`,
  `ctx.helpers.parseDuration`.
- `createInstance(params, ctx)`:
  - reads the current power binding (value, `lastUpdated`, `freshnessBudgetMs`) → FR4;
  - publishes the cold state, sets `alarm` false and the summary;
  - subscribes `ctx.eventBus.onType("equipment.data.changed")` filtered on the machine and alias
    `power`; feeds `CycleMachine.onPower`;
  - returns `{ stop }`.
- Never throws from an event handler: `try/catch` + `ctx.logger.error({ err }, …)`.

### `src/sowel-api.ts`

The slice of the core's types the recipe uses (`RecipeDefinition`, `RecipeSlotDef`,
`RecipePublishDef`, the parts of the context it reads), hand-synced with the core's
`src/shared/types.ts`, like the simulator's `sowel-api.ts`: an external package cannot import the
core.

### `src/__fixtures__/cycles.ts`

The two recorded cycles from the core's reverted spec 213 (`[seconds, watts]`), unchanged.

## Package

- `manifest.json`: `id: "appliance-cycle"`, `type: "recipe"`, icon `WashingMachine`,
  `sowelVersion` = the first core release carrying spec 214.
- Release tarball `sowel-recipe-appliance-cycle-<version>.tar.gz` (the core's PackageManager picks
  the `sowel-*.tar.gz` asset).

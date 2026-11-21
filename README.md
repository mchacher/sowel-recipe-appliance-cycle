# sowel-recipe-appliance-cycle

A [Sowel](https://github.com/mchacher/sowel) recipe that reads an appliance's cycle on its measured power — a washing machine, a dishwasher or a dryer behind a metering plug — and gives the equipment its run state:

| State      | When                                                       |
| ---------- | ---------------------------------------------------------- |
| `off`      | below 1 W: the machine is switched off                     |
| `ready`    | switched on, not running (display on, delayed start)       |
| `running`  | above the start threshold                                  |
| `finished` | the power stayed below the end threshold for the end delay |

The state is published on the equipment (Sowel core spec 214), so its card, its panel, its history and other recipes read it like a state reported by the machine. A machine that switches itself off during the end delay still goes through `finished`.

## End-of-cycle notification

The recipe keeps `alarm` true while the cycle is finished. Bind a notification to the instance's `alarm`: it is sent once, at the end of each cycle. For a delay or a quiet window (no notification at night), use a `state-watch` on the equipment's `state` = `finished` instead.

## Settings

| Setting            | Default | Meaning                                               |
| ------------------ | ------- | ----------------------------------------------------- |
| Zone, Machine      |         | The appliance, with its power measured in watts       |
| Running above (W)  | 15      | The machine is running above this power               |
| Finished below (W) | 10      | The cycle is over once the power stays below this…    |
| End delay          | 5m      | …for this long; longer than the pauses inside a cycle |

The defaults come from five recorded washing-machine cycles: an idle display draws at most 6.4 W, and the longest stretch below 10 W inside a cycle lasted 100 s.

The machine must not have a `state` from a device already (a cloud integration): the core refuses the instance until that binding is removed.

## Requirements

Sowel 1.88.0 or later (recipes publishing data on an equipment, core spec 214).

## Development

See [CLAUDE.md](CLAUDE.md). `npm run validate` runs what CI runs.

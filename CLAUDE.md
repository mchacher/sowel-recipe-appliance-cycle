# CLAUDE.md

Guidance for Claude Code (and any AI agent) working on `sowel-recipe-appliance-cycle`. First file to read. Same method as the Sowel core: spec with gates, feature branch, tests, agent review, PR, explicit merge approval.

## What this is

A Sowel **recipe** that reads an appliance's cycle on its measured power (a washing machine behind a metering plug) and publishes its run state on the equipment (`off` / `ready` / `running` / `finished`), through the core's channel for recipe-published data (core spec 214). It raises its own alarm at the end of a cycle, which a notification binds to.

The logic of a kind of machine lives here, not in the core: the core only offers the channel.

## Where to find context

| You want to know...                      | Read this                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The recipe contract                      | `../sowel`: `src/shared/types.ts` (`RecipeDefinition`, `RecipePublishDef`, `RecipeHelpers`)     |
| How recipes publish data on an equipment | `../sowel`: `docs/technical/recipe-development.md`, `specs/214-recipe-published-equipment-data` |
| The API slice this recipe relies on      | `src/sowel-api.ts` (hand-synced with the core's types)                                          |
| Every feature specified here             | [docs/specs-index.md](docs/specs-index.md) — one row per spec, CI-gated                         |
| Feature history in this repo             | `specs/NNN-name/{spec,architecture,plan}.md`                                                    |

The core repo is expected as a sibling directory (`../sowel`) for cross-reference and for the registry bump at release time.

## Non-negotiable rules

- **One machine per instance.** The state, the alarm and the summary belong to that machine.
- **Read the power, publish the state.** The recipe never sends an order: it observes.
- **Every completed cycle is announced once.** `finished` is held 5 s before `off` when the machine switches itself off during the end delay (notification dedup and InfluxDB precision are both 1 s), and a restart never starts from `finished`.
- **The thresholds come from recorded cycles.** Change a default only with new recordings, in a spec.
- **Never throw** from an event handler or a timer. Log with `{ err }` and degrade. `console.*` is an error.
- **`src/cycle.ts` imports nothing from Sowel**: it is testable on its own, replayed against recorded cycles.

## Tech

Node 24, TypeScript strict, ESM (`NodeNext`), no runtime dependency. Vitest. ESLint + Prettier as in the core.

```bash
npm install
npm run validate        # typecheck, typecheck:tests, lint, format:check, test, build, specs index — exactly what CI runs
npx vitest run <file>   # one test file
```

Local loop against a Sowel instance: build, then install through a personal source (core spec 136).

## Git workflow

- Feature branches for anything non-trivial: `feat/`, `fix/`, `refactor/`, `docs/`. Main is protected (PR required, linear history, CI green).
- Conventional commits. Scopes: `cycle`, `recipe`, `summary`, `manifest`, `ci`, `docs`.
- **Never merge a PR without explicit user approval** ("oui", "merge", "go").
- Every new `specs/NNN-name/` folder needs `spec.md`, `architecture.md`, `plan.md` **and a row in `docs/specs-index.md`** (two CI gates).
- A release is a PR (version bump in `package.json` **and** `manifest.json`, changelog entry) then a tag on main, then the **registry hash bump in the core** (spec 089). See the `appliance-cycle-release` skill.

## Skills

| Skill                     | When                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `appliance-cycle-feature` | Implementing a feature: spec, branch, tests, PR.             |
| `appliance-cycle-release` | Bumping, tagging, publishing, and bumping the registry hash. |

## Answering the user

Short and ordered. One or two lines for the what, one bullet per finding or decision. French or English, whichever the user uses.

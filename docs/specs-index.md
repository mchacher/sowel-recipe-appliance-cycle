# Specs index — sowel-recipe-appliance-cycle

Every feature ever specified in this repository, one row each, newest last. A
CI check (`scripts/check-specs-index.sh`) fails a pull request that creates a
`specs/NNN-name/` folder without its row here.

Status: 📝 Draft, 🚧 In progress, ✅ Shipped

| #   | Title                                   | Status | Summary                                                                                                                                                                                     |
| --- | --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | An appliance's cycle, read on its power | 🚧     | `off` / `ready` / `running` / `finished` from a metering plug's watts, published on the equipment (core spec 214), end-of-cycle alarm, state summary; thresholds from five recorded cycles. |

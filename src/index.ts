/**
 * Appliance cycle — a Sowel recipe (spec 001).
 *
 * Reads one appliance's cycle on its measured power, publishes its run state on
 * the equipment (`state`: off / ready / running / finished, core spec 214), and
 * keeps `alarm` true while the cycle is finished, for the end-of-cycle
 * notification to bind to.
 */

import {
  CYCLE_STATES,
  CycleMachine,
  DEFAULT_THRESHOLDS,
  validateThresholds,
  type CycleState,
  type CycleThresholds,
} from "./cycle.js";
import { buildSummary } from "./summary.js";
import type {
  DataBindingWithValue,
  RecipeContext,
  RecipeDefinition,
  RecipePublishDef,
  RecipeSlotDef,
} from "./sowel-api.js";

export const RECIPE_ID = "appliance-cycle";

const SLOTS: RecipeSlotDef[] = [
  {
    id: "zone",
    name: "Zone",
    description: "Zone of the machine",
    type: "zone",
    required: true,
  },
  {
    id: "equipment",
    name: "Machine",
    description: "The appliance, with its power measured in watts (a metering plug)",
    type: "equipment",
    required: true,
    constraints: { equipmentType: "appliance" },
  },
  {
    id: "startW",
    name: "Running above (W)",
    description: "The machine is running above this power",
    type: "number",
    required: false,
    defaultValue: DEFAULT_THRESHOLDS.startW,
    constraints: { min: 1, max: 5000 },
  },
  {
    id: "endW",
    name: "Finished below (W)",
    description: "The cycle is over once the power has stayed below this for the end delay",
    type: "number",
    required: false,
    defaultValue: DEFAULT_THRESHOLDS.endW,
    constraints: { min: 1, max: 5000 },
  },
  {
    id: "endDelay",
    name: "End delay",
    description:
      "How long the power must stay low to end a cycle; longer than the pauses inside one",
    type: "duration",
    required: false,
    defaultValue: "5m",
  },
];

const PUBLISHES: RecipePublishDef[] = [
  {
    slot: "equipment",
    alias: "state",
    type: "enum",
    category: "appliance_state",
    enumValues: [...CYCLE_STATES],
  },
];

/** The thresholds an instance runs with, defaults filled in. Throws on an unreadable delay. */
export function thresholdsOf(params: Record<string, unknown>, ctx: RecipeContext): CycleThresholds {
  const num = (v: unknown, fallback: number) =>
    v === undefined || v === null || v === "" ? fallback : Number(v);
  const delay = params.endDelay;
  return {
    startW: num(params.startW, DEFAULT_THRESHOLDS.startW),
    endW: num(params.endW, DEFAULT_THRESHOLDS.endW),
    endDelayMs:
      delay === undefined || delay === null || delay === ""
        ? DEFAULT_THRESHOLDS.endDelayMs
        : ctx.helpers.parseDuration(delay),
  };
}

function powerBinding(bindings: readonly DataBindingWithValue[]): DataBindingWithValue | undefined {
  return bindings.find((b) => b.alias === "power" && b.type === "number");
}

/**
 * The power to start from (FR4): `null` without a value, or when the reading is
 * older than its freshness budget (a plug offline across a restart).
 */
export function startingPower(binding: DataBindingWithValue, now: number): number | null {
  if (typeof binding.value !== "number" || !Number.isFinite(binding.value)) return null;
  if (binding.freshnessBudgetMs !== undefined && binding.lastUpdated) {
    const updated = Date.parse(binding.lastUpdated);
    if (!Number.isNaN(updated) && now - updated > binding.freshnessBudgetMs) return null;
  }
  return binding.value;
}

export function createRecipe(): RecipeDefinition {
  return {
    id: RECIPE_ID,
    name: "Appliance cycle",
    description:
      "Reads an appliance's cycle on its measured power, publishes its run state on the equipment and raises an alarm when a cycle ends.",
    slots: SLOTS,
    publishes: PUBLISHES,
    i18n: {
      fr: {
        name: "Cycle d'appareil",
        description:
          "Lit le cycle d'un appareil sur sa puissance mesurée, publie son état de marche sur l'équipement et lève une alarme à la fin d'un cycle.",
        slots: {
          zone: { name: "Zone", description: "Zone de la machine" },
          equipment: {
            name: "Machine",
            description: "L'appareil, avec sa puissance mesurée en watts (une prise mesurée)",
          },
          startW: {
            name: "En marche au-dessus de (W)",
            description: "La machine tourne au-dessus de cette puissance",
          },
          endW: {
            name: "Terminé sous (W)",
            description:
              "Le cycle est fini quand la puissance est restée sous ce seuil pendant le délai de fin",
          },
          endDelay: {
            name: "Délai de fin",
            description:
              "Durée pendant laquelle la puissance doit rester basse pour finir un cycle ; plus longue que les pauses d'un cycle",
          },
        },
      },
    },

    validate(params, ctx) {
      if (!ctx.helpers.equipmentData) {
        throw new Error("This Sowel version cannot take data from a recipe (spec 214 needed)");
      }
      const id = params.equipment;
      if (typeof id !== "string" || id === "") throw new Error("A machine is required");
      const eq = ctx.equipmentManager.getByIdWithDetails(id);
      if (!eq) throw new Error(`Equipment not found: ${id}`);
      if (typeof params.zone === "string" && eq.zoneId !== params.zone) {
        throw new Error(`Equipment "${eq.name}" does not belong to the selected zone`);
      }
      if (eq.type !== "appliance") throw new Error(`"${eq.name}" is not an appliance`);
      if (!powerBinding(eq.dataBindings)) {
        throw new Error(`"${eq.name}" has no power measured in watts`);
      }
      const invalid = validateThresholds(thresholdsOf(params, ctx));
      if (invalid) throw new Error(invalid);
    },

    createInstance(params, ctx) {
      const equipmentId = params.equipment as string;
      const thresholds = thresholdsOf(params, ctx);

      const publish = (state: CycleState | null) => {
        const result = ctx.helpers.equipmentData?.publish(equipmentId, "state", state);
        if (result && !result.ok) {
          ctx.logger.warn({ equipmentId, state, reason: result.reason }, "State not published");
        }
      };

      const describe = () => {
        ctx.state.set("alarm", machine.state === "finished");
        ctx.state.set(
          "summary",
          buildSummary(machine.state, {
            runningSince: machine.runningSince,
            stateSince: machine.stateSince,
          }),
        );
      };

      const machine = new CycleMachine({
        thresholds,
        onTransition: (next, previous) => {
          try {
            publish(next);
            describe();
            if (next === "finished") {
              const started = machine.runningSince;
              const minutes =
                started !== null && machine.stateSince !== null
                  ? Math.round((machine.stateSince - started) / 60_000)
                  : null;
              ctx.log(minutes !== null ? `Cycle terminé (${minutes} min)` : "Cycle terminé");
            } else {
              ctx.logger.debug({ equipmentId, from: previous, to: next }, "Cycle state changed");
            }
          } catch (err) {
            ctx.logger.error({ err, equipmentId }, "Cycle transition handling failed");
          }
        },
      });

      // FR4 — start from the current power, never from `finished`.
      try {
        const eq = ctx.equipmentManager.getByIdWithDetails(equipmentId);
        const binding = eq ? powerBinding(eq.dataBindings) : undefined;
        const power = binding ? startingPower(binding, Date.now()) : null;
        if (power !== null) machine.start(power);
        publish(machine.state);
        describe();
      } catch (err) {
        ctx.logger.error({ err, equipmentId }, "Cycle start failed");
      }

      const unsubscribe = ctx.eventBus.onType("equipment.data.changed", (event) => {
        if (event.equipmentId !== equipmentId || event.alias !== "power") return;
        try {
          if (typeof event.value !== "number") return;
          const before = machine.state;
          machine.onPower(event.value);
          // The first reading after a `null` start is a cold start, not a transition.
          if (before === null && machine.state !== null) {
            publish(machine.state);
            describe();
          }
        } catch (err) {
          ctx.logger.error({ err, equipmentId }, "Cycle power handling failed");
        }
      });

      let stopped = false;
      return {
        stop() {
          if (stopped) return;
          stopped = true;
          unsubscribe();
          machine.stop();
        },
      };
    },
  };
}

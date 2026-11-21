import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRecipe, startingPower } from "./index.js";
import { DEFAULT_THRESHOLDS, FINISHED_HOLD_MS } from "./cycle.js";
import type {
  DataBindingWithValue,
  EquipmentDataChangedEvent,
  EquipmentWithDetails,
  RecipeContext,
} from "./sowel-api.js";

const EQ = "washer";
const ZONE = "laundry";

interface Harness {
  ctx: RecipeContext;
  published: unknown[];
  state: Map<string, unknown>;
  logs: string[];
  emitPower(value: unknown, equipmentId?: string, alias?: string): void;
  handlers: Set<(e: EquipmentDataChangedEvent) => void>;
}

function harness(
  equipment: Partial<EquipmentWithDetails> | null,
  opts: { withChannel?: boolean } = {},
): Harness {
  const published: unknown[] = [];
  const state = new Map<string, unknown>();
  const logs: string[] = [];
  const handlers = new Set<(e: EquipmentDataChangedEvent) => void>();
  const eq: EquipmentWithDetails | null = equipment
    ? {
        id: EQ,
        name: "Lave-linge",
        type: "appliance",
        zoneId: ZONE,
        dataBindings: [],
        ...equipment,
      }
    : null;
  const ctx: RecipeContext = {
    eventBus: {
      onType: (_type, handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    equipmentManager: { getByIdWithDetails: (id) => (id === EQ ? eq : null) },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    state: { get: (k) => state.get(k), set: (k, v) => void state.set(k, v) },
    log: (message) => void logs.push(message),
    helpers: {
      parseDuration: (v) => {
        const m = /^(\d+)(s|m)$/.exec(String(v));
        if (!m) throw new Error(`bad duration ${String(v)}`);
        return Number(m[1]) * (m[2] === "m" ? 60_000 : 1_000);
      },
      formatDuration: (ms) => `${ms}ms`,
      ...(opts.withChannel === false
        ? {}
        : {
            equipmentData: {
              publish: (equipmentId: string, alias: string, value: unknown) => {
                if (equipmentId === EQ && alias === "state") published.push(value);
                return { ok: true as const };
              },
            },
          }),
    },
  };
  return {
    ctx,
    published,
    state,
    logs,
    handlers,
    emitPower: (value, equipmentId = EQ, alias = "power") => {
      for (const h of [...handlers]) {
        h({ type: "equipment.data.changed", equipmentId, alias, value, previous: null });
      }
    },
  };
}

const power = (
  value: unknown,
  extra: Partial<DataBindingWithValue> = {},
): DataBindingWithValue => ({
  alias: "power",
  type: "number",
  category: "power",
  value,
  lastUpdated: new Date().toISOString(),
  ...extra,
});

const params = { zone: ZONE, equipment: EQ };

describe("validate", () => {
  const recipe = createRecipe();

  it("accepts an appliance with a measured power", () => {
    const h = harness({ dataBindings: [power(6)] });
    expect(() => recipe.validate(params, h.ctx)).not.toThrow();
  });

  it.each([
    ["not an appliance", { type: "switch", dataBindings: [power(6)] }, /not an appliance/],
    ["no numeric power", { dataBindings: [{ ...power(true), type: "boolean" }] }, /no power/],
    ["another zone", { zoneId: "garage", dataBindings: [power(6)] }, /zone/],
  ])("refuses %s", (_label, eq, message) => {
    expect(() => recipe.validate(params, harness(eq).ctx)).toThrow(message);
  });

  it("refuses thresholds out of order and a delay too short", () => {
    const h = harness({ dataBindings: [power(6)] });
    expect(() => recipe.validate({ ...params, startW: 10, endW: 20 }, h.ctx)).toThrow(/endW/);
    expect(() => recipe.validate({ ...params, endDelay: "30s" }, h.ctx)).toThrow(/endDelay/);
  });

  it("refuses a core without the publishing channel", () => {
    const h = harness({ dataBindings: [power(6)] }, { withChannel: false });
    expect(() => recipe.validate(params, h.ctx)).toThrow(/spec 214/);
  });

  it("declares the published state", () => {
    expect(recipe.publishes).toEqual([
      expect.objectContaining({
        slot: "equipment",
        alias: "state",
        category: "appliance_state",
        enumValues: ["off", "ready", "running", "finished"],
      }),
    ]);
  });
});

describe("createInstance", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts from the current power: publishes ready, no alarm, a summary", () => {
    const h = harness({ dataBindings: [power(6)] });
    const handle = createRecipe().createInstance(params, h.ctx);
    expect(h.published).toEqual(["ready"]);
    expect(h.state.get("alarm")).toBe(false);
    expect(h.state.get("summary")).toBe("Allumé, en attente");
    handle.stop();
  });

  it("starts unknown on an outdated reading, then from the next one", () => {
    const old = new Date(Date.now() - 3_600_000).toISOString();
    const h = harness({
      dataBindings: [power(1900, { lastUpdated: old, freshnessBudgetMs: 120_000 })],
    });
    const handle = createRecipe().createInstance(params, h.ctx);
    expect(h.published).toEqual([null]);
    expect(h.state.get("summary")).toBe("En attente d'une mesure de puissance");
    h.emitPower(6);
    expect(h.published).toEqual([null, "ready"]);
    handle.stop();
  });

  it("publishes each transition once and raises the alarm at the end", () => {
    const h = harness({ dataBindings: [power(6)] });
    const handle = createRecipe().createInstance(params, h.ctx);
    h.emitPower(90);
    h.emitPower(120);
    expect(h.published).toEqual(["ready", "running"]);
    expect(h.state.get("alarm")).toBe(false);
    vi.advanceTimersByTime(72 * 60_000);
    h.emitPower(5);
    vi.advanceTimersByTime(DEFAULT_THRESHOLDS.endDelayMs);
    expect(h.published).toEqual(["ready", "running", "finished"]);
    expect(h.state.get("alarm")).toBe(true);
    // The length runs to the first low sample, not to the end of the delay.
    expect(String(h.state.get("summary"))).toMatch(/^Terminé à \d\d:\d\d \(72 min\)$/);
    expect(h.logs).toEqual(["Cycle terminé (72 min)"]);
    h.emitPower(0);
    vi.advanceTimersByTime(FINISHED_HOLD_MS);
    expect(h.published.at(-1)).toBe("off");
    expect(h.state.get("alarm")).toBe(false);
    handle.stop();
  });

  it("holds finished before off when the machine switches itself off in the delay", () => {
    const h = harness({ dataBindings: [power(6)] });
    const handle = createRecipe().createInstance(params, h.ctx);
    h.emitPower(90);
    h.emitPower(5);
    vi.advanceTimersByTime(160_000);
    h.emitPower(0);
    expect(h.published.at(-1)).toBe("finished");
    expect(h.state.get("alarm")).toBe(true);
    vi.advanceTimersByTime(FINISHED_HOLD_MS);
    expect(h.published.slice(-2)).toEqual(["finished", "off"]);
    expect(h.state.get("alarm")).toBe(false);
    handle.stop();
  });

  it("ignores another equipment, another alias and a non-numeric value", () => {
    const h = harness({ dataBindings: [power(6)] });
    const handle = createRecipe().createInstance(params, h.ctx);
    h.emitPower(90, "dryer");
    h.emitPower(90, EQ, "energy");
    h.emitPower("90");
    expect(h.published).toEqual(["ready"]);
    handle.stop();
  });

  it("stops cleanly: unsubscribed, timers cleared, idempotent", () => {
    const h = harness({ dataBindings: [power(6)] });
    const handle = createRecipe().createInstance(params, h.ctx);
    h.emitPower(90);
    h.emitPower(5);
    handle.stop();
    handle.stop();
    expect(h.handlers.size).toBe(0);
    vi.advanceTimersByTime(DEFAULT_THRESHOLDS.endDelayMs * 2);
    expect(h.published).toEqual(["ready", "running"]);
  });
});

describe("startingPower", () => {
  it("is null without a number, or past the freshness budget", () => {
    const now = Date.parse("2026-11-21T10:00:00Z");
    expect(startingPower(power(null), now)).toBeNull();
    expect(
      startingPower(
        power(6, { lastUpdated: "2026-11-21T09:00:00Z", freshnessBudgetMs: 120_000 }),
        now,
      ),
    ).toBeNull();
    expect(
      startingPower(
        power(6, { lastUpdated: "2026-11-21T09:59:30Z", freshnessBudgetMs: 120_000 }),
        now,
      ),
    ).toBe(6);
    // An old 0 W still means off: a plug on a switched-off machine reports rarely.
    expect(
      startingPower(
        power(0, { lastUpdated: "2026-11-21T09:00:00Z", freshnessBudgetMs: 120_000 }),
        now,
      ),
    ).toBe(0);
  });
});

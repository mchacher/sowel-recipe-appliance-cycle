/**
 * The slice of Sowel's recipe API this recipe uses.
 *
 * Recipe packages do not import from the Sowel source tree: the contract is
 * the shape below, kept in sync by hand with `src/shared/types.ts`
 * (`RecipeDefinition`, `RecipeSlotDef`, `RecipePublishDef`, `RecipeHelpers`)
 * and `src/recipes/engine/recipe.ts` (`RecipeContext`) in mchacher/sowel.
 * Extend it when a new method is needed; never widen a type to make something
 * compile.
 */

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

export interface DataBindingWithValue {
  alias: string;
  type: string;
  category: string;
  value: unknown;
  lastUpdated: string | null;
  /** Spec 175 — how long a power reading stays current. Power bindings only. */
  freshnessBudgetMs?: number;
}

export interface EquipmentWithDetails {
  id: string;
  name: string;
  type: string;
  zoneId: string;
  dataBindings: DataBindingWithValue[];
}

export interface EquipmentDataChangedEvent {
  type: "equipment.data.changed";
  equipmentId: string;
  alias: string;
  value: unknown;
  previous: unknown;
}

/** Spec 214 — the per-instance publishing channel. */
export interface EquipmentDataHelpers {
  publish(
    equipmentId: string,
    alias: string,
    value: unknown,
  ): { ok: true } | { ok: false; reason: string };
}

export interface RecipeContext {
  eventBus: {
    onType(
      type: "equipment.data.changed",
      handler: (event: EquipmentDataChangedEvent) => void,
    ): () => void;
  };
  equipmentManager: {
    getByIdWithDetails(id: string): EquipmentWithDetails | null;
  };
  logger: Logger;
  state: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  log: (message: string, level?: "info" | "warn" | "error") => void;
  helpers: {
    parseDuration(value: unknown): number;
    formatDuration(ms: number): string;
    /** Absent on a core older than spec 214. */
    equipmentData?: EquipmentDataHelpers;
  };
}

export interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type: "zone" | "equipment" | "number" | "duration";
  required: boolean;
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: string | string[];
    min?: number;
    max?: number;
  };
}

/** Spec 214 — data a recipe publishes on the equipment of one of its slots. */
export interface RecipePublishDef {
  slot: string;
  alias: string;
  type: "number" | "boolean" | "enum" | "text";
  category: string;
  enumValues?: string[];
  unit?: string;
}

export interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, { name: string; description: string }>;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  publishes?: RecipePublishDef[];
  i18n?: Record<string, RecipeLangPack>;
  validate(params: Record<string, unknown>, ctx: RecipeContext): void;
  createInstance(params: Record<string, unknown>, ctx: RecipeContext): { stop(): void };
}

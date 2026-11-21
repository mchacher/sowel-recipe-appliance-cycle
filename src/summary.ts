import type { CycleState } from "./cycle.js";

/** Local `HH:MM`. */
export function hhmm(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The instance's one-line summary, a plain French phrase (core spec 198), like
 * the other recipes' summaries.
 */
export function buildSummary(
  state: CycleState | null,
  times: { runningSince: number | null; stateSince: number | null },
): string {
  switch (state) {
    case null:
      return "En attente d'une mesure de puissance";
    case "off":
      return "Éteint";
    case "ready":
      return "Allumé, en attente";
    case "running":
      return times.runningSince !== null
        ? `En cours depuis ${hhmm(times.runningSince)}`
        : "En cours";
    case "finished": {
      if (times.stateSince === null) return "Terminé";
      const at = `Terminé à ${hhmm(times.stateSince)}`;
      if (times.runningSince === null) return at;
      const minutes = Math.round((times.stateSince - times.runningSince) / 60_000);
      return `${at} (${minutes} min)`;
    }
  }
}

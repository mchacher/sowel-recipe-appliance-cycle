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
  times: { runningSince: number | null; stateSince: number | null; endedAt?: number | null },
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
      // The end is the cycle's first low sample (`endedAt`), not the moment
      // the end delay confirmed it, 5 min later.
      const end = times.endedAt ?? times.stateSince;
      if (end === null) return "Terminé";
      const at = `Terminé à ${hhmm(end)}`;
      if (times.runningSince === null) return at;
      const minutes = Math.round((end - times.runningSince) / 60_000);
      return `${at} (${minutes} min)`;
    }
  }
}

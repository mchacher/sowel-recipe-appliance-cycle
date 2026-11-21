import { describe, it, expect } from "vitest";
import { buildSummary, hhmm } from "./summary.js";

const at = (h: number, m: number) => new Date(2026, 10, 21, h, m).getTime();

describe("buildSummary", () => {
  it("says each state in one French phrase", () => {
    const none = { runningSince: null, stateSince: null };
    expect(buildSummary(null, none)).toBe("En attente d'une mesure de puissance");
    expect(buildSummary("off", none)).toBe("Éteint");
    expect(buildSummary("ready", none)).toBe("Allumé, en attente");
  });

  it("gives the start of a running cycle when it was seen", () => {
    expect(buildSummary("running", { runningSince: at(14, 12), stateSince: at(14, 12) })).toBe(
      "En cours depuis 14:12",
    );
    expect(buildSummary("running", { runningSince: null, stateSince: at(9, 0) })).toBe("En cours");
  });

  it("gives the end, and the length when the start was seen", () => {
    expect(buildSummary("finished", { runningSince: at(14, 12), stateSince: at(15, 36) })).toBe(
      "Terminé à 15:36 (84 min)",
    );
    expect(buildSummary("finished", { runningSince: null, stateSince: at(15, 36) })).toBe(
      "Terminé à 15:36",
    );
  });

  it("formats local time with two digits", () => {
    expect(hhmm(at(7, 5))).toBe("07:05");
  });
});

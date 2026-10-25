import { describe, expect, it } from "vitest";

import { checkMove, checkStatusSet, movesFrom, statusOrder, statusSetProblems, undoOf } from "../src";
import { DECISION, INVOICE_STATE } from "./fixtures";

describe("a status set", () => {
  it("accepts Yomizaka's decision and Akinaza's derived invoice state", () => {
    expect(statusSetProblems(DECISION)).toEqual([]);
    expect(checkStatusSet(INVOICE_STATE)).toBe(INVOICE_STATE);
  });

  it("refuses what makes the set mean nothing", () => {
    const problems = statusSetProblems({
      ...DECISION,
      key: "Décision",
      states: [...DECISION.states, { key: "retenu", label: { fr: "", en: "x" }, tone: "pink", final: true }],
      initial: "retenu",
      transitions: [...DECISION.transitions, { from: "retenu", to: "a_decider", roles: ["owner"] }, { from: "a_decider", to: "a_decider", roles: [] }, { from: "a_decider", to: "retenu", roles: ["owner"] }],
    }).join("\n");
    for (const needle of ["key:", "« retenu » is used twice", "a label has fr and en", "tone is one of", "initial: never a final state", "a final state has no way out", "a move goes to another state", "roles is a non-empty list", "a_decider→retenu is declared twice"]) expect(problems).toContain(needle);
  });

  it("a derived set has no initial state and no transitions; any set has 2 to 12 states", () => {
    expect(statusSetProblems({ ...INVOICE_STATE, initial: "due", transitions: [{ from: "due", to: "paid", roles: ["owner"] }] })).toEqual(["a derived set has no initial state", "a derived set has no transitions: nobody moves it"]);
    expect(statusSetProblems({ ...INVOICE_STATE, states: INVOICE_STATE.states.slice(0, 1) })).toContain("states: 2 to 12");
    expect(() => checkStatusSet(null)).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });
});

describe("moves", () => {
  it("lists what a role may do from a state, in the set's order", () => {
    expect(movesFrom(DECISION, "a_decider", "owner").map((t) => t.to)).toEqual(["en_attente", "retenu", "non_retenu"]);
    expect(movesFrom(DECISION, "a_decider", "manager").map((t) => t.to)).toEqual(["en_attente"]);
    expect(movesFrom(DECISION, "retenu", "owner")).toEqual([]);
    expect(movesFrom(INVOICE_STATE, "due", "owner")).toEqual([]);
  });

  it("checks the move, the role and the reason", () => {
    expect(checkMove(DECISION, { from: "a_decider", to: "non_retenu", role: "owner" }).confirm).toBe(true);
    expect(checkMove(DECISION, { from: "a_decider", to: "non_retenu", role: "owner", reason: "incomplet" }).to).toBe("non_retenu");
    expect(() => checkMove(DECISION, { from: "a_decider", to: "non_retenu", role: "owner", reason: "il ne me plaît pas" })).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    expect(() => checkMove(DECISION, { from: "a_decider", to: "retenu", role: "owner", reason: "incomplet" })).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    expect(() => checkMove(DECISION, { from: "a_decider", to: "retenu", role: "manager" })).toThrow(expect.objectContaining({ code: "FORBIDDEN", status: 403 }));
    expect(() => checkMove(DECISION, { from: "retenu", to: "a_decider", role: "owner" })).toThrow(expect.objectContaining({ code: "MOVE_NOT_ALLOWED" }));
    expect(() => checkMove(INVOICE_STATE, { from: "due", to: "paid", role: "owner" })).toThrow(expect.objectContaining({ code: "STATUS_DERIVED" }));
  });

  it("undo is the reverse move, never out of a final state", () => {
    expect(undoOf(DECISION, { from: "a_decider", to: "en_attente" }, "manager")?.to).toBe("a_decider");
    expect(undoOf(DECISION, { from: "a_decider", to: "retenu" }, "owner")).toBeNull();
    expect(undoOf(DECISION, { from: "a_decider", to: "en_attente" }, "staff")).toBeNull();
    expect(undoOf(INVOICE_STATE, { from: "due", to: "paid" }, "owner")).toBeNull();
  });

  it("a status column is ordered by the set, never by a computed value", () => {
    const order = statusOrder(DECISION);
    const rows = [{ s: "non_retenu", score: 99 }, { s: "a_decider", score: 1 }, { s: "retenu", score: 50 }];
    expect(rows.sort((a, b) => order.get(a.s)! - order.get(b.s)!).map((r) => r.s)).toEqual(["a_decider", "retenu", "non_retenu"]);
  });
});

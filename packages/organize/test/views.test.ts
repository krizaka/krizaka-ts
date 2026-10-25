import { describe, expect, it } from "vitest";

import { checkViewFilters, isDay, parseView, sameFilters, viewHref, viewSearch } from "../src";
import { DECISION } from "./fixtures";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("the address is the state", () => {
  it("reads every filter, and drops what is malformed instead of failing", () => {
    const parsed = parseView(new URLSearchParams(`view=a_decider&tags=${A},nope,${A}&tags=${B}&status=retenu,Bad!&collection=${B}&from=2026-10-01&to=2026-10-31&q=  Tremblay   Marie `));
    expect(parsed).toEqual({ view: "a_decider", filters: { tags: [A, B], status: ["retenu"], collection: B, from: "2026-10-01", to: "2026-10-31", q: "Tremblay Marie" } });
    expect(parseView({ collection: "x", from: "2026-02-30", to: "demain", q: "x".repeat(101), view: "../etc" })).toEqual({ view: null, filters: {} });
    expect(parseView({ from: "2026-10-31", to: "2026-10-01" }).filters).toEqual({});
    expect(parseView({ tags: [A, B] }).filters.tags).toEqual([A, B]);
  });

  it("writes them back in one canonical order, and round-trips", () => {
    const filters = { q: "Marie", status: ["a_decider", "en_attente"], tags: [B, A], to: "2026-10-31" };
    expect(viewSearch(filters, "a_decider")).toBe(`view=a_decider&tags=${B},${A}&status=a_decider,en_attente&to=2026-10-31&q=Marie`);
    expect(parseView(new URLSearchParams(viewSearch(filters))).filters).toEqual(filters);
    expect(viewHref("/dossiers", {})).toBe("/dossiers");
    expect(viewHref("/dossiers", { q: "a&b" })).toBe("/dossiers?q=a%26b");
  });

  it("knows when two views select the same list", () => {
    expect(sameFilters({ tags: [A, B], status: ["retenu"] }, { status: ["retenu"], tags: [B, A] })).toBe(true);
    expect(sameFilters({ tags: [A] }, { tags: [A], q: "x" })).toBe(false);
  });

  it("a day exists in the calendar", () => {
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-29", "2026-13-01", "2026-1-01", "", null]) expect(isDay(bad), String(bad)).toBe(false);
  });
});

describe("a saved view", () => {
  it("is checked as it came, refused instead of trimmed", () => {
    expect(checkViewFilters({ tags: [A], status: ["retenu"], from: "2026-10-01", q: "Marie" }, DECISION)).toEqual({ tags: [A], status: ["retenu"], from: "2026-10-01", q: "Marie" });
    const message = (() => {
      try {
        checkViewFilters({ tags: ["x"], status: ["inconnu"], collection: 3, from: "2026-10-31", to: "2026-10-01", q: " Marie ", sort: "score", view: "x" }, DECISION);
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    })();
    for (const needle of ["sort: not a filter", "view: not a filter", "tags:", "status:", "collection:", "from: on or before to", "q:"]) expect(message).toContain(needle);
    expect(() => checkViewFilters({ status: ["retenu"] }, null)).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    expect(() => checkViewFilters([], DECISION)).toThrow();
  });
});

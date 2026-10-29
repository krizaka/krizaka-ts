import { describe, expect, it } from "vitest";

import { checkKindConfig, droppedStates, kindConfigProblems, MARKERS } from "../src";
import { DECISION, fileConfig, INVOICE_STATE } from "./fixtures";

describe("a kind's configuration", () => {
  it("accepts the pilot's, and an Akinaza invoice with a derived set and no system view", () => {
    expect(kindConfigProblems(fileConfig())).toEqual([]);
    expect(checkKindConfig({ ...fileConfig({ kind: "invoice", status: INVOICE_STATE, views: [] }) }).status).toBe(
      INVOICE_STATE,
    );
    expect(checkKindConfig({ ...fileConfig({ views: [] }), status: undefined }).status).toBeNull();
  });

  it("markers are the closed palette of names, never a hex", () => {
    expect(MARKERS).toEqual(["blue", "green", "amber", "red", "violet", "gray"]);
    expect(
      kindConfigProblems(
        fileConfig({
          tags: { ...fileConfig().tags, presets: { default: [{ name: "Urgent", marker: "#ff0000" as never }] } },
        }),
      ).join(),
    ).toContain("a marker of blue");
  });

  it("refuses what the editor must fix", () => {
    const problems = kindConfigProblems({
      kind: "File",
      tags: {
        writers: ["Owner"],
        userTags: "yes",
        max: 500,
        presets: {
          default: [
            { name: " Urgent", marker: "red" },
            { name: "a", marker: "red" },
            { name: "A", marker: "blue" },
          ],
          "Bad-Variant": [],
        },
      },
      status: { ...DECISION, initial: "nope" },
      views: [
        { key: "x", label: { fr: "X", en: "X" }, filters: { sort: "score" } },
        { key: "x", label: { fr: "X", en: "X" }, filters: {} },
      ],
    }).join("\n");
    for (const needle of [
      "kind:",
      "tags.writers",
      "tags.userTags",
      "tags.max: 1 to 200",
      "tags.presets.default[0]",
      "« A » twice",
      "a variant is a key",
      "status: initial",
      "views[0].filters",
      "« x » is used twice",
    ])
      expect(problems).toContain(needle);
    expect(() => checkKindConfig(null)).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("knows the states an edit drops", () => {
    const fewer = {
      ...DECISION,
      states: DECISION.states.filter((s) => s.key !== "en_attente"),
      transitions: DECISION.transitions.filter((t) => t.from !== "en_attente" && t.to !== "en_attente"),
    };
    expect(droppedStates(fileConfig(), fileConfig({ status: fewer }))).toEqual(["en_attente"]);
    expect(droppedStates(null, fileConfig())).toEqual([]);
    expect(droppedStates(fileConfig(), fileConfig({ status: null }))).toEqual([
      "a_decider",
      "en_attente",
      "retenu",
      "non_retenu",
    ]);
  });
});

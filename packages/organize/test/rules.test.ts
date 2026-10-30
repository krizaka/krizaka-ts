import { describe, expect, it } from "vitest";

import {
  cleanDescription,
  cleanName,
  DESCRIPTION_MAX,
  isId,
  isTagColor,
  NAME_MAX,
  parseTagsParam,
  TAG_COLORS,
  tagsHref,
  toggleTag,
} from "../src/rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("names", () => {
  it("collapses the spaces and trims; refuses empty and too long", () => {
    expect(cleanName("  Salon   Cèdre \n & Ciseaux ")).toBe("Salon Cèdre & Ciseaux");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(NAME_MAX))).toHaveLength(NAME_MAX);
    expect(cleanName("x".repeat(NAME_MAX + 1))).toBeNull();
  });
  it("a description may be empty (none), is trimmed, and is bounded", () => {
    expect(cleanDescription("  Un salon de quartier.\r\nOuvert le samedi. ")).toEqual({
      value: "Un salon de quartier.\nOuvert le samedi.",
    });
    expect(cleanDescription("   ")).toEqual({ value: null });
    expect(cleanDescription(null)).toEqual({ value: null });
    expect(cleanDescription("x".repeat(DESCRIPTION_MAX + 1))).toBeNull();
  });
});

describe("ids and colours", () => {
  it("accepts a UUID, nothing else", () => {
    expect(isId(A)).toBe(true);
    for (const bad of ["", "abc", 12, null, `${A}x`, "../etc/passwd"]) expect(isId(bad), String(bad)).toBe(false);
  });
  it("a tag colour is one of the named set", () => {
    expect(TAG_COLORS).toContain("blue");
    expect(isTagColor("amber")).toBe(true);
    expect(isTagColor("#ff0000")).toBe(false);
  });
});

describe("the tags parameter", () => {
  it("reads ids in order, once each, ignoring what is not an id", () => {
    expect(parseTagsParam(`${A},nope,${B},${A}`)).toEqual([A, B]);
    expect(parseTagsParam(undefined)).toEqual([]);
    expect(parseTagsParam([A, B])).toEqual([A, B]);
  });
  it("toggles a tag and builds the link that keeps the path", () => {
    expect(toggleTag([A], B)).toEqual([A, B]);
    expect(toggleTag([A, B], A)).toEqual([B]);
    expect(tagsHref("/shops", [A, B])).toBe(`/shops?tags=${A},${B}`);
    expect(tagsHref("/shops", [])).toBe("/shops");
  });
});

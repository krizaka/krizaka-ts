import { describe, expect, it } from "vitest";

import { checkSurface, family, findCodeNames, renderSurface, SURFACES } from "../src";

const START = "<!-- krizaka:family:start -->";
const END = "<!-- krizaka:family:end -->";

describe("krizaka-family render", () => {
  for (const surface of SURFACES) {
    for (const lang of ["en", "fr"] as const) {
      it(`${surface} in ${lang}`, () => {
        expect(renderSurface(surface, lang)).toMatchSnapshot();
      });
    }
  }

  it("wraps a block surface in the two markers and nothing else", () => {
    const out = renderSurface("org-profile", "en");
    expect(out.startsWith(START)).toBe(true);
    expect(out.trimEnd().endsWith(END)).toBe(true);
  });

  it("founder-profile says the facts of the hand version, with no private link and no code name", () => {
    const out = renderSurface("founder-profile", "en");
    for (const name of [
      "Verikora",
      "Sovkora",
      "Kridoc",
      "Folioviv",
      "Krizaka UI",
      "Krizaka TypeScript",
      "Krizaka Java",
      "Krizaka Rust",
      "Krizaka Lab",
    ]) {
      expect(out).toContain(`**[${name}](`);
    }
    expect(out.match(/In development\./g)).toHaveLength(4);
    expect(out).toContain("(https://github.com/krizaka/krizaka-rust)");
    expect(out).not.toContain("agents");
    expect(findCodeNames(out)).toEqual([]);
    for (const m of family.filter((x) => x.visibility === "private")) expect(out).not.toContain(m.name);
  });

  it("links a site only while it answers", () => {
    expect(renderSurface("repo-readme", "en")).not.toContain("rust.krizaka.com");
  });

  it("keeps every social bio inside its limit", () => {
    const out = renderSurface("social-bios", "en");
    for (const [, name, limit, text] of out.matchAll(/^## (\w+) \((\d+)\)\n(.+)$/gm)) {
      expect(text!.length, name).toBeLessThanOrEqual(Number(limit));
    }
  });
});

describe("krizaka-family check", () => {
  it("passes on its own output, inside a file with other text", () => {
    const file = `# Hello\n\n${renderSurface("org-profile", "en")}\n\nmore`;
    expect(checkSurface("org-profile", file, "en")).toEqual({ ok: true, diff: "" });
  });

  it("prints the diff with the expected view on a drift", () => {
    const stale = renderSurface("member-readme", "en").replace("In development", "Paused");
    const result = checkSurface("member-readme", stale, "en");
    expect(result.ok).toBe(false);
    expect(result.diff).toContain("- ");
    expect(result.diff).toContain("+ ");
    expect(result.diff).toContain("Paused");
  });

  it("reads a bio as the whole file", () => {
    expect(checkSurface("founder-bio", `${renderSurface("founder-bio", "fr")}\n`, "fr").ok).toBe(true);
    expect(checkSurface("founder-bio", "Yomizaka", "fr").ok).toBe(false);
  });

  it("reports a missing block", () => {
    expect(checkSurface("repo-readme", "# no block", "en").ok).toBe(false);
  });
});

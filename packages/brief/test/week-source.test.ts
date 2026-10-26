import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("the brief's week reads the local day from @krizaka/intl (krizaka-ts#77)", () => {
  const source = readFileSync(new URL("../src/week.ts", import.meta.url), "utf8");

  it("has no private Intl.DateTimeFormat of its own", () => {
    expect(source).not.toMatch(/Intl\.DateTimeFormat/);
  });

  it("takes the local calendar date from localDay", () => {
    expect(source).toMatch(/import \{[^}]*\blocalDay\b[^}]*\} from "@krizaka\/intl"/);
  });
});

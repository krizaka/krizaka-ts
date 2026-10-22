import { describe, expect, it } from "vitest";

import { compare, countStream } from "./sg-ratchet.mjs";

describe("sg-ratchet", () => {
  it("counts the violations per rule from the JSON stream", () => {
    const stream = ['{"ruleId":"a"}', '{"ruleId":"b"}', "", '{"ruleId":"a"}', "not json"].join("\n");
    expect(countStream(stream)).toEqual({ a: 2, b: 1 });
  });

  it("fails when a count goes up", () => {
    const r = compare({ a: 2, b: 0 }, { a: 3 }, ["a", "b"]);
    expect(r.ok).toBe(false);
    expect(r.increased).toEqual(["a"]);
  });

  it("passes and lowers when a count goes down, never raises", () => {
    const r = compare({ a: 5 }, { a: 2 }, ["a"]);
    expect(r.ok).toBe(true);
    expect(r.decreased).toEqual(["a"]);
    expect(r.next).toEqual({ a: 2 });
  });

  it("refuses a rule that is not recorded yet", () => {
    const r = compare({ a: 1 }, { a: 1, c: 4 }, ["a", "c"]);
    expect(r.ok).toBe(false);
    expect(r.unrecorded).toEqual(["c"]);
    expect(r.next.c).toBe(4);
  });
});

import { withDateFnsImports } from "./sg-fix.mjs";

describe("sg-fix", () => {
  it("adds the date-fns import after the last import", () => {
    const out = withDateFnsImports('import a from "a";\nimport b from "b";\n\nconst x = hoursToMilliseconds(2);\n');
    expect(out).toContain('import b from "b";\nimport { hoursToMilliseconds } from "date-fns";');
  });
  it("merges into an existing date-fns import and is idempotent", () => {
    const src = 'import { addDays } from "date-fns";\nconst x = minutesToMilliseconds(5) + addDays(1);\n';
    const out = withDateFnsImports(src);
    expect(out).toContain('import { addDays, minutesToMilliseconds } from "date-fns";');
    expect(withDateFnsImports(out)).toBe(out);
  });
});

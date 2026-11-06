import { CODE_NAMES } from "@krizaka/org";
import { describe, expect, it } from "vitest";

import { defineSettings, DISPLAY_NAME_KEY, displayNameSetting } from "../src";

describe("the displayed name as a setting (krizaka-internal#2035)", () => {
  const def = displayNameSetting("verikora");

  it("defaults to the commercial name, in the brand group, set globally", () => {
    expect(def.default).toBe("Verikora");
    expect(def.group).toBe("brand");
    expect(def.scopes).toEqual(["global"]);
    expect(defineSettings({ [DISPLAY_NAME_KEY]: def }).keys).toEqual(["brand.displayName"]);
  });

  it("accepts a name of the administrator's, refuses a code name, an empty or a long one", () => {
    expect(def.schema.parse("  Verikora Pro ")).toBe("Verikora Pro");
    for (const retired of Object.keys(CODE_NAMES)) expect(def.schema.safeParse(retired).success, retired).toBe(false);
    expect(def.schema.safeParse("").success).toBe(false);
    expect(def.schema.safeParse("x".repeat(31)).success).toBe(false);
  });
});

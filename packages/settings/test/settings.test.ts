import { describe, expect, it } from "vitest";

import { ALL_SCOPES, bilingual, choice, dbSettings, defineSettings, describeSettings, flag, GLOBAL, integer, resolveValue, SCOPE, type ScopeRef, seedLegacySettings, SettingsError, settingsMigration, subset, WORKSPACE_SCOPES } from "../src";
import { databaseEnabled, testDatabase } from "./database";

/** A registry of the kinds a product uses. */
const registry = {
  "app.maintenance": flag("general", false),
  "app.message": bilingual("general", { fr: "Retour bientôt.", en: "Back soon." }),
  "signup.open": flag("general", false),
  "payments.display": choice("general", ["test", "live"], "test"),
  "features.insight": flag("features", true, ALL_SCOPES),
  "features.apiKeys": flag("features", true, WORKSPACE_SCOPES),
  "features.set": subset("features", ["a", "b", "c"], ["a", "b", "c"]),
  "limits.maxFileMb": integer("limits", 10, { min: 1, max: 10, unit: "MB" }, WORKSPACE_SCOPES),
  "limits.bonus": integer("limits", 0, { min: 0, max: 100 }, [SCOPE.user]),
  "plans.pro": integer("plans", 100, { min: 1, max: 1000 }),
} as const;
const settings = defineSettings(registry);

describe("the registry", () => {
  it.each(settings.keys)("%s: its default is valid for its own schema and it can be set somewhere", (key) => {
    const def = settings.defOf(key);
    expect(def.schema.safeParse(def.default).success).toBe(true);
    expect(def.scopes.length).toBeGreaterThan(0);
  });
  it("knows what is a setting, and the keys of a group", () => {
    expect(settings.isKey("app.maintenance")).toBe(true);
    expect(settings.isKey("toString")).toBe(false);
    expect(settings.keysOfGroup("limits")).toEqual(["limits.maxFileMb", "limits.bonus"]);
  });
  it("describes itself JSON-safe for an admin screen (no schema)", () => {
    const d = describeSettings(settings);
    expect(d).toHaveLength(settings.keys.length);
    expect(d.find((x) => x.key === "limits.maxFileMb")).toEqual({ key: "limits.maxFileMb", group: "limits", kind: "integer", default: 10, scopes: ["global", "workspace"], min: 1, max: 10, unit: "MB", choices: undefined });
    expect(JSON.parse(JSON.stringify(d))).toHaveLength(settings.keys.length);
  });
  it.each([11, 0, 1.5])("an integer outside its bounds is refused: %s", (n) => expect(settings.defOf("limits.maxFileMb").schema.safeParse(n).success).toBe(false));
});

describe("the effective value is user, then workspace, then global, then the default", () => {
  const def = settings.defOf("features.insight");
  it.each([
    ["nothing set", {}, true, "default"],
    ["global off", { global: false }, false, "global"],
    ["workspace on over global off", { global: false, workspace: true }, true, "workspace"],
    ["user off over workspace on", { global: false, workspace: true, user: false }, false, "user"],
    ["user alone", { user: false }, false, "user"],
  ] as const)("%s", (_name, layers, value, source) => expect(resolveValue(def, layers)).toEqual({ value, source }));
  it("a scope the setting cannot be set at is never read (maintenance is global only)", () => {
    expect(resolveValue(settings.defOf("app.maintenance"), { user: true, workspace: true })).toEqual({ value: false, source: "default" });
  });
  it("a deployment default replaces the registry's default but never an override", () => {
    expect(resolveValue(settings.defOf("signup.open"), {}, true)).toEqual({ value: true, source: "default" });
    expect(resolveValue(settings.defOf("signup.open"), { global: false }, true)).toEqual({ value: false, source: "global" });
  });
});

/** The adapter against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const NOW = new Date("2026-10-22T12:00:00Z");
const ADMIN = { id: null, label: "admin@test.example" };

describe.runIf(databaseEnabled)("the settings service on PostgreSQL", () => {
  const query = testDatabase("set", settingsMigration());
  const workspaces = new Map<string, string>();
  const service = () => dbSettings(settings, { query: (s, p) => query(s, p), workspaceOf: async (u) => workspaces.get(u) ?? null, cacheMs: 0 });
  const user = (id: string): ScopeRef => ({ scope: "user", id });
  const workspace = (id: string): ScopeRef => ({ scope: "workspace", id });


  it("returns the default until something is set, then the global value", async () => {
    expect(await service().get("features.insight")).toBe(true);
    await service().set(ADMIN, GLOBAL, "features.insight", false, NOW);
    expect(await service().get("features.insight")).toBe(false);
  });

  it("resolves user over workspace over global, and says where each value comes from", async () => {
    workspaces.set("u1", "w1");
    await service().set(ADMIN, workspace("w1"), "features.insight", true, NOW);
    expect(await service().get("features.insight", { userId: "u1" })).toBe(true);
    expect(await service().get("features.insight", { userId: "somebody-else" })).toBe(false);
    await service().set(ADMIN, user("u1"), "features.insight", false, NOW);
    expect(await service().get("features.insight", { userId: "u1" })).toBe(false);
    expect((await service().snapshot({ userId: "u1" }))["features.insight"]).toEqual({ value: false, source: "user" });
    await service().reset(ADMIN, user("u1"), "features.insight", NOW);
    expect((await service().snapshot({ userId: "u1" }))["features.insight"]).toEqual({ value: true, source: "workspace" });
  });

  it("refuses a value that is not valid, a setting that does not exist and a scope it cannot be set at", async () => {
    await expect(service().set(ADMIN, GLOBAL, "limits.maxFileMb", 50, NOW)).rejects.toMatchObject({ status: 400, code: "BAD_VALUE" });
    await expect(service().set(ADMIN, GLOBAL, "features.insight", "yes", NOW)).rejects.toMatchObject({ code: "BAD_VALUE" });
    await expect(service().set(ADMIN, GLOBAL, "nothing.here", true, NOW)).rejects.toMatchObject({ status: 404, code: "UNKNOWN_SETTING" });
    await expect(service().set(ADMIN, user("u1"), "app.maintenance", true, NOW)).rejects.toMatchObject({ code: "BAD_SCOPE" });
    await expect(service().set(ADMIN, { scope: "user", id: "" }, "features.insight", true, NOW)).rejects.toBeInstanceOf(SettingsError);
    expect(await service().get("app.maintenance")).toBe(false);
  });

  it("keeps who changed what, when, before and after — and a reset is recorded too", async () => {
    await service().set(ADMIN, GLOBAL, "payments.display", "live", NOW);
    await service().set(ADMIN, GLOBAL, "payments.display", "test", new Date("2026-10-22T13:00:00Z"));
    await service().reset(ADMIN, GLOBAL, "payments.display", new Date("2026-10-22T14:00:00Z"));
    const h = await service().history({ key: "payments.display" });
    expect(h.map((e) => [e.before, e.after])).toEqual([["test", null], ["live", "test"], [null, "live"]]);
    expect(h[0]).toMatchObject({ actorLabel: "admin@test.example", scope: "global", scopeId: "", at: "2026-10-22T14:00:00.000Z" });
  });

  it("a change is visible at once on this instance even with a cache; a deployment default is used until an override exists", async () => {
    const cached = dbSettings(settings, { query: (s, p) => query(s, p), cacheMs: 60_000, clock: () => 1 });
    expect(await cached.get("features.apiKeys")).toBe(true);
    await cached.set(ADMIN, GLOBAL, "features.apiKeys", false, NOW);
    expect(await cached.get("features.apiKeys")).toBe(false);
    const legacy = dbSettings(settings, { query: (s, p) => query(s, p), cacheMs: 0, defaults: { "signup.open": true } });
    expect(await legacy.get("signup.open")).toBe(true);
    await legacy.set(ADMIN, GLOBAL, "signup.open", false, NOW);
    expect(await legacy.get("signup.open")).toBe(false);
  });

  it("lists what is overridden at a scope; a person's snapshot carries their own value", async () => {
    await service().set(ADMIN, user("u9"), "limits.bonus", 20, NOW);
    expect(await service().overrides(user("u9"))).toEqual({ "limits.bonus": 20 });
    expect((await service().snapshot({ userId: "u9" }))["limits.bonus"]).toEqual({ value: 20, source: "user" });
    expect((await service().snapshot())["limits.bonus"]).toEqual({ value: 0, source: "default" });
  });

  it("legacy environment values are written once, only when they differ from the default and nobody set them since", async () => {
    await query("DELETE FROM app_settings WHERE key IN ('signup.open', 'plans.pro')");
    const s = service();
    expect(await seedLegacySettings(settings, s, { "signup.open": true, "plans.pro": 250, "payments.display": "test" }, NOW)).toEqual(["signup.open", "plans.pro"]);
    await s.set(ADMIN, GLOBAL, "signup.open", false, NOW);
    expect(await seedLegacySettings(settings, s, { "signup.open": true, "plans.pro": 250 }, NOW)).toEqual([]);
    expect(await s.get("signup.open")).toBe(false);
    expect(await s.get("plans.pro")).toBe(250);
  });
});

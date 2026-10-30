/**
 * What every WorkspaceStore adapter must do (ADR-003): the same behaviour behind the same port. A product that writes its own
 * adapter runs it too. `make` gives a store and the means to create what the store does not own: scopes, users, entities.
 */
import { expect, it } from "vitest";

import type { KindConfig } from "./config";
import { ORGANIZE_CODE } from "./errors";
import type { WorkspaceStore } from "./workspace-port";

export interface WorkspaceFixture {
  store: WorkspaceStore;
  /** A new scope (a shop, an account). */
  scope(): Promise<string>;
  /** A new person. */
  user(): Promise<string>;
  /** A new entity of `kind` in a scope. */
  entity(scope: string): Promise<string>;
}

/** A configuration the contract writes (the store keeps it as given; checking it is the service's). */
export const contractConfig = (kind: string): KindConfig => ({
  kind,
  tags: { writers: ["owner"], userTags: true, max: 20, presets: {} },
  status: null,
  views: [],
});

/**
 * @param name the adapter's name, shown in the test titles
 * @param kind a kind the adapter declares
 * @param make builds a fixture (one per case; cases may share a database)
 */
export function workspaceStoreContract(name: string, kind: string, make: () => Promise<WorkspaceFixture>) {
  const at = new Date("2026-10-25T09:00:00Z");
  const nameTaken = { code: ORGANIZE_CODE.nameTaken };

  it(`${name}: a configuration is written once, then only from the version it was read at`, async () => {
    const { store } = await make();
    const k = `${kind}_c${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
    const config = contractConfig(k);
    expect(await store.config(k)).toBeNull();
    expect(await store.saveConfig(k, config, null, at, null)).toBe(1);
    expect(await store.saveConfig(k, config, null, at, null)).toBeNull();
    expect(await store.saveConfig(k, { ...config, tags: { ...config.tags, max: 5 } }, 1, at, null)).toBe(2);
    expect(await store.saveConfig(k, config, 1, at, null)).toBeNull();
    expect(await store.config(k)).toEqual({ config: { ...config, tags: { ...config.tags, max: 5 } }, version: 2 });
  });

  it(`${name}: only the scope's entities are in the scope`, async () => {
    const f = await make();
    const [a, b] = [await f.scope(), await f.scope()];
    const [x, y] = [await f.entity(a), await f.entity(b)];
    expect(await f.store.inScope(a, kind, [x, y])).toEqual([x]);
    expect(await f.store.inScope(a, kind, [x], { lock: true })).toEqual([x]);
    expect(await f.store.inScope(b, kind, [])).toEqual([]);
  });

  it(`${name}: tags are the scope's, by kind, named once (case ignored), listed by name`, async () => {
    const f = await make();
    const [a, b] = [await f.scope(), await f.scope()];
    const zinc = await f.store.addTag(a, kind, { name: "Zinc", marker: "gray", origin: "user" }, at);
    await f.store.addTag(a, kind, { name: "argent", marker: "blue", origin: "preset" }, at);
    expect(zinc).toMatchObject({ kind, name: "Zinc", marker: "gray", origin: "user" });
    await expect(f.store.addTag(a, kind, { name: "zinc", marker: "red", origin: "user" }, at)).rejects.toMatchObject(
      nameTaken,
    );
    await f.store.addTag(b, kind, { name: "Zinc", marker: "red", origin: "user" }, at);
    expect((await f.store.tags(a, kind)).map((t) => t.name)).toEqual(["argent", "Zinc"]);
    expect(await f.store.updateTag(a, kind, zinc.id, { marker: "violet" })).toMatchObject({
      name: "Zinc",
      marker: "violet",
    });
    await expect(f.store.updateTag(a, kind, zinc.id, { name: "ARGENT" })).rejects.toMatchObject(nameTaken);
    expect(await f.store.updateTag(b, kind, zinc.id, { name: "Ailleurs" })).toBeNull();
    expect(await f.store.removeTag(b, kind, zinc.id)).toBe(false);
    expect(await f.store.removeTag(a, kind, zinc.id)).toBe(true);
    expect((await f.store.tags(a, kind)).map((t) => t.name)).toEqual(["argent"]);
  });

  it(`${name}: entities wear tags; linking twice is once, and a removed tag comes off`, async () => {
    const f = await make();
    const scope = await f.scope();
    const [x, y] = [await f.entity(scope), await f.entity(scope)];
    const [t1, t2] = [
      await f.store.addTag(scope, kind, { name: "Un", marker: "blue", origin: "user" }, at),
      await f.store.addTag(scope, kind, { name: "Deux", marker: "green", origin: "user" }, at),
    ];
    await f.store.link(kind, [
      { entityId: x, tagId: t1.id },
      { entityId: x, tagId: t2.id },
      { entityId: y, tagId: t1.id },
    ]);
    await f.store.link(kind, [{ entityId: x, tagId: t1.id }]);
    const worn = await f.store.tagsOf(kind, [x, y]);
    const byText = (a: string, b: string) => a.localeCompare(b);
    expect(worn.get(x)?.sort(byText)).toEqual([t1.id, t2.id].sort(byText));
    expect(worn.get(y)).toEqual([t1.id]);
    await f.store.unlink(kind, [{ entityId: x, tagId: t2.id }]);
    await f.store.removeTag(scope, kind, t1.id);
    const after = await f.store.tagsOf(kind, [x, y]);
    expect(after.get(x) ?? []).toEqual([]);
    expect(after.get(y) ?? []).toEqual([]);
  });

  it(`${name}: a state is kept per entity, and the states in use are known`, async () => {
    const f = await make();
    const scope = await f.scope();
    const by = await f.user();
    const [x, y] = [await f.entity(scope), await f.entity(scope)];
    expect((await f.store.states(kind, [x])).size).toBe(0);
    await f.store.setState(kind, x, "retenu", at, by);
    await f.store.setState(kind, x, "non_retenu", new Date("2026-10-25T10:00:00Z"), null);
    await f.store.setState(kind, y, "retenu", at, by);
    const states = await f.store.states(kind, [x, y]);
    expect(states.get(x)).toEqual({ state: "non_retenu", changedAt: new Date("2026-10-25T10:00:00Z") });
    expect(await f.store.statesInUse(kind, ["retenu", "a_decider", "non_retenu"])).toEqual(
      expect.arrayContaining(["non_retenu", "retenu"]),
    );
    expect(await f.store.statesInUse(kind, ["jamais_vu"])).toEqual([]);
  });

  it(`${name}: views are their author's, or the workspace's when shared; another scope never sees them`, async () => {
    const f = await make();
    const [scope, other] = [await f.scope(), await f.scope()];
    const [eric, lea] = [await f.user(), await f.user()];
    const mine = await f.store.addView(
      scope,
      { kind, authorId: eric, name: "À rappeler", filters: { status: ["a_decider"] }, shared: false },
      at,
    );
    const team = await f.store.addView(
      scope,
      { kind, authorId: lea, name: "Équipe", filters: { q: "Tremblay" }, shared: true },
      at,
    );
    await f.store.addView(scope, { kind, authorId: lea, name: "Privée", filters: {}, shared: false }, at);
    await expect(
      f.store.addView(scope, { kind, authorId: eric, name: "à rappeler", filters: {}, shared: false }, at),
    ).rejects.toMatchObject(nameTaken);
    expect((await f.store.views(scope, kind, eric)).map((v) => v.name)).toEqual(["À rappeler", "Équipe"]);
    expect(mine).toMatchObject({ kind, authorId: eric, filters: { status: ["a_decider"] }, shared: false });
    expect(await f.store.view(other, team.id)).toBeNull();
    expect(await f.store.updateView(scope, mine.id, { shared: true, filters: { tags: [] } })).toMatchObject({
      name: "À rappeler",
      shared: true,
      filters: { tags: [] },
    });
    expect(await f.store.updateView(other, mine.id, { name: "x" })).toBeNull();
    expect(await f.store.removeView(other, mine.id)).toBe(false);
    expect(await f.store.removeView(scope, mine.id)).toBe(true);
    expect(await f.store.view(scope, mine.id)).toBeNull();
  });
}

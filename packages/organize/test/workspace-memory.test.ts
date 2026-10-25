import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { memoryWorkspaceStore } from "../src";
import { workspaceStoreContract } from "../src/testkit";

describe("the memory store", () => {
  workspaceStoreContract("memory", "file", async () => {
    const files = new Map<string, string>();
    return {
      store: memoryWorkspaceStore(new Map([["file", files]])),
      scope: async () => crypto.randomUUID(),
      user: async () => crypto.randomUUID(),
      entity: async (scope) => {
        const id = crypto.randomUUID();
        files.set(id, scope);
        return id;
      },
    };
  });

  it("keeps its own copies: nothing given or read changes what it stores", async () => {
    const store = memoryWorkspaceStore();
    const scope = crypto.randomUUID();
    const filters: { tags: string[] } = { tags: [crypto.randomUUID()] };
    const view = await store.addView(scope, { kind: "file", authorId: crypto.randomUUID(), name: "Copie", filters, shared: false }, new Date("2026-10-25T09:00:00Z"));
    filters.tags.push("changed");
    view.filters.tags!.push("changed too");
    expect((await store.view(scope, view.id))?.filters.tags).toHaveLength(1);
  });
});

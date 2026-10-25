import crypto from "node:crypto";

import { describe } from "vitest";

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
});

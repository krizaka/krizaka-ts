import { describe, expect, it } from "vitest";

import { memoryApiKeyStore } from "../src/memory";
import { apiKeyStoreContract } from "../src/testkit";

describe("api key store: memory", () => {
  it("is a fresh, empty store each time", async () => {
    expect(await memoryApiKeyStore().list("owner-1")).toEqual([]);
  });
  apiKeyStoreContract("memory", memoryApiKeyStore, (n) => `owner-${n}`);
});

import { expect, it } from "vitest";

import { dbApiKeyStore, pgApiKeyStore } from "../src";

it("the old technology-named export is the same function as its functional name, kept one minor", () => {
  expect(pgApiKeyStore).toBe(dbApiKeyStore);
});

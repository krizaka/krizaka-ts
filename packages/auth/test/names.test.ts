import { expect, it } from "vitest";

import { dbAccounts, postgresAccounts } from "../src";

it("the old technology-named export is the same function as its functional name, kept one minor", () => {
  expect(postgresAccounts).toBe(dbAccounts);
});

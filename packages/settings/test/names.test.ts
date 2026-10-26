import { expect, it } from "vitest";

import { dbSettings, postgresSettings } from "../src";

it("the old technology-named export is the same function as its functional name, kept one minor", () => {
  expect(postgresSettings).toBe(dbSettings);
});

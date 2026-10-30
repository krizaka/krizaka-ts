import { describe, expect, it, vi } from "vitest";

// A bundler that serves the barrel to the browser (a client component imports `can` or a role table from it) replaces
// `node:crypto` by a shim without `scrypt`: loading the module must not call it (akinaza#515: `promisify(undefined)` threw
// at load and blanked every page of the shop).
//
// The test re-imports the whole barrel after `vi.resetModules()`, so every module of the package and its dependencies (the database client,
// the validators) is transformed and loaded again: ~1 s warm, 5.4 s on a loaded CI runner (krizaka-ts#229, the cause of that timeout, not
// scrypt, which this test never runs). It gets the budget of a cold import instead of the 5 s default; `timeouts.test.ts` keeps every such test explicit.
const COLD_IMPORT_TIMEOUT_MS = 30_000;

describe("the barrel loads where node:crypto has no scrypt", () => {
  it(
    "does not touch scrypt until a password is hashed",
    async () => {
      vi.resetModules();
      vi.doMock("node:crypto", async (original) => ({
        ...(await original<typeof import("node:crypto")>()),
        default: {},
      }));
      vi.doMock("node:util", () => ({
        promisify: () => {
          throw new TypeError('The "original" argument must be of type Function');
        },
      }));
      const barrel = await import("../src/index");
      expect(typeof barrel.can).toBe("function");
      vi.doUnmock("node:crypto");
      vi.doUnmock("node:util");
    },
    COLD_IMPORT_TIMEOUT_MS,
  );
});

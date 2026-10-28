import { describe, expect, it, vi } from "vitest";

// A bundler that serves the barrel to the browser (a client component imports `can` or a role table from it) replaces
// `node:crypto` by a shim without `scrypt`: loading the module must not call it (akinaza#515: `promisify(undefined)` threw
// at load and blanked every page of the shop).
describe("the barrel loads where node:crypto has no scrypt", () => {
  it("does not touch scrypt until a password is hashed", async () => {
    vi.resetModules();
    vi.doMock("node:crypto", async (original) => ({ ...(await original<typeof import("node:crypto")>()), default: {} }));
    vi.doMock("node:util", () => ({ promisify: () => { throw new TypeError('The "original" argument must be of type Function'); } }));
    const barrel = await import("../src/index");
    expect(typeof barrel.can).toBe("function");
    vi.doUnmock("node:crypto");
    vi.doUnmock("node:util");
  });
});

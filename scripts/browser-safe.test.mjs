import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// Bug -> guard (akinaza#515, krizaka-ts#218): `@krizaka/auth` ran `promisify(crypto.scrypt)` at load, so a client import of the barrel
// threw in the browser. A package declares the entries a browser may import in package.json (`"krizaka": { "browserSafe": ["./client"] }`,
// `./x` is `src/x.ts`); each one is bundled for the browser platform with its dependencies, and any `node:*` built-in it reaches fails.
const packages = readdirSync("packages")
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join("packages", dir, "package.json"), "utf8")) }))
  .filter(({ manifest }) => manifest.krizaka?.browserSafe?.length);

describe("browser-safe entries import no node built-in", () => {
  it("at least one package declares an entry", () => expect(packages.length).toBeGreaterThan(0));
  for (const { dir, manifest } of packages) {
    for (const entry of manifest.krizaka.browserSafe) {
      it(`${manifest.name}${entry.slice(1)}`, async () => {
        const result = await build({ entryPoints: [join("packages", dir, "src", `${entry.slice(2)}.ts`)], bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent" }).then(
          () => null,
          (error) => error,
        );
        const reasons = (result?.errors ?? []).map((e) => e.text);
        expect(reasons, `${manifest.name}${entry.slice(1)} must not reach a node built-in`).toEqual([]);
      });
    }
  }
});

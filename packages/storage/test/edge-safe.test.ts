import { resolve } from "node:path";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const entry = (name: string) => resolve(import.meta.dirname, "../src", name);

/** Bundle an entry the way an Edge or browser build would: Node built-ins are not available, so any `node:` or `fs` import fails or shows up. */
async function bundle(file: string) {
  return build({ entryPoints: [entry(file)], bundle: true, write: false, platform: "browser", format: "esm", metafile: true, logLevel: "silent" });
}

describe("the default entry is safe on Edge and in the browser", () => {
  it("bundles for the browser without any node: or fs import", async () => {
    const result = await bundle("index.ts");
    const imports = Object.values(result.metafile.inputs).flatMap((input) => input.imports.map((i) => i.path));
    expect(imports.filter((path) => /^(node:|fs$|fs\/|crypto$|path$)/.test(path))).toEqual([]);
    expect(result.outputFiles[0]?.text).not.toMatch(/node:|fs\/promises/);
  });

  it("the Node entry is the one that carries them", async () => {
    await expect(bundle("node.ts")).rejects.toThrow();
  });
});

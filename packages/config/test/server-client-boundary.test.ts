import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkBoundary, functionNames } from "../ratchet/server-client-boundary.js";

const BIN = fileURLToPath(new URL("../bin/krizaka-server-client-boundary.mjs", import.meta.url));

let root: string;
const put = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "krizaka-boundary-"));
  put("tsconfig.json", `{ // comment\n "compilerOptions": { "paths": { "@/*": ["./src/*"], }, }, }`);
  put("node_modules/@krizaka/ui/package.json", JSON.stringify({ name: "@krizaka/ui", exports: { "./filter-bar": { import: "./dist/filter-bar.js" }, "./format": "./dist/format.js" } }));
  put("node_modules/@krizaka/ui/dist/filter-bar.js", `"use client";\nexport const FilterBar = 1; export const readFilterParams = 2;`);
  put("node_modules/@krizaka/ui/dist/format.js", `export const formatDate = 1;`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("functionNames", () => {
  it("keeps the lowercase value names, not components nor types", () => {
    expect(functionNames("{ FilterBar, readFilterParams, type Props, useThing as use2 }")).toEqual(["readFilterParams", "useThing"]);
    expect(functionNames("{ FilterBar }")).toEqual([]);
    expect(functionNames("readIt")).toEqual(["readIt"]);
  });
});

describe("checkBoundary", () => {
  it("fails when a server page, through a local module, imports a function from a client module", () => {
    put("src/app/page.tsx", `import { list } from "@/lib/list";\nexport default () => list;`);
    put("src/lib/list.ts", `import { readFilterParams } from "@krizaka/ui/filter-bar";\nexport const list = readFilterParams;`);
    const { offences } = checkBoundary({ root });
    expect(offences).toEqual(['src/lib/list.ts imports readFilterParams from @krizaka/ui/filter-bar ("use client")']);
    const run = spawnSync(process.execPath, [BIN, "--root", root], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("readFilterParams");
  });

  it("accepts a component, a type, a plain module's function and anything below a client file", () => {
    put("src/app/page.tsx", `import { FilterBar } from "@krizaka/ui/filter-bar";\nimport type { x } from "@krizaka/ui/filter-bar";\nimport { formatDate } from "@krizaka/ui/format";\nimport { Panel } from "./panel";`);
    put("src/app/panel.tsx", `"use client";\nimport { readFilterParams } from "@krizaka/ui/filter-bar";\nexport const Panel = readFilterParams;`);
    const { offences, seen } = checkBoundary({ root });
    expect(offences).toEqual([]);
    expect(seen.size).toBe(2);
    expect(spawnSync(process.execPath, [BIN, "--root", root], { encoding: "utf8" }).status).toBe(0);
  });

  it("reads a multi-line import, a re-export, and a client directive after comments", () => {
    put("src/app/page.tsx", `import {\n  FilterBar,\n  readFilterParams as read,\n} from "@krizaka/ui/filter-bar";\nexport { writeIt } from "@krizaka/ui/filter-bar";\nimport "./panel";`);
    put("src/app/panel.tsx", `/* a banner\n   over two lines */\n// and a line\n'use client';\nimport { readFilterParams } from "@krizaka/ui/filter-bar";`);
    expect(checkBoundary({ root }).offences).toEqual([
      'src/app/page.tsx imports readFilterParams from @krizaka/ui/filter-bar ("use client")',
      'src/app/page.tsx imports writeIt from @krizaka/ui/filter-bar ("use client")',
    ]);
  });

  it("refuses without an app folder", () => {
    rmSync(join(root, "src"), { recursive: true, force: true });
    expect(() => checkBoundary({ root })).toThrow(/No app folder/);
  });
});

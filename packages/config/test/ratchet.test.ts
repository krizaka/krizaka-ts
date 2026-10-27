import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { countRepository, countSource, countStackSource, runRatchet } from "../ratchet/ratchet.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/repo", import.meta.url));
const BIN = fileURLToPath(new URL("../bin/krizaka-ratchet.mjs", import.meta.url));
const UI = { palette: 6, light: 3, arbitraryVar: 2, classNameTemplate: 2 };
// lib/use-data.ts (fetch in a client effect ×2, data loaded in an effect ×1, + lib/server-data.ts ×1, @tanstack ×2) · features/forms.tsx (a table, a form of two fields)
const STACK = { fetchInClientEffect: 2, asyncInEffect: 2, derivedStateInEffect: 0, directTanstackImport: 2, localTableOrForm: 2, retiredImport: 0, routeStateSelection: 0, cognitiveComplexity: 0, sonar: 0 };
const TOTAL = { ...UI, ...STACK };
const STACK_GLOBS = ["app", "components", "src", "lib", "hooks", "features"].map((d) => `${d}/**/*.{js,jsx,mjs,ts,tsx,mts}`);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "krizaka-ratchet-"));
  cpSync(FIXTURE, root, { recursive: true });
  // a dependency is never scanned, even under a scanned folder
  mkdirSync(join(root, "src/node_modules/dep"), { recursive: true });
  writeFileSync(join(root, "src/node_modules/dep/index.tsx"), `<b className="bg-red-500 light:bg-red-100" />`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ratchetFile = () => JSON.parse(readFileSync(join(root, "lint-ratchet.json"), "utf8"));
const addDebt = (code: string) => writeFileSync(join(root, "components/new.tsx"), code);
const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, "--root", root, ...args], { encoding: "utf8" });

describe("countSource", () => {
  it("counts every occurrence of the four patterns", () => {
    expect(countSource(`<a className="bg-zinc-900 text-violet-400/80 light:bg-white border-[var(--x)]" />`)).toEqual({
      palette: 2,
      light: 1,
      arbitraryVar: 1,
      classNameTemplate: 0,
    });
    expect(countSource("<a className={`a ${b}`} /><a className={ `c` } />").classNameTemplate).toBe(2);
  });

  it("ignores roles, unknown families and words that only end in light", () => {
    expect(countSource(`"bg-surface-1 text-fg-secondary text-accent bg-white/10 twilight: bg-lime-500 text-zinc"`)).toEqual({
      palette: 0,
      light: 0,
      arbitraryVar: 0,
      classNameTemplate: 0,
    });
  });

  it("honours the allowlist of families", () => {
    expect(countSource(`"bg-emerald-600 text-rose-300"`, ["emerald"]).palette).toBe(1);
  });
});

describe("countStackSource", () => {
  it("counts a fetch only inside the effects of a client file", () => {
    const effect = `useEffect(() => { fetch(a); window.fetch(b); refetch(); }, []);\nconst f = () => fetch(c);`;
    expect(countStackSource(`"use client";\n${effect}`).fetchInClientEffect).toBe(2);
    expect(countStackSource(`// a "use client" word in a comment\n${effect}`).fetchInClientEffect).toBe(0);
    expect(countStackSource(`/* header */\n'use client'\nReact.useLayoutEffect(() => void krizakaFetch(u))`).fetchInClientEffect).toBe(1);
  });

  it("counts the effects that load data and the effects that only set state, in any file", () => {
    const code = [
      `useEffect(() => { invoke("list", { dir }).then(setFiles); }, [dir]);`,
      `useEffect(() => { void (async () => { setX(await api.get(id)); })(); }, [id]);`,
      `useEffect(() => { setDir(root); }, [root]);`,
      `useEffect(() => { if (!open) { setQuery(""); setPage(0); } }, [open]);`,
      `useEffect(() => { const un = listen("file-added", async () => { await qc.invalidateQueries(); }); return () => { void un.then((f) => f()); }; }, []);`,
      `useEffect(() => { const url = URL.createObjectURL(blob); setUrl(url); return () => URL.revokeObjectURL(url); }, [blob]);`,
      `useEffect(() => { document.title = "x"; }, []);`,
      `useEffect(() => { const off = on<Probe>("stack-probe", (p) => setProbe(p)); return () => { void off.then((f) => f()); }; }, []);`,
    ].join("\n");
    expect(countStackSource(code)).toMatchObject({ asyncInEffect: 2, derivedStateInEffect: 2 });
  });

  it("counts every form of @tanstack import, never the facades", () => {
    const code = [
      `import { useQuery } from "@tanstack/react-query";`,
      `export * from "@tanstack/table-core";`,
      `const v = await import("@tanstack/react-virtual");`,
      `import { useKrizakaQuery } from "@krizaka/query";`,
    ].join("\n");
    expect(countStackSource(code).directTanstackImport).toBe(3);
  });

  it("counts tables and forms of more than one field", () => {
    expect(countStackSource(`<table><tr /></table><form><input name="q" /></form>`).localTableOrForm).toBe(1);
    expect(countStackSource(`<form><Input /><Select /></form>`).localTableOrForm).toBe(1);
    expect(countStackSource(`<form><Input /><Select /></form>`, { maxFormFields: 2 }).localTableOrForm).toBe(0);
    expect(countStackSource(`<tableau /><formula />`).localTableOrForm).toBe(0);
  });
});

describe("countRepository", () => {
  it("scans the default globs (app, components, src .tsx) and skips node_modules", async () => {
    expect(await countRepository({ root })).toEqual({ counters: TOTAL, files: 4, stackFiles: 9 });
  });

  it("counts the imports of the retired dependencies", async () => {
    expect((await countRepository({ root, retire: ["framer-motion"] })).counters.retiredImport).toBe(1);
  });

  it("takes custom globs", async () => {
    const { counters, files } = await countRepository({ root, globs: ["lib/**/*.tsx", "app/**/*.ts"], stackGlobs: [] });
    expect(files).toBe(2);
    expect(counters.fetchInClientEffect).toBe(0);
    expect(counters).toMatchObject({ palette: 4, light: 2 });
  });
});

describe("runRatchet", () => {
  it("--init records the current counters and the globs", async () => {
    const result = await runRatchet({ root, mode: "init" });
    expect(result).toMatchObject({ ok: true, written: true, file: "lint-ratchet.json" });
    expect(ratchetFile()).toEqual({
      globs: ["app/**/*.tsx", "components/**/*.tsx", "src/**/*.tsx"],
      stackGlobs: STACK_GLOBS,
      counters: TOTAL,
    });
  });

  it("--init refuses to overwrite an existing file", async () => {
    await runRatchet({ root, mode: "init" });
    await expect(runRatchet({ root, mode: "init" })).rejects.toThrow(/already exists/);
  });

  it("check without a file asks for --init", async () => {
    await expect(runRatchet({ root })).rejects.toThrow(/--init/);
  });

  it("check passes when nothing moved", async () => {
    await runRatchet({ root, mode: "init" });
    expect(await runRatchet({ root })).toMatchObject({ ok: true, increased: [], decreased: [], written: false });
  });

  it("check fails when a counter goes up", async () => {
    await runRatchet({ root, mode: "init" });
    addDebt(`<b className="text-amber-400 light:text-amber-700" />`);
    const result = await runRatchet({ root });
    expect(result.ok).toBe(false);
    expect(result.increased).toEqual(["palette", "light"]);
    expect(result.counters.palette).toEqual({ recorded: 6, current: 8, delta: 2 });
  });

  it("--update lowers the recorded values, never raises them", async () => {
    await runRatchet({ root, mode: "init" });
    rmSync(join(root, "app/settings/panel.tsx")); // -1 palette, -2 arbitraryVar
    addDebt(`<b className="light:text-fg" />`); // +1 light
    const result = await runRatchet({ root, mode: "update" });
    expect(result.ok).toBe(false); // an increase still fails, even when lowering the others
    expect(result.written).toBe(true);
    expect(ratchetFile().counters).toEqual({ ...STACK, palette: 5, light: 3, arbitraryVar: 0, classNameTemplate: 2 });
  });

  it("--update keeps a counter it does not measure, and says so (the 0.11.0 regression: pageTemplate was dropped)", async () => {
    await runRatchet({ root, mode: "init" });
    const file = ratchetFile();
    writeFileSync(join(root, "lint-ratchet.json"), JSON.stringify({ ...file, counters: { ...file.counters, pageTemplate: 38 } }));
    rmSync(join(root, "app/settings/panel.tsx")); // something to lower, so the file is rewritten
    const result = await runRatchet({ root, mode: "update" });
    expect(result).toMatchObject({ ok: true, written: true, unmeasured: ["pageTemplate"] });
    expect(ratchetFile().counters).toMatchObject({ pageTemplate: 38, palette: 5 });
    const check = cli("--update");
    expect(check.stdout).toContain("pageTemplate");
    expect(ratchetFile().counters.pageTemplate).toBe(38);
  });

  const APP_UI = { palette: 4, light: 2, arbitraryVar: 2, classNameTemplate: 1 }; // app/**/*.tsx only

  it("a file without the stack counters still checks, and --update records them", async () => {
    writeFileSync(join(root, "lint-ratchet.json"), JSON.stringify({ globs: ["app/**/*.tsx"], counters: APP_UI }));
    const check = await runRatchet({ root });
    expect(check).toMatchObject({ ok: true, written: false, added: Object.keys(STACK) });
    const update = await runRatchet({ root, mode: "update" });
    expect(update).toMatchObject({ ok: true, written: true });
    expect(ratchetFile()).toEqual({ globs: ["app/**/*.tsx"], stackGlobs: STACK_GLOBS, counters: { ...APP_UI, ...STACK } });
  });

  it("fails when a stack debt goes up, and reads `retire` and `maxFormFields` from the file", async () => {
    writeFileSync(
      join(root, "lint-ratchet.json"),
      JSON.stringify({ retire: ["framer-motion"], maxFormFields: 2, counters: { ...TOTAL, localTableOrForm: 1, retiredImport: 1 } }),
    );
    expect((await runRatchet({ root })).ok).toBe(true); // the two-field form is allowed with maxFormFields 2
    addDebt(`"use client";\nimport { m } from "framer-motion/m";\nuseEffect(() => { fetch("/a"); }, []);`);
    const result = await runRatchet({ root });
    expect(result.increased).toEqual(["fetchInClientEffect", "asyncInEffect", "retiredImport"]);
  });

  it("uses the globs recorded in the file", async () => {
    await runRatchet({ root, mode: "init", globs: ["lib/**/*.tsx"] });
    expect(ratchetFile().counters).toMatchObject({ palette: 2, light: 1 });
    addDebt(`<b className="bg-red-500" />`); // outside lib/: not counted
    expect((await runRatchet({ root })).ok).toBe(true);
  });

  it("reads the allowlist from the file", async () => {
    writeFileSync(
      join(root, "lint-ratchet.json"),
      JSON.stringify({ allow: ["emerald"], counters: { ...TOTAL, palette: 5 } }),
    );
    expect((await runRatchet({ root })).counters.palette).toEqual({ recorded: 5, current: 5, delta: 0 });
  });

  it("rejects a malformed file", async () => {
    writeFileSync(join(root, "lint-ratchet.json"), JSON.stringify({ counters: { palette: -1 } }));
    await expect(runRatchet({ root })).rejects.toThrow(/non-negative integer/);
  });
});

// each CLI call is a fresh node process that loads ESLint + the TS parser (cognitive complexity): several per test, slow on a shared CI runner
describe("krizaka-ratchet CLI", { timeout: 90_000 }, () => {
  it("--init, then --json for CI (exit 0)", () => {
    expect(cli("--init").status).toBe(0);
    expect(existsSync(join(root, "lint-ratchet.json"))).toBe(true);
    const run = cli("--json");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, files: 4, counters: { light: { current: 3 } } });
  });

  it("exits 1 when the debt goes up, 2 on a usage error", () => {
    execFileSync(process.execPath, [BIN, "--root", root, "--init"]);
    addDebt(`<b className={\`x \${y}\`} />`);
    const run = cli();
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/className template strings\s+3/);
    expect(cli("--init", "--update").status).toBe(2);
    expect(cli("--nope").status).toBe(2);
    rmSync(join(root, "lint-ratchet.json"));
    expect(cli().stderr).toMatch(/--init/);
  });

  it("--update lowers the file", () => {
    execFileSync(process.execPath, [BIN, "--root", root, "--init"]);
    rmSync(join(root, "src/widget.tsx"));
    const run = cli("--update");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/Lowered lint-ratchet.json/);
    expect(ratchetFile().counters).toEqual({ ...STACK, palette: 4, light: 2, arbitraryVar: 2, classNameTemplate: 1 });
  });
});

describe("the routeStateSelection counter", () => {
  it("counts local selections in pages only, never one with a routeKey or an @ephemeral reason", async () => {
    const { countStackSource } = await import("../ratchet/ratchet.js");
    const local = `<Tabs.Root value={t} onValueChange={setT}>\n<Chip.Group type="single" defaultValue="a">\n<Tabs.Root routeKey="tab">\n// @ephemeral: a popover\n<ChoiceGrid value={v} />`;
    expect(countStackSource(local).routeStateSelection).toBe(2);
  });
});


describe("runRatchet file argument", () => {
  it("refuses a ratchet file outside the root or that is not .json", async () => {
    for (const file of ["../outside.json", "/etc/passwd", "lint-ratchet.txt", "."]) {
      await expect(runRatchet({ root, mode: "init", file })).rejects.toThrow(/must be a \.json file inside/);
    }
  });
  it("still accepts a nested .json file", async () => {
    const result = await runRatchet({ root, mode: "init", file: "config/my-ratchet.json" }).catch((e: Error) => e);
    expect(String(result)).not.toMatch(/must be a \.json file inside/);
  });
});

// a function of cognitive complexity 16 (nested ifs weigh more each level)
const COMPLEX = `export function f(a: number[], b: boolean) {
  for (const x of a) {
    if (x > 1) {
      if (b) {
        for (const y of a) {
          if (y > x && b) { return y; }
          if (y < x || b) { return x; }
          while (y > 3 && x) { return 0; }
        }
      }
    }
  }
}
`;

describe("cognitiveComplexity (Sonar S3776)", () => {
  it("counts the functions above 15, not the simple ones", async () => {
    const { countCognitiveComplexity } = await import("../ratchet/ratchet.js");
    expect(countCognitiveComplexity(COMPLEX, "lib/x.ts")).toBe(1);
    expect(countCognitiveComplexity("export const f = (a: number) => (a > 1 ? 1 : 2);", "lib/x.ts")).toBe(0);
  });

  it("fails the ratchet when a new function goes over, ignoring test files", async () => {
    expect(cli("--init").status).toBe(0);
    writeFileSync(join(root, "lib/x.test.ts"), COMPLEX);
    expect(cli().status).toBe(0);
    writeFileSync(join(root, "lib/x.ts"), COMPLEX);
    const run = cli();
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/functions over complexity 15/);
    expect(ratchetFile().counters.cognitiveComplexity).toBe(0);
  });
});

describe("sonar (eslint-plugin-sonarjs recommended, one counter per rule)", () => {
  const NESTED = "export const f = (a: boolean, b: boolean) => (a ? 1 : b ? 2 : 3);\n";

  it("counts the violations per rule, tests excluded", async () => {
    const { countSonar } = await import("../ratchet/ratchet.js");
    expect(countSonar(NESTED, "lib/x.ts")).toEqual({ "sonarjs/no-nested-conditional": 1 });
    expect(countSonar("export const g = 1;", "lib/x.ts")).toEqual({});
    expect(countSonar("export const = ;", "lib/x.ts")).toEqual({});
  });

  it("freezes the existing violations, fails a new one and lowers when fixed", async () => {
    writeFileSync(join(root, "lib/nested.ts"), NESTED);
    expect(cli("--init").status).toBe(0);
    expect(ratchetFile().counters).toMatchObject({ sonar: expect.any(Number), "sonarjs/no-nested-conditional": 1 });
    expect(cli().status).toBe(0);
    writeFileSync(join(root, "lib/nested2.ts"), NESTED);
    const run = cli();
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/sonarjs\/no-nested-conditional/);
    rmSync(join(root, "lib/nested2.ts"));
    rmSync(join(root, "lib/nested.ts"));
    expect(cli("--update").status).toBe(0);
    expect(ratchetFile().counters["sonarjs/no-nested-conditional"]).toBeUndefined();
  });

  it("fails the first violation of a rule that had none once the layer is recorded", async () => {
    expect(cli("--init").status).toBe(0);
    writeFileSync(join(root, "lib/nested.ts"), NESTED);
    expect(cli().status).toBe(1);
  });

  it("records the layer on --update in a file written before it, without failing", async () => {
    expect(cli("--init").status).toBe(0);
    const file = ratchetFile();
    delete file.counters.sonar;
    writeFileSync(join(root, "lint-ratchet.json"), JSON.stringify(file));
    writeFileSync(join(root, "lib/nested.ts"), NESTED);
    expect(cli().status).toBe(0);
    expect(cli("--update").status).toBe(0);
    expect(ratchetFile().counters["sonarjs/no-nested-conditional"]).toBe(1);
  });
});

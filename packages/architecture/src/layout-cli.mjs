// krizaka-architecture layout <model.c4 | repo-path> [--out views.json] [--base file.c4]... [--system id] [--view id]...
// A .c4 file is checked and laid out; a directory is read with buildC4 and its containers view is laid out.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { buildC4 } from "./c4.mjs";
import { ArchitectureModelError, layoutViews } from "./layout.mjs";

const USAGE =
  "usage: krizaka-architecture layout <model.c4 | repo-path> [--out views.json] [--base file.c4]... [--system id] [--view id]...";

/** Every value of a repeatable flag (`--base a --base b`), a single one for the others. */
function valuesOf(args, name) {
  const out = [];
  args.forEach((a, i) => {
    if (a === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--")) out.push(args[i + 1]);
  });
  return out;
}

/** Runs the subcommand; returns the exit code. */
export async function runLayout(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const flagValues = new Set(["out", "base", "system", "view"].flatMap((n) => valuesOf(args, n)));
  const input = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
  if (!input) {
    stderr.write(`${USAGE}\n`);
    return 2;
  }
  const path = resolve(input);
  let model;
  try {
    model = statSync(path).isDirectory() ? buildC4(path) : [{ path: basename(path), text: readFileSync(path, "utf8") }];
  } catch {
    stderr.write(`${USAGE}\n`);
    return 2;
  }
  const base = valuesOf(args, "base").map((f) => ({ path: basename(f), text: readFileSync(resolve(f), "utf8") }));
  const views = valuesOf(args, "view");
  try {
    const layout = await layoutViews(model, {
      base,
      system: valuesOf(args, "system")[0],
      views: views.length ? views : undefined,
    });
    const json = `${JSON.stringify(layout, null, 2)}\n`;
    const [out] = valuesOf(args, "out");
    if (out) {
      writeFileSync(resolve(out), json);
      stdout.write(`${layout.views.length} view(s), check ${layout.check.status} -> ${out}\n`);
    } else stdout.write(json);
    return 0;
  } catch (error) {
    if (!(error instanceof ArchitectureModelError)) throw error;
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

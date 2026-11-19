// krizaka-architecture layout <model.c4 | repo-path> [--out views.json] [--base file.c4]... [--system id] [--view id]...
//                                                    [--translations <locale>=file.json]...
// krizaka-architecture check <views.json> --model file.c4... [--base file.c4]... [--translations <locale>=file.json]...
// A .c4 file is checked and laid out; a directory is read with buildC4 and its containers view is laid out. `check` proves a
// committed layout was made from these files as they are now.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { buildC4 } from "./c4.mjs";
import { staleSources } from "./freshness.mjs";
import { ArchitectureModelError, layoutViews } from "./layout.mjs";

const USAGE = [
  "usage: krizaka-architecture layout <model.c4 | repo-path> [--out views.json] [--base file.c4]... [--system id] [--view id]...",
  "                                   [--translations <locale>=file.json]...",
  "       krizaka-architecture check <views.json> --model file.c4... [--base file.c4]... [--translations <locale>=file.json]...",
].join("\n");
const FLAGS = ["out", "base", "system", "view", "translations", "model"];

/** A bad call: the usage on stderr, exit 2. */
class UsageError extends Error {}

/** Every value of a repeatable flag (`--base a --base b`), a single one for the others. */
function valuesOf(args, name) {
  const out = [];
  args.forEach((a, i) => {
    if (a === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--")) out.push(args[i + 1]);
  });
  return out;
}

/** The first argument that is neither a flag nor a flag's value. */
function inputOf(args) {
  const flagValues = new Set(FLAGS.flatMap((n) => valuesOf(args, n)));
  const input = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
  if (!input) throw new UsageError();
  return input;
}

/** A file as the API takes it: its name (what the layout records and `check` compares) and its text. */
function fileOf(path) {
  try {
    return { path: basename(path), text: readFileSync(resolve(path), "utf8") };
  } catch {
    throw new UsageError();
  }
}

const filesOf = (args, name) => valuesOf(args, name).map(fileOf);

/** `--translations fr=words.fr.json` → `{ fr: { path, text } }`; null when none is passed. */
function translationsOf(args) {
  const pairs = valuesOf(args, "translations");
  if (!pairs.length) return null;
  return Object.fromEntries(
    pairs.map((pair) => {
      const [, locale, path] = pair.match(/^([a-z]{2}(?:-[A-Z]{2})?)=(.+)$/) ?? [];
      if (!locale) throw new UsageError();
      return [locale, fileOf(path)];
    }),
  );
}

function modelOf(input) {
  const path = resolve(input);
  try {
    return statSync(path).isDirectory() ? buildC4(path) : [fileOf(path)];
  } catch {
    throw new UsageError();
  }
}

async function layout(args, stdout) {
  const views = valuesOf(args, "view");
  const result = await layoutViews(modelOf(inputOf(args)), {
    base: filesOf(args, "base"),
    system: valuesOf(args, "system")[0],
    views: views.length ? views : undefined,
    translations: translationsOf(args) ?? undefined,
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const [out] = valuesOf(args, "out");
  if (!out) {
    stdout.write(json);
    return 0;
  }
  writeFileSync(resolve(out), json);
  const languages = Object.keys(result.translations ?? {});
  const said = languages.length ? `, translated to ${languages.join(", ")}` : "";
  stdout.write(`${result.views.length} view(s), check ${result.check.status}${said} -> ${out}\n`);
  return 0;
}

function check(args, stdout, stderr) {
  const input = inputOf(args);
  const model = filesOf(args, "model");
  if (!model.length) throw new UsageError();
  let data;
  try {
    data = JSON.parse(fileOf(input).text);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    data = null;
  }
  const base = filesOf(args, "base");
  const problems = staleSources(data, {
    model,
    base: base.length ? base : undefined,
    translations: translationsOf(args) ?? undefined,
  });
  if (problems.length) {
    stderr.write(`${problems.map((p) => `${input}: ${p.message}`).join("\n")}\n`);
    return 1;
  }
  stdout.write(`${input} matches ${[...model, ...base].map((f) => f.path).join(", ")} and its translations\n`);
  return 0;
}

async function guarded(run, stderr) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${USAGE}\n`);
      return 2;
    }
    if (!(error instanceof ArchitectureModelError)) throw error;
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

/** Runs `layout`; returns the exit code (0 laid out, 1 refused, 2 a bad call). */
export const runLayout = (args, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  guarded(() => layout(args, stdout), stderr);

/** Runs `check`; returns the exit code (0 current, 1 stale, 2 a bad call). */
export const runCheck = (args, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  guarded(() => check(args, stdout, stderr), stderr);

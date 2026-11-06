// Why: ONE hook chain for every repository (ADR-026, krizaka-internal#2746): the same steps, the same messages, the same exit code.
// What: runs one hook of the chain: the repository's declared steps (declaration.js) in order, then the machine's extensions.
//   Each failing step prints one line `krizaka-hooks: <hook> · <step>: <why>` and stops the hook with exit code 1 (an extension
//   keeps its own code). A step that cannot run for lack of a tool prints a notice and lets the hook go: CI is the last word.
// How: `await runHook({ hook, args, input, cwd })` -> exit code; the bin calls it.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { commandStep } from "./command-step.js";
import { readSteps } from "./declaration.js";
import { runExtensions } from "./extensions.js";
import { secretsStep } from "./secrets-step.js";
import { trailersStep } from "./trailers-step.js";

/**
 * @param {{ hook: string, args?: string[], input?: string, cwd: string, env?: NodeJS.ProcessEnv, home?: string }} options
 * @returns {Promise<number>}
 */
export async function runHook({ hook, args = [], input = "", cwd, env = process.env, home = env.HOME ?? homedir() }) {
  const say = (/** @type {string} */ step, /** @type {string} */ text) =>
    console.error(`krizaka-hooks: ${hook} · ${step}: ${text}`);
  let steps;
  try {
    steps = readSteps(readManifest(cwd))[hook];
  } catch (error) {
    say("declaration", /** @type {Error} */ (error).message);
    return 1;
  }
  if (!steps) {
    say("chain", "unknown hook, nothing to run");
    return 0;
  }
  for (const step of steps) {
    const result = await runStep(step, { args, cwd, env });
    if (result.message) say(step.name, result.message);
    if (!result.ok) return 1;
  }
  const extension = runExtensions({ hook, args, input, cwd, env, home });
  if (extension.message) say("extension", extension.message);
  return extension.ok ? 0 : (extension.code ?? 1);
}

/**
 * @param {import("./declaration.js").Step} step
 * @param {{ args: string[], cwd: string, env: NodeJS.ProcessEnv }} context
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function runStep(step, context) {
  if (step.builtin === "secrets") return secretsStep(context);
  if (step.builtin === "trailers") return trailersStep(context);
  return commandStep({ step, cwd: context.cwd, env: context.env });
}

/**
 * The repository's package.json, or nothing (a repository without npm still gets the built-in steps).
 * @param {string} cwd
 */
function readManifest(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
    throw new Error(`package.json is not valid JSON (${/** @type {Error} */ (error).message})`, { cause: error });
  }
}

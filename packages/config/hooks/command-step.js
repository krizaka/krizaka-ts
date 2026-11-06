// Why: a repository's own checks (its `precheck`, a lint-staged run…) are declared as data and run by the one chain.
// What: runs a declared shell command, or an npm script through the package manager the lockfile names, in the repository root,
//   with the terminal attached so its output is seen as it runs.
// How: `commandStep({ step, cwd, env })` -> { ok, message }; used by chain.js.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RUNNERS = [
  ["pnpm-lock.yaml", "pnpm run"],
  ["yarn.lock", "yarn run"],
  ["bun.lock", "bun run"],
  ["bun.lockb", "bun run"],
];

/**
 * The command line of a step: `run` as written, or `<package manager> run <script>`.
 * @param {{ run?: string, script?: string }} step
 * @param {string} cwd
 */
export function commandLine(step, cwd) {
  if (step.run) return step.run;
  const runner = RUNNERS.find(([lock]) => existsSync(join(cwd, lock)));
  return `${runner ? runner[1] : "npm run"} ${step.script}`;
}

/**
 * @param {{ step: { name: string, run?: string, script?: string }, cwd: string, env: NodeJS.ProcessEnv }} context
 * @returns {{ ok: boolean, message?: string }}
 */
export function commandStep({ step, cwd, env }) {
  const line = commandLine(step, cwd);
  const result = spawnSync(line, { cwd, env, shell: true, stdio: "inherit" });
  if (result.status === 0) return { ok: true };
  const how = result.error ? result.error.message : `exit ${result.status ?? result.signal}`;
  return {
    ok: false,
    message: `\`${line}\` failed (${how}). Read its output above and fix it; CI runs the same checks, so --no-verify only delays the red.`,
  };
}

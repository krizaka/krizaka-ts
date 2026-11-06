// Why: a machine adds its own steps to the chain (krizaka-agents: the central scan, the identity guard) without owning the hook
//   path (ADR-026 §6).
// What: runs the executables of ~/.config/krizaka/hooks.d/<hook>/ in name order, after the chain's own steps, with the hook's
//   arguments and its standard input (pre-push refs). The first failure stops the hook with that executable's exit code.
// How: `runExtensions({ hook, args, input, cwd, env, home })` -> { ok, message, code }; used by chain.js.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {{ hook: string, args: string[], input: string, cwd: string, env: NodeJS.ProcessEnv, home: string }} context
 * @returns {{ ok: boolean, message?: string, code?: number }}
 */
export function runExtensions({ hook, args, input, cwd, env, home }) {
  const dir = join(home, ".config", "krizaka", "hooks.d", hook);
  if (!existsSync(dir)) return { ok: true };
  const names = readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort();
  for (const name of names) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (!stat.isFile() || (stat.mode & 0o111) === 0) continue;
    const result = spawnSync(file, args, { cwd, env, input, stdio: ["pipe", "inherit", "inherit"] });
    if (result.status !== 0) {
      const code = result.status ?? 1;
      return {
        ok: false,
        code,
        message: `machine extension ${hook}/${name} failed (exit ${code}). It lives in ${dir}; fix what it reports.`,
      };
    }
  }
  return { ok: true };
}

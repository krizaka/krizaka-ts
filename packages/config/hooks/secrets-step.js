// Why: a secret must not enter a commit (the pre-commit step of the chain, ADR-026; CI scans again, a hook only saves time).
// What: scans the staged changes with gitleaks, redacted (a value is never printed), with the repository's own .gitleaks.toml
//   when it has one, the org's rules from krizaka/.github otherwise. gitleaks missing: say how to install it and let the commit go.
// How: `await secretsStep({ cwd, env })` -> { ok, message }; used by chain.js.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readOrgFile } from "./org-file.js";

const ORG_RULES = "actions/security-tools/gitleaks.toml";

/**
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, orgFile?: typeof readOrgFile }} context
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function secretsStep({ cwd, env, orgFile = readOrgFile }) {
  const probe = spawnSync("gitleaks", ["version"], { env, encoding: "utf8" });
  if (probe.error) {
    return {
      ok: true,
      message:
        "gitleaks is not installed, the staged scan is skipped (CI scans again). Install it: brew install gitleaks",
    };
  }
  const scanEnv = { ...env };
  if (!existsSync(join(cwd, ".gitleaks.toml"))) {
    const rules = await orgFile(ORG_RULES);
    if (rules) scanEnv.GITLEAKS_CONFIG_TOML = rules;
  }
  const args = ["git", "--staged", "--redact", "--no-banner", "--log-level", "error"];
  const scan = spawnSync("gitleaks", args, { cwd, env: scanEnv, stdio: "inherit" });
  if (scan.status === 0) return { ok: true };
  return {
    ok: false,
    message:
      "a secret is staged (see above, values are redacted). Remove it from the change, rotate it if it was ever pushed, then commit again.",
  };
}

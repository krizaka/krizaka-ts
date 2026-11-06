// Why: the commit-msg step of the chain: no invented co-author (the org allow-list, founder 2026-11-04).
// What: reads the commit message file git hands to the hook and refuses a Co-authored-by that is not on the list. List
//   unreachable and not cached: say so and let the commit go (CI checks the trailers again).
// How: `await trailersStep({ args: [messageFile] })` -> { ok, message }; used by chain.js.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { readFileSync } from "node:fs";

import { readOrgFile } from "./org-file.js";
import { checkMessage } from "./trailers.js";

const IDENTITIES = "scripts/commit-identities.json";

/**
 * @param {{ args: string[], orgFile?: typeof readOrgFile }} context
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function trailersStep({ args, orgFile = readOrgFile }) {
  const file = args[0];
  if (!file) return { ok: false, message: "git did not give the commit message file" };
  const raw = await orgFile(IDENTITIES);
  if (raw === null)
    return {
      ok: true,
      message: "the org's identity list is unreachable and not cached, the co-author check is skipped (CI checks it)",
    };
  const foreign = checkMessage(readFileSync(file, "utf8"), JSON.parse(raw));
  if (foreign.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Co-authored-by names an identity that is not ours (${foreign.join(", ")}). No invented e-mail: only our app bots or the founder (krizaka/.github ${IDENTITIES}). Remove the trailer, then commit again.`,
  };
}

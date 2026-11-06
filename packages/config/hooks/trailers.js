// Why: no invented co-author in a commit of the org (founder, 2026-11-04): only our app bots or the founder's profile.
// What: reads the Co-authored-by trailers of a commit message and checks each e-mail against the org's public allow-list
//   (krizaka/.github scripts/commit-identities.json). A listed e-mail, a listed SHA-256 of an e-mail, or the noreply of a listed
//   id+login passes. `committerOnly` addresses (GitHub's web-flow) are never a valid co-author.
// How: imported by the chain (commit-msg step); parsing is plain string work, no pattern.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { createHash } from "node:crypto";

const SCISSORS = "# ------------------------ >8";
const TRAILER = "co-authored-by";

/**
 * The values of the co-author trailer lines of a message (any case); comment lines and the part under the scissors are left out.
 * @param {string} message
 * @returns {string[]}
 */
export function trailersOf(message) {
  /** @type {string[]} */
  const values = [];
  for (const line of message.split("\n")) {
    if (line.startsWith(SCISSORS)) break;
    const text = line.trim();
    const colon = text.indexOf(":");
    if (text.startsWith("#") || colon < 0) continue;
    if (text.slice(0, colon).trim().toLowerCase() === TRAILER) values.push(text.slice(colon + 1).trim());
  }
  return values;
}

/**
 * The address between the last `<` and `>` of a trailer value, lower case ("" when none).
 * @param {string} value
 */
export function emailOf(value) {
  const open = value.lastIndexOf("<");
  const close = value.lastIndexOf(">");
  return open >= 0 && close > open
    ? value
        .slice(open + 1, close)
        .trim()
        .toLowerCase()
    : "";
}

/**
 * The addresses and hashes ONE allow-list entry names: `email`, `emails`, `emailSha256`, and the noreply of an id + slug/login.
 * @param {any} entry
 * @returns {{ emails: string[], hashes: string[] }}
 */
function entryIdentities(entry) {
  const login = entry.slug ? `${entry.slug}[bot]` : entry.login;
  const noreply = login && entry.id ? [`${entry.id}+${login}@users.noreply.github.com`] : [];
  const emails = [entry.email, ...(entry.emails ?? []), ...noreply].filter((e) => typeof e === "string");
  const sha = entry.emailSha256;
  return { emails: emails.map((e) => e.toLowerCase()), hashes: [sha ?? []].flat().map((h) => String(h).toLowerCase()) };
}

/**
 * Every address and hash the allow-list names, whatever its nesting (each object is read as an entry).
 * @param {any} node
 * @param {{ emails: Set<string>, hashes: Set<string> }} into
 */
function collect(node, into) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((child) => collect(child, into));
  const found = entryIdentities(node);
  found.emails.forEach((e) => into.emails.add(e));
  found.hashes.forEach((h) => into.hashes.add(h));
  for (const [key, child] of Object.entries(node)) if (key !== "committerOnly") collect(child, into);
}

/**
 * The names of the trailers of a message that are not ours (the address is never echoed).
 * @param {string} message
 * @param {unknown} allowList the parsed commit-identities.json
 * @returns {string[]}
 */
export function checkMessage(message, allowList) {
  const known = { emails: new Set(), hashes: new Set() };
  collect(allowList, known);
  return trailersOf(message)
    .filter((value) => {
      const email = emailOf(value);
      if (email === "") return true;
      return !(known.emails.has(email) || known.hashes.has(createHash("sha256").update(email).digest("hex")));
    })
    .map((value) => value.split("<")[0].trim() || "unnamed");
}

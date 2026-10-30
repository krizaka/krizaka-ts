// The shared journey kit (ADR-017 §7, krizaka/.github#423): what every product's customer journeys need, in one place.
//
// A journey is one customer promise told from a persona's point of view, run on the seeded cast. The kit gives them:
// the catalogue format and its check, a persona signed in once per worker, the seeded cast, the masks of the live
// values, the video hooks of the « videos from tests » rule, and the flake policy (retries 0, a capped quarantine).
//
//   import { personaSessions, journeyMaskSelectors, videoContextOptions } from "@krizaka/page-audit/journey";

import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_BUDGET_SECONDS = 90;
const PLATFORMS = Object.freeze(["web", "mobile"]);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISSUE = /^[\w.-]+\/[\w.-]+#\d+$/;
const JOURNEY_FILE = /([^/\\]+)\.journey\.[cm]?[jt]sx?$/;

/** The problems of one catalogue row (`journeys/journeys.json`), empty when it is a good journey. `cast` = the seeded persona ids. */
export function validateJourney(journey, { cast } = {}) {
  const problems = [];
  const at = `journey « ${journey?.id ?? "?"} »`;
  if (typeof journey?.id !== "string" || !KEBAB.test(journey.id)) problems.push(`${at}: id must be kebab-case`);
  if (typeof journey?.promise !== "string" || !journey.promise.trim()) problems.push(`${at}: promise is empty`);
  if (typeof journey?.persona !== "string" || !journey.persona) problems.push(`${at}: persona is missing`);
  else if (cast && !cast.includes(journey.persona))
    problems.push(`${at}: persona « ${journey.persona} » is not in the seeded cast (${cast.join(", ")})`);
  if (!Array.isArray(journey?.platforms) || journey.platforms.length === 0) problems.push(`${at}: platforms is empty`);
  else
    for (const p of journey.platforms)
      if (!PLATFORMS.includes(p)) problems.push(`${at}: platform « ${p} » is not one of ${PLATFORMS.join(", ")}`);
  if (!Array.isArray(journey?.steps) || journey.steps.length === 0) problems.push(`${at}: steps is empty`);
  const budget = journey?.budgetSeconds ?? DEFAULT_BUDGET_SECONDS;
  if (!Number.isFinite(budget) || budget <= 0) problems.push(`${at}: budgetSeconds must be a positive number`);
  return problems;
}

/** Files and rows must match: a file with no row, a row with no file, an id twice. `files` are paths of `<id>.journey.ts`. */
export function checkCatalogue({ files, index }) {
  const problems = [];
  const fileIds = new Set(files.map((f) => JOURNEY_FILE.exec(f)?.[1]).filter(Boolean));
  const seen = new Set();
  for (const row of index) {
    if (seen.has(row.id)) problems.push(`journeys.json lists « ${row.id} » twice`);
    seen.add(row.id);
    if (!fileIds.has(row.id)) problems.push(`journeys.json row « ${row.id} » has no file`);
  }
  for (const id of fileIds) if (!seen.has(id)) problems.push(`journey file « ${id} » has no row in journeys.json`);
  return problems;
}

/** The rows that carry a tag (`smoke` runs on every pull request, the rest in the nightly pass). */
export function journeysByTag(index, tag) {
  return index.filter((j) => j.tags?.includes(tag));
}

/** The message when a run took longer than its journey's budget, `undefined` within it. */
export function budgetProblem(journey, elapsedMs) {
  const seconds = journey.budgetSeconds ?? DEFAULT_BUDGET_SECONDS;
  if (elapsedMs <= seconds * 1000) return undefined;
  return `journey « ${journey.id} » took ${Math.round(elapsedMs / 1000)} s, over its budget of ${seconds} s: split it, or the product is slow`;
}

async function written(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Persona sign-in once per worker. `signIn(persona, file)` signs in and writes the Playwright browser state to `file`
 * (the app's own way: its form, its API). `stateFor(persona)` returns that file's path: the first call signs in, the
 * next ones (also parallel ones) reuse it, so a worker never asks the sign-in more than once per persona (rate-limit
 * safe). One file per worker; a failed sign-in is not remembered.
 */
export function personaSessions({ dir, signIn, worker = Number(process.env.TEST_WORKER_INDEX ?? 0) }) {
  const inFlight = new Map();
  return {
    stateFor(persona) {
      const known = inFlight.get(persona);
      if (known) return known;
      const file = join(dir, `${persona}.w${worker}.json`);
      const pending = (async () => {
        if (!(await written(file))) {
          await mkdir(dirname(file), { recursive: true });
          await signIn(persona, file);
          if (!(await written(file))) throw new Error(`sign-in of « ${persona} » wrote no storage state to ${file}`);
        }
        return file;
      })();
      inFlight.set(persona, pending);
      pending.catch(() => inFlight.delete(persona));
      return pending;
    },
  };
}

/** A member of the seeded cast (the same people locally and deployed), or an error naming who exists. */
export function seededPersona(cast, id) {
  const person = cast[id];
  if (!person) throw new Error(`« ${id} » is not in the seeded cast: ${Object.keys(cast).join(", ")}`);
  return person;
}

/** What changes between two runs of the same build: dates, ids, anything marked `data-mask`. */
export const JOURNEY_MASKS = Object.freeze([
  "time",
  "[data-mask]",
  "[data-date]",
  '[data-testid$="-id"]',
  "[data-run-id]",
]);

/** The selectors to mask in a capture of a journey screen. */
export function journeyMaskSelectors({ extra = [], defaults = true } = {}) {
  return [...new Set([...(defaults ? JOURNEY_MASKS : []), ...extra])];
}

/** The size of a recorded video: the laptop of the visual matrix. */
export const VIDEO_SIZE = Object.freeze({ width: 1280, height: 800 });

/** Context options that record the run of a journey whose `video` is true (the source of the product video), none otherwise. */
export function videoContextOptions(journey, { dir, size = VIDEO_SIZE }) {
  if (!journey.video) return {};
  return { recordVideo: { dir: join(dir, journey.id), size: { ...size } } };
}

/** The name the recorded video is published under. */
export function videoFile(journey, platform) {
  return `${journey.id}.${platform}.webm`;
}

/** A flake is a bug, not a retry: retries are 0 (top level and every project). */
export function assertNoRetries(config) {
  if ((config.retries ?? 0) > 0)
    throw new Error(`retries is ${config.retries}: a flake is a bug, fix its cause (retries must be 0)`);
  for (const project of config.projects ?? [])
    if ((project.retries ?? 0) > 0)
      throw new Error(`project « ${project.name} » sets retries ${project.retries}: retries must be 0`);
}

export const QUARANTINE_CAP = 1;

/** The quarantine: a named test, why, and the issue that fixes it. Capped; the audit keeps running, only the assertion is skipped. */
export function quarantine(entries, { max = QUARANTINE_CAP } = {}) {
  if (entries.length > max) throw new Error(`the quarantine holds at most ${max} test(s), it has ${entries.length}`);
  for (const e of entries) {
    if (!e.test) throw new Error("a quarantine entry names its test");
    if (!e.reason?.trim()) throw new Error(`quarantine « ${e.test} » needs a reason`);
    if (!ISSUE.test(e.issue ?? ""))
      throw new Error(`quarantine « ${e.test} » needs an issue as owner/repo#n, got « ${e.issue} »`);
  }
  const names = new Set(entries.map((e) => e.test));
  return { entries, has: (title) => names.has(title) };
}

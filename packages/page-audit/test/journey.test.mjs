import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertNoRetries,
  budgetProblem,
  checkCatalogue,
  JOURNEY_MASKS,
  journeyMaskSelectors,
  journeysByTag,
  personaSessions,
  quarantine,
  seededPersona,
  validateJourney,
  videoContextOptions,
  videoFile,
} from "../src/journey.mjs";

const lease = {
  id: "lease-check-to-report",
  promise: "A tenant checks a lease and gets a signed report",
  persona: "eric",
  platforms: ["web"],
  steps: ["sign in", "upload a lease", "read the findings"],
  video: true,
  budgetSeconds: 90,
  tags: ["smoke", "paid"],
};

describe("validateJourney", () => {
  it("accepts the catalogue format of ADR-017", () => {
    expect(validateJourney(lease, { cast: ["eric", "lina"] })).toEqual([]);
  });
  it("names every problem of a shallow row", () => {
    const problems = validateJourney(
      { id: "Bad Id", promise: "", persona: "ghost", platforms: ["tv"], steps: [] },
      { cast: ["eric"] },
    );
    expect(problems.join("\n")).toMatch(/id/);
    expect(problems.join("\n")).toMatch(/promise/);
    expect(problems.join("\n")).toMatch(/persona « ghost »/);
    expect(problems.join("\n")).toMatch(/platform « tv »/);
    expect(problems.join("\n")).toMatch(/steps/);
  });
  it("defaults the budget to 90 s and refuses a non-positive one", () => {
    expect(validateJourney({ ...lease, budgetSeconds: undefined })).toEqual([]);
    expect(validateJourney({ ...lease, budgetSeconds: 0 }).join()).toMatch(/budgetSeconds/);
  });
});

describe("checkCatalogue", () => {
  const index = [{ ...lease }, { ...lease, id: "pay-with-a-launch-code" }];
  it("is silent when files and rows match", () => {
    const files = ["journeys/lease-check-to-report.journey.ts", "journeys/pay-with-a-launch-code.journey.ts"];
    expect(checkCatalogue({ files, index })).toEqual([]);
  });
  it("fails a file without a row and a row without a file", () => {
    const files = ["journeys/lease-check-to-report.journey.ts", "journeys/orphan.journey.ts"];
    const problems = checkCatalogue({ files, index });
    expect(problems).toContain("journey file « orphan » has no row in journeys.json");
    expect(problems).toContain("journeys.json row « pay-with-a-launch-code » has no file");
  });
  it("refuses a duplicate id", () => {
    const files = ["a/lease-check-to-report.journey.ts"];
    expect(checkCatalogue({ files, index: [lease, lease] }).join()).toMatch(/twice/);
  });
});

describe("journeysByTag", () => {
  it("picks the smoke journeys of a pull request", () => {
    const index = [lease, { ...lease, id: "nightly-only", tags: ["paid"] }];
    expect(journeysByTag(index, "smoke").map((j) => j.id)).toEqual(["lease-check-to-report"]);
  });
});

describe("personaSessions", () => {
  it("signs a persona in once per worker and reuses the state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kz-sessions-"));
    const signIn = vi.fn(async (persona, file) => writeFile(file, JSON.stringify({ persona })));
    const sessions = personaSessions({ dir, signIn, worker: 2 });
    const [a, b] = await Promise.all([sessions.stateFor("eric"), sessions.stateFor("eric")]);
    expect(a).toBe(b);
    expect(a).toMatch(/eric\.w2\.json$/);
    await sessions.stateFor("eric");
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(a, "utf8"))).toEqual({ persona: "eric" });
  });
  it("keeps one file per worker, so two workers never share a session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kz-sessions-"));
    const signIn = vi.fn(async (_p, file) => writeFile(file, "{}"));
    const one = await personaSessions({ dir, signIn, worker: 0 }).stateFor("lina");
    const two = await personaSessions({ dir, signIn, worker: 1 }).stateFor("lina");
    expect(one).not.toBe(two);
    expect(signIn).toHaveBeenCalledTimes(2);
  });
  it("tries again after a failed sign-in instead of caching the failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kz-sessions-"));
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockImplementation(async (_p, file) => writeFile(file, "{}"));
    const sessions = personaSessions({ dir, signIn, worker: 0 });
    await expect(sessions.stateFor("eric")).rejects.toThrow(/rate limited/);
    await expect(sessions.stateFor("eric")).resolves.toMatch(/eric/);
  });
  it("refuses a sign-in that wrote nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kz-sessions-"));
    await expect(personaSessions({ dir, signIn: async () => {}, worker: 0 }).stateFor("eric")).rejects.toThrow(
      /no storage state/,
    );
  });
});

describe("seededPersona", () => {
  const cast = {
    eric: { email: "eric@example.test", role: "tenant" },
    lina: { email: "lina@example.test", role: "owner" },
  };
  it("reads a member of the seeded cast", () => {
    expect(seededPersona(cast, "eric").email).toBe("eric@example.test");
  });
  it("names the cast when asked for someone else", () => {
    expect(() => seededPersona(cast, "bob")).toThrow(/« bob ».*eric, lina/);
  });
});

describe("masks", () => {
  it("masks dates and ids by default", () => {
    expect(journeyMaskSelectors()).toEqual([...JOURNEY_MASKS]);
    expect(JOURNEY_MASKS).toContain("time");
    expect(JOURNEY_MASKS).toContain("[data-mask]");
  });
  it("adds a journey's own masks without duplicates", () => {
    const all = journeyMaskSelectors({ extra: ["[data-run-id]", "time"] });
    expect(all.filter((s) => s === "time")).toHaveLength(1);
    expect(all).toContain("[data-run-id]");
  });
  it("can leave the defaults out", () => {
    expect(journeyMaskSelectors({ defaults: false, extra: ["x"] })).toEqual(["x"]);
  });
});

describe("video hooks", () => {
  it("records only the journeys that feed a product video", () => {
    expect(videoContextOptions({ ...lease, video: false }, { dir: "/v" })).toEqual({});
    expect(videoContextOptions(lease, { dir: "/v" })).toEqual({
      recordVideo: { dir: "/v/lease-check-to-report", size: { width: 1280, height: 800 } },
    });
  });
  it("names the file by journey and platform", () => {
    expect(videoFile(lease, "web")).toBe("lease-check-to-report.web.webm");
  });
});

describe("flake policy", () => {
  it("refuses retries above 0", () => {
    expect(() => assertNoRetries({ retries: 2 })).toThrow(/retries/);
    expect(() => assertNoRetries({ retries: 0 })).not.toThrow();
    expect(() => assertNoRetries({})).not.toThrow();
  });
  it("refuses retries in any project too", () => {
    expect(() => assertNoRetries({ projects: [{ name: "web", retries: 1 }] })).toThrow(/web/);
  });
  it("quarantines a named test with its reason and issue", () => {
    const q = quarantine([{ test: "shop publishes", reason: "lazy map chunk", issue: "krizaka/akinaza#1" }]);
    expect(q.has("shop publishes")).toBe(true);
    expect(q.has("shop orders")).toBe(false);
  });
  it("caps the quarantine and demands a reason and an issue", () => {
    const one = { test: "a", reason: "r", issue: "o/r#1" };
    expect(() => quarantine([one, { ...one, test: "b" }])).toThrow(/at most 1/);
    expect(() => quarantine([{ test: "a" }])).toThrow(/reason/);
    expect(() => quarantine([{ test: "a", reason: "r", issue: "soon" }])).toThrow(/issue/);
  });
});

describe("budgetProblem", () => {
  it("says nothing within the budget, and names the journey over it", () => {
    expect(budgetProblem(lease, 80_000)).toBeUndefined();
    expect(budgetProblem(lease, 95_000)).toMatch(/lease-check-to-report.*90 s/);
  });
});

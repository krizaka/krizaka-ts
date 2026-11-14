import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import { checkEnvSpec, readAppSpecEnvs, specEnvs } from "../deploy/env-spec.js";

const FIXTURE = fileURLToPath(new URL("fixtures/app-spec.yaml", import.meta.url));

describe("readAppSpecEnvs", () => {
  const envs = readAppSpecEnvs(FIXTURE);

  it("gives the envs by component, flow and block style alike", () => {
    assert.deepEqual(
      envs.web?.map((e) => e.key),
      ["DATABASE_URL", "AUTH_SECRET", "APP_NAME"],
    );
    assert.deepEqual(
      envs.backup?.map((e) => e.key),
      ["BACKUP_AGE_RECIPIENT"],
    );
    assert.deepEqual(
      envs.app?.map((e) => e.key),
      ["APP_ORIGIN"],
    );
    assert.equal(envs.web?.[0]?.type, "SECRET");
  });

  it("reads nothing from a spec without envs", () => {
    assert.deepEqual(specEnvs({}), { app: [] });
    assert.deepEqual(specEnvs(null), { app: [] });
  });
});

describe("checkEnvSpec", () => {
  const envs = readAppSpecEnvs(FIXTURE);

  it("is empty when every key is declared or justified", () => {
    const result = checkEnvSpec({
      schemaKeys: ["DATABASE_URL", "APP_NAME", "MAIL_FROM"],
      envs,
      components: ["web"],
      notDeclared: { MAIL_FROM: "mail is off on dev" },
    });
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.stale, []);
    assert.deepEqual(result.undeclaredWithoutReason, []);
    assert.deepEqual(checkEnvSpec({ schemaKeys: ["APP_ORIGIN"], envs, components: ["app"] }).problems, []);
  });

  it("names a key the app reads that the spec forgets", () => {
    const result = checkEnvSpec({ schemaKeys: ["APP_NAME", "NEW_KEY"], envs, components: ["web"] });
    assert.deepEqual(result.missing, ["NEW_KEY"]);
    assert.match(result.problems[0] ?? "", /NEW_KEY: read by the app/);
  });

  it("counts only the chosen components: the jobs' keys are not the web service's", () => {
    assert.deepEqual(checkEnvSpec({ schemaKeys: ["BACKUP_AGE_RECIPIENT"], envs, components: ["web"] }).missing, [
      "BACKUP_AGE_RECIPIENT",
    ]);
    assert.deepEqual(checkEnvSpec({ schemaKeys: ["BACKUP_AGE_RECIPIENT"], envs }).missing, []);
  });

  it("refuses a justification that went stale or has no reason", () => {
    const result = checkEnvSpec({
      schemaKeys: ["APP_NAME", "SHORT"],
      envs,
      components: ["web"],
      notDeclared: { APP_NAME: "declared after all", GONE: "no longer in the schema", SHORT: "x" },
    });
    assert.deepEqual(result.stale, ["APP_NAME", "GONE"]);
    assert.deepEqual(result.undeclaredWithoutReason, ["SHORT"]);
    assert.equal(result.problems.length, 4);
  });

  it("refuses a SECRET that is not its __KEY__ placeholder", () => {
    assert.deepEqual(checkEnvSpec({ schemaKeys: [], envs, components: ["web"] }).plainSecrets, ["AUTH_SECRET"]);
  });
});

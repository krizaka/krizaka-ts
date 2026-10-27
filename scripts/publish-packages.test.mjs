// Publish step of release.yml: OIDC first, NPM_TOKEN only as the logged fallback (same as krizaka-ui#786/#793).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTrustedPublisherMissing } from "./npm-publish-error.mjs";

const script = readFileSync(new URL("./publish-packages.sh", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const commands = workflow.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

describe("publish-packages.sh", () => {
  it("tries OIDC first, then NPM_TOKEN only on an auth error, with a warning", () => {
    expect(script).toMatch(/env -u NODE_AUTH_TOKEN NPM_CONFIG_USERCONFIG=.*npm publish .*--provenance/);
    expect(script).toMatch(/::warning::\$name: trusted publisher not configured or mismatched/);
    expect(script.indexOf("env -u NODE_AUTH_TOKEN")).toBeLessThan(script.indexOf('token.npmrc" npm publish'));
    expect(script).toMatch(/scripts\/npm-publish-error\.mjs/);
    expect(script).not.toMatch(/changeset publish/);
  });
  it("builds every package before packing", () => {
    expect(script).toMatch(/turbo run build --filter='\.\/packages\/\*'/);
  });
  it("retries auth failures with the token and fails on any other error", () => {
    for (const l of ["npm error code ENEEDAUTH", "npm error 404 Not Found - PUT https://registry.npmjs.org/@krizaka%2fui", "package not found"])
      expect(isTrustedPublisherMissing(l)).toBe(true);
    for (const l of ["npm error code E403 cannot publish over the previously published versions", "npm error code E500", "ETIMEDOUT"])
      expect(isTrustedPublisherMissing(l)).toBe(false);
  });
});

describe("release.yml publish and deprecate", () => {
  it("publishes through the script, with id-token and the NPM_TOKEN fallback", () => {
    expect(commands).toMatch(/publish-script:\s*bash scripts\/publish-packages\.sh/);
    expect(commands).toMatch(/id-token: write/);
    expect(commands).toMatch(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  });
  it("deprecates after the publish, idempotently, and never fails the run", () => {
    expect(commands.indexOf("publish-packages.sh")).toBeLessThan(commands.indexOf("npm deprecate"));
    expect(commands).toMatch(/npm view "@krizaka\/config@0\.9\.0" deprecated/);
    expect(commands).toMatch(/npm deprecate [^\n]*\|\| echo "::warning::/);
  });
});

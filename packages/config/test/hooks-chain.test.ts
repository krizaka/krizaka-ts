import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, it } from "vitest";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PACKAGE, "bin", "krizaka-hooks.mjs");
const IDENTITIES = { bots: [{ id: 1, slug: "bot", emails: [] }], humans: [{ emails: ["me@example.org"] }] };

let repo = "";
let home = "";
let env: NodeJS.ProcessEnv = {};

const sh = (cmd: string, args: string[], options: { cwd?: string; input?: string } = {}) =>
  spawnSync(cmd, args, { cwd: options.cwd ?? repo, env, encoding: "utf8", input: options.input });
const git = (...args: string[]) => sh("git", args);
const write = (file: string, text: string, mode?: number) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mode) chmodSync(file, mode);
};
const manifest = (extra: object) => write(join(repo, "package.json"), JSON.stringify({ name: "fixture", ...extra }));
const install = () => sh("node", [BIN, "install"]);

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "kz-hooks-"));
  repo = join(root, "repo");
  home = join(root, "home");
  const fakeBin = join(root, "bin");
  mkdirSync(join(repo, "node_modules", "@krizaka"), { recursive: true });
  symlinkSync(PACKAGE, join(repo, "node_modules", "@krizaka", "config"));
  // a stand-in for gitleaks: refuses a staged diff that holds FAKE_SECRET
  write(
    join(fakeBin, "gitleaks"),
    '#!/bin/sh\n[ "$1" = version ] && exit 0\ngit diff --cached | grep -q FAKE_SECRET && { echo "leak found"; exit 1; }\nexit 0\n',
    0o755,
  );
  const cache = join(home, ".cache", "krizaka", "hooks");
  write(join(cache, "scripts__commit-identities.json"), JSON.stringify(IDENTITIES));
  write(join(cache, "actions__security-tools__gitleaks.toml"), "");
  env = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    HOME: home,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "me@example.org",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "me@example.org",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  git("init", "-q", "-b", "main");
  manifest({});
  git("add", "package.json");
});

describe("krizaka-hooks install", () => {
  it("sets the chain, and a second run changes nothing", () => {
    assert.match(install().stdout, /installed/);
    const path = git("config", "core.hooksPath").stdout.trim();
    assert.match(readFileSync(join(path, "pre-push"), "utf8"), /run pre-push/);
    assert.equal(install().stdout, "");
  });

  it("skips outside a git repository and in CI, and never fails", () => {
    const plain = mkdtempSync(join(tmpdir(), "kz-plain-"));
    const outside = sh("node", [BIN, "install"], { cwd: plain });
    assert.equal(outside.status, 0);
    assert.match(outside.stdout, /not a git repository/);
    env = { ...env, CI: "true" };
    assert.match(install().stdout, /CI/);
  });
});

describe("krizaka-hooks chain", () => {
  it("commits clean changes, refuses a staged secret", () => {
    install();
    assert.equal(git("commit", "-q", "-m", "feat: ok").status, 0);
    write(join(repo, "leak.txt"), "FAKE_SECRET=1\n");
    git("add", "leak.txt");
    const refused = git("commit", "-q", "-m", "feat: leak");
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /pre-commit · secrets: a secret is staged/);
  });

  it("refuses an invented co-author, accepts a listed one", () => {
    install();
    const bad = git("commit", "-q", "-m", "feat: x\n\nCo-authored-by: Claude <noreply@anthropic.com>");
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /commit-msg · trailers: .*\(Claude\)/);
    assert.equal(git("commit", "-q", "-m", "feat: x\n\nCo-authored-by: Me <me@example.org>").status, 0);
  });

  it("a red declared step refuses the push with its name, a green one lets it through", () => {
    manifest({ krizaka: { hooks: { "pre-push": [{ name: "check", run: "exit 3" }] } } });
    const run = () => sh("node", [BIN, "run", "pre-push", "origin", "url"], { input: "" });
    const red = run();
    assert.equal(red.status, 1);
    assert.match(red.stderr, /pre-push · check: `exit 3` failed \(exit 3\)/);
    manifest({ scripts: { precheck: "exit 0" } });
    assert.equal(run().status, 0);
  });

  it("runs a machine extension after the steps, with its exit code", () => {
    write(
      join(home, ".config", "krizaka", "hooks.d", "pre-push", "10-guard"),
      '#!/bin/sh\ncat > "$HOME/seen"\nexit 7\n',
      0o755,
    );
    const result = sh("node", [BIN, "run", "pre-push", "origin", "url"], { input: "refs/heads/x abc\n" });
    assert.equal(result.status, 7);
    assert.equal(readFileSync(join(home, "seen"), "utf8"), "refs/heads/x abc\n");
    assert.match(result.stderr, /extension.*10-guard failed/);
  });

  it("a repository without package.json, or whose package is missing, can still commit and push", () => {
    install();
    git("rm", "-q", "--cached", "package.json");
    write(join(repo, "package.json"), "{}");
    git("add", "package.json");
    const gone = join(repo, "node_modules", "@krizaka", "config");
    spawnSync("rm", [gone]);
    const result = git("commit", "-q", "-m", "feat: no package");
    assert.equal(result.status, 0);
    assert.match(result.stderr, /missing, pre-commit skipped/);
  });
});

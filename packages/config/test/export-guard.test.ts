import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import { checkExport, formatFinding } from "../export-guard/export-guard.js";

const BIN = fileURLToPath(new URL("../bin/krizaka-export-guard.mjs", import.meta.url));
const policy = {
  codeNames: ["formername", "olderalias"],
  allowedAmounts: ["49 $"],
  licence: "FSL-1.1-ALv2",
  status: "development",
};
const page = (path: string, body: string) => [{ path, content: `<main>\n${body}\n</main>` }];
const rules = (path: string, body: string) => checkExport(page(path, body), policy).map((f) => f.rule);

describe("export guard", () => {
  it("refuses a sign-in link or word", () => {
    assert.deepEqual(rules("fr/index.html", '<a href="/fr/sign-in">x</a>'), ["sign-in"]);
    assert.deepEqual(rules("fr/index.html", "<a>Se connecter</a>"), ["sign-in"]);
    assert.deepEqual(rules("en/index.html", "<a>Sign in</a>"), ["sign-in"]);
  });
  it("refuses a dev. host", () => {
    assert.deepEqual(rules("index.html", '<a href="https://dev.verikora.com/fr">x</a>'), ["dev-host"]);
  });
  it("refuses a retired code name, any case", () => {
    assert.deepEqual(rules("index.html", "<p>Welcome to Formername</p>"), ["code-name"]);
  });
  it("refuses an e-mail outside /privacy, accepts it on /privacy", () => {
    assert.deepEqual(rules("fr/contact/index.html", "<p>a@b.com</p>"), ["email"]);
    assert.deepEqual(rules("fr/privacy/index.html", "<p>privacy@b.com</p>"), []);
  });
  it("refuses an amount outside the allowed list", () => {
    assert.deepEqual(rules("fr/pricing/index.html", "<p>99 $</p>"), ["amount"]);
    assert.deepEqual(rules("fr/pricing/index.html", "<p>49&nbsp;$</p>".replace("&nbsp;", " ")), []);
  });
  it("refuses « Bientôt » / « Soon » on an offer", () => {
    assert.deepEqual(rules("fr/pricing/index.html", "<p>Bientôt disponible</p>"), ["soon"]);
    assert.deepEqual(rules("en/pricing/index.html", "<p>Available soon</p>"), ["soon"]);
    assert.deepEqual(rules("en/index.html", "<p>Soon</p>"), []);
  });
  it("refuses a licence name other than the repo's", () => {
    assert.deepEqual(rules("index.html", "<p>Licence MIT</p>"), ["licence"]);
    assert.deepEqual(rules("index.html", "<p>Licence FSL-1.1-ALv2</p>"), []);
  });
  it("refuses a status word different from the product's", () => {
    assert.deepEqual(rules("fr/index.html", "<span>Bientôt</span>"), ["status"]);
    assert.deepEqual(rules("en/index.html", "<span>Coming soon</span>"), ["status"]);
    assert.deepEqual(rules("fr/index.html", "<span>En développement</span>"), []);
  });
  it("passes a clean export", () => {
    const files = [
      ...page("fr/index.html", "<h1>Verikora</h1><span>En développement</span><p>FSL-1.1-ALv2</p>"),
      ...page("fr/pricing/index.html", "<p>49 $</p>"),
      ...page("fr/privacy/index.html", "<a href='mailto:privacy@krizaka.com'>privacy@krizaka.com</a>"),
    ];
    assert.deepEqual(checkExport(files, policy), []);
  });
  it("formats a finding as file:line rule message", () => {
    const [f] = checkExport(page("a.html", "<a>Sign in</a>"), policy);
    assert.match(formatFinding(f!), /^a\.html:2 sign-in /);
  });
});

describe("krizaka-export-guard CLI", () => {
  const run = (html: string, extra: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), "export-"));
    mkdirSync(dirname(join(dir, "out/fr/index.html")), { recursive: true });
    writeFileSync(join(dir, "out/fr/index.html"), html);
    return spawnSync(
      "node",
      [BIN, "out", "--product", "verikora", "--status", "development", "--code-name", "formername", ...extra],
      { encoding: "utf8", cwd: dir },
    );
  };
  it("exits 1 with readable findings", () => {
    const r = run("<a href='/fr/sign-in'>x</a>");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /fr[/\\]index\.html:1 sign-in /);
  });
  it("exits 0 on a clean export", () => {
    assert.equal(run("<h1>Verikora</h1>").status, 0);
  });
  it("exits 2 on a folder outside the working directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "export-"));
    const r = spawnSync("node", [BIN, "..", "--product", "p", "--status", "development", "--code-name", "x"], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(r.status, 2);
  });
  it("exits 2 without a directory", () => {
    assert.equal(spawnSync("node", [BIN], { encoding: "utf8" }).status, 2);
  });
  describe("flight and data payloads (krizaka-internal#4628)", () => {
    const flight = '1:["$","div",null,{"children":["$L2","$3","$1f"],"x":"$Sreact.fragment","y":"$undefined"}]';
    it("reads React flight references as references, not prices", () => {
      assert.deepEqual(rules("fr/index.txt", flight), []);
      assert.deepEqual(
        rules("fr/index.html", `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`),
        [],
      );
    });
    it("accepts the licence of the org catalogue in a data payload", () => {
      assert.deepEqual(rules("fr/index.txt", '2:{"name":"@krizaka/ui","license":"Apache-2.0"}'), []);
    });
    it("still refuses a visible product licence line", () => {
      assert.deepEqual(rules("fr/index.html", "<p>Licence Apache-2.0</p>"), ["licence"]);
    });
    it("still refuses a visible amount outside the allowed list, even next to a payload", () => {
      assert.deepEqual(rules("fr/pricing/index.html", "<p>$12</p>"), ["amount"]);
      assert.deepEqual(rules("fr/pricing/index.txt", '3:["$","p",null,{"children":"12 $"}]'), ["amount"]);
    });
  });
});

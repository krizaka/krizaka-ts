import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ArchitectureModelError, buildC4, layoutViews, staleSources } from "../src/index.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.mjs");
const dirs = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "layout-"));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// The org's base in miniature: a specification and one system the models extend.
const BASE = [
  {
    path: "specification.c4",
    text: "specification {\n  element person\n  element system\n  element container\n  element datastore { style { shape storage } }\n}\n",
  },
  {
    path: "org.c4",
    text: "model {\n  founder = person 'Founder'\n  platform = system 'Platform' {\n    tooling = container 'Tooling'\n  }\n}\n",
  },
];

const MODEL = `model {
  extend platform.tooling {
    cto = container 'CTO session' { technology 'Claude Code' description 'Talks to the founder.\\nSplits the work.' }
    launcher = container 'Launcher'
    sessions = container 'Sessions'
    opsdb = datastore 'Operations database'
  }
  founder -> platform.tooling.cto 'instructs'
  platform.tooling.cto -> platform.tooling.launcher 'launches'
  platform.tooling.launcher -> platform.tooling.sessions 'builds'
  platform.tooling.sessions -> platform.tooling.opsdb 'records'
  platform.tooling.opsdb -> platform.tooling.cto 'alerts'
}
views {
  view context { title 'Context' include founder, platform.tooling }
  view containers { title 'Containers' include platform.tooling.* , founder }
  dynamic view life {
    title 'Life of a team'
    founder -> platform.tooling.cto 'writes the brief'
    platform.tooling.cto -> platform.tooling.launcher 'launches'
    platform.tooling.launcher -> platform.tooling.sessions 'builds'
    platform.tooling.sessions -> platform.tooling.cto 'reports'
  }
}
`;
const options = { base: BASE, system: "platform.tooling" };
const layout = (opts = options) => layoutViews([{ path: "agents.c4", text: MODEL }], opts);

describe("layoutViews", () => {
  it("lays every view out with the geometry a drawing needs", async () => {
    const out = await layout();
    assert.equal(out.schema, "krizaka.layout/1");
    assert.deepEqual(out.views.map((v) => v.id).sort(), ["containers", "context", "life"]);
    for (const v of out.views) {
      assert.ok(v.bounds.width > 0 && v.bounds.height > 0, v.id);
      for (const n of v.nodes) {
        for (const k of ["x", "y", "width", "height"]) assert.ok(Number.isInteger(n[k]), `${v.id}.${n.id}.${k}`);
        assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= v.bounds.width + 1, `${v.id}.${n.id} inside the bounds`);
      }
      for (const e of v.edges) assert.ok(e.points.length >= 2, `${v.id}.${e.id}`);
    }
  });

  it("flattens labels, keeps the technology and the compound parents", async () => {
    const { views } = await layout();
    const containers = views.find((v) => v.id === "containers");
    const cto = containers.nodes.find((n) => n.title === "CTO session");
    assert.equal(cto.technology, "Claude Code");
    assert.equal(cto.description, "Talks to the founder. Splits the work.");
    const context = views.find((v) => v.id === "context");
    const tooling = context.nodes.find((n) => n.id === "platform.tooling");
    assert.equal(tooling.compound, false);
    const withParents = views.flatMap((v) => v.nodes).filter((n) => n.parent !== null);
    for (const n of withParents)
      assert.ok(
        views.some((v) => v.nodes.some((p) => p.id === n.parent)),
        n.id,
      );
  });

  it("marks an edge drawn against its rank as a back edge", async () => {
    const { views } = await layout();
    const life = views.find((v) => v.id === "life");
    const reports = life.edges.find((e) => e.label === "reports");
    assert.equal(reports.back, true);
    assert.equal(life.edges.find((e) => e.label === "launches").back, false);
    // the points run from the target (the CTO) to the source (the sessions)
    const target = life.nodes.find((n) => n.id === reports.target);
    const [first] = reports.points;
    assert.ok(Math.abs(first[1] - (target.y + target.height / 2)) <= target.height, "a back edge starts at its target");
  });

  it("numbers the steps of a dynamic view in the model's order, and only there", async () => {
    const { views } = await layout();
    const life = views.find((v) => v.id === "life");
    assert.equal(life.dynamic, true);
    assert.deepEqual(
      life.edges.map((e) => e.step),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      life.edges.map((e) => e.label),
      ["writes the brief", "launches", "builds", "reports"],
    );
    const containers = views.find((v) => v.id === "containers");
    assert.equal(containers.dynamic, false);
    assert.ok(containers.edges.every((e) => e.step === null));
  });

  it("is deterministic and carries the hashes of its sources and the verdict", async () => {
    const [a, b] = [await layout(), await layout()];
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(
      a.sources.model.map((f) => f.path),
      ["agents.c4"],
    );
    assert.match(a.sources.model[0].sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      a.sources.base.map((f) => f.path),
      ["org.c4", "specification.c4"],
    );
    const edited = await layoutViews([{ path: "agents.c4", text: `${MODEL}\n// edited` }], options);
    assert.notEqual(edited.sources.model[0].sha256, a.sources.model[0].sha256);
    assert.deepEqual(a.check, {
      status: "ok",
      system: "platform.tooling",
      errors: [],
      elements: [
        "platform.tooling.cto",
        "platform.tooling.launcher",
        "platform.tooling.opsdb",
        "platform.tooling.sessions",
      ],
    });
  });

  it("returns the requested views in the requested order", async () => {
    const out = await layout({ ...options, views: ["life", "context"] });
    assert.deepEqual(
      out.views.map((v) => v.id),
      ["life", "context"],
    );
  });

  it("lays out the containers of a repository built from its code, with no hand-written model", async () => {
    const out = await layoutViews(buildC4(join(dirname(fileURLToPath(import.meta.url)), "../../..")));
    const [view] = out.views;
    assert.equal(view.id, "containers");
    assert.ok(view.nodes.some((n) => n.title === "@krizaka/architecture" && n.technology === "TypeScript"));
    assert.ok(view.edges.length > 0);
    assert.equal(
      JSON.stringify(out),
      JSON.stringify(await layoutViews(buildC4(join(dirname(fileURLToPath(import.meta.url)), "../../..")))),
    );
  });
});

describe("the check refuses", () => {
  const refused = async (model, opts, rule) => {
    const error = await layoutViews(model, opts).then(
      () => assert.fail("the model was accepted"),
      (e) => e,
    );
    assert.ok(error instanceof ArchitectureModelError);
    assert.equal(error.name, "ArchitectureModelError");
    assert.equal(error.rule, rule);
    assert.match(error.message, new RegExp(`\\[${rule}\\]`));
    return error;
  };

  it("a model that does not parse, naming the rule and the file", async () => {
    const error = await refused([{ path: "bad.c4", text: "model { x = nothing 'X' }" }], options, "model");
    assert.equal(error.problems[0].path, "model/bad.c4");
  });

  it("a model that writes its own specification when a base is given", async () => {
    const text = "specification { element thing }\nmodel { extend platform.tooling { t = thing 'T' } }";
    await refused([{ path: "spec.c4", text }], options, "no-specification");
  });

  it("an element outside the system it may extend", async () => {
    const text = "model { stray = system 'Stray' }";
    const error = await refused([{ path: "stray.c4", text }], options, "home");
    assert.match(error.problems[0].message, /« stray » is outside the system platform\.tooling/);
  });

  it("a requested view the model does not have", async () => {
    const error = await refused([{ path: "agents.c4", text: MODEL }], { ...options, views: ["nope"] }, "views");
    assert.match(error.problems[0].message, /no view nope/);
  });
});

/** The strings a model's views draw, read from the refusal of an empty translation (every one is missing). */
async function drawnStrings() {
  const error = await layout({ ...options, translations: { fr: { path: "agents.fr.json", text: "{}" } } }).catch(
    (e) => e,
  );
  assert.ok(error instanceof ArchitectureModelError);
  assert.equal(error.rule, "translations");
  return error.problems.map((p) => p.message.match(/« (.*) »/s)[1]);
}
const frenchOf = async () => JSON.stringify(Object.fromEntries((await drawnStrings()).map((s) => [s, `FR ${s}`])));

describe("layoutViews with translations", () => {
  it("returns each language's views: the same geometry, every string translated", async () => {
    const text = await frenchOf();
    const out = await layout({ ...options, translations: { fr: { path: "agents.fr.json", text } } });
    const fr = out.translations.fr;
    assert.equal(fr.path, "agents.fr.json");
    assert.match(fr.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      fr.views.map((v) => v.title),
      out.views.map((v) => `FR ${v.title}`),
    );
    const life = fr.views.find((v) => v.id === "life");
    assert.deepEqual(
      life.edges.map((e) => [e.step, e.label]),
      [
        [1, "FR writes the brief"],
        [2, "FR launches"],
        [3, "FR builds"],
        [4, "FR reports"],
      ],
    );
    const cto = fr.views.find((v) => v.id === "containers").nodes.find((n) => n.id === "platform.tooling.cto");
    assert.equal(cto.technology, "FR Claude Code");
    assert.deepEqual(
      fr.views.map((v) => v.nodes.map(({ x, y, width, height }) => [x, y, width, height])),
      out.views.map((v) => v.nodes.map(({ x, y, width, height }) => [x, y, width, height])),
    );
  });

  it("refuses a string with no translation, naming it once", async () => {
    const strings = await drawnStrings();
    assert.ok(strings.includes("writes the brief"));
    assert.ok(strings.includes("Talks to the founder. Splits the work."));
    assert.equal(new Set(strings).size, strings.length);
  });

  it("refuses a translation no view draws, and a file that is not an object of strings", async () => {
    const words = { ...JSON.parse(await frenchOf()), "a retired label": "une étiquette retirée" };
    const unused = await layout({
      ...options,
      translations: { fr: { path: "agents.fr.json", text: JSON.stringify(words) } },
    }).catch((e) => e);
    assert.equal(unused.rule, "translations");
    assert.deepEqual(
      unused.problems.map((p) => [p.path, p.message]),
      [["agents.fr.json", "« a retired label » is translated but no view draws it"]],
    );
    const broken = await layout({ ...options, translations: { fr: { path: "agents.fr.json", text: "[1]" } } }).catch(
      (e) => e,
    );
    assert.equal(broken.rule, "translations");
    assert.match(broken.problems[0].message, /an object of strings/);
  });
});

describe("staleSources", () => {
  const files = async () => ({
    model: [{ path: "agents.c4", text: MODEL }],
    base: BASE,
    translations: { fr: { path: "agents.fr.json", text: await frenchOf() } },
  });
  const made = async (sources) => layoutViews(sources.model, { ...options, translations: sources.translations });

  it("finds nothing when the layout was made from the files as they are", async () => {
    const sources = await files();
    assert.deepEqual(staleSources(await made(sources), sources), []);
  });

  it("names every source that changed or is missing since the layout was made", async () => {
    const sources = await files();
    const data = await made(sources);
    const now = {
      model: [{ path: "agents.c4", text: `${MODEL}\n// edited` }],
      base: [BASE[0], { path: "org.c4", text: `${BASE[1].text}// edited\n` }],
      translations: { fr: { path: "agents.fr.json", text: "{}" }, de: { path: "agents.de.json", text: "{}" } },
    };
    assert.deepEqual(
      staleSources(data, now).map((p) => p.path),
      ["agents.c4", "org.c4", "agents.fr.json", "agents.de.json"],
    );
    assert.match(staleSources(data, now)[0].message, /another agents\.c4/);
    assert.deepEqual(
      staleSources(data, { model: [] }).map((p) => p.message),
      ["the layout was made from agents.c4 too: pass it"],
    );
  });

  it("refuses a file that is not a layout", () => {
    assert.match(staleSources({}, { model: [] })[0].message, /not a krizaka\.layout\/1/);
  });
});

describe("krizaka-architecture layout", () => {
  const run = (...args) => spawnSync("node", [cli, "layout", ...args], { encoding: "utf8" });

  it("writes the laid-out views of a model file", () => {
    const dir = scratch();
    writeFileSync(join(dir, "agents.c4"), MODEL);
    for (const f of BASE) writeFileSync(join(dir, f.path), f.text);
    const out = join(dir, "views.json");
    const r = run(
      join(dir, "agents.c4"),
      "--out",
      out,
      "--base",
      join(dir, "specification.c4"),
      "--base",
      join(dir, "org.c4"),
      "--system",
      "platform.tooling",
    );
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(data.check.status, "ok");
    assert.equal(data.views.length, 3);
  });

  it("lays out a repository directory through buildC4 and prints JSON", () => {
    const out = execFileSync(
      "node",
      [cli, "layout", join(dirname(fileURLToPath(import.meta.url)), "../../.."), "--view", "containers"],
      { encoding: "utf8" },
    );
    assert.deepEqual(
      JSON.parse(out).views.map((v) => v.id),
      ["containers"],
    );
  });

  it("exits 1 with the rule on a refused model, 2 without an input", () => {
    const dir = scratch();
    writeFileSync(join(dir, "bad.c4"), "model { x = nothing 'X' }");
    const r = run(join(dir, "bad.c4"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[model\]/);
    assert.equal(run().status, 2);
  });

  it("writes the translations, and `check` proves the layout matches its files until one changes", async () => {
    const dir = scratch();
    const at = (name) => join(dir, name);
    writeFileSync(at("agents.c4"), MODEL);
    writeFileSync(at("agents.fr.json"), await frenchOf());
    for (const f of BASE) writeFileSync(at(f.path), f.text);
    const sources = [
      "--base",
      at("specification.c4"),
      "--base",
      at("org.c4"),
      "--translations",
      `fr=${at("agents.fr.json")}`,
    ];
    const laid = run(at("agents.c4"), "--out", at("views.json"), "--system", "platform.tooling", ...sources);
    assert.equal(laid.status, 0, laid.stderr);
    assert.equal(JSON.parse(readFileSync(at("views.json"), "utf8")).translations.fr.views.length, 3);
    const check = (...args) => spawnSync("node", [cli, "check", ...args], { encoding: "utf8" });
    const fresh = check(at("views.json"), "--model", at("agents.c4"), ...sources);
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.match(fresh.stdout, /matches/);
    writeFileSync(at("agents.fr.json"), "{}");
    const stale = check(at("views.json"), "--model", at("agents.c4"), ...sources);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /agents\.fr\.json/);
    assert.equal(check(at("views.json")).status, 2);
    writeFileSync(at("broken.json"), "not json");
    assert.equal(check(at("broken.json"), "--model", at("agents.c4")).status, 1);
    assert.equal(run(at("agents.c4"), "--translations", "fr").status, 2);
  });
});

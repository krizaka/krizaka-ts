import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ArchitectureModelError, buildC4, layoutViews } from "../src/index.mjs";

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
});

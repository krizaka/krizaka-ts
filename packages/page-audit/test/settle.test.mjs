import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { auditContext, auditOptions, loadSettled, resizeSettled, withoutViewTransitions } from "../src/settle.mjs";

describe("the helper", () => {
  it("emulates reduced motion whatever the caller passes, and keeps the caller's options", async () => {
    assert.deepEqual(auditOptions(), { reducedMotion: "reduce" });
    assert.deepEqual(auditOptions({ colorScheme: "light", reducedMotion: "no-preference" }), {
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    let seen;
    await auditContext(
      {
        newContext: async (o) => {
          seen = o;
          return { addInitScript: async () => {} };
        },
      },
      { viewport: { width: 360, height: 800 } },
    );
    assert.deepEqual(seen, { viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });
  });
  it("loads, waits for the faces, then waits for the transition to end, in that order", async () => {
    const calls = [];
    const page = {
      url: () => "about:blank",
      goto: async (url) => (calls.push(`goto ${url}`), "response"),
      evaluate: async () => calls.push("fonts"),
      waitForFunction: async () => calls.push("settled"),
      setViewportSize: async () => calls.push("resize"),
    };
    assert.equal(await loadSettled(page, "http://x/a"), "response");
    assert.deepEqual(calls, ["goto http://x/a", "fonts", "settled"]);
    calls.length = 0;
    await resizeSettled(page, { width: 360, height: 800 });
    assert.deepEqual(calls, ["settled", "resize", "settled"]);
  });
  it("lets the page being left finish its transition before loading the next one", async () => {
    const calls = [];
    const page = {
      url: () => "http://x/a",
      goto: async () => calls.push("goto"),
      evaluate: async () => calls.push("fonts"),
      waitForFunction: async () => calls.push("settled"),
    };
    await loadSettled(page, "http://x/b");
    assert.deepEqual(calls, ["settled", "goto", "fonts", "settled"]);
  });
  it("waits on a condition (no active view transition), with a bound, not on a sleep", async () => {
    let predicate;
    let opts;
    await loadSettled(
      {
        url: () => "about:blank",
        goto: async () => {},
        evaluate: async () => {},
        waitForFunction: async (fn, _arg, o) => ((predicate = fn), (opts = o)),
      },
      "http://x",
    );
    assert.match(String(predicate), /activeViewTransition/);
    assert.match(String(predicate), /:active-view-transition/);
    assert.ok(opts.timeout > 0);
  });
});

describe("the audit context offers no View Transition (a transition aborted by a resize is a console error)", () => {
  it("installs the init script on the context it opens", async () => {
    const scripts = [];
    const context = { addInitScript: async (fn) => scripts.push(fn) };
    const got = await auditContext({ newContext: async () => context }, {});
    assert.equal(got, context);
    assert.deepEqual(scripts, [withoutViewTransitions]);
  });

  it("makes document.startViewTransition undefined", () => {
    const saved = globalThis.Document;
    globalThis.Document = class {};
    Document.prototype.startViewTransition = () => ({});
    try {
      withoutViewTransitions();
      assert.equal(new Document().startViewTransition, undefined);
    } finally {
      globalThis.Document = saved;
    }
  });
});

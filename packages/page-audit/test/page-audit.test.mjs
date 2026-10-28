import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { problemsOf } from "../src/page-audit.mjs";

const fine = { h1: 1, scrollWidth: 360, clientWidth: 360, wide: [], unnamedButtons: 0, headerAction: { visible: true, named: true }, chips: [48], chromeOverlaps: [], clips: [] };

describe("what counts as a problem on a rendered page", () => {
  it("nothing, when the page fits, has one h1, named buttons and its action on screen", () => {
    assert.deepEqual(problemsOf("/app @360 dark", fine, { h1: true, headerAction: true }), []);
    assert.deepEqual(problemsOf("/fr @360 dark", { ...fine, h1: 0, headerAction: null }), []);
  });
  it("a horizontal overflow, or elements past the edge, on any page", () => {
    assert.match(problemsOf("x", { ...fine, scrollWidth: 400 })[0], /scrollWidth 400 > 360/);
    assert.match(problemsOf("x", { ...fine, wide: ["code.font-mono"] })[0], /past the edge \(code.font-mono\)/);
  });
  it("not exactly one h1, and unnamed buttons, on a signed-in page", () => {
    assert.match(problemsOf("x", { ...fine, h1: 0 }, { h1: true })[0], /0 h1/);
    assert.match(problemsOf("x", { ...fine, h1: 2 }, { h1: true })[0], /2 h1/);
    assert.match(problemsOf("x", { ...fine, unnamedButtons: 2 }, { h1: true })[0], /2 unnamed button/);
    assert.deepEqual(problemsOf("x", { ...fine, h1: 0 }), []);
  });
  it("the header's action missing, off screen or unnamed, where the page has one", () => {
    assert.match(problemsOf("x", { ...fine, headerAction: null }, { headerAction: true })[0], /no header action/);
    assert.match(problemsOf("x", { ...fine, headerAction: { visible: false, named: true } }, { headerAction: true })[0], /off screen/);
    assert.match(problemsOf("x", { ...fine, headerAction: { visible: true, named: false } }, { headerAction: true })[0], /no accessible name/);
  });
  it("a card out of its panel, two sections covering each other, a column cut off (yomizaka#435)", () => {
    assert.match(problemsOf("x", { ...fine, overflowing: ["div[collection-card] out of section[binder]"] })[0], /overflows its panel \(div\[collection-card\]/);
    assert.match(problemsOf("x", { ...fine, overlaps: ["section[binder] over section[latest-checks]"] })[0], /covers a neighbouring section/);
    assert.match(problemsOf("x", { ...fine, cutColumns: ["aside[activity] cut by div.grid"] })[0], /is cut off/);
    assert.deepEqual(problemsOf("x", { ...fine, overflowing: [], overlaps: [], cutColumns: [] }), []);
  });
  it("a console error, and a chip under 44 px", () => {
    assert.match(problemsOf("x", fine, { errors: ["React error #418"] })[0], /console error — React error #418/);
    assert.match(problemsOf("x", { ...fine, chips: [40, 48] })[0], /40 px tall/);
  });
  it("the top chrome that chromeOverlaps: the fixed bar over the notice (yomizaka#449)", () => {
    assert.match(problemsOf("/fr @390 dark", { ...fine, chromeOverlaps: ["div.kz-environment-notice / header.fixed.top-3"] })[0], /top chrome chromeOverlaps \(div.kz-environment-notice \/ header.fixed.top-3\)/);
    assert.deepEqual(problemsOf("x", fine), []);
  });
  it("a box that cuts its own content (never overflows)", () => {
    assert.match(problemsOf("x", { ...fine, clips: ["button[header-check].truncate"] })[0], /content cut inside its box \(button\[header-check\]/);
  });
});

describe("the checks of the dev-preview crawls (akinaza#341, orazaka-web-client#124), opt-in", () => {
  it("the HTTP status of the load: 4xx, 5xx, or no response", () => {
    assert.deepEqual(problemsOf("x", fine, { status: 200 }), []);
    assert.match(problemsOf("x", fine, { status: 404 })[0], /HTTP 404/);
    assert.match(problemsOf("x", fine, { status: null })[0], /HTTP none/);
    assert.deepEqual(problemsOf("x", fine), []);
  });
  it("an empty <main>", () => {
    assert.match(problemsOf("x", { ...fine, emptyMain: true }, { emptyMain: true })[0], /empty <main>/);
    assert.deepEqual(problemsOf("x", { ...fine, emptyMain: true }), []);
  });
  it("the frame that forces a scroll: top + forced over the viewport", () => {
    assert.match(problemsOf("x", { ...fine, frame: { top: 60, forced: 900, viewport: 800 } }, { frame: true })[0], /forces a scroll \(starts at 60 px and asks 900 px of a 800 px screen\)/);
    assert.deepEqual(problemsOf("x", { ...fine, frame: { top: 60, forced: 740, viewport: 800 } }, { frame: true }), []);
    assert.deepEqual(problemsOf("x", { ...fine, frame: null }, { frame: true }), []);
  });
  it("an action under the tap target, a landmark wider than its box, a broken picture, a tile with nothing, a hard-coded colour", () => {
    assert.match(problemsOf("x", { ...fine, actions: [44, 30] }, { minAction: 36 })[0], /30 px tall \(< 36\)/);
    assert.match(problemsOf("x", { ...fine, boxes: ["<aside> 500px in 200px"] }, { boxes: true })[0], /wider than its box/);
    assert.match(problemsOf("x", { ...fine, brokenPictures: ["/a.png"] }, { pictures: true })[0], /broken picture \/a.png/);
    assert.match(problemsOf("x", { ...fine, emptyControls: ["empty tile"] }, { emptyControls: true })[0], /empty tile/);
    assert.match(problemsOf("x", { ...fine, hardColors: 2 }, { hardColors: true })[0], /2 element\(s\) with a hard-coded colour/);
  });
  it("the family chrome by kind of page", () => {
    const ok = { footers: 1, footerNamesKrizaka: true, nav: true };
    assert.deepEqual(problemsOf("x", { ...fine, landmarks: ok }, { landmarks: "public" }), []);
    assert.match(problemsOf("x", { ...fine, landmarks: { ...ok, footers: 0 } }, { landmarks: "public" })[0], /0 page footers/);
    assert.match(problemsOf("x", { ...fine, landmarks: { ...ok, footerNamesKrizaka: false } }, { landmarks: "public" })[0], /does not name Krizaka/);
    assert.match(problemsOf("x", { ...fine, landmarks: { ...ok, footers: 2 } }, { landmarks: "app" })[0], /at most one/);
    assert.deepEqual(problemsOf("x", { ...fine, landmarks: { footers: 0, footerNamesKrizaka: false, nav: false } }, { landmarks: "auth" }), []);
    assert.match(problemsOf("x", { ...fine, landmarks: { ...ok, nav: false } }, { landmarks: "app" })[0], /no <nav>/);
  });
  it("an empty map: 0 px, no canvas, no loaded tile (akinaza#488); nothing when it is drawn or when not asked", () => {
    const map = { name: "div.maplibregl-map", width: 600, height: 300, canvas: true, leaflet: false, tiles: 0 };
    assert.deepEqual(problemsOf("x", { ...fine, maps: [map] }, { maps: true }), []);
    assert.match(problemsOf("x", { ...fine, maps: [{ ...map, height: 0 }] }, { maps: true })[0], /600x0 px \(empty\)/);
    assert.match(problemsOf("x", { ...fine, maps: [{ ...map, canvas: false }] }, { maps: true })[0], /has no canvas/);
    assert.match(problemsOf("x", { ...fine, maps: [{ ...map, leaflet: true, canvas: false }] }, { maps: true })[0], /no loaded tile/);
    assert.deepEqual(problemsOf("x", { ...fine, maps: [{ ...map, leaflet: true, tiles: 4 }] }, { maps: true }), []);
    assert.deepEqual(problemsOf("x", { ...fine, maps: [{ ...map, height: 0 }] }), []);
    assert.deepEqual(problemsOf("x", { ...fine, maps: [] }, { maps: true }), []);
    assert.match(problemsOf("x", { ...fine, maps: [] }, { maps: { required: true } })[0], /no map on the page/);
    assert.match(problemsOf("x", { ...fine, maps: [{ ...map, height: 150 }] }, { maps: { min: 200 } })[0], /empty/);
  });
});

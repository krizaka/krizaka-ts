import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { describe, it } from "vitest";

import { checkMessage, trailersOf } from "../hooks/trailers.js";

const ALLOW = {
  bots: [{ emails: ["1+bot[bot]@users.noreply.github.com"] }],
  humans: [{ emails: ["me@example.org"] }],
  committerOnly: ["noreply@github.com"],
};

describe("hooks trailers", () => {
  it("reads the co-author trailers, any case, and stops at the scissors line and comments", () => {
    const msg = [
      "feat: x",
      "",
      "co-authored-by: A <a@x.org>",
      "# Co-authored-by: C <c@x.org>",
      "Signed-off-by: S <s@x.org>",
      "# ------------------------ >8 ------------------------",
      "Co-authored-by: Z <z@x.org>",
    ].join("\n");
    assert.deepEqual(trailersOf(msg), ["A <a@x.org>"]);
  });

  it("accepts a listed e-mail, a hashed one, and a message without trailer", () => {
    assert.deepEqual(checkMessage("x\n\nCo-Authored-By: Bot <1+bot[bot]@users.noreply.github.com>", ALLOW), []);
    assert.deepEqual(checkMessage("x\n\nCo-authored-by: M <ME@example.org>", ALLOW), []);
    const hash = createHash("sha256").update("hidden@x.org").digest("hex");
    assert.deepEqual(checkMessage("x\n\nCo-authored-by: H <hidden@x.org>", { people: [{ emailSha256: hash }] }), []);
    assert.deepEqual(checkMessage("just a subject", ALLOW), []);
  });

  it("refuses an invented e-mail, names it without echoing the address, and the committer-only one", () => {
    assert.deepEqual(checkMessage("x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", ALLOW), ["Claude"]);
    assert.deepEqual(checkMessage("x\n\nCo-authored-by: G <noreply@github.com>", ALLOW), ["G"]);
    assert.deepEqual(checkMessage("x\n\nCo-authored-by: <>", ALLOW), ["unnamed"]);
  });
});

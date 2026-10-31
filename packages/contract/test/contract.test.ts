import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertContract,
  ContractError,
  count,
  defineContract,
  expectContract,
  expectProviderAnswer,
  fetchContract,
  nonEmptyList,
  text,
} from "../src/index.js";

const res = (status: number, body?: unknown, raw?: string) => ({
  status,
  text: async () => raw ?? (body === undefined ? "" : JSON.stringify(body)),
});

const send = z.object({ sent: count(), total: count(), recipients: nonEmptyList(text()) });
const ok = { sent: 2, total: 3, recipients: ["a", "b"] };

async function fails(p: Promise<unknown> | (() => unknown), path?: string): Promise<ContractError> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(ContractError);
    if (path !== undefined) expect((e as ContractError).issues.map((i) => i.path)).toContain(path);
    return e as ContractError;
  }
  throw new Error("expected a ContractError");
}

describe("expectContract", () => {
  it("returns the parsed body of a valid 2xx answer", async () => {
    expect(await expectContract(res(200, ok), send)).toEqual(ok);
  });

  it("fails a 204 with no body", async () => {
    const e = await fails(expectContract(res(204), send));
    expect(e.status).toBe(204);
    expect(e.message).toContain("has no body");
  });

  it("fails a non-2xx and a non-JSON body", async () => {
    await fails(expectContract(res(500, ok), send));
    expect((await fails(expectContract(res(200, undefined, "<html>"), send))).message).toContain("not JSON");
  });

  it("fails a missing field with its path", async () => {
    await fails(expectContract(res(200, { sent: 1, recipients: ["a"] }), send), "total");
  });

  it("fails an undefined count with its path", async () => {
    await fails(() => assertContract({ ...ok, sent: undefined }, send), "sent");
  });

  it("fails NaN, Infinity, fractions and negatives in a count", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1])
      await fails(() => assertContract({ ...ok, sent: bad }, send), "sent");
  });

  it("fails an empty string and an empty list where one is required", async () => {
    await fails(expectContract(res(200, { ...ok, recipients: ["a", ""] }), send), "recipients.1");
    await fails(expectContract(res(200, { ...ok, recipients: [] }), send), "recipients");
  });

  it("catches holes a loose schema lets through, unless allowed", async () => {
    const loose = z.object({ data: z.unknown() });
    await fails(() => assertContract({ data: { n: Number.NaN } }, loose), "data.n");
    await fails(() => assertContract({ data: { s: "" } }, loose), "data.s");
    expect(assertContract({ data: { s: "" } }, loose, { allowEmptyStrings: true })).toEqual({ data: { s: "" } });
  });

  it("never reports a value", async () => {
    const e = await fails(() => assertContract({ ...ok, recipients: ["secret-token-123", ""] }, send));
    expect(e.message).not.toContain("secret-token-123");
  });
});

describe("expectProviderAnswer", () => {
  const mail = z.object({ id: text(), accepted: count() });
  it("passes with an accepted count and an id", async () => {
    expect(await expectProviderAnswer(res(200, { id: "m1", accepted: 2 }), mail, { expectedAccepted: 2 })).toEqual({
      id: "m1",
      accepted: 2,
    });
  });
  it("fails when nothing was accepted or fewer than expected", async () => {
    await fails(expectProviderAnswer(res(200, { id: "m1", accepted: 0 }), mail), "accepted");
    await fails(expectProviderAnswer(res(200, { id: "m1", accepted: 1 }), mail, { expectedAccepted: 2 }), "accepted");
  });
  it("fails without the id or with other keys", async () => {
    await fails(expectProviderAnswer(res(200, { accepted: 1 }), z.object({ accepted: count() })), "id");
    const other = z.object({ queued: count(), ref: text() });
    expect(
      await expectProviderAnswer(res(200, { queued: 3, ref: "r" }), other, { acceptedKey: "queued", idKey: "ref" }),
    ).toEqual({ queued: 3, ref: "r" });
  });
});

describe("defineContract and fetchContract", () => {
  const c = defineContract("newsletter send", send);
  it("asserts a value and a response under its name", async () => {
    expect(c.assert(ok)).toEqual(ok);
    expect(await c.expect(res(200, ok))).toEqual(ok);
    expect((await fails(c.expect(res(204)))).message).toContain("newsletter send");
  });
  it("fetchContract fails on a network error, non-2xx, and a broken body; passes a good one", async () => {
    expect(await fetchContract(async () => res(200, ok), "https://x.test/?token=abc", undefined, c)).toEqual(ok);
    expect(await fetchContract(async () => res(200, ok), "https://x.test", undefined, send)).toEqual(ok);
    const boom = await fails(
      fetchContract(
        async () => Promise.reject(new TypeError("fetch failed https://x.test/?token=abc")),
        "u",
        undefined,
        c,
      ),
    );
    expect(boom.message).not.toContain("token=abc");
    await fails(fetchContract(async () => res(502), "u", undefined, c));
    await fails(
      fetchContract(async () => res(200, { sent: 1 }), "u", undefined, send),
      "total",
    );
  });
});

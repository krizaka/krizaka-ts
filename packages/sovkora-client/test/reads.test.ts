import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createSovkoraClient, MAX_PAGE_BYTES, PAGE_KIND, parseReadings, SOVKORA_CODE, SovkoraError } from "../src";

/** The answer of sovkora-conversation-service's `POST /api/v1/document-reads` (`DocumentReadsResponse`). */
const ANSWER = readFileSync(new URL("./fixtures/document-reads.json", import.meta.url), "utf8");

function edgeAnswering(status: number, body: string) {
  const seen: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(body, { status });
  }) as typeof globalThis.fetch;
  const client = createSovkoraClient({
    baseUrl: "https://api.sovkora.test",
    apiKey: "oz_test",
    clock: { now: () => new Date("2026-11-18T12:00:00Z") },
    fetch,
    circuit: false,
  });
  return { client, seen };
}

const PAGE = new TextEncoder().encode("PAGE");

describe("document reads", () => {
  it("sends the pages, base64, with their kind, and answers one reading per page", async () => {
    const { client, seen } = edgeAnswering(200, ANSWER);
    const readings = await client.readPages([{ image: PAGE, kind: PAGE_KIND.photo }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: "https://api.sovkora.test/api/v1/document-reads",
      method: "POST",
      body: { pages: [{ image: "UEFHRQ==", kind: "photo" }] },
    });
    expect(seen[0]!.headers.authorization).toBe("Bearer oz_test");
    expect(readings).toEqual([
      {
        text: "TOTAL 1234.56",
        lines: [{ text: "TOTAL 1234.56", box: { left: 0.1, top: 0.4, right: 0.5, bottom: 0.5 }, confidence: 0.97 }],
        reader: "tesseract",
        version: "tesseract-5.5.0",
        generative: false,
        pageHash: "3f1a4c3b5d2e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
        key: "3f1a4c3b5d2e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a:tesseract:tesseract-5.5.0",
        costMicros: 0,
        latencyMs: 412,
        fallbackFrom: "paddleocr",
      },
    ]);
  });

  it("never sends a reader: the routing chooses it", async () => {
    const { client, seen } = edgeAnswering(200, ANSWER);
    await client.readPages([{ image: PAGE, kind: "pdf-scan", reader: "textract" } as never]);
    expect(seen[0]!.body).toEqual({ pages: [{ image: "UEFHRQ==", kind: "pdf-scan" }] });
  });

  it.each([
    ["no page", []],
    ["more than twelve pages", Array.from({ length: 13 }, () => ({ image: PAGE, kind: "photo" }))],
    ["an unknown kind", [{ image: PAGE, kind: "poster" }]],
    ["an empty page", [{ image: new Uint8Array(), kind: "photo" }]],
    ["a page over the bound", [{ image: new Uint8Array(MAX_PAGE_BYTES + 1), kind: "photo" }]],
  ])("refuses %s before any call", async (_what, pages) => {
    const { client, seen } = edgeAnswering(200, ANSWER);
    await expect(client.readPages(pages as never)).rejects.toMatchObject({ code: SOVKORA_CODE.input });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [400, '{"code":"INPUT_INVALID"}', SOVKORA_CODE.input],
    [413, '{"code":"BUDGET_EXHAUSTED"}', SOVKORA_CODE.input],
    [422, '{"code":"READER_REFUSED"}', SOVKORA_CODE.input],
    [401, "", SOVKORA_CODE.key],
    [503, '{"code":"READER_UNAVAILABLE"}', SOVKORA_CODE.unavailable],
    [504, '{"code":"READER_TIMEOUT"}', SOVKORA_CODE.unavailable],
  ])("a %i from the door is %s", async (status, body, code) => {
    const { client } = edgeAnswering(status, body);
    const failed = await client.readPages([{ image: PAGE, kind: "photo" }]).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(SovkoraError);
    expect((failed as SovkoraError).code).toBe(code);
  });

  it("refuses an answer that is not one reading per page", async () => {
    const { client } = edgeAnswering(200, '{"readings":[]}');
    await expect(client.readPages([{ image: PAGE, kind: "photo" }])).rejects.toMatchObject({
      code: SOVKORA_CODE.shape,
    });
    expect(() => parseReadings({ readings: [{ text: "x" }] }, 1)).toThrow(SovkoraError);
    expect(() => parseReadings(null, 1)).toThrow(SovkoraError);
  });
});

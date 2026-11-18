import { SOVKORA_CODE, SovkoraError } from "./errors";

/** The kinds of page Sovkora reads: its routing chooses a reader per kind. A PDF page is rasterised by the product first. */
export const PAGE_KIND = { pdfScan: "pdf-scan", screenshot: "screenshot", photo: "photo" } as const;
export type PageKind = (typeof PAGE_KIND)[keyof typeof PAGE_KIND];

/** At most this many pages in one `readPages` call. */
export const MAX_PAGES = 12;
/** One page is at most this many bytes (the reader worker's bound). */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

/** One page to read: its image bytes and its kind. There is no reader to choose: Sovkora's routing does. */
export interface ReadPageInput {
  image: Uint8Array;
  kind: PageKind;
}

/** A box, as fractions of the page (0 to 1, from the top left). */
export interface ReadBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ReadLine {
  text: string;
  box: ReadBox;
  /** The reader's confidence, 0 to 1. */
  confidence: number;
}

/** What Sovkora read on one page, which reader read it, and what it cost and took. */
export interface DocumentReading {
  text: string;
  lines: ReadLine[];
  reader: string;
  version: string;
  /** Whether the reader is a generative model (a vision-language model): never, unless Sovkora's switch is on. */
  generative: boolean;
  /** The SHA-256 of the page. */
  pageHash: string;
  /** The page hash, the reader and its version: the same page read again by the same version is the same reading. */
  key: string;
  /** What the page cost, in millionths of a US dollar. */
  costMicros: number;
  latencyMs: number;
  /** The default reader that failed when the fallback answered; null otherwise. */
  fallbackFrom: string | null;
}

const KINDS: ReadonlySet<string> = new Set(Object.values(PAGE_KIND));
const input = (message: string) => new SovkoraError(SOVKORA_CODE.input, message, { status: 422 });
const shape = (what: string) =>
  new SovkoraError(SOVKORA_CODE.shape, `Sovkora's answer has an unexpected shape: ${what}`);

/** Standard base64 of the bytes, in chunks (no `Buffer`: the package reads no runtime of its own). */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The body of `POST /api/v1/document-reads`, or `SOVKORA_INPUT` before any call: 1 to 12 pages, each 1 byte to 2 MB, of a known kind. */
export function readBody(pages: readonly ReadPageInput[]): { pages: { image: string; kind: PageKind }[] } {
  if (pages.length === 0 || pages.length > MAX_PAGES) throw input(`A read is 1 to ${MAX_PAGES} pages`);
  return {
    pages: pages.map(({ image, kind }) => {
      if (!KINDS.has(kind)) throw input("Not a page kind");
      if (!(image instanceof Uint8Array) || image.length === 0 || image.length > MAX_PAGE_BYTES)
        throw input(`A page is 1 to ${MAX_PAGE_BYTES} bytes`);
      return { image: base64(image), kind };
    }),
  };
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string";

function line(v: unknown): ReadLine {
  const o = (v ?? {}) as Record<string, unknown>;
  const b = (o.box ?? {}) as Record<string, unknown>;
  if (!isText(o.text) || !isNumber(o.confidence) || ![b.left, b.top, b.right, b.bottom].every(isNumber))
    throw shape("a line needs its text, box and confidence");
  return {
    text: o.text,
    box: { left: b.left as number, top: b.top as number, right: b.right as number, bottom: b.bottom as number },
    confidence: o.confidence,
  };
}

function reading(v: unknown): DocumentReading {
  const o = (v ?? {}) as Record<string, unknown>;
  const texts = [o.text, o.reader, o.version, o.pageHash, o.key];
  if (!texts.every(isText) || !Array.isArray(o.lines) || typeof o.generative !== "boolean")
    throw shape("a reading needs its text, lines, reader, version and key");
  if (!isNumber(o.costMicros) || !isNumber(o.latencyMs)) throw shape("a reading needs its cost and latency");
  if (o.fallbackFrom !== null && o.fallbackFrom !== undefined && !isText(o.fallbackFrom))
    throw shape("a fallback is a reader's name");
  return {
    text: o.text as string,
    lines: o.lines.map(line),
    reader: o.reader as string,
    version: o.version as string,
    generative: o.generative,
    pageHash: o.pageHash as string,
    key: o.key as string,
    costMicros: o.costMicros,
    latencyMs: o.latencyMs,
    fallbackFrom: (o.fallbackFrom as string | null | undefined) ?? null,
  };
}

/** Reads the door's answer: exactly one reading per page, in order; anything else is `SOVKORA_SHAPE`. */
export function parseReadings(body: unknown, pages: number): DocumentReading[] {
  const readings = (body as { readings?: unknown } | null)?.readings;
  if (!Array.isArray(readings) || readings.length !== pages) throw shape("one reading per page");
  return readings.map(reading);
}

import {
  DEFAULT_SCAN_TIMEOUT_MS,
  errorMessage,
  type MalwareScanner,
  type ObjectRef,
  readForScan,
  type ScanResult,
} from "./malware-scanner";
import type { ObjectStore } from "./port";

/** Sends one request to the daemon and returns everything it answers; rejects on a timeout or a broken connection. */
export type ScanTransport = (request: Uint8Array, options: { timeoutMs: number }) => Promise<Uint8Array>;

// @fixed: the INSTREAM protocol frames the stream in chunks, each prefixed by its length in 4 bytes (network order)
const CHUNK = 64 * 1024;

/** The INSTREAM request: `zINSTREAM\0`, the chunks as [length][bytes], then a zero length. */
export function instreamRequest(bytes: Uint8Array): Uint8Array {
  const command = new TextEncoder().encode("zINSTREAM\0");
  const frames = Math.ceil(bytes.byteLength / CHUNK);
  const out = new Uint8Array(command.byteLength + bytes.byteLength + 4 * (frames + 1));
  const view = new DataView(out.buffer);
  out.set(command, 0);
  let at = command.byteLength;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    view.setUint32(at, chunk.byteLength);
    out.set(chunk, at + 4);
    at += 4 + chunk.byteLength;
  }
  return out; // the last four bytes stay zero: the end of the stream
}

/** Reads the daemon's answer (`stream: OK`, `stream: <name> FOUND`, `… ERROR`). Anything else is an error, never clean. */
export function parseVerdict(answer: string): ScanResult {
  const line = answer.replaceAll("\0", "").trim();
  const found = /^stream: (.+) FOUND$/.exec(line);
  if (found?.[1]) return { status: "infected", name: found[1] };
  if (line === "stream: OK") return { status: "clean" };
  return { status: "error", reason: `unexpected answer from the scanner: ${line.slice(0, 200)}` };
}

/**
 * The scanner over a ClamAV daemon (`clamd`): the object is read from `store` and streamed to the daemon through `transport`
 * (`tcpScanTransport` in `@krizaka/storage/node`). Down, slow or confused: `error`, never `clean`.
 */
export function scanDaemon(options: {
  store: ObjectStore;
  transport: ScanTransport;
  timeoutMs?: number;
}): MalwareScanner {
  return {
    async scan(ref: ObjectRef, call = {}) {
      const read = await readForScan(options.store, ref);
      if ("status" in read) return read;
      try {
        const answer = await options.transport(instreamRequest(read.bytes), {
          timeoutMs: call.timeoutMs ?? options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS,
        });
        return parseVerdict(new TextDecoder().decode(answer));
      } catch (e) {
        return { status: "error", reason: `the scanner did not answer: ${errorMessage(e)}` };
      }
    },
  };
}

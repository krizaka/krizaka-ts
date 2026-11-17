import { lookup as dnsLookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";

import type { Resolver } from "./dns-check";
import { type FetchLike, STORAGE_CODE, StorageError } from "./port";
import { isPrivateAddress } from "./private-address";

type Found = { address: string; family: 4 | 6 };
/** Node's `lookup` callback: every address when it may try several (`all`), one otherwise. */
type NodeAnswer = (error: Error | null, address?: string | Found[], family?: number) => void;
type Request = (url: URL, options: https.RequestOptions, callback: (res: IncomingMessage) => void) => ClientRequest;
type FetchResponse = Awaited<ReturnType<FetchLike>>;

const defaultResolver: Resolver = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);
const refused = (why: string) => new StorageError(STORAGE_CODE.badEndpoint, `endpoint ${why}`);

/** The addresses a name resolved to, judged: a private one among them refuses the whole name. */
function judged(addresses: string[]): Found[] {
  const found = addresses.map((address): Found => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
  if (found.length === 0) throw refused("does not resolve");
  if (found.some((f) => isPrivateAddress(f.address))) throw refused("must not be a private address");
  return found;
}

/** The `lookup` a connection is made with: every address the name resolves to is judged at connect time, and only a checked one is used. */
function checkedLookup(resolve: Resolver) {
  return (host: string, options: { all?: boolean }, callback: unknown) => {
    const answer = callback as NodeAnswer;
    resolve(host)
      .catch(() => [])
      .then(judged)
      .then(
        (found) => (options.all ? answer(null, found) : answer(null, found[0]!.address, found[0]!.family)),
        (error: Error) => answer(error),
      );
  };
}

/** A whole Node response, read, as a `FetchLike` answer. */
function readResponse(res: IncomingMessage): Promise<FetchResponse> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("error", fail);
    res.on("end", () => {
      const bytes = Buffer.concat(chunks);
      const status = res.statusCode ?? 0;
      const header = (name: string) => {
        const value = res.headers[name.toLowerCase()];
        return Array.isArray(value) ? value.join(", ") : (value ?? null);
      };
      done({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: header },
        arrayBuffer: async () => new Uint8Array(bytes).buffer,
        text: async () => bytes.toString("utf8"),
      });
    });
  });
}

/**
 * A `FetchLike` for an endpoint someone typed (a person's own bucket), for Node: https only, a redirect is answered as it is (never
 * followed), a timeout, and the connection goes to an address judged *at connect time* (`isPrivateAddress`), so a name that resolved to
 * a public address when it was checked cannot connect us to our own network afterwards. `request` is for tests (node:http's).
 */
export function publicOnlyFetch(
  options: { resolve?: Resolver; timeoutMs?: number; request?: Request } = {},
): FetchLike {
  const lookup = checkedLookup(options.resolve ?? defaultResolver);
  const request: Request = options.request ?? https.request;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return (url, init) =>
    new Promise((done, fail) => {
      const target = new URL(url);
      if (target.protocol !== "https:") return fail(refused("must be https"));
      const literal = target.hostname.replace(/^\[|\]$/g, "");
      if (net.isIP(literal) && isPrivateAddress(literal)) return fail(refused("must not be a private address"));
      const req = request(target, { method: init.method, headers: init.headers, timeout: timeoutMs, lookup }, (res) => {
        readResponse(res).then(done, fail);
      });
      req.on("timeout", () => req.destroy(refused("did not answer in time")));
      req.on("error", fail);
      req.end(init.body ? Buffer.from(init.body) : undefined);
    });
}

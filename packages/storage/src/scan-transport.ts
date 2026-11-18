import net from "node:net";

import type { ScanTransport } from "./scan-daemon";

/** A TCP connection to the daemon (`host:3310`): one request per connection, the answer read until the daemon closes it. */
export function tcpScanTransport(address: { host: string; port: number }): ScanTransport {
  return (request, { timeoutMs }) =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = net.connect(address.port, address.host);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`no answer within ${timeoutMs} ms`)));
      socket.on("connect", () => socket.write(request));
      socket.on("data", (d) => chunks.push(d));
      socket.on("error", reject);
      socket.on("close", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    });
}

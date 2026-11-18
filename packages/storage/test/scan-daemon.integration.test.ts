import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { memoryObjectStore } from "../src/memory-store";
import { scanDaemon } from "../src/scan-daemon";
import { tcpScanTransport } from "../src/scan-transport";
import { EICAR } from "./eicar";

/** The scanner against a real clamd (CI sets STORAGE_SCAN_IT=1; locally with Docker running): the EICAR test file, and a daemon that is not there. */
describe.runIf(process.env.STORAGE_SCAN_IT === "1")("the scanner on clamd", () => {
  let server: StartedTestContainer;
  let address = { host: "127.0.0.1", port: 3310 };

  beforeAll(async () => {
    server = await new GenericContainer(process.env.STORAGE_CLAMD_IMAGE ?? "clamav/clamav:1.4")
      .withPlatform("linux/amd64") // the image has no arm64 build (a Mac runs it emulated)
      .withExposedPorts(3310)
      // clamd answers only once the signatures are loaded (a minute or two)
      .withWaitStrategy(
        Wait.forLogMessage(/Self checking every|socket found, clamd started/i).withStartupTimeout(600_000),
      )
      .start();
    address = { host: server.getHost(), port: server.getMappedPort(3310) };
  }, 660_000);
  afterAll(async () => {
    await server?.stop();
  });

  const bytes = (s: string) => new TextEncoder().encode(s);
  const storeWith = async (files: Record<string, string>) => {
    const store = memoryObjectStore();
    for (const [k, v] of Object.entries(files)) await store.put(k, bytes(v), { contentType: "text/plain" });
    return store;
  };

  it("finds the EICAR test file and passes a clean one", async () => {
    const store = await storeWith({ "u/eicar.com": EICAR, "u/ok.txt": "hello" });
    const scanner = scanDaemon({ store, transport: tcpScanTransport(address) });
    expect(await scanner.scan({ key: "u/eicar.com" })).toMatchObject({
      status: "infected",
      name: expect.stringMatching(/eicar/i),
    });
    expect(await scanner.scan({ key: "u/ok.txt" })).toEqual({ status: "clean" });
  });

  it("is an error, never clean, when nothing listens", async () => {
    const store = await storeWith({ "u/ok.txt": "hello" });
    const scanner = scanDaemon({ store, transport: tcpScanTransport({ host: "127.0.0.1", port: 1 }), timeoutMs: 2000 });
    expect(await scanner.scan({ key: "u/ok.txt" })).toMatchObject({ status: "error" });
  });
});

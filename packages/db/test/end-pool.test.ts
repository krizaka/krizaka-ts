import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { endPool } from "../src/testing";

/** A socket that closes later than `pool.end()` resolves: what `pg` does against a server. */
function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), { destroyed: false });
  return {
    socket,
    close: () => {
      socket.destroyed = true;
      socket.emit("close");
    },
  };
}

describe("endPool", () => {
  it("resolves only once every socket of the pool is closed, not when pool.end() resolves", async () => {
    const [a, b] = [fakeSocket(), fakeSocket()];
    const pool = { _clients: [a, b].map(({ socket }) => ({ connection: { stream: socket } })), end: async () => {} };
    let done = false;
    const ended = endPool(pool).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    a.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    b.close();
    await ended;
    expect(done).toBe(true);
  });

  it("does not wait for a socket that is already destroyed, nor for a pool without clients", async () => {
    const gone = fakeSocket();
    gone.close();
    await expect(
      endPool({ _clients: [{ connection: { stream: gone.socket } }, {}], end: async () => {} }),
    ).resolves.toBeUndefined();
    await expect(endPool({ end: async () => {} })).resolves.toBeUndefined();
  });
});

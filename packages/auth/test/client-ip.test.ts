import { describe, expect, it } from "vitest";

import { clientIp } from "../src";

const h = (init: Record<string, string>) => new Headers(init);

describe("the client's address", () => {
  it("reads the header the edge sets, first", () => {
    expect(
      clientIp(h({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" }), {
        header: "do-connecting-ip",
      }),
    ).toBe("203.0.113.7");
    expect(clientIp(h({ "CF-Connecting-IP": "2001:db8::1" }), { header: " CF-Connecting-IP " })).toBe("2001:db8::1");
  });

  it("never trusts the left of X-Forwarded-For (the client writes it): it reads the entry the last proxy appended", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.1" }), { trustedProxyHops: 2 })).toBe(
      "203.0.113.7",
    );
  });

  it("clamps the hops to 1–10 and falls back to 1 for nonsense", () => {
    const headers = h({ "x-forwarded-for": "198.51.100.1, 198.51.100.2, 198.51.100.3" });
    expect(clientIp(headers, { trustedProxyHops: 0 })).toBe("198.51.100.3");
    expect(clientIp(headers, { trustedProxyHops: Number.NaN })).toBe("198.51.100.3");
    expect(clientIp(headers, { trustedProxyHops: 99 })).toBeNull();
  });

  it("falls back to X-Real-IP, then to nothing (local development without a proxy)", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIp(h({}))).toBeNull();
  });

  it("ignores a value that is not an address", () => {
    expect(
      clientIp(h({ "do-connecting-ip": "not-an-ip", "x-forwarded-for": "999.1.1.1" }), { header: "do-connecting-ip" }),
    ).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "<script>" }))).toBeNull();
  });

  it("reads the first address of a list in the edge's header", () => {
    expect(clientIp(h({ "do-connecting-ip": "203.0.113.7, 10.0.0.1" }), { header: "do-connecting-ip" })).toBe(
      "203.0.113.7",
    );
  });
});

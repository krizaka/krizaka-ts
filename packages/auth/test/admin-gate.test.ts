import { describe, expect, it } from "vitest";

import { ADMIN_REFUSAL, allowedIps, ipAllowed, requireAdmin } from "../src";

const admin = { account: { role: "ADMIN" } };
const user = { account: { role: "USER" } };

describe("the administration's address lock", () => {
  it("lets in only an address of the list, nobody without one", () => {
    expect(ipAllowed("203.0.113.7", ["203.0.113.7"])).toBe(true);
    expect(ipAllowed("198.51.100.9", ["203.0.113.7"])).toBe(false);
    expect(ipAllowed(null, ["203.0.113.7"])).toBe(false);
  });

  it("an empty list is nobody in production and anybody in development, so a forgotten setting never opens the console", () => {
    expect(allowedIps([], { production: true })).toEqual([]);
    expect(allowedIps([], { production: false })).toBeNull();
    expect(allowedIps(["203.0.113.7"], { production: true })).toEqual(["203.0.113.7"]);
    expect(ipAllowed("203.0.113.7", allowedIps([], { production: true }))).toBe(false);
    expect(ipAllowed(null, allowedIps([], { production: false }))).toBe(true);
  });
});

describe("the administration's three locks", () => {
  const open = { ip: "203.0.113.7", allowedIps: ["203.0.113.7"] };

  it("lets in an administrator on an allowed address", () => {
    expect(requireAdmin({ session: admin, ...open })).toEqual({ ok: true });
  });

  it("on the API: 401 without a session, 403 for another role, 403 for another address, each with its code", () => {
    expect(requireAdmin({ session: null, ...open })).toEqual({ ok: false, status: 401, code: ADMIN_REFUSAL.unauthenticated });
    expect(requireAdmin({ session: user, ...open })).toEqual({ ok: false, status: 403, code: ADMIN_REFUSAL.forbidden });
    expect(requireAdmin({ session: admin, ip: "198.51.100.9", allowedIps: ["203.0.113.7"] })).toEqual({ ok: false, status: 403, code: ADMIN_REFUSAL.ipNotAllowed });
  });

  it("on a page: the administration does not announce itself, so every failed lock is a 404", () => {
    for (const input of [{ session: null, ...open }, { session: user, ...open }, { session: admin, ip: null, allowedIps: [] }]) {
      expect(requireAdmin({ ...input, surface: "page" })).toEqual({ ok: false, status: 404, code: ADMIN_REFUSAL.notFound });
    }
    expect(requireAdmin({ session: admin, ...open, surface: "page" })).toEqual({ ok: true });
  });

  it("the first lock that fails decides, and the role is the product's to name", () => {
    expect(requireAdmin({ session: user, ip: "198.51.100.9", allowedIps: [] }).ok).toBe(false);
    expect(requireAdmin({ session: user, ip: "198.51.100.9", allowedIps: [] })).toMatchObject({ code: ADMIN_REFUSAL.forbidden });
    expect(requireAdmin({ session: { account: { role: "OPERATOR" } }, ip: null, allowedIps: null, role: "OPERATOR" })).toEqual({ ok: true });
  });
});

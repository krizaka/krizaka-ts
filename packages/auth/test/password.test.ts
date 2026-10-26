import { describe, expect, it } from "vitest";

import { decoyHash, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem, verifyPassword } from "../src";

/** Made by the copy of `password.ts` that Yomizaka, Akinaza, Kachizaka and Yororis carried (recorded 2026-10-26 from that code). */
const FROM_A_PRODUCT = "scrypt$32768$8$1$tB8PYjKQjpGaU0F--n265A$pcYd8V_rsq7tMXfRX1cPH5iWLSJVOzq5oz0vQLc2d3I";

describe("passwords", () => {
  it("hashes with scrypt and a salt: the right password passes, a wrong one does not", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await hashPassword("correct horse battery")).not.toBe(hash);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterz", hash)).toBe(false);
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false);
    expect(await verifyPassword("anything", await decoyHash())).toBe(false);
  });

  it("verifies a hash a product stored with its own copy, so no one is asked to change their password", async () => {
    expect(await verifyPassword("correct horse battery staple", FROM_A_PRODUCT)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", FROM_A_PRODUCT)).toBe(false);
  });

  it("refuses a malformed hash or an over-long password without doing the work", async () => {
    expect(await verifyPassword("whatever", "scrypt$32768$8$1$only-a-salt")).toBe(false);
    expect(await verifyPassword("whatever", "")).toBe(false);
    expect(await verifyPassword("a".repeat(PASSWORD_MAX_LENGTH + 1), FROM_A_PRODUCT)).toBe(false);
  });

  it("asks for 12 characters at least and 256 at most", () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([12, 256]);
    expect(passwordProblem("short")).toBe("TOO_SHORT");
    expect(passwordProblem("a".repeat(12))).toBeNull();
    expect(passwordProblem("a".repeat(256))).toBeNull();
    expect(passwordProblem("a".repeat(300))).toBe("TOO_LONG");
  });

  it("gives the decoy hash once: the same work for an address with no account", async () => {
    expect(await decoyHash()).toBe(await decoyHash());
  });
});

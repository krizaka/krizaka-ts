import { describe, expect, it } from "vitest";

import { ME_HEADERS, ME_PATH, meResponse, meSchema } from "../src/contract";

const account = { id: "a1", name: "Éric", email: "eric@example.com", avatarSeed: null };

describe("the « who is here » contract (krizaka-ui#551)", () => {
  it("answers 200 for a signed-out visitor, never a 401, with the headers that keep it private", async () => {
    const response = meResponse({ signupOpen: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ signedIn: false, signupOpen: true });
  });

  it("answers the account of a signed-in person", async () => {
    const response = meResponse({ signupOpen: false, account });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedIn: true, signupOpen: false, account });
  });

  it("holds the path and the headers every product serves", () => {
    expect(ME_PATH).toBe("/api/me");
    expect(ME_HEADERS).toEqual({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  });

  it("refuses a body that breaks the rule: an account exactly when signed in", () => {
    expect(meSchema.safeParse({ signedIn: true, signupOpen: true }).success).toBe(false);
    expect(meSchema.safeParse({ signedIn: false, signupOpen: true, account }).success).toBe(false);
    expect(meSchema.safeParse({ signedIn: true, signupOpen: true, account: { id: "a1" } }).success).toBe(false);
    expect(meSchema.safeParse({ signedIn: true, signupOpen: true, account }).success).toBe(true);
  });
});

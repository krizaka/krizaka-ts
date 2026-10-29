import { describe, expect, it } from "vitest";

import { isCanadianPostalCode, isE164Phone, isEmail, isHttpUrl, isSlug } from "../src";

describe("validate", () => {
  it("emails", () => {
    expect(isEmail("eric@example.com")).toBe(true);
    expect(isEmail("eric@example")).toBe(false);
    expect(isEmail("a b@example.com")).toBe(false);
    expect(isEmail(null)).toBe(false);
  });
  it("http urls", () => {
    expect(isHttpUrl("https://www.krizaka.com/story")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("/relative")).toBe(false);
  });
  it("slugs", () => {
    expect(isSlug("my-first-post")).toBe(true);
    expect(isSlug("My-Post")).toBe(false);
    expect(isSlug("a--b")).toBe(false);
  });
  it("phones and postal codes", () => {
    expect(isE164Phone("+15145550123")).toBe(true);
    expect(isE164Phone("514-555-0123")).toBe(false);
    expect(isCanadianPostalCode("H2T 1S6")).toBe(true);
    expect(isCanadianPostalCode("h2t1s6")).toBe(true);
    expect(isCanadianPostalCode("D2T 1S6")).toBe(false);
  });
});

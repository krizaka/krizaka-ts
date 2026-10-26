import { differenceInMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import { type AccountDeps, dbAccounts, type Mail, PASSWORD_RESET_TTL_MINUTES, passwordResetMail, type Query } from "../src";

const NOW = new Date("2026-10-24T12:00:00.000Z");

/** A query that answers one account and records the reset link it is asked to store. */
function harness(extra: Partial<AccountDeps> = {}) {
  const inserts: unknown[][] = [];
  const mails: Mail[] = [];
  const query: Query = async <T,>(sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT id, locale FROM accounts")) return [{ id: "a1", locale: "fr" }] as T[];
    if (sql.startsWith("INSERT INTO password_resets")) inserts.push(params ?? []);
    return [] as T[];
  };
  const deps: AccountDeps = {
    query,
    mail: async (m) => void mails.push(m),
    baseUrl: "https://www.example.test",
    product: "Exemple",
    tokenPrefix: "ex",
    passwords: { hash: async (p) => p, verify: async () => true },
    tokenHash: (t) => `h:${t}`,
    ...extra,
  };
  return { deps, inserts, mails };
}

const minutesBetween = (a: Date, b: Date) => differenceInMinutes(b, a);

describe("the password reset link's lifetime", () => {
  it("is 30 minutes by default, in the expiry and in the mail", async () => {
    const { deps, inserts, mails } = harness();
    await dbAccounts(deps).requestPasswordReset("a@b.test", NOW);
    expect(PASSWORD_RESET_TTL_MINUTES).toBe(30);
    expect(minutesBetween(NOW, inserts[0]![2] as Date)).toBe(30);
    expect(mails[0]!.text).toContain("30 min");
  });

  it("hands the link to the product as data (kind, url, minutes), beside the text", async () => {
    const { deps, mails } = harness({ passwordResetTtlMinutes: 45 });
    await dbAccounts(deps).requestPasswordReset("a@b.test", NOW);
    expect(mails[0]!.link).toEqual({ kind: "passwordReset", url: expect.stringMatching(/^https:\/\/www\.example\.test\/fr\/reset-password\?token=ex1\./), minutes: 45 });
    expect(mails[0]!.text).toContain(mails[0]!.link!.url);
  });

  it("uses the configured value for the expiry and for the mail text, in French and in English", async () => {
    const { deps, inserts, mails } = harness({ passwordResetTtlMinutes: 90 });
    await dbAccounts(deps).requestPasswordReset("a@b.test", NOW);
    expect(minutesBetween(NOW, inserts[0]![2] as Date)).toBe(90);
    expect(mails[0]!.text).toContain("90 min");
    expect(mails[0]!.text).not.toContain("30 min");
    expect(passwordResetMail("P", "en", "https://u", 45).text).toContain("valid 45 min");
    expect(passwordResetMail("P", "fr", "https://u", 45).text).toContain("valide 45 min");
    expect(passwordResetMail("P", "en", "https://u").text).toContain("valid 30 min");
  });

  it("accepts the bounds 5 and 1440 minutes", () => {
    expect(() => dbAccounts(harness({ passwordResetTtlMinutes: 5 }).deps)).not.toThrow();
    expect(() => dbAccounts(harness({ passwordResetTtlMinutes: 1440 }).deps)).not.toThrow();
  });

  it.each([4, 1441, 0, -30, 30.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s when the service is made", (value) => {
    expect(() => dbAccounts(harness({ passwordResetTtlMinutes: value }).deps)).toThrow(/passwordResetTtlMinutes/);
  });

  it("the mail function refuses an out-of-range value too", () => {
    expect(() => passwordResetMail("P", "en", "https://u", 4)).toThrow(/passwordResetTtlMinutes/);
  });
});

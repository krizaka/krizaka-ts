import crypto from "node:crypto";

import { addHours, addMinutes } from "date-fns";

import { AccountError, type AccountProfile, type AccountService, type ProfilePatch, type SessionSummary, type Theme } from "./port";

/** A SQL executor: the rows of a statement and its parameters (the product's pool). */
export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Mail {
  to: string;
  /** The language of the mail (the person's). */
  locale: "en" | "fr";
  subject: string;
  text: string;
}

export interface AccountDeps {
  query: Query;
  /**
   * Runs `work` in one transaction on one connection (BEGIN … COMMIT, rolled back when `work` throws) — the product's pool
   * knows how. The password reset runs under it: the account row is locked, the links retired and issued, the token claimed,
   * the password set and the sessions ended as one. Without it, the statements run one by one on `query` (one process, no
   * concurrent requests): give it in production.
   */
  transaction?: <T>(work: (query: Query) => Promise<T>) => Promise<T>;
  mail: (mail: Mail) => Promise<void>;
  /** `https://www.akinaza.com`: the e-mail change link is `<baseUrl>/<locale>/confirm-email?token=…`, the reset link `<baseUrl>/<locale>/reset-password?token=…`. */
  baseUrl: string;
  /** The product's name, in the words of the mail (« Akinaza »). */
  product: string;
  /** The product's token prefix, two or three letters (`ye1.` for Yomizaka: `ye`). The tokens are `<prefix>1.<43 base64url>`. */
  tokenPrefix: string;
  passwords: { hash: (password: string) => Promise<string>; verify: (password: string, stored: string) => Promise<boolean> };
  /** How a token is kept: the product's own keyed hash, the one its sessions use. */
  tokenHash: (token: string) => string;
  /** Test seam: the token to issue. */
  token?: () => string;
}

// @fixed: the lifetime of an e-mail change link, a security parameter
export const EMAIL_CHANGE_TTL_HOURS = 24;
// @fixed: the lifetime of a password reset link, a security parameter
export const PASSWORD_RESET_TTL_MINUTES = 30;
const NAME_MAX = 80;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 256;
const THEMES: readonly Theme[] = ["light", "dark", "system"];

/** One format for every mailed link (an e-mail change, a password reset): the product's prefix, a version, 256 random bits. */
export const linkToken = (prefix: string) => `${prefix}1.${crypto.randomBytes(32).toString("base64url")}`;
export const isLinkToken = (prefix: string, value: string | undefined | null): value is string => !!value && new RegExp(`^${prefix}1\\.[A-Za-z0-9_-]{43}$`).test(value);
export const emailChangeToken = linkToken;
export const isEmailChangeToken = isLinkToken;

export function passwordResetMail(product: string, locale: "en" | "fr", url: string) {
  return locale === "fr"
    ? { subject: `Réinitialisez votre mot de passe — ${product}`, text: `Bonjour,\n\nPour choisir un nouveau mot de passe pour votre compte ${product}, ouvrez ce lien (valide ${PASSWORD_RESET_TTL_MINUTES} min, une seule fois) :\n${url}\n\nSi vous n'avez rien demandé, ignorez ce message : votre mot de passe ne change pas.\n` }
    : { subject: `Reset your password — ${product}`, text: `Hello,\n\nTo choose a new password for your ${product} account, open this link (valid ${PASSWORD_RESET_TTL_MINUTES} min, once):\n${url}\n\nIf you did not ask for this, ignore this message: your password does not change.\n` };
}

export function emailChangeMail(product: string, locale: "en" | "fr", url: string) {
  return locale === "fr"
    ? { subject: `Confirmez votre nouvelle adresse — ${product}`, text: `Bonjour,\n\nPour utiliser cette adresse avec votre compte ${product}, confirmez-la en ouvrant ce lien (valide ${EMAIL_CHANGE_TTL_HOURS} h) :\n${url}\n\nSi vous n'avez rien demandé, ignorez ce message : rien ne change.\n` }
    : { subject: `Confirm your new address — ${product}`, text: `Hello,\n\nTo use this address with your ${product} account, confirm it by opening this link (valid ${EMAIL_CHANGE_TTL_HOURS} h):\n${url}\n\nIf you did not ask for this, ignore this message: nothing changes.\n` };
}

/** One « @ », something on each side, a dot inside the domain, no space — checked without a backtracking pattern. */
const looksLikeEmail = (address: string): boolean => {
  if (address.length > 320 || /\s/.test(address)) return false;
  const at = address.indexOf("@");
  if (at < 1 || at !== address.lastIndexOf("@")) return false;
  const domain = address.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
};

const cleanName = (raw: string): string => {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length > NAME_MAX) throw new AccountError(400, "BAD_REQUEST", `A name is at most ${NAME_MAX} characters`);
  return name;
};

interface ProfileRow {
  id: string;
  email: string;
  name: string | null;
  locale: "en" | "fr";
  theme: Theme | null;
  avatar_seed: string | null;
  email_verified_at: Date | null;
  pending: string | null;
}

/** The adapter over the product's own PostgreSQL (`accounts`, `sessions`, `email_changes`, `password_resets`; see `accountsMigration`). */
export function postgresAccounts(deps: AccountDeps): AccountService {
  const { query } = deps;
  const transaction = deps.transaction ?? (<T>(work: (q: Query) => Promise<T>) => work(query));
  const wrong = () => new AccountError(403, "WRONG_PASSWORD", "The password is not right");

  async function profileOf(id: string): Promise<AccountProfile> {
    const [row] = await query<ProfileRow>(
      `SELECT a.id, a.email, a.name, a.locale, a.theme, a.avatar_seed, a.email_verified_at,
              (SELECT c.new_email FROM email_changes c WHERE c.account_id = a.id AND c.used_at IS NULL AND c.expires_at > now() ORDER BY c.created_at DESC LIMIT 1) AS pending
         FROM accounts a WHERE a.id = $1`,
      [id],
    );
    if (!row) throw new AccountError(404, "NOT_FOUND", "No such account");
    return { id: row.id, email: row.email, name: row.name, locale: row.locale, theme: row.theme, avatarSeed: row.avatar_seed, emailVerified: !!row.email_verified_at, pendingEmail: row.pending };
  }

  async function confirmPassword(id: string, password: string): Promise<void> {
    const [row] = await query<{ password_hash: string | null }>("SELECT password_hash FROM accounts WHERE id = $1", [id]);
    if (!row?.password_hash || password.length > PASSWORD_MAX || !(await deps.passwords.verify(password, row.password_hash))) throw wrong();
  }

  return {
    profile: profileOf,

    async updateProfile(id, patch: ProfilePatch) {
      const name = patch.name === undefined ? undefined : patch.name === null ? null : cleanName(patch.name);
      if (patch.avatarSeed && !/^[a-z0-9-]{1,40}$/.test(patch.avatarSeed)) throw new AccountError(400, "BAD_REQUEST", "Not an avatar");
      if (patch.theme && !THEMES.includes(patch.theme)) throw new AccountError(400, "BAD_REQUEST", "Not a theme");
      await query(
        `UPDATE accounts SET name = CASE WHEN $2::boolean THEN $3 ELSE name END, locale = COALESCE($4, locale),
                avatar_seed = CASE WHEN $5::boolean THEN $6 ELSE avatar_seed END, theme = CASE WHEN $7::boolean THEN $8 ELSE theme END WHERE id = $1`,
        [id, name !== undefined, name === "" ? null : (name ?? null), patch.locale ?? null, patch.avatarSeed !== undefined, patch.avatarSeed ?? null, patch.theme !== undefined, patch.theme ?? null],
      );
      return profileOf(id);
    },

    async requestEmailChange(id, input, now) {
      await confirmPassword(id, input.password);
      const address = input.newEmail.trim().toLowerCase();
      if (!looksLikeEmail(address)) throw new AccountError(400, "BAD_REQUEST", "Not an e-mail address");
      const [taken] = await query("SELECT 1 FROM accounts WHERE email = $1", [address]);
      if (taken) return; // the same answer, no mail: the address is not disclosed
      const profile = await profileOf(id);
      await query("UPDATE email_changes SET used_at = $2 WHERE account_id = $1 AND used_at IS NULL", [id, now]);
      const token = (deps.token ?? (() => emailChangeToken(deps.tokenPrefix)))();
      await query("INSERT INTO email_changes (account_id, new_email, token_hash, expires_at) VALUES ($1, $2, $3, $4)", [id, address, deps.tokenHash(token), addHours(now, EMAIL_CHANGE_TTL_HOURS)]);
      const url = `${deps.baseUrl.replace(/\/$/, "")}/${profile.locale}/confirm-email?token=${encodeURIComponent(token)}`;
      await deps.mail({ to: address, locale: profile.locale, ...emailChangeMail(deps.product, profile.locale, url) });
    },

    async confirmEmailChange(token, now) {
      if (!isEmailChangeToken(deps.tokenPrefix, token)) return "INVALID";
      const [row] = await query<{ account_id: string; new_email: string }>("UPDATE email_changes SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING account_id, new_email", [deps.tokenHash(token), now]);
      if (!row) return "INVALID";
      try {
        await query("UPDATE accounts SET email = $2, email_verified_at = $3 WHERE id = $1", [row.account_id, row.new_email, now]);
      } catch {
        return "INVALID"; // taken in the meantime
      }
      return "CHANGED";
    },

    async changePassword(id, input, keepSessionId) {
      await confirmPassword(id, input.current);
      if (input.next.length < PASSWORD_MIN) throw new AccountError(400, "PASSWORD_TOO_SHORT", `At least ${PASSWORD_MIN} characters`);
      if (input.next.length > PASSWORD_MAX) throw new AccountError(400, "PASSWORD_TOO_LONG", `At most ${PASSWORD_MAX} characters`);
      await query("UPDATE accounts SET password_hash = $2 WHERE id = $1", [id, await deps.passwords.hash(input.next)]);
      await query("DELETE FROM sessions WHERE account_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)", [id, keepSessionId ?? null]);
    },

    confirmPassword,

    async requestPasswordReset(email, now) {
      const address = email.trim().toLowerCase();
      if (!looksLikeEmail(address)) return; // the same answer: nothing is disclosed
      // One transaction, the account row locked: two requests at once leave one valid link — the later one. The mail goes after the commit.
      const issued = await transaction(async (q) => {
        const [row] = await q<{ id: string; locale: "en" | "fr" }>("SELECT id, locale FROM accounts WHERE email = $1 AND password_hash IS NOT NULL FOR UPDATE", [address]);
        if (!row) return null;
        await q("UPDATE password_resets SET used_at = $2 WHERE account_id = $1 AND used_at IS NULL", [row.id, now]);
        const token = (deps.token ?? (() => linkToken(deps.tokenPrefix)))();
        await q("INSERT INTO password_resets (account_id, token_hash, expires_at) VALUES ($1, $2, $3)", [row.id, deps.tokenHash(token), addMinutes(now, PASSWORD_RESET_TTL_MINUTES)]);
        return { token, locale: row.locale };
      });
      if (!issued) return;
      const url = `${deps.baseUrl.replace(/\/$/, "")}/${issued.locale}/reset-password?token=${encodeURIComponent(issued.token)}`;
      await deps.mail({ to: address, locale: issued.locale, ...passwordResetMail(deps.product, issued.locale, url) });
    },

    async resetPassword(token, next, now) {
      if (next.length < PASSWORD_MIN) throw new AccountError(400, "PASSWORD_TOO_SHORT", `At least ${PASSWORD_MIN} characters`);
      if (next.length > PASSWORD_MAX) throw new AccountError(400, "PASSWORD_TOO_LONG", `At most ${PASSWORD_MAX} characters`);
      if (!isLinkToken(deps.tokenPrefix, token)) return "INVALID";
      // One transaction: the link is claimed, the password set and every session ended as one — a failure leaves the link usable.
      return transaction(async (q) => {
        const [row] = await q<{ account_id: string }>("UPDATE password_resets SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING account_id", [deps.tokenHash(token), now]);
        if (!row) return "INVALID" as const;
        await q("UPDATE accounts SET password_hash = $2 WHERE id = $1", [row.account_id, await deps.passwords.hash(next)]);
        await q("DELETE FROM sessions WHERE account_id = $1", [row.account_id]);
        return "CHANGED" as const;
      });
    },

    async sessions(id, now, currentSessionId) {
      const rows = await query<{ id: string; created_at: Date; expires_at: Date; ip: string | null; user_agent: string | null }>("SELECT id, created_at, expires_at, ip, user_agent FROM sessions WHERE account_id = $1 AND expires_at > $2 ORDER BY created_at DESC", [id, now]);
      return rows.map((r): SessionSummary => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, ip: r.ip, userAgent: r.user_agent, current: r.id === currentSessionId }));
    },

    async signOutOthers(id, keepSessionId) {
      return (await query("DELETE FROM sessions WHERE account_id = $1 AND id <> $2::uuid RETURNING id", [id, keepSessionId])).length;
    },

    async exportAccount(id, now, extra) {
      const profile = await profileOf(id);
      const live = await this.sessions(id, now);
      return { exportedAt: now.toISOString(), account: profile, sessions: live.map(({ current: _current, ...s }) => s), ...(extra ? await extra() : {}) };
    },

    async deleteAccount(id) {
      const rows = await query("DELETE FROM accounts WHERE id = $1 RETURNING id", [id]);
      if (!rows.length) throw new AccountError(404, "NOT_FOUND", "No such account");
    },
  };
}

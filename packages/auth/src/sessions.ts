import crypto from "node:crypto";

import type { Clock } from "@krizaka/db";

/**
 * Web sessions (the copies each product carried: Yomizaka `ys1.`, Akinaza `as1.`, Kachizaka `ks1.`). The cookie holds a random token
 * (`<prefix>1.` and 32 bytes); the store keeps only its keyed hash, so a leaked table opens nothing. The account is re-read on every
 * request (a suspension applies at once). The lifetime is the setting `auth.sessionDays`.
 */

/** A live session and the account it signs in. `Account` is the product's own shape (id, e-mail, role, locale, name…). */
export interface Session<Account> {
  id: string;
  account: Account;
}

/** What a store keeps for a new session. */
export interface NewSession {
  accountId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

/** Where sessions live. Adapters: the PostgreSQL store over the product's `sessions` table, and a memory one. */
export interface SessionStore<Account> {
  insert(session: NewSession): Promise<void>;
  /** The session of this hash, when it has not expired at `now` and its account is active; null otherwise. */
  find(tokenHash: string, now: Date): Promise<Session<Account> | null>;
  delete(tokenHash: string): Promise<void>;
}

export interface SessionsDeps<Account> {
  store: SessionStore<Account>;
  clock: Clock;
  /** The product's token letters: `ys` makes `ys1.<43 characters>`. Lower-case letters, 1 to 4. */
  tokenPrefix: string;
  /** What keys the stored hash (`AUTH_SESSION_SECRET`). A function lets the product read its environment when it is needed. */
  secret: string | (() => string);
  /** Days a new session lives: the setting `auth.sessionDays`, read for each new session. */
  sessionDays: number | (() => number | Promise<number>);
}

export interface Sessions<Account> {
  /** A fresh token: shaped `<prefix>1.<43>`, random, never stored (only its hash is). */
  newToken(): string;
  isToken(value: string | undefined): value is string;
  /** The keyed hash the store keeps for a token. */
  tokenHash(token: string): string;
  /** Opens a session: the token for the cookie (shown once) and when it expires. */
  create(accountId: string, meta: { ip: string | null; userAgent: string | null }): Promise<{ token: string; expires: Date }>;
  /** The session a token opens, or null (unknown, malformed, expired, account not active). */
  resolve(token: string | undefined): Promise<Session<Account> | null>;
  /** Ends the session of this token. A malformed token is ignored. */
  revoke(token: string | undefined): Promise<void>;
}

const BODY = /^[A-Za-z0-9_-]{43}$/;
const PREFIX = /^[a-z]{1,4}$/;
const USER_AGENT_MAX = 300;

/**
 * The sessions service of a product.
 * @param deps the store, the clock, the token letters, the secret and the lifetime
 * @throws RangeError for a token prefix that is not 1 to 4 lower-case letters, or a lifetime that is not a whole number of days from 1
 */
export function createSessions<Account>(deps: SessionsDeps<Account>): Sessions<Account> {
  if (!PREFIX.test(deps.tokenPrefix)) throw new RangeError(`tokenPrefix must be 1 to 4 lower-case letters, got ${deps.tokenPrefix}`);
  const head = `${deps.tokenPrefix}1.`;
  const secret = () => (typeof deps.secret === "function" ? deps.secret() : deps.secret);
  const isToken = (value: string | undefined): value is string => !!value && value.startsWith(head) && BODY.test(value.slice(head.length));
  const tokenHash = (token: string) => crypto.createHmac("sha256", `session:${secret()}`).update(token).digest("hex");
  const newToken = () => `${head}${crypto.randomBytes(32).toString("base64url")}`;
  return {
    newToken,
    isToken,
    tokenHash,
    async create(accountId, meta) {
      const days = typeof deps.sessionDays === "function" ? await deps.sessionDays() : deps.sessionDays;
      if (!Number.isInteger(days) || days < 1) throw new RangeError(`sessionDays must be a whole number of days from 1, got ${days}`);
      const token = newToken();
      const createdAt = deps.clock.now();
      // days of 24 hours, not calendar days: the same instant whatever the server's time zone (the copies added 86 400 000 ms a day)
      const expires = new Date(createdAt);
      expires.setUTCHours(expires.getUTCHours() + days * 24);
      await deps.store.insert({ accountId, tokenHash: tokenHash(token), createdAt, expiresAt: expires, ip: meta.ip, userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX) ?? null });
      return { token, expires };
    },
    async resolve(token) {
      if (!isToken(token)) return null;
      return deps.store.find(tokenHash(token), deps.clock.now());
    },
    async revoke(token) {
      if (!isToken(token)) return;
      await deps.store.delete(tokenHash(token));
    },
  };
}

/** The attributes of the session cookie, for the product's framework (`cookies().set(cookie)`, `NextResponse.cookies.set`…). */
export interface SessionCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
}

/**
 * The session cookie: HttpOnly, SameSite=Lax, on the whole site, `Secure` where the product says (production).
 * @param options the cookie's name (`yomizaka_session`) and whether it is `Secure`
 */
export function sessionCookie(token: string, expires: Date, options: { name: string; secure: boolean }): SessionCookie {
  return { name: options.name, value: token, httpOnly: true, secure: options.secure, sameSite: "lax", path: "/", expires };
}

/** The same cookie, expired now: what signing out sets. */
export function clearedSessionCookie(options: { name: string; secure: boolean }, now: Date): SessionCookie {
  return sessionCookie("", now, options);
}

/**
 * The session token of a request: the native apps' `Authorization: Bearer` (which wins over a stale cookie), else the web's cookie.
 * @param headers the request's headers
 * @param options the cookie's name; `bearer: false` for a product with no native app
 * @returns the raw token (not yet checked), or undefined
 */
export function sessionTokenOf(headers: Headers, options: { cookie: string; bearer?: boolean }): string | undefined {
  if (options.bearer !== false) {
    const bearer = /^bearer (\S+)$/i.exec(headers.get("authorization") ?? "")?.[1];
    if (bearer) return bearer;
  }
  const prefix = `${options.cookie}=`;
  return headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

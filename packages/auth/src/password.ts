import crypto from "node:crypto";

/** Called only when a password is hashed or checked: the module also loads in a browser bundle (the role model), where `crypto.scrypt` does not exist. */
const scrypt = (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

/**
 * scrypt (N=2^15, r=8, p=1), a 16-byte salt, stored as `scrypt$N$r$p$salt$hash` (base64url). These are the parameters of the copies
 * the products carried (Yomizaka, Akinaza, Kachizaka, Yororis): a hash they stored verifies here, and one made here verifies there.
 */
// @fixed: the cost of the algorithm is part of the stored format; changing it is a new scheme, not a setting
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;
const OPTIONS = { N, r: R, p: P, maxmem: MAXMEM };

/** The shortest password the products accept. */
// @fixed: a security floor shared by every product, not a business parameter
export const PASSWORD_MIN_LENGTH = 12;
/** The longest: a longer one is refused before any work is done (a very long password is a way to make the server spend time). */
// @fixed: bounds the work a request can make the server do
export const PASSWORD_MAX_LENGTH = 256;

/** Why a new password is refused, or null when its length is acceptable. */
export function passwordProblem(password: string): "TOO_SHORT" | "TOO_LONG" | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (password.length > PASSWORD_MAX_LENGTH) return "TOO_LONG";
  return null;
}

/**
 * Hashes a password with a fresh salt.
 * @returns `scrypt$N$r$p$salt$hash`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, OPTIONS);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/**
 * Checks a password against a stored hash, in constant time. A hash of another scheme, a malformed one or an over-long password is `false`.
 * The cost parameters are read from the stored value, so an older hash still verifies after the default changes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash || password.length > PASSWORD_MAX_LENGTH) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

let decoy: Promise<string> | undefined;
/** A hash to verify against when the address has no account: the same work, the same time, the same answer. */
export const decoyHash = (): Promise<string> => (decoy ??= hashPassword(crypto.randomBytes(24).toString("base64url")));

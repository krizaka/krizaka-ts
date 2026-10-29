import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { addSeconds, isAfter } from "@krizaka/time";

import type { CodeStore, VerificationSettings, VerifyResult } from "./port";
import { DEFAULT_SETTINGS, VERIFICATION_CODE, VerificationError,VERIFY_FAILURE } from "./port";

/** The shortest secret accepted: it salts every proof, so a leaked store alone cannot be brute-forced offline. */
// @fixed: 32 characters = 128+ bits of entropy for a random secret
export const MIN_SECRET_LENGTH = 32;

export interface EmailVerificationOptions {
  store: CodeStore;
  /** Salts the proofs (a long random string from the product's configuration). */
  secret: string;
  /** The instant « now »: injected, never read from the wall clock. */
  now: () => Date;
  settings?: Partial<VerificationSettings>;
  /** Replaceable in tests: a uniform integer in [0, max). */
  randomInt?: (max: number) => number;
  /** Replaceable in tests: an opaque unguessable id. */
  randomId?: () => string;
}

/** What `issue` returns: mail `code` to the address; hand `challengeId` back to the browser (it is not secret, it is useless without the code). */
export interface Issued {
  challengeId: string;
  code: string;
  expiresAt: Date;
  /** The minutes the code stays valid, for the mail text. */
  ttlMinutes: number;
}

const normalise = (address: string) => address.trim().toLowerCase();

/**
 * The verification of an address: `issue` holds an action (the payload) and produces the code to mail; `confirm` releases the action
 * only for the right code, at most `maxAttempts` wrong tries, before the expiry, once. The store only ever sees a salted hash.
 */
export function createEmailVerification(options: EmailVerificationOptions) {
  const settings: VerificationSettings = { ...DEFAULT_SETTINGS, ...options.settings };
  if (options.secret.length < MIN_SECRET_LENGTH) throw new VerificationError(VERIFICATION_CODE.badSecret, `the secret needs at least ${MIN_SECRET_LENGTH} characters`);
  if (!Number.isInteger(settings.codeLength) || settings.codeLength < 4 || settings.codeLength > 10 || settings.ttlSeconds < 60 || settings.maxAttempts < 1) {
    throw new VerificationError(VERIFICATION_CODE.badSettings, "codeLength 4..10, ttlSeconds >= 60, maxAttempts >= 1");
  }
  const draw = options.randomInt ?? ((max: number) => randomInt(max));
  const newId = options.randomId ?? (() => randomBytes(24).toString("base64url"));
  const { store } = options;

  const proof = (id: string, address: string, code: string) => createHmac("sha256", options.secret).update(`${id}\n${normalise(address)}\n${code}`).digest("base64url");
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  function makeCode(): string {
    let digits = "";
    for (let i = 0; i < settings.codeLength; i += 1) digits += String(draw(10));
    return digits;
  }

  return {
    settings,

    /** Holds `payload` (JSON-able) until `address` returns the code. Throws on an empty address. */
    async issue(input: { address: string; payload: unknown }): Promise<Issued> {
      if (!normalise(input.address).includes("@")) throw new VerificationError(VERIFICATION_CODE.badAddress, "an e-mail address is required");
      const id = newId();
      const code = makeCode();
      const expiresAt = addSeconds(options.now(), settings.ttlSeconds);
      await store.put({ id, proof: proof(id, input.address, code), attempts: 0, expiresAt, payload: JSON.stringify(input.payload) });
      return { challengeId: id, code, expiresAt, ttlMinutes: Math.ceil(settings.ttlSeconds / 60) };
    },

    /** Releases the held payload for the right code, once. A wrong code counts; the last allowed one destroys the challenge. */
    async confirm<T = unknown>(input: { challengeId: string; address: string; code: string }): Promise<VerifyResult<T>> {
      const row = await store.get(input.challengeId);
      if (!row) return { ok: false, reason: VERIFY_FAILURE.unknown };
      if (isAfter(options.now(), row.expiresAt)) {
        await store.consume(row.id);
        return { ok: false, reason: VERIFY_FAILURE.expired };
      }
      if (row.attempts >= settings.maxAttempts) {
        await store.consume(row.id);
        return { ok: false, reason: VERIFY_FAILURE.locked };
      }
      const code = input.code.replaceAll(/\s/g, "");
      if (!same(row.proof, proof(row.id, input.address, code))) {
        const attempts = (await store.recordFailure(row.id)) ?? settings.maxAttempts;
        if (attempts >= settings.maxAttempts) {
          await store.consume(row.id);
          return { ok: false, reason: VERIFY_FAILURE.locked };
        }
        return { ok: false, reason: VERIFY_FAILURE.invalid, attemptsLeft: settings.maxAttempts - attempts };
      }
      if (!(await store.consume(row.id))) return { ok: false, reason: VERIFY_FAILURE.unknown };
      return { ok: true, payload: JSON.parse(row.payload) as T };
    },

    /** Drops the expired challenges (the product's job calls it). */
    purge: () => store.purge(options.now()),
  };
}

export type EmailVerification = ReturnType<typeof createEmailVerification>;

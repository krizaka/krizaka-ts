/**
 * The ports of « email-verification »: a person proves they control an address by returning the code mailed to it. The module
 * never sends the mail (the product queues it, e.g. with `@krizaka/mail`), never reads an environment variable and never reads the
 * wall clock: `now` and the secret come in as parameters.
 */

/** What a product tunes. The defaults are the org rule: 6 digits, 15 minutes, 5 tries. */
export interface VerificationSettings {
  /** Digits of the code. */
  codeLength: number;
  /** Seconds the code stays valid. */
  ttlSeconds: number;
  /** Wrong codes allowed before the challenge is destroyed. */
  maxAttempts: number;
}

// @fixed: the org rule « public e-mail forms verify the address » (krizaka/.github docs/standards/rules.json): 6 digits, 15 minutes, 5 tries
export const DEFAULT_SETTINGS: VerificationSettings = { codeLength: 6, ttlSeconds: 900, maxAttempts: 5 };

/** One pending proof, as the store keeps it. The code and the address are only hashes; `payload` is what is released on success. */
export interface Challenge {
  id: string;
  /** Salted hash of the address and the code (never the code, never the address). */
  proof: string;
  /** Wrong codes so far. */
  attempts: number;
  expiresAt: Date;
  /** The action held until the address is proven (JSON text: a contact message, a subscription). */
  payload: string;
}

/** Where challenges live. Every adapter runs `codeStoreContract` (`@krizaka/email-verification/testkit`). */
export interface CodeStore {
  put(challenge: Challenge): Promise<void>;
  get(id: string): Promise<Challenge | null>;
  /** Counts one wrong code and returns the new total; null when the challenge no longer exists. Atomic. */
  recordFailure(id: string): Promise<number | null>;
  /** Removes the challenge; `true` only for the call that removed it (single use: two concurrent confirms release once). */
  consume(id: string): Promise<boolean>;
  /** Drops the challenges that expired before `now`; returns how many. */
  purge(now: Date): Promise<number>;
}

/** Why a confirmation was refused. `unknown` covers an id never issued, already used or destroyed: the caller cannot tell them apart. */
export const VERIFY_FAILURE = { invalid: "invalid", expired: "expired", locked: "locked", unknown: "unknown" } as const;
export type VerifyFailure = (typeof VERIFY_FAILURE)[keyof typeof VERIFY_FAILURE];

export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; reason: VerifyFailure; attemptsLeft?: number };

export const VERIFICATION_CODE = {
  badSecret: "VERIFICATION_BAD_SECRET",
  badSettings: "VERIFICATION_BAD_SETTINGS",
  badAddress: "VERIFICATION_BAD_ADDRESS",
} as const;
export type VerificationCode = (typeof VERIFICATION_CODE)[keyof typeof VERIFICATION_CODE];

export class VerificationError extends Error {
  constructor(
    readonly code: VerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

/**
 * The account PORT (ADR-0008 of Yomizaka, now shared). A product's account — name, language, theme, avatar, e-mail change with
 * verification, password, sessions, export, deletion — behind one interface. Every product keeps its OWN accounts: no central
 * service, no runtime dependency between products.
 */
export type Theme = "light" | "dark" | "system";

export interface AccountProfile {
  id: string;
  email: string;
  name: string | null;
  locale: "en" | "fr";
  /** The theme the person chose; null = follow the device. */
  theme: Theme | null;
  /** A seed of the default avatars (the UI draws it); null = derived from the e-mail address. */
  avatarSeed: string | null;
  emailVerified: boolean;
  /** An address awaiting its verification link, if the person asked to change it. */
  pendingEmail: string | null;
}

export interface ProfilePatch {
  name?: string | null;
  locale?: "en" | "fr";
  theme?: Theme | null;
  avatarSeed?: string | null;
}

/** A sign-in of the person: where from and when. Never the token. */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface AccountService {
  profile(accountId: string): Promise<AccountProfile>;
  updateProfile(accountId: string, patch: ProfilePatch): Promise<AccountProfile>;
  /** Asks to change the address: the password is checked, a link is mailed to the NEW address. Answers the same whether or not it is already taken (no enumeration). */
  requestEmailChange(accountId: string, input: { newEmail: string; password: string }, now: Date): Promise<void>;
  /** Applies the change from the mailed link (single use, expires); the new address is verified by that very act. */
  confirmEmailChange(token: string, now: Date): Promise<"CHANGED" | "INVALID">;
  /** Changes the password (the current one is checked) and signs every other session out; `keepSessionId` stays. */
  changePassword(accountId: string, input: { current: string; next: string }, keepSessionId?: string): Promise<void>;
  /** Checks the password. Throws `AccountError(403, "WRONG_PASSWORD")`. */
  confirmPassword(accountId: string, password: string): Promise<void>;
  /** The person's live sign-ins, newest first; `currentSessionId` is flagged. */
  sessions(accountId: string, now: Date, currentSessionId?: string): Promise<SessionSummary[]>;
  /** Signs every other session out (and returns how many); `keepSessionId` stays. */
  signOutOthers(accountId: string, keepSessionId: string): Promise<number>;
  /** What the product keeps about the person, as one JSON-able document: the profile, the live sign-ins, and what `extra` adds. */
  exportAccount(accountId: string, now: Date, extra?: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>>;
  /** Deletes the identity: the account, its sessions and everything that hangs on it (the product erases its own data first). */
  deleteAccount(accountId: string): Promise<void>;
}

export class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

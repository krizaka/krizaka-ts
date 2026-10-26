import type { Query } from "@krizaka/db";

/**
 * The ports of « organize »: nothing here knows a database client, an image library, a storage vendor or the wall clock.
 */

/** Runs one SQL statement with its parameters and returns the rows: `@krizaka/db`'s `Query`, which the product passes (its pool, or its transaction's client). */
export type { Query };

/** What an uploaded avatar is kept in: the same shape as a document store (put, get, delete), so a product passes the one it has. */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, meta: { contentType: string }): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/** Makes an uploaded image an avatar: checked, square, upright, without metadata. Throws `AvatarImageError` for what it cannot read. */
export interface AvatarProcessor {
  process(file: { name: string; type: string; bytes: Uint8Array }): Promise<{ bytes: Uint8Array; contentType: string }>;
}

/** The processor refuses an image with a stable reason; the service turns it into `AVATAR_UNREADABLE` or a pass-through error. */
export class AvatarImageError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** An avatar: one of a set (a seed the UI draws) or an uploaded image (served at an address that carries its version). */
export type Avatar = { kind: "set"; seed: string } | { kind: "image"; version: number };
export const AVATAR_KIND = { set: "set", image: "image" } as const;

export interface AvatarRules {
  /** The seeds the administrator allows. */
  allowedSeeds: readonly string[];
  maxBytes: number;
}

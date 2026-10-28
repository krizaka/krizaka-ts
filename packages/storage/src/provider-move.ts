import { createHash } from "node:crypto";

import { type ObjectStore } from "./port";

/** An object the product holds, with the provider it lives at and the SHA-256 recorded at upload. */
export interface CatalogObject {
  id: string;
  key: string;
  contentType: string;
  /** Full SHA-256 hex of the plain bytes, recorded at upload. */
  sha256: string;
}

/** The product's side of a move: it owns the objects table. `switchProvider` runs in ONE transaction and answers false if the row already moved. */
export interface ObjectCatalog {
  pending(providerId: string, limit: number): Promise<CatalogObject[]>;
  remaining(providerId: string): Promise<number>;
  switchProvider(objectId: string, from: string, to: string): Promise<boolean>;
}

export interface MoveResult {
  copied: number;
  verified: number;
  switched: number;
  failed: { id: string; reason: string }[];
  left: number;
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * One bounded batch of the move (ADR-005 §3), run from a leased outbox worker, resumable: get from the old store, check the hash
 * recorded at upload, put to the new one, read it back and compare the SHA-256, only then switch the row. A mismatch or a failure
 * lands in `failed` (the worker's dead letters) and the row is never switched.
 */
export async function moveBatch(input: { catalog: ObjectCatalog; from: { id: string; store: ObjectStore }; to: { id: string; store: ObjectStore }; limit: number }): Promise<MoveResult> {
  const result: MoveResult = { copied: 0, verified: 0, switched: 0, failed: [], left: 0 };
  for (const object of await input.catalog.pending(input.from.id, input.limit)) {
    try {
      const old = await input.from.store.get(object.key);
      if (!old) throw new Error("the object is missing at the old provider");
      if (sha256Hex(old.bytes) !== object.sha256) throw new Error("the old copy does not match its recorded SHA-256");
      await input.to.store.put(object.key, old.bytes, { contentType: object.contentType });
      result.copied += 1;
      const back = await input.to.store.get(object.key);
      if (!back || sha256Hex(back.bytes) !== object.sha256) throw new Error("the new copy does not match the SHA-256 after reading it back");
      result.verified += 1;
      if (await input.catalog.switchProvider(object.id, input.from.id, input.to.id)) result.switched += 1;
    } catch (error) {
      result.failed.push({ id: object.id, reason: error instanceof Error ? error.message.slice(0, 160) : "failed" });
    }
  }
  result.left = await input.catalog.remaining(input.from.id);
  return result;
}

/**
 * Reads from the provider the row names, and falls back to the older providers while a move is running. The old provider is
 * `retiring` and keeps reading until no row reaches it; a missing file is never an error while another store holds it.
 */
export async function readDual(input: { key: string; providerId: string; fallbackIds: readonly string[]; open: (providerId: string) => Promise<ObjectStore> }) {
  for (const id of [input.providerId, ...input.fallbackIds.filter((f) => f !== input.providerId)]) {
    const found = await (await input.open(id)).get(input.key);
    if (found) return { ...found, providerId: id };
  }
  return null;
}

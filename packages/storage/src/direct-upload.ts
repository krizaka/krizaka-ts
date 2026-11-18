/** A browser form post: `url` and the `fields` to send before the file (the `file` field is last). */
export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  /** The size the provider will refuse beyond. */
  maxBytes: number;
}

/** A store that can let a client upload straight to it, bounded in size. */
export interface DirectUpload {
  /**
   * A POST policy with `content-length-range` 1..`maxBytes` for exactly `key`, for `ttlSeconds`; `contentTypes` are the types it
   * accepts (one type, or several of one family such as `image/png` and `image/jpeg`).
   * `null` when the provider cannot bound the size: the caller then goes through the server (`readUpload`).
   */
  presignUpload(
    key: string,
    maxBytes: number,
    contentTypes: readonly string[],
    ttlSeconds: number,
  ): Promise<PresignedUpload | null>;
}

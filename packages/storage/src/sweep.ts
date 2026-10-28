import type { ObjectStore } from "./port";

export interface SweepResult {
  /** Files listed under the prefix. */
  scanned: number;
  /** Files no one references (deleted, unless `dryRun`). */
  orphans: string[];
  /** Orphans actually removed from the store. */
  deleted: number;
  /** Orphans whose deletion failed (the store did not answer): the next sweep retries them. */
  failed: string[];
}

export interface SweepOptions {
  /** List the orphans and delete nothing. */
  dryRun?: boolean;
  /** Stop after this many deletions (a bound for one run); the rest waits for the next sweep. */
  limit?: number;
}

/**
 * Deletes the files under `prefix` that `isReferenced` does not know: the leftovers of an upload whose row was rolled back, of a
 * purge interrupted between the object and the row. Generic: the caller says what « known » means (a database lookup). The caller
 * writes its row BEFORE the object, so a referenced file is never seen as an orphan. A failing `delete` does not stop the run.
 */
export async function sweepOrphans(
  store: ObjectStore,
  prefix: string,
  isReferenced: (key: string) => boolean | Promise<boolean>,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const listed = await store.list(prefix);
  const orphans: string[] = [];
  for (const { key } of listed) {
    if (options.limit !== undefined && orphans.length >= options.limit) break;
    if (!(await isReferenced(key))) orphans.push(key);
  }
  const failed: string[] = [];
  let deleted = 0;
  if (!options.dryRun) {
    for (const key of orphans) {
      try {
        await store.delete(key);
        deleted += 1;
      } catch {
        failed.push(key);
      }
    }
  }
  return { scanned: listed.length, orphans, deleted, failed };
}

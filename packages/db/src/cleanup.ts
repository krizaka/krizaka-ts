/**
 * After a failure, runs the cleanup (a `ROLLBACK`, a `DROP`) and rethrows the original error. If the cleanup fails too, both
 * errors reach the caller as an `AggregateError`, the original first: a cleanup never hides why the work failed.
 * @param error what the work threw
 * @param cleanup what must run after it
 * @throws the original error, or an `AggregateError` of both
 */
export async function rethrowAfter(error: unknown, cleanup: () => Promise<unknown>): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], "the work failed, and its cleanup failed too", {
      cause: cleanupError,
    });
  }
  throw error;
}

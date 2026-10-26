import { ident, type Query } from "@krizaka/db";

/**
 * The idempotent consumer: the outbox delivers AT LEAST ONCE, so a consumer that has an effect in the database applies it once per
 * message id. Run it inside the transaction of the effect: the marker and the effect commit together, so a crash between them
 * leaves neither and the redelivery applies both; a redelivery after the commit finds the marker and does nothing.
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   const result = await consumeOnce(tx, "credits", message.id, clock.now(), () => credits.grant(tx, …));
 * });
 * ```
 * @param tx the transaction the effect writes through
 * @param consumer who applies it (`credits`, `mail`): a message may be consumed once by each consumer
 * @param messageId the outbox message's id
 * @param effect what to do the first time; its failure rolls the marker back with the transaction
 * @param schema the Postgres schema of the module, default `outbox`
 * @returns `applied` the first time, `duplicate` after
 */
export async function consumeOnce(tx: Query, consumer: string, messageId: string, now: Date, effect: () => Promise<void>, schema = "outbox"): Promise<"applied" | "duplicate"> {
  const rows = await tx(`INSERT INTO ${ident(schema)}.processed (consumer, message_id, processed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`, [consumer, messageId, now]);
  if (rows.length === 0) return "duplicate";
  await effect();
  return "applied";
}

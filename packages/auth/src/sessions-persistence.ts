import { ident, type Query } from "@krizaka/db";

import type { Session, SessionStore } from "./sessions";

export interface DbSessionStoreOptions<Account> {
  /** The product's session table. Default `sessions` (`id`, `account_id`, `token_hash` unique, `created_at`, `expires_at`, `ip`, `user_agent`). */
  sessions?: string;
  /** The product's account table. Default `accounts`. */
  accounts?: string;
  /** The account columns the session carries (`id`, `email`, `role`, `locale`, `name`…): all checked, all read in one query with the session. */
  columns: readonly string[];
  /** Builds the product's account from a row holding exactly `columns`. */
  toAccount: (row: Record<string, unknown>) => Account;
  /** An account that is not active signs nobody in (a suspension applies at once): the column and the value it must have (`status` = `ACTIVE`). */
  active?: { column: string; equals: string };
}

/**
 * The session store over the product's own tables (`sessions` joined to `accounts`): the declared tables and columns are checked by
 * `ident()` and nothing else reaches SQL. The expiry is compared with the clock's `now`, not the database's.
 * @param query the product's query
 * @param options the table names, the account columns and how the account is built
 * @throws DbError `DB_UNSAFE_IDENTIFIER` for a table or column name that is not a safe identifier
 */
export function dbSessionStore<Account>(query: Query, options: DbSessionStoreOptions<Account>): SessionStore<Account> {
  const sessions = ident(options.sessions ?? "sessions");
  const accounts = ident(options.accounts ?? "accounts");
  const columns = options.columns.map((column) => `a.${ident(column)}`).join(", ");
  const active = options.active ? ` AND a.${ident(options.active.column)} = $3` : "";
  return {
    async insert(session) {
      await query(
        `INSERT INTO ${sessions} (account_id, token_hash, created_at, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)`,
        [session.accountId, session.tokenHash, session.createdAt, session.expiresAt, session.ip, session.userAgent],
      );
    },
    async find(tokenHash, now): Promise<Session<Account> | null> {
      const params: unknown[] = [tokenHash, now];
      if (options.active) params.push(options.active.equals);
      const [row] = await query<Record<string, unknown> & { session_id: string }>(
        `SELECT s.id AS session_id, ${columns} FROM ${sessions} s JOIN ${accounts} a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > $2${active}`,
        params,
      );
      if (!row) return null;
      const { session_id: id, ...account } = row;
      return { id, account: options.toAccount(account) };
    },
    async delete(tokenHash) {
      await query(`DELETE FROM ${sessions} WHERE token_hash = $1`, [tokenHash]);
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Account and entry removal, shared by the API (`DELETE /api/account`,
 * `DELETE /api/entries/:id`) and the admin commands (`emo account-delete`,
 * `emo entry-delete`). Specification: api.md §2.5–§2.6, ops.md §7.1.
 */

import type { DatabaseSync } from "node:sqlite";
import { tx } from "../db/index.ts";

/**
 * Hard-deletes every row of the account in one transaction. Its sessions'
 * token hashes go to `gone_sessions` first, so other devices get
 * `401 account_gone`. Returns false when there was no such account.
 */
export function deleteAccount(
  db: DatabaseSync,
  accountId: string,
  nowIso: string = new Date().toISOString(),
): boolean {
  return tx(db, () => {
    const acc = db.prepare("SELECT email_hmac FROM accounts WHERE id = ?").get(
      accountId,
    ) as { email_hmac: Uint8Array } | undefined;
    if (!acc) return false;

    const gone = db.prepare(
      "INSERT OR REPLACE INTO gone_sessions (token_hash, deleted_at) VALUES (?, ?)",
    );
    const sessions = db.prepare(
      "SELECT token_hash FROM sessions WHERE account_id = ?",
    ).all(accountId) as Array<{ token_hash: string }>;
    for (const s of sessions) gone.run(s.token_hash, nowIso);

    db.prepare("DELETE FROM login_codes WHERE email_hmac = ?").run(
      acc.email_hmac,
    );
    for (
      const sql of [
        "DELETE FROM entries WHERE account_id = ?",
        "DELETE FROM keyrings WHERE account_id = ?",
        "DELETE FROM sessions WHERE account_id = ?",
        "DELETE FROM push_subscriptions WHERE account_id = ?",
        "DELETE FROM reminders WHERE account_id = ?",
        "DELETE FROM prefs WHERE account_id = ?",
        "DELETE FROM mail_log WHERE account_id = ?",
        "DELETE FROM invite_uses WHERE account_id = ?",
        "DELETE FROM invites WHERE created_by = ?",
        "DELETE FROM accounts WHERE id = ?",
      ]
    ) {
      db.prepare(sql).run(accountId);
    }
    return true;
  });
}

/**
 * Turns an entry into a tombstone with a new `seq` (so other devices see it
 * on their next pull). An unknown id becomes a tombstone too, so a device
 * that uploads the original later gets `410 entry_deleted`. Idempotent:
 * returns the existing tombstone's `seq`.
 */
export function tombstoneEntry(
  db: DatabaseSync,
  accountId: string,
  entryId: string,
  nowIso: string = new Date().toISOString(),
): number {
  return tx(db, () => {
    const existing = db.prepare(
      "SELECT seq, deleted FROM entries WHERE account_id = ? AND id = ?",
    ).get(accountId, entryId) as { seq: number; deleted: number } | undefined;
    if (existing?.deleted === 1) return existing.seq;

    const { max_seq } = db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM entries WHERE account_id = ?",
    ).get(accountId) as { max_seq: number };
    const seq = max_seq + 1;
    if (existing) {
      db.prepare(`
        UPDATE entries
        SET seq = ?, nonce = NULL, ciphertext = NULL, deleted = 1, received_at = ?
        WHERE account_id = ? AND id = ?
      `).run(seq, nowIso, accountId, entryId);
    } else {
      db.prepare(`
        INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
        VALUES (?, ?, ?, 1, NULL, NULL, 1, ?)
      `).run(entryId, accountId, seq, nowIso);
    }
    return seq;
  });
}

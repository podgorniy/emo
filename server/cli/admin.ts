// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Operator commands: `emo accounts`, `account-delete`, `login-code`,
 * `keyring-revert`, `entry-delete` and `rotate-secret`. Each logs its
 * `admin_*` line with the account id, never the email.
 * Specification: ops.md §1.1, §6.2, §7; api.md §2.5–§2.6.
 */

import type { DatabaseSync } from "node:sqlite";
import { tx } from "../db/index.ts";
import {
  decryptServerString,
  encryptServerBlob,
  generateLoginCode,
  generateUuidV4,
  hashEmail,
  hashLoginCode,
  normalizeEmail,
} from "../crypto.ts";
import { logger } from "../log.ts";
import { activeLease } from "../services/lease.ts";
import { deleteAccount, tombstoneEntry } from "../services/accounts.ts";
import { SECRET_CHECK_KEY, secretCheckValue } from "../secret_check.ts";
import { decodeHex } from "../../shared/crypto/encoding.ts";
import { CliRefusal } from "./restore.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Commands that need the server stopped refuse while it holds the lease. */
export function refuseWhileServing(db: DatabaseSync, now = Date.now()) {
  let lease = null;
  try {
    lease = activeLease(db, now);
  } catch { /* no meta table yet: nothing can hold a lease */ }
  if (lease) {
    throw new CliRefusal(
      `A server is running (scheduler lease held by ${lease.holder} until ${lease.expires_at}). Stop it first: make down`,
    );
  }
}

export interface AccountSummary {
  id: string;
  created_at: string;
  last_seen_at: string | null;
  entries: number;
  subscriptions: number;
  keyring_revisions: number;
  email?: string;
}

/** ops.md §7.1. Emails only when asked, decrypted for the terminal. */
export async function listAccounts(
  db: DatabaseSync,
  options: { emails?: boolean; serverSecretHex?: string } = {},
): Promise<AccountSummary[]> {
  const rows = db.prepare(`
    SELECT a.id, a.created_at, a.email_enc,
      (SELECT MAX(last_seen_at) FROM sessions s WHERE s.account_id = a.id) AS last_seen_at,
      (SELECT COUNT(*) FROM entries e WHERE e.account_id = a.id AND e.deleted = 0) AS entries,
      (SELECT COUNT(*) FROM push_subscriptions p WHERE p.account_id = a.id) AS subscriptions,
      (SELECT COUNT(*) FROM keyrings k WHERE k.account_id = a.id) AS keyring_revisions
    FROM accounts a
    ORDER BY a.created_at
  `).all() as unknown as Array<AccountSummary & { email_enc: Uint8Array }>;
  const secret = options.emails && options.serverSecretHex
    ? decodeHex(options.serverSecretHex)
    : null;
  const out: AccountSummary[] = [];
  for (const { email_enc, ...row } of rows) {
    out.push(
      secret
        ? {
          ...row,
          email: await decryptServerString(secret, email_enc, "email"),
        }
        : row,
    );
  }
  return out;
}

export function adminDeleteAccount(
  db: DatabaseSync,
  accountId: string,
): boolean {
  const deleted = deleteAccount(db, accountId);
  if (deleted) logger.info("admin_account_delete", { account_id: accountId });
  return deleted;
}

/**
 * ops.md §7.2: a fresh code for an existing account, for the operator to pass
 * on during a mail outage. Older codes stop working. Null when the address
 * has no account (a new one needs an invite and the normal sign-up).
 */
export async function issueLoginCode(
  db: DatabaseSync,
  serverSecretHex: string,
  email: string,
  now = new Date(),
): Promise<{ code: string; expiresAt: string; accountId: string } | null> {
  const emailHmac = await hashEmail(
    decodeHex(serverSecretHex),
    normalizeEmail(email),
  );
  const account = db.prepare("SELECT id FROM accounts WHERE email_hmac = ?")
    .get(
      emailHmac,
    ) as { id: string } | undefined;
  if (!account) return null;
  const code = generateLoginCode();
  const codeHash = await hashLoginCode(decodeHex(serverSecretHex), code);
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  tx(db, () => {
    db.prepare("DELETE FROM login_codes WHERE email_hmac = ?").run(emailHmac);
    db.prepare(`
      INSERT INTO login_codes (id, email_hmac, code_hash, attempts, invite_hash, expires_at, created_at)
      VALUES (?, ?, ?, 0, NULL, ?, ?)
    `).run(generateUuidV4(), emailHmac, codeHash, expiresAt, now.toISOString());
  });
  logger.info("admin_login_code", { account_id: account.id });
  return { code, expiresAt, accountId: account.id };
}

/**
 * ops.md §7.3: re-inserts revision `rev` as a new latest revision of the same
 * key version; nothing is deleted. Returns the new revision number.
 */
export function revertKeyring(
  db: DatabaseSync,
  accountId: string,
  rev: number,
  now = new Date(),
): number {
  return tx(db, () => {
    const source = db.prepare(`
      SELECT key_version, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, auth_hash
      FROM keyrings WHERE account_id = ? AND rev = ?
    `).get(accountId, rev) as {
      key_version: number;
      kdf_json: string;
      dek_wrapped_pass: Uint8Array;
      dek_wrapped_recovery: Uint8Array;
      auth_hash: Uint8Array;
    } | undefined;
    if (!source) {
      throw new CliRefusal(
        `Account ${accountId} has no keyring revision ${rev}`,
      );
    }
    const { max_rev } = db.prepare(
      "SELECT MAX(rev) AS max_rev FROM keyrings WHERE account_id = ? AND key_version = ?",
    ).get(accountId, source.key_version) as { max_rev: number };
    const newRev = max_rev + 1;
    db.prepare(`
      INSERT INTO keyrings (account_id, key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, auth_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      source.key_version,
      newRev,
      source.kdf_json,
      source.dek_wrapped_pass,
      source.dek_wrapped_recovery,
      source.auth_hash,
      now.toISOString(),
    );
    logger.info("admin_keyring_revert", {
      account_id: accountId,
      from_rev: rev,
      new_rev: newRev,
    });
    return newRev;
  });
}

/** Same tombstone as `DELETE /api/entries/:id`, without the user's proof. */
export function adminDeleteEntry(
  db: DatabaseSync,
  accountId: string,
  entryId: string,
): number {
  if (!UUID_RE.test(accountId) || !UUID_RE.test(entryId)) {
    throw new CliRefusal("Both ids must be lower-case UUIDs");
  }
  const exists = db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(
    accountId,
  );
  if (!exists) throw new CliRefusal(`No account ${accountId}`);
  const seq = tombstoneEntry(db, accountId, entryId);
  logger.info("admin_entry_delete", { account_id: accountId, seq });
  return seq;
}

/**
 * ops.md §6.2, with the server stopped: re-encrypts every `email_enc` and
 * unused `invites.code_enc` under NEW, recomputes `email_hmac`, and rewrites
 * the secret check, in one transaction. Everything is decrypted with OLD
 * first, so a wrong OLD changes nothing. Pending login codes are dropped:
 * they are keyed by the old `email_hmac`.
 */
export async function rotateSecret(
  db: DatabaseSync,
  oldHex: string,
  newHex: string,
): Promise<{ accounts: number; invites: number }> {
  for (const [name, hex] of [["--old", oldHex], ["--new", newHex]]) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new CliRefusal(`${name} must be 64 hex characters`);
    }
  }
  if (oldHex.toLowerCase() === newHex.toLowerCase()) {
    throw new CliRefusal("--old and --new are the same secret");
  }
  refuseWhileServing(db);

  const stored = db.prepare("SELECT value FROM meta WHERE key = ?").get(
    SECRET_CHECK_KEY,
  ) as { value: string } | undefined;
  if (stored && stored.value !== await secretCheckValue(oldHex)) {
    throw new CliRefusal("--old is not the secret this database uses");
  }

  const oldKey = decodeHex(oldHex);
  const newKey = decodeHex(newHex);
  const accounts = db.prepare("SELECT id, email_enc FROM accounts")
    .all() as Array<
      { id: string; email_enc: Uint8Array }
    >;
  const invites = db.prepare(
    "SELECT code_hash, code_enc FROM invites WHERE code_enc IS NOT NULL",
  ).all() as Array<{ code_hash: string; code_enc: Uint8Array }>;

  // Every row must open with OLD before anything is written
  const accountRows: Array<{ id: string; enc: Uint8Array; hmac: Uint8Array }> =
    [];
  for (const a of accounts) {
    let email: string;
    try {
      email = await decryptServerString(oldKey, a.email_enc, "email");
    } catch {
      throw new CliRefusal(
        `Account ${a.id}: email does not decrypt with --old; nothing changed`,
      );
    }
    accountRows.push({
      id: a.id,
      enc: await encryptServerBlob(newKey, email, "email"),
      hmac: await hashEmail(newKey, email),
    });
  }
  const inviteRows: Array<{ hash: string; enc: Uint8Array }> = [];
  for (const i of invites) {
    let code: string;
    try {
      code = await decryptServerString(oldKey, i.code_enc, "invite-code");
    } catch {
      throw new CliRefusal(
        "An invite code does not decrypt with --old; nothing changed",
      );
    }
    inviteRows.push({
      hash: i.code_hash,
      enc: await encryptServerBlob(newKey, code, "invite-code"),
    });
  }
  const newCheck = await secretCheckValue(newHex);

  tx(db, () => {
    const setAccount = db.prepare(
      "UPDATE accounts SET email_enc = ?, email_hmac = ? WHERE id = ?",
    );
    for (const r of accountRows) setAccount.run(r.enc, r.hmac, r.id);
    const setInvite = db.prepare(
      "UPDATE invites SET code_enc = ? WHERE code_hash = ?",
    );
    for (const r of inviteRows) setInvite.run(r.enc, r.hash);
    db.prepare("DELETE FROM login_codes").run();
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      SECRET_CHECK_KEY,
      newCheck,
    );
  });
  logger.info("admin_rotate_secret", {
    accounts: accountRows.length,
    invites: inviteRows.length,
  });
  return { accounts: accountRows.length, invites: inviteRows.length };
}

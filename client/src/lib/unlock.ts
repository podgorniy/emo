// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Unlocking this device with the passphrase (reliability.md §1.2):
 * - the revision cached on the device first, so unlocking works offline;
 * - then the server's revisions: a newer one (the passphrase changed on
 *   another device), or, when the newest is damaged or does not open, the
 *   newest one before it with the same KDF salt (a bad write from another
 *   device: one AES operation, no second KDF; an old passphrase never opens
 *   a revision written after it was changed). A fallback is recorded in
 *   diagnostics as `keyring.rev_fallback`;
 * - a keyring with no well-formed revision is "damaged", never sent to the
 *   KDF, and does not count as a wrong passphrase;
 * - after 5 wrong passphrases each try waits 30 s (anti-shoulder-surfing
 *   only; Argon2id is the real protection), across reloads.
 */
import type { KeyringItem } from "../../../shared/protocol.ts";
import { kdfId, keyringProblem } from "../../../shared/crypto/keyring.ts";
import { apiGetKeyring } from "./api.ts";
import { unlockWithRevisions } from "./crypto.ts";
import { getMeta, removeMeta, setMeta } from "./db.ts";
import { recordDiag } from "./diag.ts";
import { cachedKeyring, rememberKeyring } from "./session.ts";
import { FALLBACK_KEY } from "./keyring.ts";

export type UnlockResult =
  | { kind: "ok" }
  | { kind: "wrong" }
  | { kind: "damaged" }
  | { kind: "offline" }
  | { kind: "wait"; seconds: number };

export const FREE_ATTEMPTS = 5;
export const RETRY_DELAY_MS = 30_000;
const FAILURES_KEY = "unlock_failures";

interface Failures {
  count: number;
  /** When the last wrong passphrase was entered (epoch ms). */
  last: number;
}

/** Seconds until the next try is allowed; 0 = now. */
export async function unlockWaitSeconds(now = Date.now()): Promise<number> {
  const f = await getMeta<Failures>(FAILURES_KEY);
  if (!f || f.count < FREE_ATTEMPTS) return 0;
  return Math.max(0, Math.ceil((f.last + RETRY_DELAY_MS - now) / 1000));
}

export async function unlockDevice(
  accountId: string,
  passphrase: string,
  now = Date.now(),
): Promise<UnlockResult> {
  const wait = await unlockWaitSeconds(now);
  if (wait > 0) return { kind: "wait", seconds: wait };

  const keks = new Map<string, CryptoKey>();
  const cached = await cachedKeyring();
  if (
    cached && !keyringProblem(cached) &&
    await unlockWithRevisions(accountId, passphrase, [cached], keks)
  ) {
    return await succeeded();
  }

  let revisions: KeyringItem[] | null;
  try {
    const res = await apiGetKeyring(true);
    revisions = res.items
      .filter((k) => k.key_version === res.current_key_version)
      .sort((a, b) => b.rev - a.rev);
  } catch {
    revisions = null;
  }
  if (!revisions) {
    // Offline: only the cached copy could have helped
    if (!cached) return { kind: "offline" };
    if (keyringProblem(cached)) return { kind: "damaged" };
    return await failed(now);
  }

  const valid = revisions.filter((k) => !keyringProblem(k));
  if (valid.length === 0) {
    await recordDiag("keyring.damaged", "unlock");
    return { kind: "damaged" };
  }
  const sameKdf = valid.filter((k) => kdfId(k) === kdfId(valid[0]));
  const used = await unlockWithRevisions(accountId, passphrase, sameKdf, keks);
  if (!used) return await failed(now);
  if (used.rev !== revisions[0].rev) {
    await recordDiag("keyring.rev_fallback", "unlock");
    await setMeta(FALLBACK_KEY, true);
  } else {
    await removeMeta(FALLBACK_KEY);
  }
  await rememberKeyring(used);
  return await succeeded();
}

async function succeeded(): Promise<UnlockResult> {
  await removeMeta(FAILURES_KEY);
  return { kind: "ok" };
}

async function failed(now: number): Promise<UnlockResult> {
  const f = (await getMeta<Failures>(FAILURES_KEY)) ?? { count: 0, last: 0 };
  await setMeta(FAILURES_KEY, { count: f.count + 1, last: now });
  return { kind: "wrong" };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/index.ts";
import {
  deriveAuthKey,
  derivePassphraseKek,
  deriveRecoveryKek,
  encryptEntry,
  encryptPrefs,
  generateDek,
  generateRecoverySecret,
  generateSalt,
  importDek,
  wrapDek,
} from "../shared/crypto/e2e.ts";
import { buildKeyringAad } from "../shared/crypto/aad.ts";
import { encodeBase64Url } from "../shared/crypto/encoding.ts";
import { generateRecoveryKey } from "../shared/crypto/recovery.ts";
import { MailService, type OutgoingMail } from "./services/mail.ts";
import type { Config } from "./config.ts";
import type { EntryV2 } from "../shared/entry.ts";

function createTestContext() {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);

  const configOverride: Partial<Config> = {
    serverSecret:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    baseUrl: "http://localhost:8080",
    invitesByUsers: true,
    invitesPerUser: 5,
    recoveryMailEnabled: true,
  };

  // Recording transport: tests read the mail; production code keeps none.
  const sentMessages: OutgoingMail[] = [];
  const mailService = new MailService(
    {} as Config,
    (mail) => {
      sentMessages.push(mail);
      return Promise.resolve();
    },
  );

  const app = createApp(db, configOverride, { mailService });

  return { db, app, mailService, sentMessages };
}

Deno.test("API - Full Registration, Auth, E2E Keyring, Entry with Undo, and Account Deletion", async () => {
  const { db, app, sentMessages } = createTestContext();
  const origin = "http://localhost:8080";

  // Insert valid invite for testing
  const { hashInviteCode } = await import("./crypto.ts");
  const testInviteHash = await hashInviteCode("K7QM3XPA9TNE");
  db.prepare(`
    INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
    VALUES (?, NULL, NULL, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 1, 0)
  `).run(testInviteHash);

  // Request code for alice
  const reqAlice = await app.request("/api/auth/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": origin },
    body: JSON.stringify({
      email: "alice@example.com",
      invite_code: "K7QM3XPA9TNE",
      locale: "en",
    }),
  });
  assertEquals(reqAlice.status, 202);

  // Check generated code in login_codes
  const loginCodeRow = db.prepare(
    "SELECT id, code_hash, invite_hash FROM login_codes",
  ).get() as {
    id: string;
    code_hash: string;
    invite_hash: string;
  };
  assertEquals(!!loginCodeRow, true);
  assertEquals(loginCodeRow.invite_hash, testInviteHash);

  // Find the code that was mailed
  const lastMail = sentMessages[sentMessages.length - 1];
  assertEquals(!!lastMail, true);
  const matchCode = lastMail.text.match(/\b\d{6}\b/);
  assertEquals(!!matchCode, true);
  const code = matchCode![0];

  // 3. Verify code -> Session created
  const verifyRes = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": origin },
    body: JSON.stringify({
      email: "alice@example.com",
      code,
      tz: "Europe/Kyiv",
      locale: "en",
    }),
  });
  assertEquals(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assertEquals(verifyData.account.created, true);
  assertEquals(verifyData.account.has_keyring, false);
  const accountId = verifyData.account.id;

  const setCookie = verifyRes.headers.get("set-cookie");
  assertEquals(!!setCookie, true);
  const cookieMatch = setCookie!.match(/emo_session=([^;]+)/);
  const cookieHeader = `emo_session=${cookieMatch![1]}`;

  // 4. Session check
  const sessionRes = await app.request("/api/session", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assertEquals(sessionData.account.id, accountId);

  // 5. Setup E2E Keyring
  const dekRaw = generateDek();
  const authKey = await deriveAuthKey(dekRaw, accountId);
  const authProofB64 = encodeBase64Url(authKey);

  const salt = generateSalt();
  const passKek = await derivePassphraseKek("mypassphrase123", salt, {
    m: 32768,
    t: 1,
    p: 1,
  });
  const recoverySecret = generateRecoverySecret();
  const recKek = await deriveRecoveryKek(recoverySecret, accountId);

  const keyringAad = buildKeyringAad(accountId, 1);
  const passWrapped = await wrapDek(passKek, dekRaw, keyringAad);
  const recWrapped = await wrapDek(recKek, dekRaw, keyringAad);

  // Initial Keyring PUT (rev 1)
  const putKeyringRes = await app.request("/api/keyring/1", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
      "X-Emo-Auth": authProofB64,
    },
    body: JSON.stringify({
      key_version: 1,
      kdf: {
        alg: "argon2id",
        m_kib: 32768,
        t: 1,
        p: 1,
        salt_b64: encodeBase64Url(salt),
      },
      dek_wrapped_pass: {
        nonce_b64: encodeBase64Url(passWrapped.nonce),
        ct_b64: encodeBase64Url(passWrapped.ciphertext),
      },
      dek_wrapped_recovery: {
        nonce_b64: encodeBase64Url(recWrapped.nonce),
        ct_b64: encodeBase64Url(recWrapped.ciphertext),
      },
    }),
  });
  assertEquals(putKeyringRes.status, 201);
  const putKeyringData = await putKeyringRes.json();
  assertEquals(putKeyringData.rev, 1);

  // GET Keyring
  const getKeyringRes = await app.request("/api/keyring", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(getKeyringRes.status, 200);
  assertEquals(getKeyringRes.headers.get("etag"), '"1"');

  // 6. E2E Encrypted Entry PUT & Sync Pull
  const dek = await importDek(dekRaw);
  const entryId = "018f3a2b-1111-4000-8000-000000000001";
  const entry: EntryV2 = {
    schema_v: 2,
    id: entryId,
    ts: "2026-10-08T10:00:00.000Z",
    tz_offset_min: 180,
    trigger: "manual",
    reminder_id: null,
    latency_sec: 12,
    hidden_sec: 0,
    skipped: false,
    abandoned: false,
    untouched: null,
    ui: null,
    body: {
      locations: ["chest"],
      qualities: ["flutter"],
      intensity: 3,
    },
    affect: {
      valence: 1,
      arousal: 2,
      word: "joy.calm",
      word_confidence: "sure",
    },
    urge: null,
    head_mode: null,
    context_tag: "rest",
    context_other: null,
    note: "Resting",
  };

  const encEntry = await encryptEntry(dek, entry, accountId, 1);

  const putEntryRes = await app.request(`/api/entries/${entryId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
    },
    body: JSON.stringify({
      key_version: 1,
      nonce_b64: encodeBase64Url(encEntry.nonce),
      ct_b64: encodeBase64Url(encEntry.ciphertext),
    }),
  });
  assertEquals(putEntryRes.status, 201);
  const putEntryData = await putEntryRes.json();
  assertEquals(putEntryData.seq, 1);

  // Duplicate upload is idempotent
  const dupEntryRes = await app.request(`/api/entries/${entryId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
    },
    body: JSON.stringify({
      key_version: 1,
      nonce_b64: encodeBase64Url(encEntry.nonce),
      ct_b64: encodeBase64Url(encEntry.ciphertext),
    }),
  });
  assertEquals(dupEntryRes.status, 200);

  // Pull entries stream
  const pullRes = await app.request("/api/entries?since=0", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(pullRes.status, 200);
  const pullData = await pullRes.json();
  assertEquals(pullData.items.length, 1);
  assertEquals(pullData.items[0].id, entryId);
  assertEquals(pullData.items[0].seq, 1);
  assertEquals(pullData.items[0].deleted, false);

  // 7. Emergency Undo: DELETE /api/entries/:id with DEK proof
  // Without proof fails with 403
  const noProofDeleteRes = await app.request(`/api/entries/${entryId}`, {
    method: "DELETE",
    headers: {
      "Origin": origin,
      "Cookie": cookieHeader,
    },
  });
  assertEquals(noProofDeleteRes.status, 403);

  // With proof succeeds
  const undoRes = await app.request(`/api/entries/${entryId}`, {
    method: "DELETE",
    headers: {
      "Origin": origin,
      "Cookie": cookieHeader,
      "X-Emo-Auth": authProofB64,
    },
  });
  assertEquals(undoRes.status, 200);
  const undoData = await undoRes.json();
  assertEquals(undoData.seq, 2); // Tombstone assigned new seq!

  // Pull entries after undo: row is tombstone
  const pullAfterUndo = await app.request("/api/entries?since=0", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(pullAfterUndo.status, 200);
  const pullAfterUndoData = await pullAfterUndo.json();
  assertEquals(pullAfterUndoData.items.length, 1);
  assertEquals(pullAfterUndoData.items[0].deleted, true);
  assertEquals(pullAfterUndoData.items[0].seq, 2);
  assertEquals(pullAfterUndoData.items[0].ct_b64, null);

  // Late upload of tombstoned entry returns 410 entry_deleted
  const lateUploadRes = await app.request(`/api/entries/${entryId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
    },
    body: JSON.stringify({
      key_version: 1,
      nonce_b64: encodeBase64Url(encEntry.nonce),
      ct_b64: encodeBase64Url(encEntry.ciphertext),
    }),
  });
  assertEquals(lateUploadRes.status, 410);

  // 8. Prefs: PUT and GET
  const prefsObj = { appearance: { preset: "paper", mode: "light" } };
  const encPrefs = await encryptPrefs(dek, prefsObj, accountId, 1);

  const putPrefsRes = await app.request("/api/prefs", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
    },
    body: JSON.stringify({
      key_version: 1,
      nonce_b64: encodeBase64Url(encPrefs.nonce),
      ct_b64: encodeBase64Url(encPrefs.ciphertext),
    }),
  });
  assertEquals(putPrefsRes.status, 200);

  const getPrefsRes = await app.request("/api/prefs", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(getPrefsRes.status, 200);

  // 9. Settings: GET and PUT
  const settingsRes = await app.request("/api/settings", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(settingsRes.status, 200);

  const putSettingsRes = await app.request("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
    },
    body: JSON.stringify({
      tz: "Europe/Kyiv",
      locale: "uk",
      wake_start: "08:00",
      wake_end: "23:00",
      reminders_per_day: 4,
      min_gap_min: 120,
    }),
  });
  assertEquals(putSettingsRes.status, 200);

  // 10. Recovery Mail
  const { formatted: recKeyFormatted } = await generateRecoveryKey();
  const recMailRes = await app.request("/api/account/recovery-mail", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "Cookie": cookieHeader,
    },
    body: JSON.stringify({
      recovery_key: recKeyFormatted,
    }),
  });
  assertEquals(recMailRes.status, 202);

  // 11. Delete Account with DEK proof
  const delAccRes = await app.request("/api/account", {
    method: "DELETE",
    headers: {
      "Origin": origin,
      "Cookie": cookieHeader,
      "X-Emo-Auth": authProofB64,
    },
  });
  assertEquals(delAccRes.status, 204);

  // Subsequent request with that session cookie returns 401 account_gone
  const goneRes = await app.request("/api/session", {
    method: "GET",
    headers: { "Cookie": cookieHeader },
  });
  assertEquals(goneRes.status, 401);
  const goneData = await goneRes.json();
  assertEquals(goneData.error.code, "account_gone");
});

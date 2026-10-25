// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { setLogSink } from "../log.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";
import { hashEmail } from "../crypto.ts";
import { checkServerSecret } from "../secret_check.ts";
import { tryAcquireLease } from "../services/lease.ts";
import { decodeHex, encodeBase64Url } from "../../shared/crypto/encoding.ts";
import {
  derivePassphraseKek,
  deriveRecoveryKek,
  encryptEntry,
  generateDek,
  generateSalt,
  importDek,
  wrapDek,
} from "../../shared/crypto/e2e.ts";
import { buildKeyringAad } from "../../shared/crypto/aad.ts";
import { generateRecoveryKey } from "../../shared/crypto/recovery.ts";
import {
  type EmoBundleV1,
  entriesToCsv,
  type ExportedEntry,
} from "../../shared/export.ts";
import type { EntryV2 } from "../../shared/entry.ts";
import {
  adminDeleteAccount,
  adminDeleteEntry,
  issueLoginCode,
  listAccounts,
  revertKeyring,
  rotateSecret,
} from "./admin.ts";
import { BundleError, decryptBundle } from "./decrypt_bundle.ts";
import { CliRefusal } from "./restore.ts";

const SECRET = "a3f1".repeat(16); // the harness's SERVER_SECRET
const count = (
  server: ReturnType<typeof startTestServer>,
  sql: string,
  ...args: string[]
) => (server.db.prepare(sql).get(...args) as { n: number }).n;

async function withServer(
  fn: (server: ReturnType<typeof startTestServer>) => Promise<void>,
) {
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const restoreLog = setLogSink(() => {});
  try {
    await fn(server);
  } finally {
    restoreLog();
    restoreFetch();
  }
}

Deno.test("admin - accounts lists counts; emails only on request", async () => {
  await withServer(async (server) => {
    const { accountId } = await server.signUp("list@example.org");
    const plain = await listAccounts(server.db);
    assertEquals(plain.length, 1);
    assertEquals(plain[0].id, accountId);
    assertEquals(plain[0].entries, 0);
    assertEquals("email" in plain[0], false);
    const withEmail = await listAccounts(server.db, {
      emails: true,
      serverSecretHex: SECRET,
    });
    assertEquals(withEmail[0].email, "list@example.org");
  });
});

Deno.test("admin - account-delete removes every row, mail_log included", async () => {
  await withServer(async (server) => {
    const { accountId } = await server.signUp("gone@example.org");
    server.db.prepare(
      "INSERT INTO mail_log (account_id, kind, sent_at) VALUES (?, 'recovery', 'x')",
    )
      .run(accountId);
    assertEquals(adminDeleteAccount(server.db, accountId), true);
    for (const table of ["accounts", "sessions", "mail_log"]) {
      const col = table === "accounts" ? "id" : "account_id";
      assertEquals(
        count(
          server,
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`,
          accountId,
        ),
        0,
      );
    }
    assertEquals(count(server, "SELECT COUNT(*) AS n FROM gone_sessions"), 1);
    // The old session now learns the account is gone
    const res = await fetch(`${TEST_ORIGIN}/api/session`);
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error.code, "account_gone");
    assertEquals(adminDeleteAccount(server.db, accountId), false);
  });
});

Deno.test("admin - login-code signs the person in without mail", async () => {
  await withServer(async (server) => {
    await server.signUp("outage@example.org");
    assertEquals(
      await issueLoginCode(server.db, SECRET, "nobody@example.org"),
      null,
    );
    const issued =
      (await issueLoginCode(server.db, SECRET, "  Outage@Example.org "))!;
    assert(/^\d{6}$/.test(issued.code));
    const res = await fetch(`${TEST_ORIGIN}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "outage@example.org",
        code: issued.code,
        tz: "Europe/Kyiv",
        locale: "en",
      }),
    });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).account.id, issued.accountId);
  });
});

Deno.test("admin - keyring-revert appends the old revision as the newest", async () => {
  await withServer(async (server) => {
    const { accountId } = await server.signUp("keys@example.org");
    const insert = server.db.prepare(`
      INSERT INTO keyrings (account_id, key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, auth_hash, created_at)
      VALUES (?, 1, ?, ?, ?, x'02', x'03', 'x')
    `);
    insert.run(accountId, 1, '{"rev":1}', new Uint8Array([1]));
    insert.run(accountId, 2, '{"rev":2}', new Uint8Array([2]));
    assertEquals(revertKeyring(server.db, accountId, 1), 3);
    const latest = server.db.prepare(
      "SELECT rev, kdf_json FROM keyrings WHERE account_id = ? ORDER BY rev DESC LIMIT 1",
    ).get(accountId) as { rev: number; kdf_json: string };
    assertEquals(latest, { rev: 3, kdf_json: '{"rev":1}' });
    assertEquals(count(server, "SELECT COUNT(*) AS n FROM keyrings"), 3); // nothing deleted
    assertThrows(() => revertKeyring(server.db, accountId, 9), CliRefusal);
  });
});

Deno.test("admin - entry-delete makes a tombstone, idempotently", async () => {
  await withServer(async (server) => {
    const { accountId } = await server.signUp("entry@example.org");
    const entryId = crypto.randomUUID();
    const seq = adminDeleteEntry(server.db, accountId, entryId);
    assertEquals(adminDeleteEntry(server.db, accountId, entryId), seq);
    const row = server.db.prepare(
      "SELECT deleted, ciphertext FROM entries WHERE id = ?",
    ).get(entryId);
    assertEquals(row, { deleted: 1, ciphertext: null });
    assertThrows(
      () => adminDeleteEntry(server.db, accountId, "NOT-A-UUID"),
      CliRefusal,
    );
  });
});

Deno.test("admin - rotate-secret re-keys emails, or changes nothing", async () => {
  await withServer(async (server) => {
    await server.signUp("rotate@example.org");
    await checkServerSecret(server.db, SECRET);
    const next = "b4e2".repeat(16);
    const before = server.db.prepare(
      "SELECT email_enc, email_hmac FROM accounts",
    ).get();

    await assertRejects(
      () => rotateSecret(server.db, "c5d3".repeat(16), next),
      CliRefusal,
    );
    assertEquals(
      server.db.prepare("SELECT email_enc, email_hmac FROM accounts").get(),
      before,
    );

    tryAcquireLease(server.db, "running-server");
    await assertRejects(
      () => rotateSecret(server.db, SECRET, next),
      CliRefusal,
      "server is running",
    );
    server.db.prepare("DELETE FROM meta WHERE key = 'scheduler_lease'").run();

    assertEquals(await rotateSecret(server.db, SECRET, next), {
      accounts: 1,
      invites: 0,
    });
    const hmac = await hashEmail(decodeHex(next), "rotate@example.org");
    const found = server.db.prepare(
      "SELECT 1 AS one FROM accounts WHERE email_hmac = ?",
    ).get(hmac);
    assertEquals(found, { one: 1 });
    assertEquals(await checkServerSecret(server.db, next), "match");
    assertEquals(
      (await listAccounts(server.db, { emails: true, serverSecretHex: next }))[
        0
      ].email,
      "rotate@example.org",
    );
  });
});

// --- decrypt-bundle ------------------------------------------------------------

const FIXTURE: EntryV2 = JSON.parse(
  await Deno.readTextFile(
    new URL("../../shared/fixtures/entry.v2.json", import.meta.url),
  ),
);
// Fast Argon2 parameters for the test; the bundle carries whatever was used
const KDF = { m: 1024, t: 1, p: 1 };

async function makeBundle(
  passphrase: string,
  extra: Array<Record<string, unknown>> = [],
) {
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const dekRaw = generateDek();
  const dek = await importDek(dekRaw);
  const salt = generateSalt();
  const recovery = await generateRecoveryKey();
  const aad = buildKeyringAad(accountId, 1);
  const pass = await wrapDek(
    await derivePassphraseKek(passphrase, salt, KDF),
    dekRaw,
    aad,
  );
  const rec = await wrapDek(
    await deriveRecoveryKek(recovery.secret, accountId),
    dekRaw,
    aad,
  );
  const b64 = encodeBase64Url;
  const later = {
    ...FIXTURE,
    id: crypto.randomUUID(),
    ts: "2026-10-08T09:00:00Z",
    note: null,
  };
  const entries = [];
  for (const e of [later, FIXTURE, ...extra] as EntryV2[]) {
    const { nonce, ciphertext } = await encryptEntry(dek, e, accountId, 1);
    entries.push({
      id: e.id,
      key_version: 1,
      nonce_b64: b64(nonce),
      ct_b64: b64(ciphertext),
      deleted: false,
      received_at: "2026-10-08T10:00:00.000Z",
    });
  }
  entries.push({
    id: crypto.randomUUID(),
    key_version: 1,
    nonce_b64: null,
    ct_b64: null,
    deleted: true,
    received_at: "x",
  });
  const bundle: EmoBundleV1 = {
    format: "emo-bundle",
    version: 1,
    exported_at: "2026-10-08T10:00:00.000Z",
    app_version: "0.1.0",
    instance: "emo.example.org",
    account_id: accountId,
    keyrings: [{
      key_version: 1,
      rev: 1,
      kdf: {
        alg: "argon2id",
        m_kib: KDF.m,
        t: KDF.t,
        p: KDF.p,
        salt_b64: b64(salt),
      },
      dek_wrapped_pass: {
        nonce_b64: b64(pass.nonce),
        ct_b64: b64(pass.ciphertext),
      },
      dek_wrapped_recovery: {
        nonce_b64: b64(rec.nonce),
        ct_b64: b64(rec.ciphertext),
      },
    }],
    entries,
    prefs: null,
    reminders: [],
  };
  return { bundle, recoveryKey: recovery.formatted };
}

Deno.test("decrypt-bundle - passphrase or recovery key opens the entries", async () => {
  const { bundle, recoveryKey } = await makeBundle("correct horse battery");
  const byPass = await decryptBundle(bundle, {
    passphrase: "correct horse battery",
  });
  assertEquals(byPass.undecryptable, 0);
  // Tombstones are left out; sorted by time
  assertEquals(byPass.entries.map((e) => e.id)[0], FIXTURE.id);
  assertEquals(byPass.entries.length, 2);
  assertEquals(byPass.entries[0].note, "созвон с руководителем");
  assertEquals(byPass.entries[0].received_at, "2026-10-08T10:00:00.000Z");
  const byKey = await decryptBundle(bundle, {
    recoveryKey: recoveryKey.toLowerCase(),
  });
  assertEquals(byKey.entries.length, 2);

  await assertRejects(
    () => decryptBundle(bundle, { passphrase: "wrong one" }),
    BundleError,
    "Wrong passphrase",
  );
});

Deno.test("decrypt-bundle - invalid and newer entries are kept apart, as in the app", async () => {
  const invalid = { ...FIXTURE, id: crypto.randomUUID(), ts: 42, note: "bad" };
  const newer = { ...FIXTURE, id: crypto.randomUUID(), schema_v: 3 };
  const { bundle } = await makeBundle("correct horse battery", [
    invalid,
    newer,
  ]);
  const opened = await decryptBundle(bundle, {
    passphrase: "correct horse battery",
  });
  assertEquals(opened.entries.length, 2);
  assertEquals(opened.invalid.map((e) => [e.id, e._invalid]), [[
    invalid.id,
    true,
  ]]);
  assertEquals([opened.newer, opened.undecryptable], [1, 0]);
});

Deno.test("export - entries.csv: BOM, keys, ; for arrays, quoting, labels", () => {
  const entry: ExportedEntry = {
    ...FIXTURE,
    note: 'said "no", then left',
    received_at: "2026-10-08T10:00:00.000Z",
  };
  const csv = entriesToCsv([entry], "en");
  assert(csv.startsWith("﻿id,ts,"));
  const [header, row] = csv.slice(1).trim().split("\r\n");
  const cols = header.split(",");
  assert(cols.includes("ui_figure") && cols.includes("received_at"));
  assert(cols.includes("affect_word_label"));
  assert(row.includes('"chest;throat"'));
  assert(row.includes('"said ""no"", then left"'));
  assert(row.includes("anxiety") || row.includes("Anxiety"));
});

Deno.test("export - entries.csv: every row as wide as the header; the wording and schema versions", () => {
  const entry = (ui: ExportedEntry["ui"]): ExportedEntry => ({
    ...FIXTURE,
    note: "созвон",
    ui,
    received_at: "2026-10-08T10:00:00.000Z",
  });
  const ui = {
    theme: "3f9a1c0be27d4a65",
    intensity: "slider",
    options: "grid",
    figure: "solid",
  } as const;
  for (const labels of [undefined, "ru"] as const) {
    const csv = entriesToCsv(
      [
        entry({ ...ui, copy: 6, layout: "mixed" }),
        entry({ ...ui, copy: 3 }),
        entry(ui),
        entry(null),
      ],
      labels,
    );
    const [header, ...rows] = csv.slice(1).trim().split("\r\n");
    const cols = header.split(",");
    for (const row of rows) assertEquals(row.split(",").length, cols.length);
    const cell = (row: string, name: string) =>
      row.split(",")[cols.indexOf(name)];
    // Without `ui.copy` the wording is version 1; without `ui`, unknown
    assertEquals(rows.map((r) => cell(r, "ui_copy")), ["6", "3", "1", ""]);
    assertEquals(rows.map((r) => cell(r, "schema_v")), ["2", "2", "2", "2"]);
    // The layout: appended after schema_v, so earlier columns keep their
    // places; empty when unknown (before copy 6)
    assertEquals(cols.indexOf("ui_layout"), cols.indexOf("schema_v") + 1);
    assertEquals(rows.map((r) => cell(r, "ui_layout")), ["mixed", "", "", ""]);
  }
});

Deno.test("export - entries.csv: a stopped check-in keeps its answers and stopped_at", () => {
  const stopped: ExportedEntry = {
    ...FIXTURE,
    skipped: true,
    stopped_at: "valence",
    untouched: [],
    body: { locations: ["chest"], qualities: ["squeeze"], intensity: 6 },
    affect: null,
    urge: null,
    head_mode: null,
    context_tag: null,
    context_other: null,
    note: null,
    received_at: "2026-10-08T10:00:00.000Z",
  };
  const csv = entriesToCsv([stopped, { ...FIXTURE, received_at: "x" }], "en");
  const [header, row, saved] = csv.slice(1).trim().split("\r\n");
  const cols = header.split(",");
  const cell = (line: string, name: string) =>
    line.split(",")[cols.indexOf(name)];
  assertEquals(cell(row, "stopped_at"), "valence");
  assertEquals(cell(row, "skipped"), "true");
  assertEquals(cell(row, "body_qualities"), "squeeze");
  assertEquals(cell(row, "body_intensity"), "6");
  assertEquals(cell(row, "affect_valence"), "");
  assertEquals(cell(saved, "stopped_at"), "");
});

// --- backup / verify-backup ----------------------------------------------------

Deno.test("backup - snapshot, integrity, rotation; verify-backup checks the secret", async () => {
  await withServer(async (server) => {
    await server.signUp("backup@example.org");
    const { backupDatabase, verifyBackup } = await import("./backup.ts");
    const dir = await Deno.makeTempDir();
    try {
      const at = (min: number) => new Date(Date.UTC(2026, 9, 8, 3, min));
      const results = [0, 1, 2].map((m) =>
        backupDatabase(server.db, dir, { keep: 2, now: at(m) })
      );
      assertEquals(results[2].file.endsWith("emo-20261008-0302.sqlite"), true);
      assertEquals(results[2].integrity, "ok");
      assertEquals(results[2].tableCounts.accounts, 1);
      assert(results[2].sizeBytes > 0);
      assertEquals(results[2].removed, ["emo-20261008-0300.sqlite"]);
      // Copies older than the oldest kept snapshot go too; newer ones stay
      const old = [
        "pre-migrate-4-to-5-20261008-025959.sqlite",
        "replaced-20261008-0259.sqlite",
        "replaced-20261008-0259-2.sqlite",
      ];
      const fresh = [
        "pre-migrate-5-to-6-20261008-030400.sqlite",
        "replaced-20261008-0304.sqlite",
      ];
      for (const name of [...old, ...fresh]) {
        Deno.writeTextFileSync(`${dir}/${name}`, "");
      }
      const fourth = backupDatabase(server.db, dir, { keep: 2, now: at(3) });
      assertEquals(
        fourth.removed.sort(),
        ["emo-20261008-0301.sqlite", ...old].sort(),
      );
      for (const name of fresh) assert(Deno.statSync(`${dir}/${name}`).isFile);
      // Same minute again: a distinct name, not a failure
      const again = backupDatabase(server.db, dir, { keep: 5, now: at(3) });
      assert(again.file.endsWith("emo-20261008-0303-00.sqlite"));

      const good = await verifyBackup(results[2].file, SECRET);
      assertEquals(good.ok, true);
      assertEquals(good.counts.accounts, 1);
      assertEquals(good.secretMatches, true);
      const wrong = await verifyBackup(results[2].file, "b4e2".repeat(16));
      assertEquals(wrong.ok, false);
      assertEquals(wrong.secretMatches, false);
      assertEquals(
        (await verifyBackup(`${dir}/missing.sqlite`, SECRET)).ok,
        false,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});

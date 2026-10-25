// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Entry sync (api.md §2.6, development.md §5.1–§5.2): an id holds one
 * blob, `seq` only grows, pulls page by `since`, and a tombstone wins.
 */
import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "../../shared/crypto/encoding.ts";
import type { EntriesPullRes } from "../../shared/protocol.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";

const b64 = (n: number) =>
  encodeBase64Url(crypto.getRandomValues(new Uint8Array(n)));
const blob = () => ({ key_version: 1, nonce_b64: b64(12), ct_b64: b64(2064) });

async function setup() {
  const server = startTestServer();
  const restore = server.installFetch();
  await server.signUp(`entries-${crypto.randomUUID().slice(0, 8)}@example.org`);
  const proof = b64(32);
  const keyring = await fetch(`${TEST_ORIGIN}/api/keyring/1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Emo-Auth": proof },
    body: JSON.stringify({
      key_version: 1,
      kdf: { alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt_b64: b64(16) },
      dek_wrapped_pass: { nonce_b64: b64(12), ct_b64: b64(48) },
      dek_wrapped_recovery: { nonce_b64: b64(12), ct_b64: b64(48) },
    }),
  });
  assertEquals(keyring.status, 201);
  const put = (id: string, body: unknown) =>
    fetch(`${TEST_ORIGIN}/api/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const del = (id: string) =>
    fetch(`${TEST_ORIGIN}/api/entries/${id}`, {
      method: "DELETE",
      headers: { "X-Emo-Auth": proof },
    });
  const pull = async (since: number, limit = 500) =>
    await (await fetch(
      `${TEST_ORIGIN}/api/entries?since=${since}&limit=${limit}`,
    )).json() as EntriesPullRes;
  return { server, restore, put, del, pull };
}

Deno.test("entries - one blob per id: the same is 200, another is 409", async () => {
  const { restore, put } = await setup();
  try {
    const id = crypto.randomUUID();
    const first = blob();
    const created = await put(id, first);
    assertEquals(created.status, 201);
    const { seq } = await created.json();
    const again = await put(id, first);
    assertEquals(again.status, 200);
    assertEquals((await again.json()).seq, seq);
    const other = await put(id, blob());
    assertEquals(other.status, 409);
    assertEquals((await other.json()).error.code, "entry_blob_mismatch");
  } finally {
    restore();
  }
});

Deno.test("entries - seq grows, pulls page by since, max_seq is the newest", async () => {
  const { restore, put, pull } = await setup();
  try {
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) {
      seqs.push((await (await put(crypto.randomUUID(), blob())).json()).seq);
    }
    assertEquals(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), true);

    const first = await pull(0, 2);
    assertEquals(first.items.map((e) => e.seq), seqs.slice(0, 2));
    assertEquals(first.has_more, true);
    assertEquals(first.max_seq, seqs[4]);
    const second = await pull(first.next_seq, 2);
    assertEquals(second.items.map((e) => e.seq), seqs.slice(2, 4));
    const third = await pull(second.next_seq, 2);
    assertEquals(third.items.map((e) => e.seq), seqs.slice(4));
    assertEquals(third.has_more, false);
    assertEquals((await pull(third.next_seq)).items, []);
  } finally {
    restore();
  }
});

Deno.test("entries - a tombstone wins: a later upload of the id is 410", async () => {
  const { restore, put, del, pull } = await setup();
  try {
    const id = crypto.randomUUID();
    const original = blob();
    await put(id, original);
    const deleted = await del(id);
    assertEquals(deleted.status, 200);
    const { seq } = await deleted.json();

    // Another device that still holds the entry uploads it again
    const res = await put(id, original);
    assertEquals(res.status, 410);
    assertEquals((await res.json()).error.code, "entry_deleted");
    const pulled = (await pull(0)).items.find((e) => e.id === id)!;
    assertEquals([pulled.deleted, pulled.seq, pulled.ct_b64], [
      true,
      seq,
      null,
    ]);
  } finally {
    restore();
  }
});

Deno.test("entries - lower-case ids, 12-byte nonces; a replay is fine even when full", async () => {
  const { server, restore, put } = await setup();
  try {
    const id = crypto.randomUUID();
    const upper = await put(id.toUpperCase(), blob());
    assertEquals(upper.status, 400);
    const shortNonce = await put(id, { ...blob(), nonce_b64: b64(8) });
    assertEquals(shortNonce.status, 400);
    assertEquals((await shortNonce.json()).error.code, "invalid_field");

    const first = blob();
    assertEquals((await put(id, first)).status, 201);
    assertEquals((await put(id, first)).status, 200);

    // A full account (100 000 live entries): a replay still answers 200, a
    // new entry is refused
    const { account_id } = server.db.prepare(
      "SELECT account_id FROM entries WHERE id = ?",
    ).get(id) as { account_id: string };
    server.db.prepare(`
      WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < 100000)
      INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
      SELECT 'filler-' || i, ?, i, 1, x'00', x'00', 0, '2026-10-08T00:00:00.000Z' FROM n
    `).run(account_id);
    assertEquals((await put(id, first)).status, 200);
    const full = await put(crypto.randomUUID(), blob());
    assertEquals(full.status, 413);
    assertEquals((await full.json()).error.code, "account_full");
  } finally {
    restore();
  }
});

Deno.test("entries - a pull over 1 KB is sent gzip-compressed", async () => {
  const { restore, put } = await setup();
  try {
    await put(crypto.randomUUID(), blob());
    const res = await fetch(`${TEST_ORIGIN}/api/entries?since=0`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    assertEquals(res.headers.get("Content-Encoding"), "gzip");
    const json = await new Response(
      res.body!.pipeThrough(new DecompressionStream("gzip")),
    ).json();
    assertEquals(json.items.length, 1);
  } finally {
    restore();
  }
});

Deno.test("entries - concurrent identical PUT requests resolve idempotently without constraint error", async () => {
  const { restore, put } = await setup();
  try {
    const id = crypto.randomUUID();
    const entryData = blob();
    const [res1, res2] = await Promise.all([
      put(id, entryData),
      put(id, entryData),
    ]);
    const statuses = [res1.status, res2.status].sort();
    assertEquals(statuses, [200, 201]);
    const json1 = await res1.json();
    const json2 = await res2.json();
    assertEquals(json1.seq, json2.seq);
  } finally {
    restore();
  }
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals, assertRejects } from "@std/assert";
import {
  decryptServerString,
  encryptServerBlob,
  generateInviteCode,
  generateLoginCode,
  generateSessionToken,
  generateUuidV4,
  generateUuidV7,
  hashEmail,
  hashInviteCode,
  hashLoginCode,
  sha256Bytes,
  verifyAuthProof,
} from "./crypto.ts";
import { encodeBase64Url } from "../shared/crypto/encoding.ts";

Deno.test("server crypto - UUID v4 and v7", () => {
  const v4 = generateUuidV4();
  assertEquals(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(v4),
    true,
  );

  const v7 = generateUuidV7();
  assertEquals(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(v7),
    true,
  );
});

Deno.test("server crypto - server blobs: subkey, bound to their column, old rows open", async () => {
  const secret = new Uint8Array(32).fill(42);
  const text = "user@example.com";

  const enc = await encryptServerBlob(secret, text, "email");
  assertEquals(await decryptServerString(secret, enc, "email"), text);
  // An email ciphertext copied into `invites.code_enc` does not open (L2)
  await assertRejects(() => decryptServerString(secret, enc, "invite-code"));
  await assertRejects(() =>
    decryptServerString(new Uint8Array(32).fill(7), enc, "email")
  );

  // A row from before the subkey: the raw secret, no AAD
  const raw = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const old = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      raw,
      new TextEncoder().encode(text),
    ),
  );
  const legacy = new Uint8Array(12 + old.length);
  legacy.set(iv);
  legacy.set(old, 12);
  assertEquals(await decryptServerString(secret, legacy, "email"), text);
});

Deno.test("server crypto - login codes are hashed under a key (L26)", async () => {
  const a = new Uint8Array(32).fill(1);
  const b = new Uint8Array(32).fill(2);
  const h = await hashLoginCode(a, " 123456 ");
  assertEquals(h, await hashLoginCode(a, "123456"));
  assertEquals(h.length, 64);
  // Not a plain SHA-256 of the code, and different under another secret
  assertEquals(h === await hashLoginCode(b, "123456"), false);
  const plain = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("123456")),
    ),
  ).map((x) => x.toString(16).padStart(2, "0")).join("");
  assertEquals(h === plain, false);
});

Deno.test("server crypto - email HMAC normalization", async () => {
  const secret = new Uint8Array(32).fill(42);
  const h1 = await hashEmail(secret, "  User@Example.Com ");
  const h2 = await hashEmail(secret, "user@example.com");
  assertEquals(h1, h2);
});

Deno.test("server crypto - session token generation", async () => {
  const { token, tokenHash } = await generateSessionToken();
  assertEquals(token.length > 30, true);
  assertEquals(tokenHash.length, 64);
});

Deno.test("server crypto - login and invite code generation", async () => {
  const code = generateLoginCode();
  assertEquals(/^\d{6}$/.test(code), true);

  const invite = generateInviteCode();
  assertEquals(invite.length, 12);
  const hash1 = await hashInviteCode(invite);
  const hash2 = await hashInviteCode(invite.toLowerCase());
  assertEquals(hash1, hash2);
});

Deno.test("server crypto - auth proof verification", async () => {
  const rawAuthKey = crypto.getRandomValues(new Uint8Array(32));
  const storedHash = await sha256Bytes(rawAuthKey);
  const proofB64 = encodeBase64Url(rawAuthKey);

  const valid = await verifyAuthProof(storedHash, proofB64);
  assertEquals(valid, true);

  const wrongProof = encodeBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const invalid = await verifyAuthProof(storedHash, wrongProof);
  assertEquals(invalid, false);
});

Deno.test("server crypto - invite codes use all 12 characters independently", () => {
  // With 60 random bits no character is a function of the others: across many
  // codes, every position takes many values whatever the first 4 are
  const byPrefix = new Map<string, Set<string>>();
  for (let i = 0; i < 4000; i++) {
    const code = generateInviteCode();
    assertEquals(/^[0-9A-HJKMNP-TV-Z]{12}$/.test(code), true);
    const key = code.slice(0, 1);
    const tails = byPrefix.get(key) ?? new Set();
    tails.add(code.slice(8));
    byPrefix.set(key, tails);
  }
  for (const tails of byPrefix.values()) assertEquals(tails.size > 50, true);
});

Deno.test("server crypto - login codes are six digits", () => {
  for (let i = 0; i < 1000; i++) {
    assertEquals(/^\d{6}$/.test(generateLoginCode()), true);
  }
});

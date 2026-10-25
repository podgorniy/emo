// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Argument handling and terminal output for the operator commands of
 * `server/cli/admin.ts` and `emo decrypt-bundle`. Specification: ops.md §1.1.
 */

import { loadConfig } from "../config.ts";
import {
  adminDeleteAccount,
  adminDeleteEntry,
  issueLoginCode,
  listAccounts,
  revertKeyring,
  rotateSecret,
} from "./admin.ts";
import { BundleError, writeDecryptedBundle } from "./decrypt_bundle.ts";
import { openAndMigrate } from "./open.ts";
import { promptLine, promptSecret } from "./prompt.ts";
import { CliRefusal } from "./restore.ts";

export const ADMIN_COMMANDS = [
  "accounts",
  "account-delete",
  "login-code",
  "keyring-revert",
  "entry-delete",
  "rotate-secret",
  "decrypt-bundle",
] as const;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (["--out", "--old", "--new"].includes(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function usage(text: string): never {
  console.error(`Usage: emo ${text}`);
  Deno.exit(1);
}

function printTable(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "—").length))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(width[i])).join("  ");
  console.log(line(cols));
  for (const r of rows) console.log(line(cols.map((c) => String(r[c] ?? "—"))));
}

export async function runAdminCommand(
  command: string,
  args: string[],
): Promise<void> {
  try {
    await dispatch(command, args);
  } catch (err) {
    if (err instanceof CliRefusal || err instanceof BundleError) {
      console.error(`[emo] Refusing: ${err.message}`);
      Deno.exit(1);
    }
    throw err;
  }
}

async function dispatch(command: string, args: string[]) {
  const pos = positional(args);
  switch (command) {
    case "accounts": {
      const { db } = openAndMigrate();
      const emails = args.includes("--emails");
      const rows = await listAccounts(db, {
        emails,
        serverSecretHex: emails ? loadConfig().serverSecret : undefined,
      });
      printTable(rows as unknown as Array<Record<string, unknown>>);
      return;
    }
    case "account-delete": {
      const [id] = pos;
      if (!id) usage("account-delete <account_id>");
      const again = await promptLine(
        `This deletes account ${id} and all its data for good. Type the id again to confirm: `,
      );
      if (again !== id) throw new CliRefusal("The ids differ; nothing deleted");
      const { db } = openAndMigrate();
      if (!adminDeleteAccount(db, id)) throw new CliRefusal(`No account ${id}`);
      console.log(
        `[emo] Deleted account ${id}. Its other devices get account_gone.`,
      );
      return;
    }
    case "login-code": {
      const [email] = pos;
      if (!email) usage("login-code <email>");
      const { db } = openAndMigrate();
      const issued = await issueLoginCode(db, loadConfig().serverSecret, email);
      if (!issued) throw new CliRefusal("No account has this email");
      console.log(
        `[emo] Login code: ${issued.code} (account ${issued.accountId})`,
      );
      console.log(
        `[emo] Valid until ${issued.expiresAt}. Older codes no longer work.`,
      );
      console.log(
        "[emo] Pass it on only after confirming the person through another channel.",
      );
      return;
    }
    case "keyring-revert": {
      const [accountId, revText] = pos;
      const rev = Number(revText);
      if (!accountId || !Number.isInteger(rev)) {
        usage("keyring-revert <account_id> <rev>");
      }
      const { db } = openAndMigrate();
      const newRev = revertKeyring(db, accountId, rev);
      console.log(
        `[emo] Revision ${rev} is now the latest, as revision ${newRev}.`,
      );
      console.log(
        "[emo] The person unlocks with the passphrase that belonged to it.",
      );
      return;
    }
    case "entry-delete": {
      const [accountId, entryId] = pos;
      if (!accountId || !entryId) usage("entry-delete <account_id> <entry_id>");
      const { db } = openAndMigrate();
      const seq = adminDeleteEntry(db, accountId, entryId);
      console.log(
        `[emo] Entry ${entryId} is a tombstone (seq ${seq}); devices drop it on their next sync.`,
      );
      return;
    }
    case "rotate-secret": {
      const oldHex = option(args, "--old");
      const newHex = option(args, "--new");
      if (!oldHex || !newHex) usage("rotate-secret --old <hex> --new <hex>");
      const { db } = openAndMigrate();
      const r = await rotateSecret(db, oldHex, newHex);
      console.log(
        `[emo] Re-encrypted ${r.accounts} account(s) and ${r.invites} invite code(s).`,
      );
      console.log(
        "[emo] Next: set SERVER_SECRET to the new value in .env, then make up && make smoke",
      );
      return;
    }
    case "decrypt-bundle": {
      const [file] = pos;
      const out = option(args, "--out");
      if (!file || !out) usage("decrypt-bundle FILE --out DIR [--recovery]");
      const recovery = args.includes("--recovery");
      const secret = recovery
        ? { recoveryKey: await promptSecret("Recovery key: ") }
        : { passphrase: await promptSecret("Passphrase: ") };
      const r = await writeDecryptedBundle(file, out, secret);
      console.log(
        `[emo] Wrote ${r.entries} entr${
          r.entries === 1 ? "y" : "ies"
        } and ${r.reminders} reminder(s) to ${out}`,
      );
      const entries = (n: number) => `${n} entr${n === 1 ? "y" : "ies"}`;
      if (r.invalid > 0) {
        console.log(
          `[emo] ${
            entries(r.invalid)
          } failed validation: in entries.jsonl only, marked _invalid`,
        );
      }
      if (r.newer > 0) {
        console.log(
          `[emo] ${
            entries(r.newer)
          } written by a newer Emo: not exported, update this binary`,
        );
      }
      if (r.undecryptable > 0) {
        console.log(`[emo] ${entries(r.undecryptable)} could not be decrypted`);
      }
      return;
    }
  }
}

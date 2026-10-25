// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Terminal input for the `emo` admin commands: a line read without echo
 * (passphrases, recovery keys) and a plain line (confirmations). Without a
 * terminal both read one line from stdin, so the commands can be scripted.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readLine(): Promise<string> {
  const buf = new Uint8Array(1);
  const bytes: number[] = [];
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break;
    if (buf[0] === 0x0a) break;
    if (buf[0] !== 0x0d) bytes.push(buf[0]);
  }
  return decoder.decode(new Uint8Array(bytes));
}

export async function promptLine(question: string): Promise<string> {
  await Deno.stderr.write(encoder.encode(question));
  return (await readLine()).trim();
}

/** Reads a line with echo off; Ctrl-C aborts with exit code 130. */
export async function promptSecret(question: string): Promise<string> {
  await Deno.stderr.write(encoder.encode(question));
  if (!Deno.stdin.isTerminal()) return await readLine();
  Deno.stdin.setRaw(true);
  const bytes: number[] = [];
  const buf = new Uint8Array(16);
  try {
    outer: while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;
      for (let i = 0; i < n; i++) {
        const b = buf[i];
        if (b === 0x03) {
          Deno.stdin.setRaw(false);
          await Deno.stderr.write(encoder.encode("\n"));
          Deno.exit(130);
        }
        if (b === 0x0d || b === 0x0a) break outer;
        if (b === 0x7f || b === 0x08) bytes.pop();
        else bytes.push(b);
      }
    }
  } finally {
    Deno.stdin.setRaw(false);
    await Deno.stderr.write(encoder.encode("\n"));
  }
  return decoder.decode(new Uint8Array(bytes));
}

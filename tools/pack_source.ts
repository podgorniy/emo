// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The source of this exact build as `client/dist/source.tar.gz` (AGPL §13):
 * the binary embeds it with the client and serves it at `/source.tar.gz`,
 * where `SOURCE_URL` points unless set (ops.md §2.4). It carries what builds
 * and tests the app, from an allowlist: never `.env`, data, build output or
 * local notes. The tar is written here (ustar, sorted, owner `emo`), so
 * macOS and Linux give the same layout and no local user name leaks.
 *
 *   deno run -A tools/pack_source.ts [out]
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files at the repository root that belong to the source */
const ROOT_FILES = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  ".tool-versions",
  "CHANGELOG.md",
  "Caddyfile",
  "Dockerfile",
  "LICENSE",
  "Makefile",
  "README.md",
  "VERSION",
  "compose.yml",
  "deno.json",
  "deno.lock",
  "package.json",
];
/** Directories taken whole, minus `SKIP` */
const DIRS = [
  ".github",
  "client",
  "e2e",
  "llm",
  "perf",
  "server",
  "shared",
  "tools",
];
/** Never packed, at any depth: dependencies, build output, reports */
const SKIP = new Set(["node_modules", "dist", "report", ".vite", ".DS_Store"]);

/** Repository-relative paths of the source, sorted; missing entries skipped. */
export function sourceFiles(root = ROOT): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of Deno.readDirSync(path.join(root, rel))) {
      if (SKIP.has(entry.name) || /\.sqlite/.test(entry.name)) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory) walk(child);
      else if (entry.isFile) out.push(child);
    }
  };
  for (const name of ROOT_FILES) {
    try {
      if (Deno.statSync(path.join(root, name)).isFile) out.push(name);
    } catch { /* not in this checkout (e.g. a Docker build context) */ }
  }
  for (const dir of DIRS) {
    try {
      if (Deno.statSync(path.join(root, dir)).isDirectory) walk(dir);
    } catch { /* idem */ }
  }
  return out.sort();
}

const encoder = new TextEncoder();

/** A 512-byte ustar header; `name` longer than 100 bytes uses the prefix. */
function header(name: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (text: string, at: number, len: number) => {
    const bytes = encoder.encode(text);
    if (bytes.length > len) throw new Error(`Too long for tar: ${text}`);
    h.set(bytes, at);
  };
  const octal = (n: number, at: number, len: number) =>
    put(n.toString(8).padStart(len - 1, "0") + "\0", at, len);

  let prefix = "";
  let base = name;
  if (encoder.encode(name).length > 100) {
    const cut = name.lastIndexOf("/", name.length - 1);
    const fits = (i: number) =>
      i > 0 && encoder.encode(name.slice(0, i)).length <= 155 &&
      encoder.encode(name.slice(i + 1)).length <= 100;
    let i = cut;
    while (i > 0 && !fits(i)) i = name.lastIndexOf("/", i - 1);
    if (i <= 0) throw new Error(`Path too long for ustar: ${name}`);
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
  }
  put(base, 0, 100);
  octal(0o644, 100, 8);
  octal(0, 108, 8); // uid
  octal(0, 116, 8); // gid
  octal(size, 124, 12);
  octal(mtime, 136, 12);
  put("        ", 148, 8); // checksum placeholder: spaces
  put("0", 156, 1); // regular file
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put("emo", 265, 32);
  put("emo", 297, 32);
  put(prefix, 345, 155);
  const sum = h.reduce((a, b) => a + b, 0);
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/** The gzipped tar of `files` under `<top>/`. */
export async function packSource(
  root = ROOT,
  top = `emo-${Deno.readTextFileSync(path.join(root, "VERSION")).trim()}`,
  files = sourceFiles(root),
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const rel of files) {
    const full = path.join(root, rel);
    const data = Deno.readFileSync(full);
    const mtime = Math.floor(
      (Deno.statSync(full).mtime?.getTime() ?? 0) / 1000,
    );
    parts.push(header(`${top}/${rel}`, data.length, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024)); // end of archive: two empty blocks
  const tar = new Blob(parts as BlobPart[]);
  const gz = tar.stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(gz).arrayBuffer());
}

if (import.meta.main) {
  const out = path.resolve(
    Deno.args[0] ?? path.join(ROOT, "client/dist/source.tar.gz"),
  );
  const files = sourceFiles();
  const archive = await packSource(ROOT, undefined, files);
  await Deno.mkdir(path.dirname(out), { recursive: true });
  await Deno.writeFile(out, archive);
  console.log(
    `${path.relative(ROOT, out)}: ${files.length} files, ${
      (archive.length / 1024).toFixed(0)
    } KB`,
  );
}

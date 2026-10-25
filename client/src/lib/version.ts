// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The app version: the repository's `VERSION` file, injected by Vite at build
 * time (`vite.config.ts` → `__EMO_VERSION__`); under `deno test`, read from
 * the file. Specification: development.md §7.1.
 */

declare const __EMO_VERSION__: string | undefined;

function readVersionFile(): string {
  const deno = (globalThis as {
    Deno?: { readTextFileSync(path: URL): string };
  }).Deno;
  return deno
    ? deno.readTextFileSync(new URL("../../../VERSION", import.meta.url)).trim()
    : "0.0.0";
}

export const CLIENT_VERSION: string = typeof __EMO_VERSION__ === "string"
  ? __EMO_VERSION__
  : readVersionFile();

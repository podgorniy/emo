// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where the built client is: `client/dist` under the working directory
 * (`make dev`), else next to the code (the compiled binary embeds it).
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The source archive of this build (tools/pack_source.ts, AGPL §13). */
export const SOURCE_ARCHIVE = "source.tar.gz";

export function distDir(): string {
  const candidates = [
    path.resolve(Deno.cwd(), "client/dist"),
    path.resolve(
      path.dirname(path.dirname(fileURLToPath(import.meta.url))),
      "client/dist",
    ),
  ];
  for (const c of candidates) {
    try {
      if (Deno.statSync(c).isDirectory) return c;
    } catch {
      // Continue
    }
  }
  return candidates[0];
}

/** True when this build carries its own source archive. */
export function hasSourceArchive(dir = distDir()): boolean {
  try {
    return Deno.statSync(path.join(dir, SOURCE_ARCHIVE)).isFile;
  } catch {
    return false;
  }
}

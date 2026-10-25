// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The server version: the repository's `VERSION` file, embedded in the binary
 * by `deno compile` through the module graph. Specification: development.md §7.1.
 */

import versionText from "../VERSION" with { type: "text" };
import { parseSemver, type Semver } from "../shared/version.ts";

export const SERVER_VERSION: string = versionText.trim();

export const SERVER_SEMVER: Semver = (() => {
  const parsed = parseSemver(SERVER_VERSION);
  if (!parsed) throw new Error(`VERSION is not semver: ${SERVER_VERSION}`);
  return parsed;
})();

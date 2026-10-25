// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client/server compatibility window. The server answers a client outside it
 * with `426 upgrade_required`; a client that sees an older server pauses sync.
 * Specification: reliability.md §3 (old client vs new server, new client vs
 * old server), api.md §1.
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(text: string): Semver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

/** Client major ≠ server major, or client minor < server minor − 1. */
export function clientTooOld(client: Semver, server: Semver): boolean {
  return client.major !== server.major || client.minor < server.minor - 1;
}

/** Server minor < client minor − 1 (same major). */
export function serverTooOld(server: Semver, client: Semver): boolean {
  return server.major === client.major && server.minor < client.minor - 1;
}

/** The oldest client a server accepts, as `major.minor`. */
export function minClientFor(server: Semver): string {
  return `${server.major}.${Math.max(0, server.minor - 1)}`;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The client address for per-IP rate limits (api.md §1.3). The
 * socket peer is the client, unless the peer is a trusted proxy: then
 * `X-Forwarded-For` is read from the right, skipping trusted hops, so a
 * client cannot pick its own bucket by sending the header itself.
 *
 * `TRUSTED_PROXIES` (ops.md §2.4) lists exact addresses and the keywords
 * `private` (loopback, RFC 1918, link-local, IPv6 ULA: the default, which fits
 * the shipped `compose.yml` where emo listens on 127.0.0.1 behind a proxy) and
 * `none`.
 */

export type TrustCheck = (ip: string) => boolean;

/** IPv4 octets of a dotted or IPv4-mapped IPv6 address; null otherwise. */
function ipv4(ip: string): number[] | null {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(
    ip,
  );
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4(ip);
  if (v4) {
    const [a, b] = v4;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(v6) ||
    /^fe[89ab][0-9a-f]?:/.test(v6);
}

/** Whether `value` is an IPv4 or IPv6 address (a loose shape check). */
export function isIpAddress(value: string): boolean {
  return ipv4(value) !== null ||
    (/^[0-9a-f:.]+$/i.test(value) && value.includes(":"));
}

/** Problems with a `TRUSTED_PROXIES` value; empty = valid. */
export function trustedProxiesProblems(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter((s) =>
    s && s !== "private" && s !== "none" && !isIpAddress(s)
  ).map((s) =>
    `TRUSTED_PROXIES: "${s}" is not an IP address, "private" or "none"`
  );
}

export function parseTrustedProxies(value: string): TrustCheck {
  const entries = value.split(",").map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const exact = new Set(entries.filter((e) => e !== "private" && e !== "none"));
  const privateToo = entries.includes("private");
  return (ip) =>
    exact.has(ip.toLowerCase()) || (privateToo && isPrivateAddress(ip));
}

/**
 * The address to rate-limit by. `peer` is the socket's remote address
 * (undefined when there is no socket, as in tests: one shared bucket).
 */
export function clientIp(
  peer: string | undefined,
  forwardedFor: string | undefined,
  trusted: TrustCheck,
): string {
  if (!peer) return "unknown";
  if (!forwardedFor || !trusted(peer)) return peer;
  const hops = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!trusted(hops[i])) return hops[i];
  }
  return hops[0] ?? peer;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Structured JSON-lines logger: one object per line to stdout, with fields
 * that may carry secrets dropped and secret-shaped strings redacted before
 * the sink sees them.
 * Specification: ops.md §5.1–§5.2, reliability.md §1.7.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Field names whose values never reach the sink, whatever they hold. */
const SECRET_FIELDS = new Set([
  "email",
  "code",
  "passphrase",
  "password",
  "token",
  "recovery_key",
  "key",
  "auth",
  "auth_key",
  "x-emo-auth",
  "cookie",
  "authorization",
  "body",
  "payload",
  "ciphertext",
  "nonce",
  "invite",
  "invite_code",
]);

const EMAIL_RE = /[^\s@"'<>,;:()[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// A recovery key: 8 groups of 4 Crockford characters, with or without dashes
const RECOVERY_KEY_RE =
  /\b[0-9A-HJKMNP-TV-Z]{4}(?:-?[0-9A-HJKMNP-TV-Z]{4}){7}\b/gi;

let sink: (line: string) => void = (line) => console.log(line);
let minLevel: number = LEVELS[parseLevel(Deno.env.get("LOG_LEVEL"))];

function parseLevel(value: string | undefined): LogLevel {
  return value && value in LEVELS ? value as LogLevel : "info";
}

/** Replaces the sink and level (tests); returns a function that restores them. */
export function setLogSink(
  next: (line: string) => void,
  level: LogLevel = "debug",
): () => void {
  const prev = { sink, minLevel };
  sink = next;
  minLevel = LEVELS[level];
  return () => {
    sink = prev.sink;
    minLevel = prev.minLevel;
  };
}

export function redactString(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(RECOVERY_KEY_RE, "[key]");
}

function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return redactString(`${value.name}: ${value.message}`);
  }
  if (value === null || typeof value !== "object" || depth > 3) return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: LogFields = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELDS.has(k.toLowerCase())) continue;
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

export function log(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVELS[level] < minLevel) return;
  const record: LogFields = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? sanitize(fields) as LogFields : {}),
  };
  if (
    level === "debug" && fields?.err instanceof Error && fields.err.stack
  ) {
    record.stack = redactString(fields.err.stack);
  }
  sink(JSON.stringify(record));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => log("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => log("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => log("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => log("error", msg, fields),
};

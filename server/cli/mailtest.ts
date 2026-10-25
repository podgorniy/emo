// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `emo mail-test <address>` (ops.md §2.5): whether mail leaves from where the
 * server runs, answered on the spot. A sign-in request cannot tell: the server
 * answers 202 before it sends, and sends nothing to an address without an
 * account or invite. First a bare TCP connection to SMTP_HOST:SMTP_PORT, so a
 * firewall that drops it is told apart from what the mail server answers; then
 * the real sign-in mail, with a sample code that signs nobody in, through the
 * server's own transport.
 */

import type { Config } from "../config.ts";
import {
  createSmtpTransport,
  MailService,
  type MailTransport,
  SMTP_TIMEOUT_MS,
} from "../services/mail.ts";

/** The code in the sample mail, as in the smoke test's dry run */
export const SAMPLE_CODE = "123456";

export interface MailTestResult {
  ok: boolean;
  lines: string[];
}

/** null once a TCP connection opens, else why not. */
async function reach(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(
      () => resolve(`no answer within ${timeoutMs / 1000} s`),
      timeoutMs,
    );
  });
  const attempt = Deno.connect({ hostname: host, port }).then(
    (conn) => {
      conn.close();
      return null;
    },
    (err) => (err instanceof Error ? err.message : String(err)),
  );
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function mailTest(
  config: Config,
  to: string,
  timeoutMs = SMTP_TIMEOUT_MS,
  transport: MailTransport = createSmtpTransport(config, timeoutMs),
): Promise<MailTestResult> {
  if (!config.smtpHost) {
    return { ok: false, lines: ["[emo] SMTP_HOST is not set in .env"] };
  }
  const where = `${config.smtpHost}:${config.smtpPort}`;
  const unreachable = await reach(config.smtpHost, config.smtpPort, timeoutMs);
  if (unreachable) {
    return {
      ok: false,
      lines: [
        `[emo] Cannot reach ${where}: ${unreachable}.`,
        "[emo] The connection never opens: a firewall drops it (ufw on the host, often its routed rules for containers, or the provider's), or the provider blocks the port outbound; many block 25 and 465, 587 and 2525 usually pass.",
      ],
    };
  }
  const mail = new MailService(config, null).renderLoginCodeMail(
    SAMPLE_CODE,
    config.defaultLocale,
  );
  try {
    await transport({ to, subject: mail.subject, text: mail.text });
  } catch (err) {
    return {
      ok: false,
      lines: [
        `[emo] Reached ${where}, but it did not take the message: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "[emo] Check SMTP_USER, SMTP_PASS and SMTP_SECURE, and that SMTP_FROM is on the domain the provider sends for.",
      ],
    };
  }
  return {
    ok: true,
    lines: [
      `[emo] ${where} accepted a sample sign-in mail for ${to} (its code, ${SAMPLE_CODE}, signs nobody in).`,
      "[emo] Not in the inbox within a minute: look in spam, and in the provider's sending log (ops.md §2.5).",
    ],
  };
}

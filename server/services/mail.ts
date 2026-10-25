// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Email service for login codes and recovery keys.
 * SMTP via nodemailer (architecture.md §3.1), 10 s timeout, and a circuit breaker
 * that stays open for 5 minutes after a failure (api.md §2.1,
 * reliability.md §1.7). Message bodies are never retained: the server forgets
 * a recovery key as soon as the mail is handed to SMTP (architecture.md §5.6).
 */

// @ts-types="@types/nodemailer"
import nodemailer from "nodemailer";
import type { Config } from "../config.ts";
import type { Locale } from "../../shared/protocol.ts";
import { logger } from "../log.ts";
import {
  loginCodeMail,
  type MailText,
  recoveryKeyMail,
} from "../../shared/i18n/mail.ts";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** Delivers one message; resolves when SMTP accepted it, throws otherwise. */
export type MailTransport = (mail: OutgoingMail) => Promise<void>;

export type MailStatus = "ok" | "circuit_open" | "unconfigured";

export const SMTP_TIMEOUT_MS = 10_000;

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

/**
 * SMTP transport; every stage (connect, greeting, socket, whole send) is capped.
 * Login codes and credentials never travel in clear: without implicit TLS,
 * STARTTLS is required, except to a mail catcher on this machine.
 */
export function createSmtpTransport(
  config: Pick<
    Config,
    | "smtpHost"
    | "smtpPort"
    | "smtpSecure"
    | "smtpUser"
    | "smtpPass"
    | "smtpFrom"
  >,
  timeoutMs = SMTP_TIMEOUT_MS,
): MailTransport {
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure, // true for 465; otherwise STARTTLS
    requireTLS: !config.smtpSecure && !isLoopback(config.smtpHost),
    auth: config.smtpUser
      ? { user: config.smtpUser, pass: config.smtpPass ?? "" }
      : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
  return async (mail) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("SMTP send timed out")),
        timeoutMs,
      );
    });
    try {
      await Promise.race([
        transporter.sendMail({ from: config.smtpFrom, ...mail }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** DEV_MODE only: prints mail to stderr so `make dev` can sign in. */
function createDevConsoleTransport(): MailTransport {
  return (mail) => {
    console.error(
      `[emo dev mail — DEV_MODE only, never in production]\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`,
    );
    return Promise.resolve();
  };
}

/**
 * Where mail goes. Under `DEV_MODE` it is printed to stderr even when SMTP is
 * configured, so a local sign-in never reaches a real inbox; `DEV_MAIL=smtp`
 * sends it through SMTP_HOST instead.
 */
export function mailMode(config: Config): "smtp" | "stderr" | "off" {
  if (config.devMode && !(config.devMailSmtp && config.smtpHost)) {
    return "stderr";
  }
  return config.smtpHost ? "smtp" : "off";
}

/** The transport the configuration asks for, or null when mail is unconfigured. */
export function transportFromConfig(config: Config): MailTransport | null {
  const mode = mailMode(config);
  if (mode === "smtp") return createSmtpTransport(config);
  if (mode === "stderr") return createDevConsoleTransport();
  return null;
}

export class MailService {
  private lastFailureTime = 0;
  private circuitDurationMs = 5 * 60 * 1000; // 5 minutes
  private transport: MailTransport | null;
  private baseUrl: string;

  constructor(
    config: Config,
    transport: MailTransport | null = transportFromConfig(config),
  ) {
    this.transport = transport;
    this.baseUrl = config.baseUrl ?? "";
  }

  /** For `/healthz` (api.md §2.10). */
  status(): MailStatus {
    if (!this.transport) return "unconfigured";
    return this.isCircuitOpen().open ? "circuit_open" : "ok";
  }

  isCircuitOpen(): { open: boolean; retryAfterSec?: number } {
    if (this.lastFailureTime === 0) {
      return { open: false };
    }
    const elapsed = Date.now() - this.lastFailureTime;
    if (elapsed < this.circuitDurationMs) {
      const retryAfterSec = Math.ceil(
        (this.circuitDurationMs - elapsed) / 1000,
      );
      return { open: true, retryAfterSec };
    }
    return { open: false };
  }

  /** Feeds `ops_counters` (ops.md §5.4); set by `createApp`. */
  onCounter: ((name: "mail_failed" | "mail_circuit_open") => void) | null =
    null;

  recordFailure() {
    const wasOpen = this.isCircuitOpen().open;
    this.lastFailureTime = Date.now();
    this.onCounter?.("mail_failed");
    if (!wasOpen) this.onCounter?.("mail_circuit_open");
  }

  recordSuccess() {
    this.lastFailureTime = 0;
  }

  /** The hostname only (copy.md §2.1: no URL in the mail). */
  private instance(): string {
    try {
      return new URL(this.baseUrl).hostname;
    } catch {
      return "";
    }
  }

  renderLoginCodeMail(code: string, locale: Locale): MailText {
    return loginCodeMail(locale, code, this.instance());
  }

  renderRecoveryKeyMail(
    key: string,
    locale: Locale,
    renewed = false,
  ): MailText {
    return recoveryKeyMail(locale, key, this.instance(), renewed);
  }

  /**
   * Sends one message. Returns false (and opens the circuit) on any failure,
   * including "unconfigured". Nothing about the message is kept afterwards.
   */
  async sendMail(to: string, subject: string, text: string): Promise<boolean> {
    if (this.isCircuitOpen().open) {
      return false;
    }
    if (!this.transport) {
      logger.error("mail_failed", {
        err: "SMTP is not configured (SMTP_HOST)",
      });
      this.recordFailure();
      return false;
    }
    try {
      await this.transport({ to, subject, text });
      this.recordSuccess();
      return true;
    } catch (err) {
      logger.error("mail_failed", { err });
      this.recordFailure();
      return false;
    }
  }
}

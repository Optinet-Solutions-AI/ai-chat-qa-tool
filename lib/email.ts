import nodemailer, { type Transporter } from 'nodemailer';

// Server-only — never import from client components.
// Sends through SMTP (Microsoft 365 / Office 365 in production) using the
// VIP@roosterpartners.com mailbox. The transporter is cached at module scope
// so we don't open a new TCP connection per send. Env vars consumed:
//
//   SMTP_HOST  — typically `smtp.office365.com`
//   SMTP_PORT  — typically 587 (STARTTLS); we don't support implicit TLS (465)
//   SMTP_USER  — full mailbox address (`VIP@roosterpartners.com`)
//   SMTP_PASS  — mailbox password, OR an app password if MFA is enabled
//   DAILY_SNAPSHOT_FROM — optional override; defaults to SMTP_USER. Can carry
//                         a display name in standard RFC 5322 form, e.g.
//                         `"Roosterpartners QA" <VIP@roosterpartners.com>`.
//
// Microsoft 365 prerequisites that aren't visible from the code:
//   1. The mailbox must have "Authenticated SMTP" enabled (admin centre →
//      mail flow → authentication policies, or per-user). Newer tenants ship
//      this disabled by default.
//   2. If MFA is enforced on the account, the password above must be an app
//      password generated under the user's security settings — the regular
//      password will fail with `5.7.139 Authentication unsuccessful, basic
//      authentication is disabled`.

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASS must be set');
  }
  const port = portRaw ? parseInt(portRaw, 10) : 587;
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    // 587 uses STARTTLS, which is opportunistic — `secure:false` keeps the
    // initial socket plaintext and lets the server upgrade it via STARTTLS.
    // Setting secure:true here would attempt implicit TLS (port 465 style)
    // and fail against M365's STARTTLS-only listener.
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    // M365 requires TLS 1.2+; without this nodemailer's defaults can fall
    // through to TLS 1.0 on some older Node runtimes and the handshake fails.
    tls: { minVersion: 'TLSv1.2' },
  });
  return cachedTransporter;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const from = msg.from
    ?? process.env.DAILY_SNAPSHOT_FROM
    ?? process.env.SMTP_USER!;
  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  if (to.length === 0) throw new Error('sendEmail: recipient list is empty');

  const info = await getTransporter().sendMail({
    from,
    to,
    subject: msg.subject,
    html: msg.html,
  });
  // info.messageId is the RFC-2822 Message-ID, e.g. `<abc@host>` — useful as
  // a tracing handle in logs even though we don't surface it to recipients.
  return { id: info.messageId };
}

// Parses a comma-separated env var (DAILY_SNAPSHOT_RECIPIENTS) into a clean
// recipient list. Trims whitespace and drops empty entries; returns [] when
// the env var is unset so callers can decide whether that's a hard error.
export function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

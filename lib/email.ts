import { Resend } from 'resend';

// Server-only — never import from client components.
// Resend SDK reads RESEND_API_KEY at send time; we lazily construct the client
// so build-time imports without the env var present don't blow up.

let cachedClient: Resend | null = null;
function getClient(): Resend {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  // Falls back to DAILY_SNAPSHOT_FROM, then to Resend's shared sender — used for
  // initial QA before a verified domain is wired up. Switch to qa@<verified
  // domain> once DNS is live; no code change needed, just the env var.
  from?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const from = msg.from
    ?? process.env.DAILY_SNAPSHOT_FROM
    ?? 'onboarding@resend.dev';
  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  if (to.length === 0) throw new Error('sendEmail: recipient list is empty');

  const result = await getClient().emails.send({
    from,
    to,
    subject: msg.subject,
    html: msg.html,
  });
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message}`);
  }
  return { id: result.data?.id ?? '' };
}

// Parses a comma-separated env var (DAILY_SNAPSHOT_RECIPIENTS) into a clean
// recipient list. Trims whitespace and drops empty entries; returns [] when
// the env var is unset so callers can decide whether that's a hard error.
export function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

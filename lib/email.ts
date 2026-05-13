// Server-only — never import from client components.
//
// Sends through Microsoft Graph API on the Roosterpartners tenant, using
// OAuth 2.0 client-credentials flow. The Entra app registration is granted
// `Mail.Send` Application permission scoped to the VIP@roosterpartners.com
// mailbox via RBAC for Applications, so the app can only send AS that one
// user — not as any other tenant user.
//
// Env vars consumed:
//   GRAPH_TENANT_ID     — Microsoft Entra tenant GUID
//   GRAPH_CLIENT_ID     — Application (client) ID of the Entra app
//   GRAPH_CLIENT_SECRET — Client secret value (NOT the secret ID)
//   GRAPH_SENDER        — Mailbox UPN we're sending as
//                         (e.g. `VIP@roosterpartners.com`)
//   DAILY_SNAPSHOT_FROM — Optional override for the visible From: header. RFC
//                         5322 form is preferred so the recipient sees a
//                         friendly display name, e.g.
//                         `"Roosterpartners QA" <VIP@roosterpartners.com>`
//                         The address inside <> must match GRAPH_SENDER
//                         (Graph enforces this — sending "as" requires
//                         delegated SendAs permission which we haven't set up).
//
// Token caching: client_credentials tokens are valid for ~1h. We cache the
// token in module scope and refresh ~5 min before expiry so back-to-back
// sends don't hit /oauth2/v2.0/token every time.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_SAFETY_MARGIN_MS > now) {
    return cachedToken.token;
  }
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET must be set');
  }
  // Per Microsoft docs, the scope for client-credentials flow against Graph
  // is always `https://graph.microsoft.com/.default` — the actual API
  // permissions (Mail.Send) are pre-granted on the app registration, so the
  // token gets them automatically rather than requesting per-call scopes.
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth token request failed (${res.status}): ${errText}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    // expires_in is in seconds; convert to ms and offset from now.
    expiresAt: now + json.expires_in * 1000,
  };
  return json.access_token;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  // Optional override; defaults to DAILY_SNAPSHOT_FROM (display+addr) or
  // GRAPH_SENDER (bare address). Whatever you set here, the email address
  // portion must match GRAPH_SENDER — Graph enforces that the sending user
  // ID in the URL matches the from-address unless SendAs is granted, which
  // we have not configured.
  from?: string;
}

// Splits "Display Name" <addr@x.com> into its parts. Falls through to
// { email: trimmed } for a bare email address. Quotes around the display
// name are stripped; whitespace between display name and `<` is tolerated.
function parseFromHeader(input: string): { name?: string; email: string } {
  const trimmed = input.trim();
  const m = trimmed.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (m) {
    const name = m[1].trim();
    return { name: name || undefined, email: m[2].trim() };
  }
  return { email: trimmed };
}

export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const rawFrom = msg.from
    ?? process.env.DAILY_SNAPSHOT_FROM
    ?? process.env.GRAPH_SENDER;
  if (!rawFrom) {
    throw new Error('GRAPH_SENDER or DAILY_SNAPSHOT_FROM must be set');
  }
  const from = parseFromHeader(rawFrom);
  // The mailbox UPN we authenticate as / send through. If DAILY_SNAPSHOT_FROM
  // is just a display-name override, GRAPH_SENDER is the authoritative
  // mailbox identifier.
  const senderUpn = process.env.GRAPH_SENDER ?? from.email;

  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  if (to.length === 0) throw new Error('sendEmail: recipient list is empty');
  const toRecipients = to.map((addr) => ({ emailAddress: { address: addr } }));

  const payload = {
    message: {
      subject: msg.subject,
      body: { contentType: 'HTML', content: msg.html },
      toRecipients,
      // Graph honours `from.emailAddress.name` for the display name in the
      // recipient's inbox. The address must match the authenticated mailbox
      // (see comment on EmailMessage.from above).
      from: {
        emailAddress: {
          ...(from.name ? { name: from.name } : {}),
          address: from.email,
        },
      },
    },
    // Drops a copy into the VIP mailbox's Sent Items so the Roosterpartners
    // team can audit "did the daily snapshot actually go out?" by reading
    // that folder. Set false later if it clutters the mailbox.
    saveToSentItems: true,
  };

  const token = await getAccessToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(senderUpn)}/sendMail`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${errText}`);
  }
  // sendMail returns 202 Accepted with no body; Graph does not surface a
  // message-id back to the caller (you'd need the create-draft → send flow
  // for that). Returning a sentinel keeps the EmailMessage contract intact
  // for callers that log the id.
  return { id: '202-accepted' };
}

// Parses a comma-separated env var (DAILY_SNAPSHOT_RECIPIENTS) into a clean
// recipient list. Trims whitespace and drops empty entries; returns [] when
// the env var is unset so callers can decide whether that's a hard error.
export function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

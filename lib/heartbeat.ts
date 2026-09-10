// Dead-man's-switch heartbeat for the cron routes.
//
// An external monitor (healthchecks.io) is configured with the cron's period
// plus a grace window; this pings it after each run. The monitor alerts on the
// ABSENCE of a success ping, which is what makes it useful: it catches the
// failures the app cannot report about itself — Vercel cron disabled, a broken
// deploy, the function being killed mid-run, plan limits — not just the errors
// it manages to throw. That gap is what let the Telegram bot outage go
// unnoticed for as long as it did.
//
// CONTRACT: this must never throw and never meaningfully delay a cron. A
// monitoring outage must not become a pipeline outage, so every failure path
// (unset env var, malformed URL, DNS failure, non-2xx, timeout) is swallowed
// silently and the caller carries on. Callers do not need to guard the call.

// Kept well under the cron routes' maxDuration so a hanging monitor can never
// push a run past its limit.
const PING_TIMEOUT_MS = 3000;

/**
 * Notify the external monitor about a cron run.
 *
 * `success` records a healthy run. `fail` reports an explicit failure, which
 * alerts immediately instead of waiting out the grace window.
 *
 * No-ops when HEALTHCHECK_PING_URL is unset, so local dev and preview
 * deployments stay silent without any extra configuration.
 */
export async function pingHeartbeat(outcome: 'success' | 'fail' = 'success'): Promise<void> {
  const base = process.env.HEALTHCHECK_PING_URL;
  if (!base) return;

  const url = outcome === 'fail' ? `${base.replace(/\/+$/, '')}/fail` : base;

  try {
    // POST rather than GET so no proxy or platform layer can serve a cached
    // response and make a dead pipeline look alive.
    await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
  } catch {
    // Swallowed deliberately — see CONTRACT above.
  }
}

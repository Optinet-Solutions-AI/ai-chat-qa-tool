'use client';

import { useEffect, useState } from 'react';

interface AsanaMetrics {
  configured: boolean;
  projectGid: string | null;
  totalTickets: number;
  error?: string;
}

export default function AsanaDashboardPage() {
  const [data, setData] = useState<AsanaMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/asana')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Asana Tickets</h1>
      <p className="text-sm text-slate-500 mb-6">
        Severity-3 conversations are auto-pushed to Asana as action items for
        the account managers. This page will grow with per-AM and resolution
        metrics once tickets start flowing.
      </p>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : !data ? (
        <div className="text-slate-400 text-sm">No data.</div>
      ) : !data.configured ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Asana isn&apos;t configured yet. Set <code>ASANA_ACCESS_TOKEN</code>{' '}
          and <code>ASANA_PROJECT_GID</code> in env to start pushing tickets.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Tickets created
              </div>
              <div className="text-3xl font-semibold mt-1">{data.totalTickets}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Project
              </div>
              <div className="text-sm mt-1 font-mono break-all">
                {data.projectGid ?? '—'}
              </div>
            </div>
          </div>

          {data.projectGid && (
            <a
              href={`https://app.asana.com/0/${data.projectGid}/board`}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-blue-600 hover:underline"
            >
              Open project board in Asana →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

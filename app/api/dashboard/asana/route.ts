import { NextResponse } from 'next/server';
import { dbGetAsanaReportingMetrics } from '@/lib/db';
import { isAsanaConfigured } from '@/lib/asana';

// Reporting metrics for the AM action-items dashboard. Pivots are done in JS
// against the conversations table — see dbGetAsanaReportingMetrics for the
// exact shape.
export async function GET() {
  try {
    const metrics = await dbGetAsanaReportingMetrics();
    return NextResponse.json({
      configured: isAsanaConfigured(),
      projectGid: process.env.ASANA_PROJECT_GID ?? null,
      ...metrics,
    });
  } catch (e) {
    return NextResponse.json(
      {
        configured: isAsanaConfigured(),
        projectGid: process.env.ASANA_PROJECT_GID ?? null,
        totalTickets: 0,
        openTickets: 0,
        closedTickets: 0,
        ticketsByAm: [],
        ticketsBySeverity: [],
        ticketsByCategory: [],
        ticketsByDate: [],
        lastSyncedAt: null,
        error: (e as Error).message,
      },
      { status: 500 },
    );
  }
}

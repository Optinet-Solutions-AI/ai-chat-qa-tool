import { NextResponse } from 'next/server';
import { dbCountAsanaTickets } from '@/lib/db';
import { isAsanaConfigured } from '@/lib/asana';

// Stub metrics endpoint for the Asana reporting page. Will grow as we decide
// what's worth showing once tickets are flowing — for now just exposes whether
// the integration is wired up and how many tickets have been created.
export async function GET() {
  try {
    const totalTickets = await dbCountAsanaTickets();
    return NextResponse.json({
      configured: isAsanaConfigured(),
      projectGid: process.env.ASANA_PROJECT_GID ?? null,
      totalTickets,
    });
  } catch (e) {
    return NextResponse.json(
      { configured: isAsanaConfigured(), totalTickets: 0, error: (e as Error).message },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadAnalysisRuns, loadAnalysisRun } from '@/lib/db';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');

  if (id) {
    const run = await loadAnalysisRun(id);
    if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(run);
  }

  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '0', 10);
  const perPage = parseInt(req.nextUrl.searchParams.get('perPage') ?? '25', 10);

  try {
    const result = await loadAnalysisRuns(page, perPage);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

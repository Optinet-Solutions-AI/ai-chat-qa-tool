import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const maxDuration = 60;

// GET /api/admin/inspect-batch?id=batch_XXX
// Pulls the full OpenAI batch object + error_file (if any) so we can see why
// historical "failed" batches died with error_message=null on our side.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const headers = { Authorization: `Bearer ${apiKey}` };

  const batchRes = await fetch(`https://api.openai.com/v1/batches/${id}`, { headers });
  if (!batchRes.ok) {
    const body = await batchRes.text();
    return NextResponse.json({ error: `OpenAI ${batchRes.status}: ${body}` }, { status: 500 });
  }
  const batch = await batchRes.json();

  let errorFileSample: string | null = null;
  if (batch.error_file_id) {
    try {
      const efRes = await fetch(`https://api.openai.com/v1/files/${batch.error_file_id}/content`, { headers });
      if (efRes.ok) {
        const text = await efRes.text();
        errorFileSample = text.split('\n').filter((l) => l.trim()).slice(0, 5).join('\n');
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    id: batch.id,
    status: batch.status,
    request_counts: batch.request_counts,
    errors: batch.errors,
    error_file_id: batch.error_file_id,
    output_file_id: batch.output_file_id,
    failed_at: batch.failed_at,
    expired_at: batch.expired_at,
    completed_at: batch.completed_at,
    error_file_sample: errorFileSample,
  });
}

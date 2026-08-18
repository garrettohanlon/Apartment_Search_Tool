/**
 * GET  /api/inventory   the current dataset, sanitized
 * POST /api/inventory   ingest a new dataset from the local agent
 *
 * POST is guarded by a shared secret in the INGEST_SECRET env var. Without it set,
 * ingest is refused outright rather than left open, because an unauthenticated
 * write endpoint on a public deployment would let anyone replace the inventory.
 */
import { NextResponse } from 'next/server';
import { getInventory, putInventory } from '@/lib/inventory';
import type { Dataset } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const { data, source } = await getInventory();
  if (!data) {
    return NextResponse.json(
      { error: 'No dataset available. Configure a Vercel Blob store and POST a run, or set INVENTORY_URL.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store', 'X-Inventory-Source': source },
  });
}

export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Ingest is disabled because INGEST_SECRET is not configured on this deployment.' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // Constant-time-ish compare. Lengths differing is itself a mismatch.
  if (token.length !== secret.length || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Dataset;
  try {
    body = (await req.json()) as Dataset;
  } catch {
    return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body?.listings) || !Array.isArray(body?.buildings)) {
    return NextResponse.json(
      { error: 'Expected an object with `listings` and `buildings` arrays' },
      { status: 422 },
    );
  }

  const res = await putInventory(body);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}

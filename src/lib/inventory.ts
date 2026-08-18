/**
 * Where the deployed UI gets its dataset.
 *
 * The agent runs on a local machine on a schedule; Vercel has no filesystem to
 * write to and no credentials to search with. So the dataset has to arrive over
 * the wire. Resolution order, first hit wins:
 *
 *   1. Vercel Blob, if BLOB_READ_WRITE_TOKEN is configured. This is what
 *      `POST /api/inventory` writes to, so a new run appears without a redeploy.
 *   2. INVENTORY_URL, any publicly readable JSON URL (a gist, an S3 object).
 *   3. public/demo-inventory.json, committed, clearly labelled as demo.
 *
 * Nothing personal is ever published. `sanitize` strips the search-criteria block
 * before anything is stored or served, because that is where income lives.
 */
import type { Dataset } from './types';

const BLOB_KEY = 'inventory-latest.json';

/** Remove anything that describes the tenant rather than the apartments. */
export function sanitize(d: Dataset): Dataset {
  const out = { ...d } as Dataset & { search_criteria?: unknown; qualifying?: unknown };
  delete out.search_criteria;
  delete out.qualifying;
  return out;
}

async function fromBlob(): Promise<Dataset | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: BLOB_KEY, limit: 1 });
    if (!blobs.length) return null;
    const r = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as Dataset;
  } catch {
    return null;
  }
}

async function fromUrl(): Promise<Dataset | null> {
  const url = process.env.INVENTORY_URL;
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as Dataset;
  } catch {
    return null;
  }
}

async function fromBundledDemo(): Promise<Dataset | null> {
  try {
    const mod = await import('../../public/demo-inventory.json');
    return (mod.default ?? mod) as unknown as Dataset;
  } catch {
    return null;
  }
}

export async function getInventory(): Promise<{ data: Dataset | null; source: string }> {
  const blob = await fromBlob();
  if (blob) return { data: normalize(blob), source: 'blob' };
  const url = await fromUrl();
  if (url) return { data: normalize(url), source: 'url' };
  const demo = await fromBundledDemo();
  if (demo) return { data: { ...normalize(demo), demo: true }, source: 'demo' };
  return { data: null, source: 'none' };
}

export async function putInventory(d: Dataset): Promise<{ ok: boolean; detail: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { ok: false, detail: 'BLOB_READ_WRITE_TOKEN is not set, so there is nowhere to store the dataset. Add a Vercel Blob store, or set INVENTORY_URL and host the JSON yourself.' };
  }
  try {
    const { put } = await import('@vercel/blob');
    await put(BLOB_KEY, JSON.stringify(sanitize(d)), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
    });
    return { ok: true, detail: `Stored ${d.listings?.length ?? 0} listing(s) and ${d.buildings?.length ?? 0} building profile(s).` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'blob write failed' };
  }
}

function normalize(d: Dataset): Dataset {
  return sanitize({ ...d, buildings: d.buildings ?? [], listings: d.listings ?? [] });
}

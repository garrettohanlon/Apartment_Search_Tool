/**
 * The scoring engine. Pure functions over a dataset plus the user's preferences,
 * so ranking recomputes synchronously on every keystroke or slider move with no
 * server round trip. This is the reason the agent supplies component sub-scores
 * rather than a pre-blended score.
 *
 * Two invariants, both load-bearing:
 *   1. Only a Required filter can exclude. Strong and Nice only cost points.
 *   2. Missing data is never a failure. Unknown size or unknown amenity routes to
 *      "unverified", never to exclusion, because roughly one listing in eight
 *      publishes a square footage and a hard filter would delete the large prewar
 *      and conversion units that are the whole point of the search.
 */
import type {
  Building, Components, Dataset, Importance, Listing, Scored, StabClass, ConfidenceLevel,
} from './types';
import { HOODS, HOOD_BY_ID, NORTH_LIMIT_LAT, WEST_SIDE_IDS, type Hood } from './geography';

/* ------------------------------------------------------------------ filters */
export type FilterType = 'num' | 'range' | 'bool' | 'enum' | 'date';

export interface FilterDef {
  k: string;
  label: string;
  group: string;
  type: FilterType;
  def: unknown;
  imp: Importance;
  primary?: boolean;
  min?: number;
  max?: number;
  step?: number;
  opts?: [string, string][];
  thresholds?: Record<string, number>;
}

export const FILTERS: FilterDef[] = [
  // --- the seven primary controls ---
  { k: 'rent', label: 'Max monthly rent', group: 'Price & size', type: 'range', def: [4500, 9000], imp: 'req', primary: true, min: 2000, max: 20000, step: 250 },
  { k: 'sf', label: 'Minimum size', group: 'Price & size', type: 'num', def: 1200, imp: 'strong', primary: true, min: 500, max: 3000, step: 50 },
  { k: 'beds', label: 'Bedrooms', group: 'Price & size', type: 'num', def: 2, imp: 'req', primary: true, min: 0, max: 5, step: 1 },
  { k: 'stab', label: 'Rent stabilized', group: 'Regulation & value', type: 'enum', def: 'preferred', imp: 'strong', primary: true,
    opts: [['only', 'Required'], ['preferred', 'Preferred'], ['irrelevant', "Doesn't matter"]] },
  { k: 'bq', label: 'Building quality', group: 'Building', type: 'enum', def: 'nice', imp: 'strong', primary: true,
    opts: [['luxury', 'Luxury'], ['nice', 'Nice'], ['any', 'Any']], thresholds: { luxury: 82, nice: 60, any: 0 } },
  { k: 'construction', label: 'Condition', group: 'Building', type: 'enum', def: 'reno', imp: 'strong', primary: true,
    opts: [['reno', 'New or renovated'], ['any', 'Any']] },
  { k: 'moveIn', label: 'Available by', group: 'Terms', type: 'date', def: '', imp: 'nice', primary: true },

  // --- everything else lives behind More Filters ---
  { k: 'baths', label: 'Bathrooms (min)', group: 'Price & size', type: 'num', def: 1, imp: 'nice', min: 0, max: 4, step: 0.5 },
  { k: 'valueMin', label: 'Min Value Score', group: 'Regulation & value', type: 'num', def: 0, imp: 'off', min: 0, max: 100, step: 5 },
  { k: 'discount', label: 'Min discount to market %', group: 'Regulation & value', type: 'num', def: 0, imp: 'off', min: 0, max: 40, step: 2 },
  { k: 'noFee', label: 'No broker fee', group: 'Regulation & value', type: 'bool', def: false, imp: 'nice' },

  { k: 'doorman', label: 'Doorman', group: 'Building', type: 'bool', def: true, imp: 'strong' },
  { k: 'concierge', label: 'Concierge', group: 'Building', type: 'bool', def: false, imp: 'nice' },
  { k: 'elevator', label: 'Elevator', group: 'Building', type: 'bool', def: true, imp: 'req' },
  { k: 'gym', label: 'Gym', group: 'Building', type: 'bool', def: false, imp: 'nice' },
  { k: 'roof_deck', label: 'Roof deck', group: 'Building', type: 'bool', def: false, imp: 'nice' },
  { k: 'package_room', label: 'Package room', group: 'Building', type: 'bool', def: false, imp: 'nice' },
  { k: 'parking', label: 'Parking', group: 'Building', type: 'bool', def: false, imp: 'off' },
  { k: 'pets', label: 'Pets allowed', group: 'Building', type: 'bool', def: false, imp: 'off' },

  { k: 'aq', label: 'Min apartment condition', group: 'Apartment', type: 'num', def: 60, imp: 'strong', min: 0, max: 100, step: 5 },
  { k: 'laundry_in_unit', label: 'Laundry in unit', group: 'Apartment', type: 'bool', def: true, imp: 'strong' },
  { k: 'central_air', label: 'Central air', group: 'Apartment', type: 'bool', def: false, imp: 'nice' },
  { k: 'outdoor_space', label: 'Outdoor space', group: 'Apartment', type: 'bool', def: false, imp: 'nice' },
  { k: 'floor', label: 'Min floor', group: 'Apartment', type: 'num', def: 0, imp: 'off', min: 0, max: 50, step: 1 },
  { k: 'light', label: 'Min natural light', group: 'Apartment', type: 'num', def: 0, imp: 'nice', min: 0, max: 100, step: 10 },
  { k: 'views', label: 'Min views', group: 'Apartment', type: 'num', def: 0, imp: 'off', min: 0, max: 100, step: 10 },
  { k: 'ceiling', label: 'Min ceiling (ft)', group: 'Apartment', type: 'num', def: 0, imp: 'off', min: 0, max: 16, step: 0.5 },
  { k: 'kitchen', label: 'Min kitchen quality', group: 'Apartment', type: 'num', def: 0, imp: 'nice', min: 0, max: 100, step: 10 },
  { k: 'bath_q', label: 'Min bathroom quality', group: 'Apartment', type: 'num', def: 0, imp: 'nice', min: 0, max: 100, step: 10 },
  { k: 'furnished', label: 'Furnished', group: 'Apartment', type: 'enum', def: 'any', imp: 'off',
    opts: [['any', 'Either'], ['yes', 'Furnished'], ['no', 'Unfurnished']] },

  { k: 'lease', label: 'Lease length', group: 'Terms', type: 'enum', def: 'any', imp: 'off',
    opts: [['any', 'Any'], ['12', '12 months'], ['24', '24 months'], ['flex', 'Flexible']] },
  { k: 'freshness', label: 'Listing freshness', group: 'Terms', type: 'enum', def: 'any', imp: 'off',
    opts: [['today', 'Listed today'], ['h24', 'Last 24 hours'], ['d3', 'Last 3 days'], ['any', 'Any']] },
];

export const FILTER_BY_K: Record<string, FilterDef> = Object.fromEntries(FILTERS.map((f) => [f.k, f]));
export const PRIMARY_FILTERS = FILTERS.filter((f) => f.primary);
export const ADVANCED_FILTERS = FILTERS.filter((f) => !f.primary);
export const IMP_PENALTY: Record<Importance, number> = { req: 0, strong: 18, nice: 6, off: 0 };

export const AMEN_KEYS = ['doorman', 'concierge', 'elevator', 'gym', 'roof_deck', 'package_room',
  'parking', 'pets', 'laundry_in_unit', 'central_air', 'outdoor_space'] as const;

/* ------------------------------------------------------------------ weights */
export const WEIGHT_KEYS: [keyof Components, string][] = [
  ['location', 'Location'], ['size', 'Size'], ['price', 'Price'],
  ['building_quality', 'Building quality'], ['apartment_quality', 'Apartment quality'],
  ['stabilization', 'Rent stabilization'], ['amenities', 'Amenities'], ['value', 'Value'],
];
export type Weights = Record<keyof Components, number>;

export interface Mode { label: string; w: Weights; byFresh?: boolean }
export const MODES: Record<string, Mode> = {
  best:     { label: 'Best Overall',    w: { location: 18, size: 16, price: 14, building_quality: 14, apartment_quality: 12, stabilization: 14, amenities: 6, value: 16 } },
  value:    { label: 'Best Value',      w: { location: 12, size: 14, price: 18, building_quality: 10, apartment_quality: 8, stabilization: 10, amenities: 4, value: 34 } },
  stab:     { label: 'Rent Stabilized', w: { location: 12, size: 12, price: 10, building_quality: 10, apartment_quality: 8, stabilization: 38, amenities: 4, value: 12 } },
  space:    { label: 'Most Space',      w: { location: 12, size: 40, price: 14, building_quality: 10, apartment_quality: 8, stabilization: 8, amenities: 4, value: 10 } },
  building: { label: 'Best Buildings',  w: { location: 16, size: 10, price: 8, building_quality: 34, apartment_quality: 20, stabilization: 6, amenities: 12, value: 8 } },
  newest:   { label: 'Newest Listings', w: { location: 16, size: 14, price: 12, building_quality: 12, apartment_quality: 10, stabilization: 14, amenities: 4, value: 18 }, byFresh: true },
};

/* ------------------------------------------------------------ preference set */
export interface Prefs {
  vals: Record<string, any>;
  imps: Record<string, Importance>;
  weights: Weights;
  hoodsOn: Record<string, boolean>;
  hoodsEx: Record<string, boolean>;
  exStreets: string[];
  exBuildings: string[];
  onlyBuildings: string[];
  mode: string;
  poly: [number, number][] | null;
  saved: Record<string, { id: string; building_id: string; at: number }>;
  hidden: Record<string, string>;
  followed: Record<string, { at: number }>;
}

export function defaultPrefs(): Prefs {
  return {
    vals: Object.fromEntries(FILTERS.map((f) => [f.k, f.def])),
    imps: Object.fromEntries(FILTERS.map((f) => [f.k, f.imp])) as Record<string, Importance>,
    weights: { ...MODES.best.w },
    hoodsOn: Object.fromEntries(HOODS.map((h) => [h.id, h.on])),
    hoodsEx: {},
    exStreets: [], exBuildings: [], onlyBuildings: [],
    mode: 'best', poly: null,
    saved: {}, hidden: {}, followed: {},
  };
}

/* ------------------------------------------------------------------ helpers */
export const money = (n?: number | null) => (n == null ? '-' : '$' + Math.round(n).toLocaleString());
export const daysAgo = (iso?: string | null) => {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / 864e5;
  return Number.isNaN(d) ? null : Math.max(0, d);
};
export const STAB_ORDER: Record<StabClass, number> = { confirmed: 4, highly_likely: 3, possible: 2, market: 1, unknown: 0 };
export const STAB_SHORT: Record<StabClass, string> = { confirmed: 'Confirmed', highly_likely: 'Likely', possible: 'Possible', market: 'No', unknown: 'Unknown' };
export const STAB_LONG: Record<StabClass, string> = {
  confirmed: 'Confirmed Rent Stabilized', highly_likely: 'Strong Evidence',
  possible: 'Possible', market: 'Market Rate', unknown: 'Unknown',
};
export const valueLabel = (v: number) => (v >= 75 ? 'Excellent' : v >= 58 ? 'Good' : 'Fair');

export function bldgOf(d: Dataset, L: Listing): Building | undefined {
  return d.buildings.find((b) => b.id === L.building_id);
}

export function buildingLabel(d: Dataset, L: Listing): 'New' | 'Luxury' | 'Renovated' | 'Standard' {
  const b = bldgOf(d, L) ?? ({} as Building);
  const yr = b.year_renovated ?? b.year_built ?? null;
  const q = b.quality_score ?? 55;
  const cond = (L.condition ?? b.condition ?? '').toLowerCase();
  if (cond.includes('new construction') || (yr != null && yr >= 2020)) return 'New';
  if (q >= 82) return 'Luxury';
  if (cond.includes('renovat') || (b.year_renovated != null && b.year_renovated >= 2010)) return 'Renovated';
  return 'Standard';
}

export function hoodOf(L: Listing): Hood | undefined {
  if (L.hood_id && HOOD_BY_ID[L.hood_id]) return HOOD_BY_ID[L.hood_id];
  const n = (L.neighborhood ?? '').toLowerCase();
  if (!n) return undefined;
  return HOODS.find((h) => h.name.toLowerCase().split(' (')[0] === n)
      ?? HOODS.find((h) => h.name.toLowerCase().includes(n));
}

export function amenState(d: Dataset, L: Listing, k: string): boolean | null {
  const a = L.amenities ?? {};
  const b = bldgOf(d, L)?.amenities ?? {};
  const v = a[k] !== undefined ? a[k] : b[k];
  if (v === undefined || v === null) return null;
  return v === true;
}
export const hasAmen = (d: Dataset, L: Listing, k: string) => amenState(d, L, k) === true;

export function effRent(L: Listing): number | null {
  if (L.effective_rent != null) return L.effective_rent;
  if (L.rent == null) return null;
  const mf = L.months_free ?? 0;
  const term = L.lease_months ?? 12;
  return mf ? Math.round((L.rent * (term - mf)) / term) : L.rent;
}

export function freshnessOf(L: Listing): Scored['freshness'] {
  const d = daysAgo(L.listed_date);
  if (d == null) return 'older';
  if (d < 1) return 'today';
  if (d < 2) return 'h24';
  if (d <= 3) return 'd3';
  return 'older';
}

/* ---------------------------------------------------------- availability gate */
/** Only genuinely live inventory reaches the feed. */
export function isLive(L: Listing): boolean {
  const st = L.availability_status;
  if (st && !/^(available|active)$/i.test(st)) return false;
  if (L.cross_check?.status === 'gone') return false;
  const dv = daysAgo(L.last_verified);
  if (dv != null && dv > 7) return false;
  return true;
}

/** Confidence with a stated reason. No resolved unit can never beat Low. */
export function availability(L: Listing): { level: ConfidenceLevel; why: string } {
  const dv = daysAgo(L.last_verified);
  const cc = L.cross_check ?? {};
  const n = cc.sources_confirming?.length ?? 0;
  if (cc.status === 'conflict' || L.listing_grade === 'building_indicated') {
    return { level: 'Low', why: 'No specific unit was resolved, or sources disagree. Treat this as a lead to confirm by phone, not an apartment.' };
  }
  if (dv != null && dv <= 1 && (n >= 2 || cc.status === 'confirmed')) {
    return { level: 'High', why: `Specific unit verified within 24 hours${n >= 2 ? ` and corroborated by ${n} sources` : ''}.` };
  }
  if (dv != null && dv <= 3) {
    return { level: 'Medium', why: 'Specific unit, verified within the last three days, single source.' };
  }
  return { level: 'Low', why: 'Verification is older than three days. Re-confirm before acting on it.' };
}

/* --------------------------------------------------------------- components */
export function components(d: Dataset, L: Listing, p: Prefs): Required<Components> {
  const c = { ...(L.components ?? {}) } as Components;
  const h = hoodOf(L);
  if (c.location == null) c.location = h ? Math.round(h.tier * 100) : 50;
  if (c.size == null) {
    const target = (p.vals.sf as number) || 1200;
    c.size = L.sf == null ? 50 : Math.max(0, Math.min(100, Math.round((100 * L.sf) / (target * 1.25))));
  }
  if (c.price == null) {
    const [lo, hi] = p.vals.rent as [number, number];
    const r = effRent(L);
    c.price = r == null ? 50 : Math.max(0, Math.min(100, Math.round((100 * (hi - r)) / Math.max(1, hi - lo))));
  }
  if (c.building_quality == null) c.building_quality = bldgOf(d, L)?.quality_score ?? 55;
  if (c.apartment_quality == null) c.apartment_quality = L.condition_score ?? 55;
  if (c.stabilization == null) {
    c.stabilization = { confirmed: 100, highly_likely: 82, possible: 55, market: 18, unknown: 32 }[L.stabilization?.class ?? 'unknown'];
  }
  if (c.amenities == null) {
    const want = AMEN_KEYS.filter((k) => p.vals[k] === true);
    c.amenities = want.length ? Math.round((100 * want.filter((k) => hasAmen(d, L, k)).length) / want.length) : 60;
  }
  if (c.value == null) c.value = L.value_score ?? 50;
  return c as Required<Components>;
}

/* ------------------------------------------------------ filter satisfaction */
export function evaluate(d: Dataset, L: Listing, p: Prefs) {
  const misses: Scored['misses'] = [];
  const unverified: Scored['unverified'] = [];
  let ok = true;
  const V = p.vals;
  const fail = (k: string) => {
    const imp = p.imps[k];
    if (imp === 'off') return;
    if (imp === 'req') ok = false;
    misses.push({ k, label: FILTER_BY_K[k].label, imp });
  };
  const unknown = (k: string) => {
    if (p.imps[k] === 'off') return;
    unverified.push({ k, label: FILTER_BY_K[k].label });
  };

  if (L.beds != null && L.beds < V.beds) fail('beds');
  if (L.baths != null && L.baths < V.baths) fail('baths');
  // Unknown square footage is deliberately not a failure.
  if (L.sf != null && L.sf < V.sf) fail('sf');
  const r = effRent(L);
  if (r != null && (r < V.rent[0] || r > V.rent[1])) fail('rent');

  const sc = L.stabilization?.class ?? 'unknown';
  if (V.stab === 'only' && STAB_ORDER[sc] < 3) fail('stab');
  else if (V.stab === 'preferred' && STAB_ORDER[sc] < 2) fail('stab');

  if (V.valueMin > 0 && (L.value_score ?? 0) < V.valueMin) fail('valueMin');
  if (V.discount > 0 && (L.discount_pct ?? 0) < V.discount) fail('discount');
  if (V.noFee && !(L.fee === 'none' || L.fee_paid_by === 'landlord')) fail('noFee');

  const b = bldgOf(d, L) ?? ({} as Building);
  const yr = b.year_renovated ?? b.year_built ?? null;
  if (V.construction === 'reno') {
    const cond = (L.condition ?? '').toLowerCase();
    const reno = cond.includes('new construction') || cond.includes('renovat') || (yr != null && yr >= 2010);
    if (!reno) fail('construction');
  }
  const bqMin = FILTER_BY_K.bq.thresholds?.[V.bq] ?? 0;
  if (bqMin > 0 && (b.quality_score ?? 55) < bqMin) fail('bq');
  if (V.aq > 0 && (L.condition_score ?? 55) < V.aq) fail('aq');

  for (const k of AMEN_KEYS) {
    if (V[k] !== true) continue;
    const st = amenState(d, L, k);
    if (st === false) fail(k);
    else if (st === null) unknown(k);
  }

  if (V.floor > 0 && L.floor != null && L.floor < V.floor) fail('floor');
  ([['light', 'light_score'], ['views', 'views_score'], ['kitchen', 'kitchen_score'], ['bath_q', 'bathroom_score']] as const)
    .forEach(([k, f]) => { const v = L[f]; if (V[k] > 0 && v != null && v < V[k]) fail(k); });
  if (V.ceiling > 0 && L.ceiling_ft != null && L.ceiling_ft < V.ceiling) fail('ceiling');
  if (V.furnished !== 'any' && L.furnished != null) {
    const isF = L.furnished === true || L.furnished === 'yes';
    if ((V.furnished === 'yes') !== isF) fail('furnished');
  }
  if (V.moveIn && L.available_date && new Date(L.available_date) > new Date(V.moveIn)) fail('moveIn');
  if (V.lease !== 'any' && L.lease_terms && !String(L.lease_terms).includes(V.lease)) fail('lease');
  if (V.freshness !== 'any') {
    const order = { today: 3, h24: 2, d3: 1, older: 0 };
    const need = { today: 3, h24: 2, d3: 1 }[V.freshness as 'today' | 'h24' | 'd3'];
    if (order[freshnessOf(L)] < need) fail('freshness');
  }
  return { ok, misses, unverified };
}

/* ------------------------------------------------------------ geo filtering */
function pointInPoly(pt: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function geoOk(L: Listing, p: Prefs, viewport?: { contains(ll: [number, number]): boolean } | null) {
  if (p.onlyBuildings.length) return p.onlyBuildings.includes(L.building_id);
  const h = hoodOf(L);
  if (h) { if (p.hoodsEx[h.id]) return false; if (!p.hoodsOn[h.id]) return false; }
  const addr = (L.address ?? '').toLowerCase();
  if (p.exStreets.some((s) => s && addr.includes(s.toLowerCase()))) return false;
  if (p.exBuildings.includes(L.building_id)) return false;
  if (p.poly && L.lat != null && L.lon != null && !pointInPoly([L.lon, L.lat], p.poly)) return false;
  if (viewport && L.lat != null && L.lon != null && !viewport.contains([L.lat, L.lon])) return false;
  return true;
}

/* ------------------------------------------------------------------ scoring */
export function fitOf(d: Dataset, L: Listing, p: Prefs,
                      ev: ReturnType<typeof evaluate>, comp: Required<Components>): number {
  const tw = WEIGHT_KEYS.reduce((s, [k]) => s + (p.weights[k] || 0), 0) || 1;
  let f = WEIGHT_KEYS.reduce((s, [k]) => s + (p.weights[k] || 0) * (comp[k] ?? 50), 0) / tw;
  ev.misses.forEach((m) => { if (m.imp !== 'req') f -= IMP_PENALTY[m.imp]; });
  // Unknowns cost a little, so a confirmed match outranks an unconfirmed one
  // without the unconfirmed one disappearing.
  f -= ev.unverified.length * 2;
  // Learned bias from behaviour. Ranking only; it can never override a Required filter.
  const savedHere = Object.values(p.saved).filter((x) => x.building_id === L.building_id).length;
  const hidHere = Object.values(p.hidden).filter((x) => x === L.building_id).length;
  f += Math.min(6, savedHere * 3) + (p.followed[L.building_id] ? 3 : 0) - Math.min(6, hidHere * 2);
  if (L.sf == null) f -= 4;
  return Math.max(0, Math.min(100, Math.round(f)));
}

function score(d: Dataset, L: Listing, p: Prefs, nearReason?: string): Scored {
  const ev = evaluate(d, L, p);
  const comp = components(d, L, p);
  return {
    L, comp, misses: ev.misses, unverified: ev.unverified,
    fit: fitOf(d, L, p, ev, comp),
    value: L.value_score ?? comp.value,
    eff: effRent(L),
    sizeUnknown: L.sf == null,
    freshness: freshnessOf(L),
    ...(nearReason ? { nearReason } : {}),
  };
}

/** The live feed. */
export function results(d: Dataset | null, p: Prefs,
                        viewport?: { contains(ll: [number, number]): boolean } | null): Scored[] {
  if (!d) return [];
  const rows: Scored[] = [];
  for (const L of d.listings) {
    if (p.hidden[L.id]) continue;
    if (!isLive(L)) continue;
    if (!geoOk(L, p, viewport)) continue;
    if (!evaluate(d, L, p).ok) continue;
    rows.push(score(d, L, p));
  }
  const mode = MODES[p.mode] ?? MODES.best;
  if (mode.byFresh) {
    const ord = { today: 3, h24: 2, d3: 1, older: 0 };
    rows.sort((a, b) => ord[b.freshness] - ord[a.freshness]
      || (a.L.days_on_market ?? 99) - (b.L.days_on_market ?? 99) || b.fit - a.fit);
  } else {
    const key = p.mode === 'value' ? 'value' : 'fit';
    rows.sort((a, b) => b[key] - a[key] || b.fit - a.fit || (b.L.sf ?? 0) - (a.L.sf ?? 0));
  }
  return rows;
}

/**
 * Near misses. A rigid filter that silently deletes an exceptional apartment is
 * the failure this tool exists to avoid, so anything blocked by geography alone
 * or by exactly one Required filter is surfaced with the reason.
 */
export function nearMisses(d: Dataset | null, p: Prefs): Scored[] {
  if (!d) return [];
  const out: Scored[] = [];
  for (const L of d.listings) {
    if (p.hidden[L.id] || !isLive(L)) continue;
    const geo = geoOk(L, p);
    const ev = evaluate(d, L, p);
    if (geo && ev.ok) continue;
    const hard = ev.misses.filter((m) => m.imp === 'req');
    let reason: string | null = null;
    if (!geo && ev.ok) {
      const h = hoodOf(L);
      const cause = p.onlyBuildings.length ? 'it is outside the building lock'
        : h && p.hoodsEx[h.id] ? `${h.name} is excluded`
        : h && !p.hoodsOn[h.id] ? `${h.name} is switched off`
        : p.poly ? 'it is outside your drawn area'
        : 'it is outside your geographic filters';
      reason = `Clears every other filter, but ${cause}.`;
    } else if (geo && hard.length === 1) {
      reason = `Clears everything except one Required filter: ${hard[0].label}.`;
    } else continue;
    out.push(score(d, L, p, reason));
  }
  return out.sort((a, b) => b.fit - a.fit);
}

/** Buildings with no qualifying availability. Never mixed into apartment results. */
export function buildingsToWatch(d: Dataset | null): Building[] {
  if (!d) return [];
  const live = new Set(d.listings.filter(isLive).map((x) => x.building_id));
  return d.buildings.filter((b) => !live.has(b.id)).sort((a, b) => (b.fit_seed ?? 0) - (a.fit_seed ?? 0));
}

export { WEST_SIDE_IDS, NORTH_LIMIT_LAT, HOODS };

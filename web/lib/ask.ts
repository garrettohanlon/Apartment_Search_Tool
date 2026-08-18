/**
 * Natural-language search. Maps a sentence onto filters over the dataset already
 * loaded, and reports exactly what it changed so nothing moves silently.
 *
 * It cannot find apartments that are not in today's dataset. Anything requiring a
 * live web search is returned as `queue`, for the next agent run to pick up.
 */
import { FILTER_BY_K, MODES, type Prefs } from './engine';
import { HOODS } from './geography';

export interface AskResult {
  prefs: Prefs;
  changes: string[];
  notes: string[];
  queue: boolean;
}

const parseMoney = (t: string): number | null => {
  const m = t.match(/([\d,]+)\s*(k)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (m[2]) n *= 1000;
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number) => '$' + n.toLocaleString();

export function ask(raw: string, prev: Prefs): AskResult {
  const s = raw.toLowerCase().trim();
  const p: Prefs = { ...prev, vals: { ...prev.vals }, imps: { ...prev.imps },
                     weights: { ...prev.weights }, hoodsOn: { ...prev.hoodsOn }, hoodsEx: { ...prev.hoodsEx } };
  const changes: string[] = [];
  const notes: string[] = [];
  const set = (k: string, v: unknown, desc: string) => {
    if (JSON.stringify(p.vals[k]) === JSON.stringify(v)) return;
    p.vals[k] = v; changes.push(desc);
  };
  const imp = (k: string, v: Prefs['imps'][string]) => {
    if (p.imps[k] === v) return;
    p.imps[k] = v; changes.push(`${FILTER_BY_K[k].label} requirement is now ${v}`);
  };
  const mode = (m: string, label: string) => {
    if (p.mode === m) return;
    p.mode = m; p.weights = { ...MODES[m].w }; changes.push(`Rank by ${label}`);
  };

  let m: RegExpMatchArray | null;

  // --- rent
  if ((m = s.match(/(?:under|below|less than|max|up to|<)\s*\$?([\d,]+k?)/))) {
    const n = parseMoney(m[1]);
    if (n) set('rent', [p.vals.rent[0], n], `Max rent ${fmt(n)}`);
  }
  if ((m = s.match(/between\s*\$?([\d,]+k?)\s*(?:and|to|-)\s*\$?([\d,]+k?)/))) {
    const a = parseMoney(m[1]); const b = parseMoney(m[2]);
    if (a && b) set('rent', [a, b], `Rent ${fmt(a)} to ${fmt(b)}`);
  }
  // --- size
  if ((m = s.match(/(?:over|above|at least|more than|minimum|min)\s*([\d,]{3,5})\s*(?:\+)?\s*(?:sq\.?\s?f|sf|square)/))) {
    const n = Number(m[1].replace(/,/g, ''));
    set('sf', n, `Minimum size ${n.toLocaleString()} sq ft`);
    imp('sf', 'req');
  } else if ((m = s.match(/([\d,]{3,5})\s*\+?\s*(?:sq\.?\s?f|sf|square feet)/))) {
    const n = Number(m[1].replace(/,/g, ''));
    set('sf', n, `Minimum size ${n.toLocaleString()} sq ft`);
  }
  // --- beds / baths
  if ((m = s.match(/(\d)\s*(?:br|bed|bedroom)/))) set('beds', Number(m[1]), `Bedrooms ${m[1]}+`);
  if ((m = s.match(/(\d(?:\.5)?)\s*(?:ba\b|bath)/))) set('baths', Number(m[1]), `Bathrooms ${m[1]}+`);

  // --- stabilization
  if (/rent[- ]?stabili/.test(s)) {
    if (/only|just|restrict|require/.test(s)) { set('stab', 'only', 'Rent stabilized is Required'); imp('stab', 'req'); }
    else { set('stab', 'preferred', 'Rent stabilized is Preferred'); imp('stab', 'strong'); mode('stab', 'Rent Stabilized'); }
  }
  if (/market rate|not stabili|ignore stabili|doesn'?t matter/.test(s)) {
    set('stab', 'irrelevant', "Rent stabilized set to Doesn't matter"); imp('stab', 'off');
  }
  // --- condition and quality
  if (/renovat|new construction|brand new|newly built|newer building/.test(s)) {
    set('construction', 'reno', 'Condition set to New or renovated'); imp('construction', 'strong');
  }
  if (/luxur|high[- ]end/.test(s)) set('bq', 'luxury', 'Building quality set to Luxury');
  else if (/nice|good building|well[- ]maintained/.test(s)) set('bq', 'nice', 'Building quality set to Nice');
  if (/doorman/.test(s)) set('doorman', true, 'Doorman wanted');

  // --- freshness
  if (/\btoday\b/.test(s)) { set('freshness', 'today', 'Listed today only'); imp('freshness', 'req'); }
  else if (/last 24|past 24/.test(s)) { set('freshness', 'h24', 'Listed in the last 24 hours'); imp('freshness', 'req'); }
  else if (/last 48|past 48|two days|2 days|last (?:3|three) days/.test(s)) {
    set('freshness', 'd3', 'Listed in the last 3 days'); imp('freshness', 'req');
    notes.push('Freshness buckets are today, 24 hours and 3 days, so 48 hours maps to the 3 day bucket.');
  }

  // --- amenities
  ([['laundry', 'laundry_in_unit'], ['washer', 'laundry_in_unit'], ['central air', 'central_air'],
    ['outdoor', 'outdoor_space'], ['terrace', 'outdoor_space'], ['balcony', 'outdoor_space'],
    ['roof', 'roof_deck'], ['gym', 'gym'], ['concierge', 'concierge'], ['parking', 'parking'],
    ['pet', 'pets'], ['package', 'package_room'], ['elevator', 'elevator']] as const)
    .forEach(([word, key]) => {
      if (!s.includes(word)) return;
      const before = s.slice(Math.max(0, s.indexOf(word) - 9), s.indexOf(word));
      if (/no |without |not /.test(before)) return;
      set(key, true, `${FILTER_BY_K[key].label} wanted`);
    });
  if (/no[- ]fee|without a fee|no broker fee/.test(s)) set('noFee', true, 'No broker fee wanted');

  // --- geography
  const hits = HOODS.filter((h) => {
    const n = h.name.toLowerCase().replace(/ \(ues\)| \(other\)| \/.*$/, '');
    return n.length > 3 && s.includes(n);
  });
  if (/\bues\b|upper east/.test(s)) {
    HOODS.filter((h) => h.region === 'Upper East Side').forEach((h) => { if (!hits.includes(h)) hits.push(h); });
  }
  if (hits.length) {
    HOODS.forEach((h) => { p.hoodsOn[h.id] = false; });
    hits.forEach((h) => { p.hoodsOn[h.id] = true; delete p.hoodsEx[h.id]; });
    changes.push(`Neighborhoods narrowed to ${hits.map((h) => h.name).join(', ')}`);
  }
  if (/west side/.test(s)) {
    HOODS.forEach((h) => { p.hoodsOn[h.id] = /West/.test(h.region); });
    changes.push('Neighborhoods restricted to the West Side, capped at W 38th St');
  }

  // --- ranking
  if (/best value|good value|underpriced|cheap for/.test(s)) mode('value', 'Best Value');
  if (/most space|biggest|largest/.test(s)) mode('space', 'Most Space');
  if (/best building|nicest building/.test(s)) mode('building', 'Best Buildings');
  if (/newest|just listed|new listing/.test(s)) mode('newest', 'Newest Listings');

  return { prefs: p, changes, notes, queue: changes.length === 0 };
}

/** "Similar, but ..." applied to a seed listing. */
export function similarTo(seed: { rent?: number | null; sf?: number | null; beds?: number | null },
                          instruction: string, prev: Prefs): AskResult {
  const p: Prefs = { ...prev, vals: { ...prev.vals }, imps: { ...prev.imps },
                     weights: { ...prev.weights }, hoodsOn: { ...prev.hoodsOn }, hoodsEx: { ...prev.hoodsEx } };
  const changes: string[] = [];
  const q = instruction.toLowerCase();
  if (seed.beds) { p.vals.beds = seed.beds; changes.push(`Bedrooms ${seed.beds}+`); }
  if (seed.sf) {
    const floor = Math.max(1000, Math.round((seed.sf * 0.9) / 50) * 50);
    p.vals.sf = floor; changes.push(`Minimum size ${floor.toLocaleString()} sq ft`);
  }
  if (seed.rent) {
    const cap = /cheaper/.test(q) ? Math.max(1000, seed.rent - 500) : Math.round((seed.rent * 1.05) / 250) * 250;
    p.vals.rent = [p.vals.rent[0], cap];
    changes.push(`Max rent ${'$' + cap.toLocaleString()}`);
  }
  if (/1,?300/.test(q)) { p.vals.sf = 1300; changes.push('Minimum size 1,300 sq ft'); }
  if (/stabili/.test(q)) { p.vals.stab = 'only'; p.imps.stab = 'req'; changes.push('Rent stabilized is Required'); }
  if (/newer/.test(q)) { p.vals.construction = 'reno'; changes.push('Condition set to New or renovated'); }
  const hood = HOODS.find((h) => new RegExp(h.name.split(' (')[0], 'i').test(instruction));
  if (hood) {
    HOODS.forEach((h) => { p.hoodsOn[h.id] = false; });
    p.hoodsOn[hood.id] = true; delete p.hoodsEx[hood.id];
    changes.push(`Neighborhoods narrowed to ${hood.name}`);
  }
  return { prefs: p, changes, notes: [], queue: true };
}

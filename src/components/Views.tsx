'use client';
/** Buildings to Watch, Off-Market, Saved, Compare, and the neighborhood picker. */
import { useStore } from '@/lib/store';
import {
  AMEN_KEYS, availability, bldgOf, buildingLabel, buildingsToWatch, hasAmen, isLive, money,
  results, STAB_ORDER, STAB_SHORT, valueLabel,
} from '@/lib/engine';
import { HOODS, regionsInOrder } from '@/lib/geography';
import type { Building, Scored } from '@/lib/types';
import ResultCard from './ResultCard';

/* -------------------------------------------------------------- buildings */
export function BuildingCard({ b, offMarket }: { b: Building; offMarket?: boolean }) {
  const { data, prefs, toggleFollow, queueRequest } = useStore();
  const c = b.contact ?? {};
  const contact = c.phone
    ? `${c.name ?? ''} ${c.phone}${c.verified ? '' : ' (unverified)'}`
    : c.name ? `${c.name}, no published phone found` : 'No leasing contact identified';
  const bits = [
    b.year_built && `built ${b.year_built}`,
    b.units && `${b.units} units`,
    b.avg_sf_per_unit && `avg ${b.avg_sf_per_unit} sq ft/unit`,
    b.program,
  ].filter(Boolean) as string[];

  return (
    <div className="bcard">
      <div className="btop">
        <div className="bleft">
          <div className="baddr">{b.name ?? b.address ?? b.id}</div>
          <div className="rsub">{[b.address, b.neighborhood].filter(Boolean).join(' · ')}</div>
          <div className="rfacts">{bits.map((x, i) => (<span key={i}>{i ? <i>|</i> : null}{x}</span>))}</div>
          {b.benefit_status ? <div className="bwhy"><b>Regulatory status:</b> {b.benefit_status}</div> : null}
          {(b.why_stabilized ?? b.stabilization_note)
            ? <div className="bwhy"><b>Why it may hold stabilized units:</b> {b.why_stabilized ?? b.stabilization_note}</div>
            : null}
          <div className="bcontact"><b>Leasing:</b> {contact}</div>
          {offMarket ? (
            <div className="bwhy">
              <b>Availability:</b> nothing qualifying found today.
              {b.availability_source ? ` Last seen via ${b.availability_source}.` : ''}
              {b.last_checked ? ` Last checked ${b.last_checked}.` : ''}
            </div>
          ) : null}
        </div>
        {b.fit_seed != null ? (
          <div className="bright"><div className="bfit"><div className="sn">{b.fit_seed}</div><div className="sl">Building fit</div></div></div>
        ) : null}
      </div>
      <div className="racts">
        <button className={prefs.followed[b.id] ? 'on' : ''} onClick={() => toggleFollow(b.id)}>
          {prefs.followed[b.id] ? 'Following' : 'Follow building'}
        </button>
        <button onClick={() => {
          queueRequest({ type: 'deep_search', target_kind: 'building', target_id: b.id,
            target_label: b.name ?? b.address ?? b.id });
          alert(`Deep Search queued for ${b.name ?? b.id}. The next agent run investigates listings, management, owner, direct leasing contact, archived pages, stabilized-unit evidence and tax-benefit history.`);
        }}>Deep Search</button>
      </div>
      {data && !isLive({ id: '', building_id: b.id } as never) ? null : null}
    </div>
  );
}

export function BuildingsToWatch() {
  const { data } = useStore();
  const rows = buildingsToWatch(data);
  return (
    <>
      <div className="lead">
        Promising buildings with <b>nothing currently available</b> that meets your criteria. Kept out of
        apartment results on purpose, so a building never reads as inventory it does not have.
      </div>
      <div className="rescount">{rows.length} building(s) with no qualifying availability today</div>
      {rows.map((b) => <BuildingCard key={b.id} b={b} />)}
    </>
  );
}

export function OffMarket() {
  const { data } = useStore();
  const flagged = data?.off_market_buildings ?? [];
  const proxies = (data?.buildings ?? []).filter((b) => !b.contact?.phone).slice(0, 12);
  return (
    <>
      <div className="lead">
        Buildings that are hard to find by normal search: no polished leasing site, owner markets
        directly, leasing runs through a phone number or a management portal, inventory appears briefly
        on small brokerage sites, or units fill by referral. This is where inventory the major platforms
        never carry tends to sit.
      </div>
      {flagged.length
        ? flagged.map((b) => <BuildingCard key={b.id} b={b} offMarket />)
        : (
          <>
            <div className="empty">
              <h3>None identified yet</h3>
              <p>The agent populates this from the off-market sweep: management portals, direct-landlord
                pages, small brokerages, and buildings with stabilization history but no marketing
                presence. Run the agent to fill it.</p>
              <p>Meanwhile the strongest proxies already on file are watchlist buildings whose only
                recorded contact is an owning entity rather than a leasing office.</p>
            </div>
            {proxies.map((b) => <BuildingCard key={b.id} b={b} offMarket />)}
          </>
        )}
    </>
  );
}

/* ------------------------------------------------------------------ saved */
export function SavedView() {
  const { data, prefs, rows, exportSignals, requests } = useStore();
  const savedIds = Object.keys(prefs.saved);
  const followed = Object.keys(prefs.followed);
  const byId = new Map(rows.map((r) => [r.L.id, r] as const));

  return (
    <>
      <h2 className="pt">Saved</h2>
      <div className="lead">
        {savedIds.length} apartment(s) and {followed.length} building(s) saved.
      </div>

      <h3 className="sh">Saved apartments</h3>
      {savedIds.length === 0 && <p className="hint">Nothing saved yet.</p>}
      {savedIds.map((id) => {
        const r = byId.get(id);
        if (r) return <ResultCard key={id} r={r} />;
        return (
          <div className="bcard" key={id}>
            <div className="btop"><div className="bleft">
              <div className="baddr">{id}</div>
              <div className="bwhy">No longer in the live dataset, or filtered out by your current
                settings. If it has gone from the dataset entirely it was most likely rented.</div>
            </div></div>
          </div>);
      })}

      <h3 className="sh">Followed buildings</h3>
      {followed.length === 0 && (
        <p className="hint">Follow a building to be told the morning qualifying inventory appears there.</p>)}
      {followed.map((id) => {
        const b = data?.buildings.find((x) => x.id === id);
        return b ? <BuildingCard key={id} b={b} /> : null;
      })}

      {requests.length > 0 && (
        <>
          <h3 className="sh">Queued for the next agent run</h3>
          {requests.slice(-10).map((x, i) => (
            <div className="chg" key={i}>
              {x.type === 'deep_search'
                ? `Deep Search: ${x.target_label}`
                : `${x.type === 'find_more_like' ? 'Find more like' : 'Query'}: ${x.instruction ?? ''}`}
            </div>))}
          <button className="linkbtn" onClick={exportSignals}>Export queue and signals for the agent</button>
          <p className="hint">
            Drop the downloaded signals.json in the agent directory under data/. The next run reads your
            queued Deep Searches and biases ranking toward what you have been saving. It never overrides
            a required filter.
          </p>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- compare */
type CmpRow = [string, (r: Scored) => React.ReactNode, ((r: Scored) => number) | null];

export function CompareView() {
  const { data, rows, near, compare, clearCompare } = useStore();
  const pool = [...rows, ...near].filter((r) => compare.includes(r.L.id));

  if (!data) return null;
  if (pool.length < 2) {
    return (
      <>
        <h2 className="pt">Compare</h2>
        <div className="empty">
          <h3>Pick at least two apartments</h3>
          <p>Use Compare on any result card, then come back here.</p>
        </div>
      </>);
  }

  const CMP: CmpRow[] = [
    ['Rent', (r) => money(r.L.rent), (r) => -(r.L.rent ?? 1e9)],
    ['Effective rent', (r) => (r.eff != null ? money(r.eff) : '-'), (r) => -(r.eff ?? 1e9)],
    ['Square feet', (r) => (r.L.sf ? r.L.sf.toLocaleString() : 'not published'), (r) => r.L.sf ?? 0],
    ['Rent per sq ft', (r) => (r.L.sf && r.L.rent ? `$${(r.L.rent / r.L.sf).toFixed(2)}` : '-'),
      (r) => -(r.L.sf && r.L.rent ? r.L.rent / r.L.sf : 1e9)],
    ['Neighborhood', (r) => r.L.neighborhood ?? '-', null],
    ['Building', (r) => r.L.building_name ?? '-', null],
    ['Built', (r) => bldgOf(data, r.L)?.year_built ?? '-', (r) => bldgOf(data, r.L)?.year_built ?? 0],
    ['Classification', (r) => buildingLabel(data, r.L), null],
    ['Rent stabilized', (r) => STAB_SHORT[r.L.stabilization?.class ?? 'unknown'],
      (r) => STAB_ORDER[r.L.stabilization?.class ?? 'unknown']],
    ['Availability', (r) => availability(r.L).level,
      (r) => ({ High: 3, Medium: 2, Low: 1 })[availability(r.L).level]],
    ['Amenities', (r) => AMEN_KEYS.filter((k) => hasAmen(data, r.L, k)).map((k) => k.replace(/_/g, ' ')).join(', ') || '-',
      (r) => AMEN_KEYS.filter((k) => hasAmen(data, r.L, k)).length],
    ['Floor', (r) => r.L.floor ?? '-', (r) => r.L.floor ?? 0],
    ['Fees / concessions', (r) => [r.L.fee, r.L.concessions_text].filter(Boolean).join('; ') || '-', null],
    ['Value', (r) => valueLabel(r.value), (r) => r.value],
    ['Fit Score', (r) => r.fit, (r) => r.fit],
    ['Pros', (r) => r.L.why_matches ?? '-', null],
    ['Cons', (r) => r.L.tradeoffs ?? '-', null],
  ];

  const verdicts: [string, (a: Scored, b: Scored) => number, (w: Scored) => string][] = [
    ['Best overall', (a, b) => b.fit - a.fit, (w) => `Highest fit at ${w.fit} using your current weights.`],
    ['Best value', (a, b) => b.value - a.value,
      (w) => `Value ${valueLabel(w.value)}${w.L.discount_pct ? `, ${Math.abs(w.L.discount_pct)}% ${w.L.discount_pct > 0 ? 'below' : 'above'} estimated market` : ''}.`],
    ['Best stabilized opportunity',
      (a, b) => STAB_ORDER[b.L.stabilization?.class ?? 'unknown'] - STAB_ORDER[a.L.stabilization?.class ?? 'unknown'] || b.fit - a.fit,
      (w) => `${STAB_SHORT[w.L.stabilization?.class ?? 'unknown']}. ${(w.L.stabilization?.reasons ?? [])[0] ?? ''}`],
    ['Best building', (a, b) => (bldgOf(data, b.L)?.quality_score ?? 0) - (bldgOf(data, a.L)?.quality_score ?? 0),
      (w) => `${buildingLabel(data, w.L)}${bldgOf(data, w.L)?.year_built ? `, built ${bldgOf(data, w.L)!.year_built}` : ''}.`],
    ['Most space', (a, b) => (b.L.sf ?? 0) - (a.L.sf ?? 0),
      (w) => (w.L.sf ? `${w.L.sf.toLocaleString()} sq ft.` : 'Size unpublished; confirm by phone.')],
    ['Most certain to be available',
      (a, b) => ({ High: 3, Medium: 2, Low: 1 })[availability(b.L).level] - ({ High: 3, Medium: 2, Low: 1 })[availability(a.L).level],
      (w) => availability(w.L).why],
  ];

  return (
    <>
      <h2 className="pt">Compare</h2>
      <table className="cmp">
        <thead>
          <tr><th /> {pool.map((r) => <th key={r.L.id}>{r.L.address}{r.L.unit ? ` #${r.L.unit}` : ''}</th>)}</tr>
        </thead>
        <tbody>
          {CMP.map(([label, fmt, cmp]) => {
            let best = -1;
            if (cmp) { let hi = -Infinity; pool.forEach((r, i) => { const v = cmp(r); if (v > hi) { hi = v; best = i; } }); }
            return (
              <tr key={label}>
                <td className="rowh">{label}</td>
                {pool.map((r, i) => <td key={r.L.id} className={i === best ? 'best' : ''}>{fmt(r)}</td>)}
              </tr>);
          })}
        </tbody>
      </table>

      <h3 className="sh">Agent ranking</h3>
      <div className="verdicts">
        {verdicts.map(([label, sortFn, why]) => {
          const w = [...pool].sort(sortFn)[0];
          return (
            <div className="verdict" key={label}>
              <div className="vl">{label}</div>
              <div className="vv">{w.L.address}{w.L.unit ? ` #${w.L.unit}` : ''}</div>
              <div className="vr">{why(w)}</div>
            </div>);
        })}
      </div>
      <button className="linkbtn" onClick={clearCompare}>Clear comparison</button>
    </>
  );
}

/* --------------------------------------------------------- hood picker */
export function HoodPicker() {
  const { hoodPicker, setHoodPicker, prefs, toggleHood, setHoods } = useStore();
  if (!hoodPicker) return null;
  return (
    <>
      <div className="scrim on" onClick={() => setHoodPicker(false)} />
      <div className="drawer on">
        <div className="dh">
          <h3>Neighborhoods</h3>
          <button onClick={() => setHoodPicker(false)} aria-label="Close">&times;</button>
        </div>
        <div className="db">
          <p className="hint">
            Click to include or remove. Ranking still weighs the specific block, transit, restaurants,
            parks and noise, so two apartments in the same neighborhood do not score the same.
          </p>
          {regionsInOrder().map((region) => (
            <div key={region}>
              <h5>{region}</h5>
              <div className="chips">
                {HOODS.filter((h) => h.region === region).map((h) => {
                  const on = prefs.hoodsOn[h.id] && !prefs.hoodsEx[h.id];
                  return (
                    <button key={h.id} className={on ? 'chip on' : 'chip'} title={h.caveat ? `${h.name}, ${h.caveat}` : h.name}
                            onClick={() => toggleHood(h.id)}>
                      {h.name}{h.caveat ? ' *' : ''}
                    </button>);
                })}
              </div>
            </div>))}
          <p className="hint">* lower tier: surfaced only when the specific building is compelling.</p>
          <button className="linkbtn" onClick={() => setHoods(Object.fromEntries(HOODS.map((h) => [h.id, true])), {})}>Select all</button>
          <button className="linkbtn" onClick={() => setHoods(Object.fromEntries(HOODS.map((h) => [h.id, false])), {})}>Clear all</button>
          <button className="linkbtn" onClick={() => setHoods(Object.fromEntries(HOODS.map((h) => [h.id, h.on])), {})}>My defaults</button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------- stabilized view */
export function StabilizedResults() {
  const { data, prefs } = useStore();
  // Rent-Stabilized mode ranks stabilization heavily and keeps anything with
  // evidence, rather than filtering on the words "rent stabilized".
  const p = { ...prefs, mode: 'stab', vals: { ...prefs.vals, stab: 'preferred' } };
  const rows = results(data, p).filter((r) => STAB_ORDER[r.L.stabilization?.class ?? 'unknown'] >= 2);
  return (
    <>
      <div className="rescount">{rows.length} available unit(s) with stabilization evidence</div>
      {rows.length === 0 && (
        <div className="empty">
          <h3>No stabilized units available right now</h3>
          <p>This is normal. Regulated inventory in good buildings turns over rarely. Use Buildings to
            Watch and follow the strongest candidates so the next run flags them the morning something
            appears.</p>
        </div>)}
      {rows.map((r) => <ResultCard key={r.L.id} r={r} />)}
    </>
  );
}

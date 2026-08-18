'use client';
/** Full analysis, opening with the agent's opinion because that is the reason to read the rest. */
import { useStore } from '@/lib/store';
import { similarTo } from '@/lib/ask';
import {
  AMEN_KEYS, availability, bldgOf, buildingLabel, hasAmen, money, STAB_LONG, valueLabel, WEIGHT_KEYS,
} from '@/lib/engine';

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === '-') return null;
  return (<><dt>{k}</dt><dd>{children}</dd></>);
}

export default function DetailDrawer() {
  const {
    data, detail, openDetail, prefs, toggleSave, toggleFollow, hide,
    notes, setNote, queueRequest, patchPrefs, setTab,
  } = useStore();

  const open = !!detail;
  const r = detail;
  const L = r?.L;
  const b = data && L ? bldgOf(data, L) : undefined;

  const findMore = () => {
    if (!L) return;
    const opts = ['Similar, but cheaper', 'Similar, but West Village', 'Similar, but 1,300+ sq ft',
      'Similar, but rent stabilized', 'Similar, but newer building', 'Just similar'];
    const pick = window.prompt(
      `Find more like ${L.address ?? 'this'}.\n\n${opts.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nEnter 1-6, or type your own.`);
    if (!pick) return;
    const n = Number.parseInt(pick, 10);
    const q = n >= 1 && n <= 6 ? opts[n - 1] : pick;
    const res = similarTo({ rent: L.rent, sf: L.sf, beds: L.beds }, q, prefs);
    patchPrefs(res.prefs);
    queueRequest({ type: 'find_more_like', instruction: q,
      seed: { id: L.id, address: L.address, rent: L.rent, sf: L.sf, neighborhood: L.neighborhood } });
    openDetail(null); setTab('search');
    alert(`Filters shifted to match "${q}" against the inventory already loaded:\n\n`
      + res.changes.map((c) => `• ${c}`).join('\n')
      + '\n\nA web search for genuinely new matches has been queued for the next agent run.');
  };

  const deepSearch = () => {
    if (!L) return;
    const label = b?.name ?? L.address ?? L.building_id;
    queueRequest({ type: 'deep_search', target_kind: 'building', target_id: L.building_id, target_label: label });
    const known = [
      b?.address && `Address: ${b.address}`,
      b?.management && `Management: ${b.management}`,
      b?.owner && `Owner: ${b.owner}`,
      b?.program && `Tax program: ${b.program}`,
      b?.benefit_status && `Benefit status: ${b.benefit_status}`,
      b?.bbl && `BBL: ${b.bbl}`,
      b?.contact?.phone && `Phone: ${b.contact.phone}`,
    ].filter(Boolean) as string[];
    alert(`Deep Search queued for ${label}.\n\nThe next agent run will investigate current listings, `
      + 'management and owner, direct leasing contact, archived leasing pages, stabilized-unit evidence, '
      + 'tax-benefit history, regulatory records, small-broker listings, and other properties held by the '
      + 'same landlord.\n\nThis cannot run in the browser: it needs the agent\'s web access.'
      + (known.length ? `\n\nAlready on file:\n${known.map((x) => `• ${x}`).join('\n')}` : ''));
  };

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={() => openDetail(null)} />
      <div className={`drawer${open ? ' on' : ''}`} aria-hidden={!open}>
        {r && L && data ? (() => {
          const sc = L.stabilization?.class ?? 'unknown';
          const av = availability(L);
          const amen = AMEN_KEYS.filter((k) => hasAmen(data, L, k));
          return (
            <>
              <div className="dh">
                <h3>{L.address}{L.unit ? <span className="unit"> #{L.unit}</span> : null}</h3>
                <button onClick={() => openDetail(null)} aria-label="Close">&times;</button>
              </div>
              <div className="db">
                <div className="take">
                  <h5>Agent Take</h5>
                  <div className="tl">Why I would consider it</div>
                  <p>{L.why_matches ?? 'The agent did not supply a recommendation for this listing.'}</p>
                  <div className="tl">Main tradeoff</div>
                  <p>{L.tradeoffs ?? 'None recorded. Ask what is wrong with it on the call.'}</p>
                </div>

                {L.photos?.length ? (
                  <div className="gal">
                    {L.photos.slice(0, 8).map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" loading="lazy"
                           onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ))}
                  </div>
                ) : null}
                {L.floorplan_url
                  ? <a className="linkbtn" href={L.floorplan_url} target="_blank" rel="noreferrer">Open floor plan</a>
                  : <p className="hint">No floor plan published. Worth requesting from the leasing office.</p>}

                <h5>The numbers</h5>
                <dl className="kv">
                  <Row k="Asking rent"><b>{L.rent != null ? money(L.rent) : 'not published'}</b></Row>
                  <Row k="Effective rent">{r.eff != null && r.eff !== L.rent ? money(r.eff) : null}</Row>
                  <Row k="Square footage">
                    {L.sf ? `${L.sf.toLocaleString()}${L.sf_source ? ` (${L.sf_source})` : ''}`
                          : <span className="neg">not published. Ask on the call.</span>}
                  </Row>
                  <Row k="Rent per sq ft">{L.sf && L.rent ? `$${(L.rent / L.sf).toFixed(2)}` : 'not computable without a size'}</Row>
                  <Row k="Estimated market rent">{L.est_market_rent ? money(L.est_market_rent) : null}</Row>
                  <Row k="Versus market">
                    {L.discount_pct != null ? (
                      <b className={L.discount_pct > 0 ? 'pos' : 'neg'}>
                        {L.discount_pct > 0 ? '-' : '+'}{Math.abs(L.discount_pct)}%
                        {L.comps_count ? ` against ${L.comps_count} comparable unit(s)` : ''}
                      </b>) : null}
                  </Row>
                  <Row k="Bedrooms / baths">{`${L.beds ?? '?'} / ${L.baths ?? '?'}`}</Row>
                  <Row k="Floor">{L.floor ?? null}</Row>
                  <Row k="Broker fee">{L.fee ? `${L.fee}${L.fee_paid_by ? ` (${L.fee_paid_by} pays)` : ''}` : null}</Row>
                  <Row k="Concessions">{L.concessions_text ?? null}</Row>
                  <Row k="Move-in">{L.available_date ?? null}</Row>
                </dl>

                <h5>The building</h5>
                <dl className="kv">
                  <Row k="Building">{b?.name ?? L.building_name ?? null}</Row>
                  <Row k="Neighborhood">{L.neighborhood ?? null}</Row>
                  <Row k="Built">{b?.year_built ?? null}</Row>
                  <Row k="Renovated">{b?.year_renovated ?? null}</Row>
                  <Row k="Units">{b?.units ?? null}</Row>
                  <Row k="Classification">{buildingLabel(data, L)}</Row>
                  <Row k="Management">{b?.management ?? null}</Row>
                  <Row k="Tax program">{b?.program ?? null}</Row>
                  <Row k="Benefit status">{b?.benefit_status ?? null}</Row>
                  <Row k="Transit">{b?.transit ?? null}</Row>
                </dl>
                {amen.length ? (<><h5>Amenities</h5><p>{amen.map((k) => k.replace(/_/g, ' ')).join(' · ')}</p></>) : null}

                <h5>Availability</h5>
                <dl className="kv">
                  <Row k="Confidence"><b className={`av-${av.level.toLowerCase()}`}>{av.level}</b></Row>
                  <Row k="Why">{av.why}</Row>
                  <Row k="Last verified">{L.last_verified ?? 'unknown'}</Row>
                  <Row k="Listed">{`${L.listed_date ?? 'unknown'}${L.days_on_market != null ? ` · ${L.days_on_market} days on market` : ''}`}</Row>
                  <Row k="Found on">
                    {L.url ? <a href={L.url} target="_blank" rel="noreferrer">{L.source ?? 'listing'}</a> : L.source ?? null}
                  </Row>
                  <Row k="Other sources confirming">
                    {L.cross_check?.sources_confirming?.length
                      ? L.cross_check.sources_confirming.join(', ')
                      : <span className="sub">None found. Single-source availability.</span>}
                  </Row>
                </dl>

                <h5>Rent stabilization</h5>
                <div className={`stabbig stab-${sc}`}>{STAB_LONG[sc]}</div>
                <ul className="evlist">
                  {(L.stabilization?.reasons ?? ['No reasoning supplied.']).map((x, i) => <li key={i}>{x}</li>)}
                </ul>
                {sc !== 'confirmed' && (
                  <p className="hint">
                    Not confirmed. For any individual apartment the standing position is: potentially
                    stabilized, tenant-specific DHCR verification required. Pull the unit rent history
                    from HCR before signing.
                  </p>
                )}

                <h5>Comparable apartments</h5>
                {L.comparables?.length ? (
                  <table className="cmp">
                    <thead><tr><th>Address</th><th>Rent</th><th>Sq ft</th><th>$/sf</th></tr></thead>
                    <tbody>
                      {L.comparables.map((c, i) => (
                        <tr key={i}>
                          <td>{c.address}</td><td>{money(c.rent)}</td>
                          <td>{c.sf ? c.sf.toLocaleString() : '-'}</td>
                          <td>{c.sf ? `$${(c.rent / c.sf).toFixed(2)}` : '-'}</td>
                        </tr>))}
                    </tbody>
                  </table>
                ) : <p className="hint">No comparable set attached. Use Find More Like This below.</p>}
                {L.value_reasons ? (<><h5>Why this is or is not good value</h5><p>{L.value_reasons}</p></>) : null}

                <h5>Fit and value</h5>
                <div className="scorerow">
                  <div><div className="sn">{r.fit}</div><div className="sl">Fit Score</div></div>
                  <div><div className="sn">{Math.round(r.value)}</div><div className="sl">Value Score, {valueLabel(r.value)}</div></div>
                </div>
                <div className="breakdown">
                  {WEIGHT_KEYS.map(([k, label]) => {
                    const v = Math.max(0, Math.min(100, r.comp[k] ?? 50));
                    return (<div className="brow" key={k}><span>{label}</span><i style={{ width: `${v}%` }} /><b>{Math.round(v)}</b></div>);
                  })}
                </div>

                <h5>Actions</h5>
                <div className="dacts">
                  <button className="primary" onClick={findMore}>Find More Like This</button>
                  <button onClick={deepSearch}>Deep Search this building</button>
                  <button className={prefs.saved[L.id] ? 'on' : ''} onClick={() => toggleSave(L)}>
                    {prefs.saved[L.id] ? 'Saved' : 'Save'}
                  </button>
                  <button className={prefs.followed[L.building_id] ? 'on' : ''} onClick={() => toggleFollow(L.building_id)}>
                    {prefs.followed[L.building_id] ? 'Following building' : 'Follow building'}
                  </button>
                  <button onClick={() => { hide(L); openDetail(null); }}>Hide</button>
                  {L.url ? <button onClick={() => window.open(L.url!, '_blank')}>Open listing</button> : null}
                </div>

                <h5>Private notes</h5>
                <textarea rows={3} value={notes[L.id] ?? ''} placeholder="Stays on this machine."
                          onChange={(e) => setNote(L.id, e.target.value)} />
              </div>
            </>
          );
        })() : null}
      </div>
    </>
  );
}

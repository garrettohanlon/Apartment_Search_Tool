'use client';
/**
 * The one page. Navigation is four sections and nothing else; everything lives
 * inside them. Search is primary, the map is a panel you open.
 */
import dynamic from 'next/dynamic';
import { useStore, type Sub, type Tab } from '@/lib/store';
import { MoreFilters, PrimaryControls, RankBar, SearchBar } from '@/components/SearchPanel';
import ResultCard from '@/components/ResultCard';
import DetailDrawer from '@/components/DetailDrawer';
import {
  BuildingsToWatch, CompareView, HoodPicker, OffMarket, SavedView, StabilizedResults,
} from '@/components/Views';

// Leaflet touches window on import, so it must stay off the server render.
const MapPanel = dynamic(() => import('@/components/MapPanel'), { ssr: false });

const NAV: [Tab, string][] = [
  ['search', 'Search'], ['stab', 'Rent-Stabilized'], ['saved', 'Saved'], ['compare', 'Compare'],
];

function SubTabs({ items }: { items: [Sub, string][] }) {
  const { sub, setSub } = useStore();
  return (
    <div className="subtabs">
      {items.map(([k, label]) => (
        <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{label}</button>
      ))}
    </div>
  );
}

function Discoveries() {
  const { data, rows, openDetail } = useStore();
  const list = [...(data?.discoveries ?? [])];
  const gem = rows.find((r) => (r.L.discount_pct ?? 0) >= 12);
  if (gem) list.push({ kind: 'Exceptional value', listing_id: gem.L.id,
    text: `${gem.L.address ?? ''}${gem.L.unit ? ` #${gem.L.unit}` : ''} is about ${Math.abs(gem.L.discount_pct!)}% below estimated market for comparable inventory nearby.` });
  const lead = rows.find((r) => r.L.listing_grade === 'building_indicated'
    && ['highly_likely', 'possible'].includes(r.L.stabilization?.class ?? ''));
  if (lead) list.push({ kind: 'Rent-stabilized lead', listing_id: lead.L.id,
    text: `${lead.L.building_name ?? lead.L.address} has stabilization evidence and a two-bedroom advertised directly. Unit status needs confirmation by phone.` });
  if (!list.length) return null;

  return (
    <div className="discs">
      {list.slice(0, 4).map((d, i) => (
        <div className="disc" key={i}>
          <div className="dkind">{d.kind ?? 'Discovery'}</div>
          <div className="dtext">{d.text}</div>
          {d.listing_id ? (
            <button className="linkbtn" onClick={() => {
              const r = rows.find((x) => x.L.id === d.listing_id);
              if (r) openDetail(r);
            }}>Open</button>
          ) : null}
        </div>))}
    </div>
  );
}

function ResultsFeed() {
  const { data, demo, rows, near, prefs, setImp, setShowMore } = useStore();
  const blocked = data?.coverage?.sources_blocked ?? [];

  return (
    <>
      {demo && (
        <div className="notice">
          <b>Demo data.</b> Fabricated examples so you can try the interface. Nothing here is a real apartment.
        </div>)}

      {rows.length === 0 ? (
        <div className="empty">
          <h3>Nothing currently available matches</h3>
          <p>No verified live unit clears your required filters. Try raising max rent, lowering minimum
            size, setting Rent stabilized to Preferred rather than Required, or adding neighborhoods.</p>
          {prefs.imps.sf === 'req' && (
            <button className="linkbtn" onClick={() => setImp('sf', 'strong')}>
              Make minimum size a preference rather than a requirement
            </button>)}
        </div>
      ) : (
        <>
          <div className="rescount">Showing the {Math.min(rows.length, 20)} strongest of {rows.length} available</div>
          {rows.slice(0, 20).map((r) => <ResultCard key={r.L.id} r={r} />)}
        </>
      )}

      {near.length > 0 && (
        <div className="nearwrap">
          <button className="morebtn" onClick={() => setShowMore(false)}>{near.length} one filter away</button>
          <p className="hint">
            Not in your results. Each is blocked by geography alone or by exactly one required filter,
            shown so a single preference never silently deletes a good apartment.
          </p>
          {near.slice(0, 10).map((r) => <ResultCard key={r.L.id} r={r} dim />)}
        </div>)}

      {blocked.length > 0 && (
        <div className="covnote">
          <b>Coverage gap.</b> {blocked.length} source(s) blocked automated access on the last run:{' '}
          {blocked.join(', ')}. Inventory covered only by those is missing, not absent.
        </div>)}
    </>
  );
}

export default function Page() {
  const { data, loading, demo, loadDemo, tab, setTab, sub, prefs, compare } = useStore();
  const savedCount = Object.keys(prefs.saved).length + Object.keys(prefs.followed).length;

  return (
    <>
      <header className="top">
        <div className="brand">Apartment Search</div>
        <nav id="nav">
          {NAV.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
              {k === 'saved' && savedCount ? <i>{savedCount}</i> : null}
              {k === 'compare' && compare.length ? <i>{compare.length}</i> : null}
            </button>))}
        </nav>
        <div className="spacer" />
        <div className={`stamp${demo ? ' demo' : ''}`}>
          {demo ? 'DEMO DATA, nothing here is real'
            : loading ? 'loading'
            : data ? `${data.date ?? ''} · ${data.listings.filter((l) => l.availability_status !== 'rented').length} scanned`
            : 'no data'}
        </div>
      </header>

      <main>
        {tab === 'search' && (
          <>
            <SearchBar />
            <PrimaryControls />
            <MoreFilters />
            {!data && !loading ? (
              <div className="empty">
                <h3>No dataset loaded</h3>
                <p>This screen renders <code>inventory-latest.json</code> from the nightly agent run.
                  Nothing has been generated yet, or the file is not being served next to this page.</p>
                <p>Generate it with <code>run.sh</code> in the agent directory. The agent searches
                  broadly, verifies each unit is genuinely available, scores it, and writes the dataset.</p>
                <button className="primary" onClick={loadDemo}>Load demo data</button>
              </div>
            ) : (
              <>
                <RankBar />
                <Discoveries />
                <SubTabs items={[['apts', 'Available Apartments'], ['watch', 'Buildings to Watch']]} />
                {sub === 'watch' ? <BuildingsToWatch /> : <ResultsFeed />}
                <MapPanel />
              </>
            )}
          </>
        )}

        {tab === 'stab' && (
          <>
            <SearchBar placeholder="Rent-stabilized 2BR, 1,200+ sq ft, Chelsea or West Village, under $7,000" />
            <div className="lead">
              <b>Rent-Stabilized Opportunities.</b> This mode does not look for listings containing the
              words &quot;rent stabilized&quot;. It works building-first: identify buildings likely to hold
              regulated units from building age, unit count, J-51 and 421-a or 421-g history, prior
              stabilized listings, regulatory agreements and owner portfolios, then check whether anything
              qualifying is actually available. Being in a regulated building does not make a specific
              apartment regulated.
            </div>
            <PrimaryControls />
            <SubTabs items={[['apts', 'Available Apartments'], ['watch', 'Buildings to Watch'], ['off', 'Off-Market / Under-the-Radar']]} />
            {sub === 'apts' && <StabilizedResults />}
            {sub === 'watch' && <BuildingsToWatch />}
            {sub === 'off' && <OffMarket />}
          </>
        )}

        {tab === 'saved' && <SavedView />}
        {tab === 'compare' && <CompareView />}
      </main>

      <DetailDrawer />
      <HoodPicker />
    </>
  );
}

'use client';
/**
 * The primary screen: one search bar, seven controls, everything else behind
 * More Filters. Feature density is deliberately traded away for the ability to
 * describe what you want in a sentence and see results.
 */
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { ask } from '@/lib/ask';
import { ADVANCED_FILTERS, FILTER_BY_K, MODES, WEIGHT_KEYS, type FilterDef } from '@/lib/engine';
import { HOODS } from '@/lib/geography';
import type { Importance } from '@/lib/types';

const PLACEHOLDER =
  'Find me a nice renovated 2BR over 1,200 sq ft under $6,000 in Chelsea, West Village, ' +
  'East Village, UES, or the West Side below 38th. Prioritize rent stabilized and good value.';

export function SearchBar({ placeholder }: { placeholder?: string }) {
  const { query, setQuery, prefs, patchPrefs, queueRequest } = useStore();
  const [flash, setFlash] = useState<string[] | null>(null);

  const run = () => {
    if (!query.trim()) return;
    const r = ask(query, prefs);
    patchPrefs(r.prefs);
    if (r.queue) queueRequest({ type: 'freeform_query', instruction: query });
    setFlash(
      r.changes.length
        ? [...r.changes, ...r.notes]
        : ['Nothing in that mapped onto a filter, so it has been queued for the next agent run.',
           'This box searches the inventory already loaded. Finding listings that are not in today\'s dataset needs a live web search.'],
    );
    setTimeout(() => setFlash(null), 9000);
  };

  return (
    <div className="hero">
      <h1>What are you looking for?</h1>
      <div className="sbox">
        <input
          type="text"
          value={query}
          placeholder={placeholder ?? PLACEHOLDER}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          aria-label="Describe what you are looking for"
        />
        <button onClick={run}>Search</button>
      </div>
      {flash ? (
        <div className="notice" role="status">
          <b>Applied</b>
          <ul style={{ margin: '6px 0 0 18px' }}>{flash.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      ) : (
        <p className="herohint">
          Type it however you like. Everything below updates to match, and the interface tells you
          exactly what it changed.
        </p>
      )}
    </div>
  );
}

function EnumSeg({ k }: { k: string }) {
  const { prefs, setVal } = useStore();
  const f = FILTER_BY_K[k];
  if (!f.opts) return null;
  return (
    <div className="segsm">
      {f.opts.map(([v, label]) => (
        <button key={v} className={prefs.vals[k] === v ? 'on' : ''} onClick={() => setVal(k, v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function PrimaryControls() {
  const { prefs, setVal, setHoodPicker } = useStore();
  const onCount = HOODS.filter((h) => prefs.hoodsOn[h.id] && !prefs.hoodsEx[h.id]).length;

  return (
    <div className="pcontrols">
      <div className="pc">
        <div className="pclabel">Max monthly rent</div>
        <div className="inline">
          <span className="pre">$</span>
          <input type="number" step={250} value={prefs.vals.rent[1]}
                 onChange={(e) => setVal('rent', [prefs.vals.rent[0], Number(e.target.value)])} />
          <span className="suf">/mo</span>
        </div>
      </div>

      <div className="pc">
        <div className="pclabel">Minimum size</div>
        <div className="inline">
          <input type="number" step={50} value={prefs.vals.sf}
                 onChange={(e) => setVal('sf', Number(e.target.value))} />
          <span className="suf">sq ft min</span>
        </div>
        <div className="pcnote">Unpublished sizes are shown, not filtered out</div>
      </div>

      <div className="pc">
        <div className="pclabel">Bedrooms</div>
        <div className="segsm">
          {[1, 2, 3].map((v) => (
            <button key={v} className={prefs.vals.beds === v ? 'on' : ''} onClick={() => setVal('beds', v)}>
              {v === 3 ? '3+' : v}
            </button>
          ))}
        </div>
      </div>

      <div className="pc">
        <div className="pclabel">Neighborhoods</div>
        <button className="pcbtn" onClick={() => setHoodPicker(true)}>{onCount} selected</button>
      </div>

      <div className="pc"><div className="pclabel">Rent stabilized</div><EnumSeg k="stab" /></div>
      <div className="pc"><div className="pclabel">Building quality</div><EnumSeg k="bq" /></div>
      <div className="pc"><div className="pclabel">Condition</div><EnumSeg k="construction" /></div>

      <div className="pc">
        <div className="pclabel">Move in</div>
        <div className="inline">
          <button className={prefs.vals.moveIn ? 'pcbtn' : 'pcbtn on'} onClick={() => setVal('moveIn', '')}>
            Available now
          </button>
          <input type="date" value={prefs.vals.moveIn || ''}
                 onChange={(e) => setVal('moveIn', e.target.value)} />
        </div>
      </div>
    </div>
  );
}

const IMP_OPTS: [Importance, string, string][] = [
  ['req', 'R', 'Required, excludes non-matches'],
  ['strong', 'S', 'Strong preference, costs points only'],
  ['nice', 'N', 'Nice to have, small penalty'],
  ['off', '–', 'Ignored'],
];

function ImpCtl({ k }: { k: string }) {
  const { prefs, setImp } = useStore();
  return (
    <div className="imp">
      {IMP_OPTS.map(([v, t, title]) => (
        <button key={v} data-v={v} title={title}
                className={prefs.imps[k] === v ? 'on' : ''} onClick={() => setImp(k, v)}>{t}</button>
      ))}
    </div>
  );
}

function FilterRow({ f }: { f: FilterDef }) {
  const { prefs, setVal } = useStore();
  const v = prefs.vals[f.k];
  return (
    <div className="row">
      <label>{f.label}</label>
      {f.type === 'bool' && (
        <input type="checkbox" checked={!!v} onChange={(e) => setVal(f.k, e.target.checked)} />
      )}
      {f.type === 'enum' && (
        <select value={v} onChange={(e) => setVal(f.k, e.target.value)}>
          {f.opts?.map(([ov, ol]) => <option key={ov} value={ov}>{ol}</option>)}
        </select>
      )}
      {f.type === 'date' && (
        <input type="date" value={v || ''} onChange={(e) => setVal(f.k, e.target.value)} />
      )}
      {f.type === 'num' && (
        <>
          <input type="range" min={f.min} max={f.max} step={f.step} value={v}
                 onChange={(e) => setVal(f.k, Number(e.target.value))} />
          <span className="num">{v}</span>
        </>
      )}
      {f.type === 'range' && (
        <div className="inline">
          <input type="number" value={v[0]} onChange={(e) => setVal(f.k, [Number(e.target.value), v[1]])} />
          <span className="suf">to</span>
          <input type="number" value={v[1]} onChange={(e) => setVal(f.k, [v[0], Number(e.target.value)])} />
        </div>
      )}
      <ImpCtl k={f.k} />
    </div>
  );
}

export function MoreFilters() {
  const { showMore, setShowMore, prefs, setWeight, patchPrefs, resetPrefs } = useStore();
  const groups = [...new Set(ADVANCED_FILTERS.map((f) => f.group))];
  const [draft, setDraft] = useState<Record<string, string>>({});

  const addTag = (key: 'exStreets' | 'exBuildings') => {
    const v = (draft[key] ?? '').trim();
    if (!v) return;
    patchPrefs({ [key]: [...prefs[key], v] } as never);
    setDraft((d) => ({ ...d, [key]: '' }));
  };

  return (
    <div className="more">
      <button className="morebtn" onClick={() => setShowMore(!showMore)}>
        {showMore ? 'Hide filters' : 'More filters · amenities, floor, light, views, fees, lease, freshness, streets, weights'}
      </button>
      {showMore && (
        <div className="moreinner">
          {groups.map((g) => (
            <div className="mcol" key={g}>
              <h6>{g}</h6>
              {ADVANCED_FILTERS.filter((f) => f.group === g).map((f) => <FilterRow key={f.k} f={f} />)}
            </div>
          ))}

          <div className="mcol">
            <h6>Ranking weights</h6>
            {WEIGHT_KEYS.map(([k, label]) => (
              <div className="row" key={k}>
                <label>{label}</label>
                <input type="range" min={0} max={40} value={prefs.weights[k]}
                       onChange={(e) => setWeight(k, Number(e.target.value))} />
                <span className="num">{prefs.weights[k]}</span>
              </div>
            ))}
          </div>

          <div className="mcol">
            <h6>Exclude</h6>
            {([['exStreets', 'Streets or blocks', 'e.g. 8th Ave'],
               ['exBuildings', 'Buildings', 'building id']] as const).map(([key, label, ph]) => (
              <div key={key}>
                <div className="row"><label>{label}</label></div>
                <input type="text" placeholder={`${ph}  (Enter)`} value={draft[key] ?? ''}
                       onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                       onKeyDown={(e) => { if (e.key === 'Enter') addTag(key); }} />
                <div className="tagin">
                  {prefs[key].map((s, i) => (
                    <span className="t" key={s + i}>{s}{' '}
                      <b onClick={() => patchPrefs({ [key]: prefs[key].filter((_, ix) => ix !== i) } as never)}>&times;</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <button className="linkbtn" onClick={() => { if (confirm('Reset filters and weights? Saved apartments are kept.')) resetPrefs(); }}>
              Reset everything to my defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RankBar() {
  const { prefs, setMode } = useStore();
  return (
    <div className="rankbar">
      <span className="rlabel">Rank by</span>
      {Object.entries(MODES).map(([k, v]) => (
        <button key={k} className={prefs.mode === k ? 'on' : ''} onClick={() => setMode(k)}>{v.label}</button>
      ))}
    </div>
  );
}

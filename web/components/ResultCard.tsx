'use client';
/**
 * The simple card. Words, not metrics: stabilization, building class, value and
 * availability as labels. Every number lives in the detail drawer.
 */
import { useStore } from '@/lib/store';
import {
  availability, buildingLabel, money, STAB_SHORT, valueLabel,
} from '@/lib/engine';
import type { Scored } from '@/lib/types';

export default function ResultCard({ r, dim }: { r: Scored; dim?: boolean }) {
  const { data, prefs, compare, toggleCompare, toggleSave, openDetail } = useStore();
  if (!data) return null;
  const L = r.L;
  const sc = L.stabilization?.class ?? 'unknown';
  const av = availability(L);
  const saved = !!prefs.saved[L.id];
  const comparing = compare.includes(L.id);

  return (
    <div className={`rcard${comparing ? ' sel' : ''}${dim ? ' dim' : ''}`}>
      <div className="rtop" onClick={() => openDetail(r)} role="button" tabIndex={0}
           onKeyDown={(e) => { if (e.key === 'Enter') openDetail(r); }}>
        <div className="rleft">
          <div className="raddr">
            {L.address ?? 'address not available'}
            {L.unit ? <span> #{L.unit}</span> : null}
          </div>
          <div className="rsub">{[L.building_name, L.neighborhood].filter(Boolean).join(' · ')}</div>
          <div className="rfacts">
            {L.beds ?? '?'}BR<i>|</i>{L.baths ?? '?'} bath<i>|</i>
            {L.sf ? `${L.sf.toLocaleString()} sq ft` : <em>size not published</em>}
          </div>
          <div className="rtags">
            <button className={`tg stab-${sc}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      alert(
                        `${STAB_SHORT[sc]}\n\n` +
                        (L.stabilization?.reasons ?? ['No reasoning supplied.']).map((x) => `• ${x}`).join('\n') +
                        (sc !== 'confirmed'
                          ? '\n\nNot confirmed. Potentially stabilized, tenant-specific DHCR verification required.'
                          : ''),
                      );
                    }}>
              Rent stabilized: {STAB_SHORT[sc]}
            </button>
            <span className="tg">Building: {buildingLabel(data, L)}</span>
            <span className={`tg val-${valueLabel(r.value).toLowerCase()}`}>Value: {valueLabel(r.value)}</span>
            <button className={`tg av-${av.level.toLowerCase()}`}
                    onClick={(e) => { e.stopPropagation(); alert(`Availability confidence: ${av.level}\n\n${av.why}`); }}>
              Available: {av.level === 'Low' ? 'Unconfirmed' : 'Yes'}
            </button>
          </div>
        </div>
        <div className="rright">
          <div className="rrent">{L.rent != null ? money(L.rent) : 'rent n/a'}</div>
          {r.eff != null && r.eff !== L.rent ? <div className="reff">effective {money(r.eff)}</div> : null}
          <div className="rver">Last verified {(L.last_verified ?? 'unknown').slice(0, 10)}</div>
          <div className="rver">Confidence: {av.level}</div>
        </div>
      </div>

      <div className="racts">
        <button className="primary" onClick={() => openDetail(r)}>View Details</button>
        <button className={comparing ? 'on' : ''} onClick={() => toggleCompare(L.id)}>
          {comparing ? 'Comparing' : 'Compare'}
        </button>
        <button className={saved ? 'on' : ''} onClick={() => toggleSave(L)}>{saved ? 'Saved' : 'Save'}</button>
      </div>

      {r.nearReason ? <div className="nearwhy">{r.nearReason}</div> : null}
    </div>
  );
}

'use client';
/**
 * All client state in one context. Preferences persist to localStorage so the
 * search survives a reload; nothing leaves the machine.
 *
 * Deliberately not a data-fetching layer. The dataset is produced by the nightly
 * agent and loaded once; every interaction is a pure recomputation over it.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Dataset, Importance, Listing, Scored } from './types';
import { FILTERS, MODES, defaultPrefs, nearMisses, results, type Prefs, type Weights } from './engine';

const LS = 'aw.next.v1.';
function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const v = window.localStorage.getItem(LS + key); return v ? (JSON.parse(v) as T) : fallback; }
  catch { return fallback; }
}
function persist(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS + key, JSON.stringify(value)); } catch { /* quota */ }
}

export type Tab = 'search' | 'stab' | 'saved' | 'compare';
export type Sub = 'apts' | 'watch' | 'off';

export interface QueuedRequest {
  type: 'deep_search' | 'find_more_like' | 'freeform_query';
  at: string;
  instruction?: string;
  target_kind?: string;
  target_id?: string;
  target_label?: string;
  seed?: Record<string, unknown>;
}

interface Ctx {
  data: Dataset | null;
  loading: boolean;
  demo: boolean;
  loadDemo: () => void;

  prefs: Prefs;
  setVal: (k: string, v: unknown) => void;
  setImp: (k: string, v: Importance) => void;
  setWeight: (k: keyof Weights, v: number) => void;
  setMode: (m: string) => void;
  toggleHood: (id: string) => void;
  setHoods: (on: Record<string, boolean>, ex?: Record<string, boolean>) => void;
  patchPrefs: (patch: Partial<Prefs>) => void;
  resetPrefs: () => void;

  tab: Tab; setTab: (t: Tab) => void;
  sub: Sub; setSub: (s: Sub) => void;
  showMore: boolean; setShowMore: (b: boolean) => void;
  query: string; setQuery: (q: string) => void;

  rows: Scored[];
  near: Scored[];

  compare: string[]; toggleCompare: (id: string) => void; clearCompare: () => void;
  toggleSave: (L: Listing) => void;
  hide: (L: Listing) => void;
  toggleFollow: (buildingId: string) => void;
  notes: Record<string, string>; setNote: (id: string, text: string) => void;

  requests: QueuedRequest[];
  queueRequest: (r: Omit<QueuedRequest, 'at'>) => void;
  exportSignals: () => void;

  detail: Scored | null; openDetail: (s: Scored | null) => void;
  hoodPicker: boolean; setHoodPicker: (b: boolean) => void;
}

const StoreCtx = createContext<Ctx | null>(null);
export const useStore = () => {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore must be used inside <StoreProvider>');
  return c;
};

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);

  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [tab, setTab] = useState<Tab>('search');
  const [sub, setSub] = useState<Sub>('apts');
  const [showMore, setShowMore] = useState(false);
  const [query, setQuery] = useState('');
  const [compare, setCompare] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<QueuedRequest[]>([]);
  const [detail, setDetail] = useState<Scored | null>(null);
  const [hoodPicker, setHoodPicker] = useState(false);

  // Hydrate after mount so server and client markup match.
  useEffect(() => {
    const stored = load<Partial<Prefs> | null>('prefs', null);
    if (stored) {
      const base = defaultPrefs();
      // Repair values persisted under an older schema rather than crashing a control.
      const vals = { ...base.vals, ...(stored.vals ?? {}) };
      for (const f of FILTERS) {
        if (f.type === 'enum' && !f.opts?.some(([v]) => v === vals[f.k])) vals[f.k] = f.def;
      }
      setPrefs({ ...base, ...stored, vals, imps: { ...base.imps, ...(stored.imps ?? {}) },
                 weights: { ...base.weights, ...(stored.weights ?? {}) } });
    }
    setNotes(load('notes', {}));
    setRequests(load('requests', []));
    setQuery(load('query', ''));
  }, []);

  useEffect(() => { persist('prefs', prefs); }, [prefs]);
  useEffect(() => { persist('notes', notes); }, [notes]);
  useEffect(() => { persist('requests', requests); }, [requests]);
  useEffect(() => { persist('query', query); }, [query]);

  // Load the dataset the agent produced.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const injected = (globalThis as { __AW_DATA__?: Dataset }).__AW_DATA__;
      if (injected) { setData(injected); setDemo(!!injected.demo); setLoading(false); return; }
      for (const url of ['./inventory-latest.json', '/inventory-latest.json']) {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) continue;
          const j = (await r.json()) as Dataset;
          // Spread first, then guarantee the two arrays exist.
          if (!cancelled) {
            setData({ ...j, buildings: j.buildings ?? [], listings: j.listings ?? [] });
            setDemo(!!j.demo);
          }
          break;
        } catch { /* try the next path */ }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const patchPrefs = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const setVal = useCallback((k: string, v: unknown) =>
    setPrefs((p) => ({ ...p, vals: { ...p.vals, [k]: v } })), []);
  const setImp = useCallback((k: string, v: Importance) =>
    setPrefs((p) => ({ ...p, imps: { ...p.imps, [k]: v } })), []);
  const setWeight = useCallback((k: keyof Weights, v: number) =>
    setPrefs((p) => ({ ...p, weights: { ...p.weights, [k]: v } })), []);
  const setMode = useCallback((m: string) =>
    setPrefs((p) => ({ ...p, mode: m, weights: { ...(MODES[m] ?? MODES.best).w } })), []);
  const toggleHood = useCallback((id: string) => setPrefs((p) => {
    const on = { ...p.hoodsOn }, ex = { ...p.hoodsEx };
    if (ex[id]) { delete ex[id]; on[id] = true; }
    else if (on[id]) { on[id] = false; }
    else { ex[id] = true; }
    return { ...p, hoodsOn: on, hoodsEx: ex };
  }), []);
  const setHoods = useCallback((on: Record<string, boolean>, ex: Record<string, boolean> = {}) =>
    setPrefs((p) => ({ ...p, hoodsOn: on, hoodsEx: ex })), []);
  const resetPrefs = useCallback(() => setPrefs((p) => ({ ...defaultPrefs(),
    saved: p.saved, hidden: p.hidden, followed: p.followed })), []);

  const toggleCompare = useCallback((id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])), []);
  const clearCompare = useCallback(() => setCompare([]), []);

  const toggleSave = useCallback((L: Listing) => setPrefs((p) => {
    const saved = { ...p.saved };
    if (saved[L.id]) delete saved[L.id];
    else saved[L.id] = { id: L.id, building_id: L.building_id, at: Date.now() };
    return { ...p, saved };
  }), []);
  const hide = useCallback((L: Listing) => setPrefs((p) =>
    ({ ...p, hidden: { ...p.hidden, [L.id]: L.building_id } })), []);
  const toggleFollow = useCallback((id: string) => setPrefs((p) => {
    const followed = { ...p.followed };
    if (followed[id]) delete followed[id]; else followed[id] = { at: Date.now() };
    return { ...p, followed };
  }), []);
  const setNote = useCallback((id: string, text: string) =>
    setNotes((n) => ({ ...n, [id]: text })), []);

  const queueRequest = useCallback((r: Omit<QueuedRequest, 'at'>) =>
    setRequests((q) => [...q, { ...r, at: new Date().toISOString() }]), []);

  const exportSignals = useCallback(() => {
    const payload = { exported_at: new Date().toISOString(), prefs, notes, requests };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'signals.json';
    a.click();
  }, [prefs, notes, requests]);

  const loadDemo = useCallback(() => {
    import('./demo').then((m) => { setData(m.demoData()); setDemo(true); setLoading(false); });
  }, []);

  const rows = useMemo(() => results(data, prefs), [data, prefs]);
  const near = useMemo(() => nearMisses(data, prefs), [data, prefs]);

  const value: Ctx = {
    data, loading, demo, loadDemo,
    prefs, setVal, setImp, setWeight, setMode, toggleHood, setHoods, patchPrefs, resetPrefs,
    tab, setTab, sub, setSub, showMore, setShowMore, query, setQuery,
    rows, near,
    compare, toggleCompare, clearCompare,
    toggleSave, hide, toggleFollow, notes, setNote,
    requests, queueRequest, exportSignals,
    detail, openDetail: setDetail, hoodPicker, setHoodPicker,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

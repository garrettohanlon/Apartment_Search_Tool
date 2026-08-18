'use client';
/**
 * Simple map. Price markers, click a building to see its available units, draw a
 * boundary. Deliberately a panel rather than the centre of the experience.
 *
 * Honest limitation: "Search this area" re-filters the loaded dataset. It cannot
 * fetch new inventory, because there is no live listing API behind this.
 */
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import { useStore } from '@/lib/store';
import { money, STAB_ORDER } from '@/lib/engine';

export default function MapPanel() {
  const { rows, prefs, patchPrefs, openDetail } = useStore();
  const [open, setOpen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const polyRef = useRef<LayerGroup | null>(null);
  const ptsRef = useRef<[number, number][]>([]);

  // Create the map once the panel is open and the host div exists.
  useEffect(() => {
    if (!open || mapRef.current || !hostRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !hostRef.current) return;
      const map = L.map(hostRef.current, { zoomControl: true, preferCanvas: true })
        .setView([40.736, -73.995], 13);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        { maxZoom: 19, attribution: '&copy; OpenStreetMap, &copy; CARTO', subdomains: 'abcd' }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      polyRef.current = L.layerGroup().addTo(map);
      map.on('click', (e) => {
        if (!drawing) return;
        ptsRef.current.push([e.latlng.lng, e.latlng.lat]);
        paint(L, true);
      });
      map.on('dblclick', () => {
        if (!drawing) return;
        setDrawing(false);
        patchPrefs({ poly: ptsRef.current.length >= 3 ? [...ptsRef.current] : null });
      });
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 40);
    })();
    return () => { cancelled = true; };
  }, [open, drawing, patchPrefs]);

  const paint = async (L: typeof import('leaflet'), preview: boolean) => {
    if (!polyRef.current) return;
    polyRef.current.clearLayers();
    const pts = preview ? ptsRef.current : (prefs.poly ?? []);
    if (!pts.length) return;
    L.polygon(pts.map(([lng, lat]) => [lat, lng] as [number, number]),
      { color: '#000', weight: 1, fillColor: '#000', fillOpacity: 0.04, dashArray: preview ? '3 3' : undefined })
      .addTo(polyRef.current);
  };

  // Redraw markers whenever the result set changes.
  useEffect(() => {
    if (!open || !mapRef.current || !layerRef.current) return;
    (async () => {
      const L = (await import('leaflet')).default;
      const layer = layerRef.current!;
      layer.clearLayers();
      rows.forEach((r) => {
        const { lat, lon } = r.L;
        if (lat == null || lon == null) return;
        const stab = STAB_ORDER[r.L.stabilization?.class ?? 'unknown'] >= 3;
        const icon = L.divIcon({
          className: '', iconSize: [52, 20], iconAnchor: [26, 20],
          html: `<div class="rentmark${stab ? ' stab' : ''}">${r.L.rent != null ? money(r.L.rent).replace('$', '') : 'n/a'}</div>`,
        });
        L.marker([lat, lon], { icon })
          .bindTooltip(
            `<b>${r.L.address ?? ''}</b>${r.L.unit ? ` #${r.L.unit}` : ''}<br>` +
            `${money(r.L.rent)} · ${r.L.sf ? `${r.L.sf} sq ft` : 'size n/a'}<br>Fit ${r.fit}`,
            { direction: 'top' })
          .on('click', () => openDetail(r))
          .addTo(layer);
      });
      paint(L, false);
    })();
  }, [open, rows, prefs.poly, openDetail]);

  return (
    <div className="mapwrap">
      <button className="morebtn" onClick={() => setOpen(!open)}>{open ? 'Hide map' : 'Show map'}</button>
      {open && (
        <div className="mapbox">
          <div ref={hostRef} id="map" />
          <div className="maptools">
            <button className={drawing ? 'on' : ''} onClick={() => { ptsRef.current = []; setDrawing(!drawing); }}>
              {drawing ? 'Click map, double-click to close' : 'Draw boundary'}
            </button>
            <button onClick={() => { ptsRef.current = []; setDrawing(false); patchPrefs({ poly: null }); }}>Clear</button>
          </div>
        </div>)}
    </div>
  );
}

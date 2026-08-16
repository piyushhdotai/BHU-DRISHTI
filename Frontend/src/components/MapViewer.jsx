import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import Compare from '@maplibre/maplibre-gl-compare';
import axios from 'axios';
import 'maplibre-gl/dist/maplibre-gl.css';

// maplibre-gl v6 derives its web-worker URL from import.meta.url, which breaks
// under Vite's dependency pre-bundling (worker file 404s -> geojson sources
// silently never load). Point it at static copies served from public/ instead.
// NOTE: these must match the installed maplibre-gl version — re-copy from
// node_modules/maplibre-gl/dist/ after upgrading the package.
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

const API_BASE = 'http://127.0.0.1:8000';

// Change category -> fill color (legend order). Anything not listed here
// falls back to FALLBACK_COLOR on the map.
const CATEGORY_COLORS = [
  ['#f97316', 'New Construction'],
  ['#ec0c0c', 'Deforestation / Canopy Loss'],
  ['#ec16e4', 'Surface Excavation / Mining'],
  ['#3b82f6', 'Riverbed Shift'],
  ['#0fea08', 'Cleared Ground / Other'],
];
const FALLBACK_COLOR = '#9ca3af';

const CATEGORY_FILL = [
  'match', ['get', 'category'],
  ...CATEGORY_COLORS.flatMap(([color, label]) => [label, color]),
  FALLBACK_COLOR,
];

// Layer / source IDs used on both maps (per map instance, so no collisions).
const AOI_SOURCE = 'aoi-source';
const AOI_FILL = 'aoi-fill';
const AOI_OUTLINE = 'aoi-outline';
const CHANGES_SOURCE = 'changes-source';
const CHANGES_FILL = 'changes-fill';
const CHANGES_OUTLINE = 'changes-outline';
// Image source+layer IDs differ per map: T1 on the before map, T2 on the after map.
const T1_IMAGE = 't1-image';
const T2_IMAGE = 't2-image';

const DARK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } }]
};

/* ------------------------------------------------------------------ */
/* GeoJSON helpers                                                     */
/* ------------------------------------------------------------------ */

// image_bounds order from the backend: [top-left, top-right, bottom-right, bottom-left].
// The AOI is the image footprint as a closed GeoJSON polygon ring.
function buildAoiFeature(imageBounds, siteId) {
  const [tl, tr, br, bl] = imageBounds;
  return {
    type: 'Feature',
    properties: { name: siteId },
    geometry: {
      type: 'Polygon',
      coordinates: [[tl, tr, br, bl, tl]]
    }
  };
}

function boundsFromImageBounds(imageBounds) {
  const bounds = new maplibregl.LngLatBounds(imageBounds[0], imageBounds[0]);
  for (const corner of imageBounds) bounds.extend(corner);
  return bounds;
}

function isValidImageBounds(imageBounds) {
  return Array.isArray(imageBounds)
    && imageBounds.length === 4
    && imageBounds.every((c) => Array.isArray(c) && c.length === 2
      && Number.isFinite(c[0]) && Number.isFinite(c[1]));
}

// Collection-level validation. A valid FeatureCollection with zero features
// is a legitimate "no changes" result, not an error.
function isValidFeatureCollection(data) {
  return !!data && data.type === 'FeatureCollection' && Array.isArray(data.features);
}

function isValidFeature(feature) {
  return !!feature
    && feature.type === 'Feature'
    && !!feature.geometry
    && typeof feature.geometry.type === 'string'
    && Array.isArray(feature.geometry.coordinates);
}

/* ------------------------------------------------------------------ */
/* Statistics / formatting helpers                                     */
/* ------------------------------------------------------------------ */

// Areas come from the backend (area_sqm / area_hectares per feature); the
// frontend only sums them — it never recomputes geometry areas.
function computeStats(features) {
  const totalAreaSqm = features.reduce(
    (sum, f) => sum + Number(f.properties?.area_sqm || 0),
    0
  );
  return {
    changeCount: features.length,
    totalAreaSqm,
    totalAreaHectares: totalAreaSqm / 10000
  };
}

function formatSqm(value) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })} m²`;
}

function formatHa(value) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 })} ha`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function buildPopupHtml(props, fallbackSite) {
  const p = props || {};
  const id = p.id ?? '—';
  const category = escapeHtml(p.category ?? 'Unknown');
  const severity = escapeHtml(p.severity ?? '—');
  const site = escapeHtml(p.site_id ?? fallbackSite ?? '—');
  const areaSqm = Number.isFinite(Number(p.area_sqm)) ? formatSqm(p.area_sqm) : '—';
  const areaHa = Number.isFinite(Number(p.area_hectares)) ? formatHa(p.area_hectares) : '—';
  const confidence = Number.isFinite(Number(p.confidence))
    ? `${Math.round(Number(p.confidence) * 100)}%`
    : '—';
  const row = (k, v) => `<div class="change-popup-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  return `<div class="change-popup">
    <div class="change-popup-title">Change #${escapeHtml(id)}</div>
    ${row('Category', category)}
    ${row('Area', areaSqm)}
    ${row('Area', areaHa)}
    ${row('Severity', severity)}
    ${row('Confidence', confidence)}
    ${row('Site', site)}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Map layer management                                                */
/* ------------------------------------------------------------------ */

// Remove all per-site layers/sources from a map so no stale data survives
// a site switch. Layers are removed before their sources.
function clearSiteLayers(map, imageId) {
  for (const layerId of [CHANGES_FILL, CHANGES_OUTLINE, AOI_FILL, AOI_OUTLINE, imageId]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const sourceId of [CHANGES_SOURCE, AOI_SOURCE, imageId]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

// Add a site's imagery + AOI + change polygons to one map.
// Draw order (bottom -> top): epoch image, AOI fill, AOI outline,
// change fills, change outlines.
function addSiteLayers(map, { imageId, imageUrl, imageBounds, aoiData, changesData }) {
  map.addSource(imageId, { type: 'image', url: imageUrl, coordinates: imageBounds });
  map.addLayer({ id: imageId, type: 'raster', source: imageId });

  map.addSource(AOI_SOURCE, { type: 'geojson', data: aoiData });
  map.addLayer({
    id: AOI_FILL,
    type: 'fill',
    source: AOI_SOURCE,
    paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.08 }
  });
  map.addLayer({
    id: AOI_OUTLINE,
    type: 'line',
    source: AOI_SOURCE,
    paint: { 'line-color': '#38bdf8', 'line-width': 2.5 }
  });

  map.addSource(CHANGES_SOURCE, { type: 'geojson', data: changesData });
  map.addLayer({
    id: CHANGES_FILL,
    type: 'fill',
    source: CHANGES_SOURCE,
    paint: { 'fill-color': CATEGORY_FILL, 'fill-opacity': 0.55 }
  });
  map.addLayer({
    id: CHANGES_OUTLINE,
    type: 'line',
    source: CHANGES_SOURCE,
    paint: { 'line-color': '#ffffff', 'line-width': 1.8 }
  });
}

function whenMapReady(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.once('load', resolve);
  });
}

// Custom map control: reset the view to the AOI / image extent.
class FitAoiControl {
  constructor(onFit) {
    this._onFit = onFit;
  }

  onAdd(map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Reset view / Fit AOI';
    button.setAttribute('aria-label', 'Reset view / Fit AOI');
    button.textContent = '⛶';
    button.addEventListener('click', this._onFit);
    this._container.appendChild(button);
    return this._container;
  }

  onRemove() {
    this._container?.remove();
    this._map = undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

const STATUS_COLORS = { loading: '#facc15', loaded: '#4ade80', empty: '#38bdf8', error: '#f87171' };

function StatsPanel({ stats, selectedSite }) {
  return (
    <div style={{
      position: 'absolute', top: 16, left: 16, zIndex: 10,
      background: 'rgba(2, 6, 23, 0.85)', border: '1px solid #334155',
      borderRadius: '8px', padding: '12px 16px', minWidth: '190px',
      fontFamily: 'sans-serif', pointerEvents: 'none'
    }}>
      <div style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '12px', marginBottom: '8px', letterSpacing: '0.05em' }}>
        GIS ANALYSIS
      </div>
      {[
        ['Site', stats?.siteId ?? selectedSite],
        ['AOI', stats ? 'Active' : '—'],
        ['Detected Changes', stats ? String(stats.changeCount) : '—'],
        ['Total Change', stats ? formatSqm(stats.totalAreaSqm) : '—'],
        ['Total Change', stats ? formatHa(stats.totalAreaHectares) : '—'],
      ].map(([k, v], i) => (
        <div key={`${k}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', marginTop: '4px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>{k}</span>
          <span style={{ color: '#f1f5f9', fontSize: '12px', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div style={{
      background: 'rgba(2, 6, 23, 0.85)', padding: '10px 14px', borderRadius: '6px',
      border: '1px solid #334155', pointerEvents: 'none', fontFamily: 'sans-serif'
    }}>
      <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Change Categories</div>
      {CATEGORY_COLORS.map(([color, label]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <span style={{ width: '12px', height: '12px', background: color, borderRadius: '2px', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#cbd5e1', fontSize: '12px', whiteSpace: 'nowrap' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function EpochChip({ label }) {
  return (
    <div style={{
      background: 'rgba(2, 6, 23, 0.8)', color: '#fff', padding: '6px 12px',
      borderRadius: '4px', fontWeight: 'bold', fontSize: '13px',
      border: '1px solid #334155', fontFamily: 'sans-serif', pointerEvents: 'none'
    }}>
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MapViewer                                                           */
/* ------------------------------------------------------------------ */

export default function MapViewer({ onLogout }) {
  const containerRef = useRef(null);
  const beforeMapRef = useRef(null);
  const afterMapRef = useRef(null);
  const beforeMapInstance = useRef(null);
  const afterMapInstance = useRef(null);
  const compareInstance = useRef(null);
  const popupRef = useRef(null);
  const aoiBoundsRef = useRef(null);

  const [selectedSite, setSelectedSite] = useState('train_2');
  const [sites, setSites] = useState([]);
  const [status, setStatus] = useState({ kind: 'loading', message: 'Loading GIS analysis...' });
  const [stats, setStats] = useState(null);

  // Keep the current site id available to click handlers without re-binding them.
  const selectedSiteRef = useRef(selectedSite);
  useEffect(() => { selectedSiteRef.current = selectedSite; }, [selectedSite]);

  // Load the available site list once from the backend (never hardcoded).
  useEffect(() => {
    axios.get(`${API_BASE}/api/sites`)
      .then((res) => {
        const list = res.data.sites || [];
        console.log('Available sites:', list);
        if (list.length) {
          setSites(list);
          setSelectedSite((cur) => (list.includes(cur) ? cur : list[0]));
        }
      })
      .catch((err) => {
        // Keep the default site so analysis can still be attempted.
        console.error('Failed to load site list:', err.message);
      });
  }, []);

  // Initialize both maps + the before/after swipe control exactly once.
  useEffect(() => {
    const beforeMap = new maplibregl.Map({
      container: beforeMapRef.current,
      style: DARK_STYLE,
      center: [-97.7431, 30.2672],
      zoom: 14
    });
    const afterMap = new maplibregl.Map({
      container: afterMapRef.current,
      style: DARK_STYLE,
      center: [-97.7431, 30.2672],
      zoom: 14
    });
    beforeMapInstance.current = beforeMap;
    afterMapInstance.current = afterMap;

    // Draggable vertical divider: T1 (before) on the left, T2 (after) on the
    // right. The plugin clips the two map containers and keeps them in sync,
    // so the divider only reveals/hides imagery — polygons never move.
    compareInstance.current = new Compare(beforeMap, afterMap, containerRef.current, {
      orientation: 'vertical'
    });

    const fitToAoi = () => {
      if (aoiBoundsRef.current) {
        afterMap.fitBounds(aoiBoundsRef.current, { padding: 40 });
      }
    };

    // Zoom / compass, fullscreen (whole comparison), reset-to-AOI.
    // Controls sit on both maps at the same position; the swipe clip makes
    // exactly one set visible at a time.
    for (const map of [beforeMap, afterMap]) {
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.FullscreenControl({ container: containerRef.current }), 'top-right');
      map.addControl(new FitAoiControl(fitToAoi), 'top-right');
    }

    // Change-polygon popup + pointer cursor on both panes. Layer presence is
    // checked at click time; only one popup exists at a time.
    const registerPopupHandlers = (map) => {
      map.on('click', (e) => {
        if (!map.getLayer(CHANGES_FILL)) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: [CHANGES_FILL] });
        if (!hits.length) return;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(buildPopupHtml(hits[0].properties, selectedSiteRef.current))
          .addTo(map);
      });
      map.on('mouseenter', CHANGES_FILL, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', CHANGES_FILL, () => { map.getCanvas().style.cursor = ''; });
    };
    registerPopupHandlers(beforeMap);
    registerPopupHandlers(afterMap);

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      compareInstance.current?.remove();
      compareInstance.current = null;
      beforeMapInstance.current?.remove();
      afterMapInstance.current?.remove();
      beforeMapInstance.current = null;
      afterMapInstance.current = null;
    };
  }, []);

  // Load analysis + imagery for the selected site and rebuild all layers.
  useEffect(() => {
    let isMounted = true;

    const loadSite = async () => {
      console.log('Selected site:', selectedSite);
      setStatus({ kind: 'loading', message: 'Loading GIS analysis...' });

      let data;
      try {
        const response = await axios.get(`${API_BASE}/api/analyze/${selectedSite}`);
        data = response.data;
      } catch (err) {
        // API error (network failure, 404 for unknown site, ...).
        console.error('Failed to load GIS analysis:', err.message);
        if (!isMounted) return;
        popupRef.current?.remove();
        for (const map of [beforeMapInstance.current, afterMapInstance.current]) {
          if (map) clearSiteLayers(map, map === beforeMapInstance.current ? T1_IMAGE : T2_IMAGE);
        }
        aoiBoundsRef.current = null;
        setStats(null);
        setStatus({ kind: 'error', message: `Failed to load GIS analysis (${err.message})` });
        return;
      }

      // Invalid response shape: log the actual payload and bail out cleanly.
      if (!isValidFeatureCollection(data) || !isValidImageBounds(data.image_bounds)) {
        console.error('Invalid GeoJSON response:', data);
        if (!isMounted) return;
        popupRef.current?.remove();
        for (const map of [beforeMapInstance.current, afterMapInstance.current]) {
          if (map) clearSiteLayers(map, map === beforeMapInstance.current ? T1_IMAGE : T2_IMAGE);
        }
        aoiBoundsRef.current = null;
        setStats(null);
        setStatus({ kind: 'error', message: 'Failed to load GIS analysis (invalid response)' });
        return;
      }

      const allFeatures = data.features;
      const validFeatures = allFeatures.filter(isValidFeature);
      if (validFeatures.length !== allFeatures.length) {
        console.warn(`Skipped ${allFeatures.length - validFeatures.length} invalid feature(s).`);
      }
      console.log('Feature count:', validFeatures.length);
      console.log('Image bounds:', data.image_bounds);

      const beforeMap = beforeMapInstance.current;
      const afterMap = afterMapInstance.current;
      if (!beforeMap || !afterMap) return;

      // Both styles must be ready before sources/layers are touched.
      await Promise.all([whenMapReady(beforeMap), whenMapReady(afterMap)]);
      if (!isMounted) return;

      popupRef.current?.remove();
      popupRef.current = null;

      const imageBounds = data.image_bounds;
      const aoiData = buildAoiFeature(imageBounds, selectedSite);
      const changesData = { type: 'FeatureCollection', features: validFeatures };

      // Rebuild both panes atomically: remove the previous site's layers,
      // then add the new site's T1/T2 imagery, AOI and change polygons.
      // The same image_bounds drives imagery, AOI and polygons on both maps,
      // keeping everything spatially aligned.
      clearSiteLayers(beforeMap, T1_IMAGE);
      addSiteLayers(beforeMap, {
        imageId: T1_IMAGE,
        imageUrl: `${API_BASE}/api/sites/${selectedSite}/image/T1`,
        imageBounds, aoiData, changesData
      });

      clearSiteLayers(afterMap, T2_IMAGE);
      addSiteLayers(afterMap, {
        imageId: T2_IMAGE,
        imageUrl: `${API_BASE}/api/sites/${selectedSite}/image/T2`,
        imageBounds, aoiData, changesData
      });

      // Frame both maps on the site extent and keep panning within it.
      const siteBounds = boundsFromImageBounds(imageBounds);
      aoiBoundsRef.current = siteBounds;
      beforeMap.setMaxBounds(siteBounds);
      afterMap.setMaxBounds(siteBounds);
      afterMap.fitBounds(siteBounds, { padding: 40, duration: 600 });

      const nextStats = { siteId: selectedSite, ...computeStats(validFeatures) };
      setStats(nextStats);

      if (validFeatures.length === 0) {
        setStatus({ kind: 'empty', message: 'No changes detected in this AOI.' });
      } else {
        setStatus({ kind: 'loaded', message: 'GIS analysis loaded' });
      }
    };

    loadSite();

    return () => {
      isMounted = false;
    };
  }, [selectedSite]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#0f172a', zIndex: 9999 }}>
      {/* Header: title, load status, site selector */}
      <div style={{ height: '65px', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '18px', fontFamily: 'sans-serif' }}>BHU-DRISHTI Change Detection</span>
          <span style={{ color: STATUS_COLORS[status.kind], fontSize: '13px', fontWeight: '600', fontFamily: 'sans-serif' }}>
            {status.message}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '15px', color: '#cbd5e1', fontWeight: '600', fontFamily: 'sans-serif' }}>Region:</label>
          <select
            value={selectedSite}
            disabled={status.kind === 'loading'}
            onChange={(e) => setSelectedSite(e.target.value)}
            style={{
              padding: '8px 16px', borderRadius: '6px', background: '#1e293b', color: '#fff',
              border: '2px solid #38bdf8', fontSize: '15px', outline: 'none',
              cursor: status.kind === 'loading' ? 'wait' : 'pointer',
              opacity: status.kind === 'loading' ? 0.6 : 1
            }}
          >
            {(sites.length ? sites : [selectedSite]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onLogout?.()}
            style={{
              border: '1px solid rgba(148, 163, 184, 0.4)',
              background: '#1e293b',
              color: '#f8fafc',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'sans-serif',
              transition: 'background-color 0.15s ease'
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.backgroundColor = '#334155';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = '#1e293b';
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Interactive map with draggable T1/T2 comparison divider */}
      <div ref={containerRef} className="comparison-container">
        <div ref={beforeMapRef} className="compare-map" />
        <div ref={afterMapRef} className="compare-map" />

        {/* Statistics overlay */}
        <StatsPanel stats={stats} selectedSite={selectedSite} />

        {/* Epoch labels + category legend */}
        <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 10 }}>
          <EpochChip label="T1 / BEFORE" />
        </div>
        <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <Legend />
          <EpochChip label="T2 / AFTER" />
        </div>
      </div>
    </div>
  );
}

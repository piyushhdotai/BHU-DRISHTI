import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import axios from 'axios';
import 'maplibre-gl/dist/maplibre-gl.css';

// maplibre-gl v6 derives its web-worker URL from import.meta.url, which breaks
// under Vite's dependency pre-bundling (worker file 404s -> geojson sources
// silently never load). Point it at static copies served from public/ instead.
// NOTE: these must match the installed maplibre-gl version — re-copy from
// node_modules/maplibre-gl/dist/ after upgrading the package.
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

const CATEGORY_COLORS = [
  ['#f97316', 'Unauthorized Construction'],
  ['#ef4444', 'Deforestation / Canopy Loss'],
  ['#a855f7', 'Surface Excavation / Mining'],
  ['#3b82f6', 'Riverbed Shift'],
  ['#eab308', 'Cleared Ground / Other'],
];

export default function MapViewer() {
  const beforeMapRef = useRef(null);
  const afterMapRef = useRef(null);
  const [selectedSite, setSelectedSite] = useState('train_2');
  const [debugStatus, setDebugStatus] = useState('Ready');
  const [sites, setSites] = useState([]);

  // Load the available site list once for the region selector.
  useEffect(() => {
    axios.get('http://127.0.0.1:8000/api/sites')
      .then((res) => {
        const list = res.data.sites || [];
        if (list.length) {
          setSites(list);
          setSelectedSite((cur) => (list.includes(cur) ? cur : list[0]));
        }
      })
      .catch(() => { /* keep the default site if the list fails to load */ });
  }, []);
  
  const beforeMapInstance = useRef(null);
  const afterMapInstance = useRef(null);
  const mapsLoaded = useRef(false);

  useEffect(() => {
    if (mapsLoaded.current) return;
    mapsLoaded.current = true;

    // No basemap: the two panes show only the site's T1/T2 imagery on a
    // dark background, so the comparison is limited to the image extent.
    const darkStyle = {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } }]
    };

    const initialCenter = [-97.7431, 30.2672];

    beforeMapInstance.current = new maplibregl.Map({
      container: beforeMapRef.current,
      style: darkStyle,
      center: initialCenter,
      zoom: 14
    });

    afterMapInstance.current = new maplibregl.Map({
      container: afterMapRef.current,
      style: darkStyle,
      center: initialCenter,
      zoom: 14
    });

    let isMoving = false;
    const syncMaps = (source, target) => {
      if (isMoving) return;
      isMoving = true;
      target.jumpTo({ center: source.getCenter(), zoom: source.getZoom(), bearing: source.getBearing(), pitch: source.getPitch() });
      isMoving = false;
    };

    beforeMapInstance.current.on('move', () => syncMaps(beforeMapInstance.current, afterMapInstance.current));
    afterMapInstance.current.on('move', () => syncMaps(afterMapInstance.current, beforeMapInstance.current));

    // Hotspot detail popup (registered once; layer presence is checked at click time)
    afterMapInstance.current.on('click', (e) => {
      const map = afterMapInstance.current;
      if (!map.getLayer('hotspots-fill')) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['hotspots-fill'] });
      if (!hits.length) return;
      const p = hits[0].properties;
      new maplibregl.Popup({ closeButton: false, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:sans-serif;font-size:13px;line-height:1.5;">
            <strong>${p.category}</strong><br/>
            Area: ${p.area_hectares} ha (${p.area_sqm} m&sup2;)<br/>
            Severity: ${p.severity}<br/>
            Confidence: ${Math.round((p.confidence || 0) * 100)}%
          </div>`
        )
        .addTo(map);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSite = async () => {
      setDebugStatus(`Fetching data for ${selectedSite}...`);
      try {
        const response = await axios.get(`http://127.0.0.1:8000/api/analyze/${selectedSite}`);
        const geojson = response.data;

        if (!isMounted) return;

        console.log("RECEIVED GEOJSON:", geojson);

        if (!geojson.features || geojson.features.length === 0) {
          setDebugStatus(`WARNING: ${selectedSite} returned 0 polygons.`);
          return;
        }

        const afterMap = afterMapInstance.current;
        const beforeMap = beforeMapInstance.current;

        if (!afterMap || !beforeMap) return;

        const updateMapLayers = () => {
          // Lay the actual epoch imagery on each map at the site's footprint
          // (same pixel -> lon/lat mapping the backend uses for polygons).
          const imageBounds = geojson.image_bounds;
          const setEpochImage = (map, key, epoch) => {
            const sourceId = `${key}-image`;
            const layerId = `${key}-layer`;
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
            map.addSource(sourceId, {
              type: 'image',
              url: `http://127.0.0.1:8000/api/sites/${selectedSite}/image/${epoch}`,
              coordinates: imageBounds
            });
            map.addLayer({ id: layerId, type: 'raster', source: sourceId });
          };

          setEpochImage(beforeMap, 't1', 'T1');
          setEpochImage(afterMap, 't2', 'T2');

          if (afterMap.getLayer('hotspots-fill')) afterMap.removeLayer('hotspots-fill');
          if (afterMap.getLayer('hotspots-outline')) afterMap.removeLayer('hotspots-outline');
          if (afterMap.getSource('hotspots')) afterMap.removeSource('hotspots');

          afterMap.addSource('hotspots', { type: 'geojson', data: geojson });
          
          afterMap.addLayer({
            id: 'hotspots-fill',
            type: 'fill',
            source: 'hotspots',
            paint: {
              'fill-color': [
                'match', ['get', 'category'],
                'Unauthorized Construction', '#f97316',
                'Deforestation / Canopy Loss', '#ef4444',
                'Surface Excavation / Mining', '#a855f7',
                'Riverbed Shift', '#3b82f6',
                '#eab308'
              ],
              'fill-opacity': 0.55
            }
          });

          afterMap.addLayer({
            id: 'hotspots-outline',
            type: 'line',
            source: 'hotspots',
            paint: { 'line-color': '#ffffff', 'line-width': 2 }
          });

          // Frame and lock both maps to the site image extent so the
          // comparison stays limited to the imagery.
          // imageBounds order: [top-left, top-right, bottom-right, bottom-left]
          const siteBounds = new maplibregl.LngLatBounds(imageBounds[3], imageBounds[1]);
          beforeMap.setMaxBounds(siteBounds);
          afterMap.setMaxBounds(siteBounds);
          beforeMap.fitBounds(siteBounds, { padding: 12, duration: 0 });
        };

        const whenStyleReady = (map, fn) => {
          if (map.isStyleLoaded()) fn();
          else map.once('style.load', fn);
        };
        // Both maps must have their style ready before receiving layers.
        whenStyleReady(beforeMap, () => whenStyleReady(afterMap, updateMapLayers));

        setDebugStatus(`SUCCESS: Loaded ${geojson.features.length} polygons for ${selectedSite}.`);

      } catch (err) {
        if (isMounted) setDebugStatus(`ERROR: ${err.message}`);
      }
    };

    loadSite();

    return () => {
      isMounted = false;
    };
  }, [selectedSite]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#0f172a', zIndex: 9999 }}>
      <div style={{ height: '65px', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '18px' }}>BHU-DRISHTI Change Detection</span>
          <span style={{ color: debugStatus.includes('SUCCESS') ? '#4ade80' : debugStatus.includes('ERROR') ? '#f87171' : '#facc15', fontSize: '13px', fontWeight: '600' }}>
            {debugStatus}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '15px', color: '#cbd5e1', fontWeight: '600' }}>Region:</label>
          <select value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)} style={{ padding: '8px 16px', borderRadius: '6px', background: '#1e293b', color: '#fff', border: '2px solid #38bdf8', fontSize: '15px', cursor: 'pointer', outline: 'none' }}>
            {(sites.length ? sites : [selectedSite]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, width: '100%', position: 'relative' }}>
        <div style={{ flex: 1, height: '100%', position: 'relative', borderRight: '2px solid #334155' }}>
          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, background: 'rgba(2, 6, 23, 0.8)', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', border: '1px solid #334155' }}>
            Before Imagery
          </div>
          <div ref={beforeMapRef} style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ flex: 1, height: '100%', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, background: 'rgba(2, 6, 23, 0.8)', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', border: '1px solid #334155' }}>
            After (Change Detection Overlays)
          </div>
          <div ref={afterMapRef} style={{ width: '100%', height: '100%' }} />
          <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10, background: 'rgba(2, 6, 23, 0.85)', padding: '10px 14px', borderRadius: '6px', border: '1px solid #334155', pointerEvents: 'none' }}>
            <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Change Categories</div>
            {CATEGORY_COLORS.map(([color, label]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span style={{ width: '12px', height: '12px', background: color, borderRadius: '2px', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ color: '#cbd5e1', fontSize: '12px', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

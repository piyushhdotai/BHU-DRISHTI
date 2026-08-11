import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import axios from 'axios';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function MapViewer() {
  const beforeMapRef = useRef(null);
  const afterMapRef = useRef(null);
  const [selectedSite, setSelectedSite] = useState('train_2');
  const [debugStatus, setDebugStatus] = useState('Ready');
  
  const beforeMapInstance = useRef(null);
  const afterMapInstance = useRef(null);
  const mapsLoaded = useRef(false);

  useEffect(() => {
    if (mapsLoaded.current) return;
    mapsLoaded.current = true;

    const satelliteStyle = {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri'
        }
      },
      layers: [{ id: 'satellite-layer', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 20 }]
    };

    const initialCenter = [-97.7431, 30.2672];

    beforeMapInstance.current = new maplibregl.Map({
      container: beforeMapRef.current,
      style: satelliteStyle,
      center: initialCenter,
      zoom: 14
    });

    afterMapInstance.current = new maplibregl.Map({
      container: afterMapRef.current,
      style: satelliteStyle,
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
          if (afterMap.getLayer('hotspots-fill')) afterMap.removeLayer('hotspots-fill');
          if (afterMap.getLayer('hotspots-outline')) afterMap.removeLayer('hotspots-outline');
          if (afterMap.getSource('hotspots')) afterMap.removeSource('hotspots');

          afterMap.addSource('hotspots', { type: 'geojson', data: geojson });
          
          afterMap.addLayer({
            id: 'hotspots-fill',
            type: 'fill',
            source: 'hotspots',
            paint: { 'fill-color': '#ff00ff', 'fill-opacity': 0.7 }
          });

          afterMap.addLayer({
            id: 'hotspots-outline',
            type: 'line',
            source: 'hotspots',
            paint: { 'line-color': '#ffff00', 'line-width': 4 }
          });

          const bounds = new maplibregl.LngLatBounds();
          let coordCount = 0;

          const extractCoords = (arr) => {
            if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
              bounds.extend([arr[0], arr[1]]);
              coordCount++;
            } else if (Array.isArray(arr)) {
              arr.forEach(extractCoords);
            }
          };

          geojson.features.forEach(f => {
            if (f.geometry && f.geometry.coordinates) {
              extractCoords(f.geometry.coordinates);
            }
          });

          console.log(`Extracted ${coordCount} coordinates. Bounds empty?`, bounds.isEmpty());

          if (coordCount > 0 && !bounds.isEmpty()) {
            beforeMap.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 0 });
          }
        };

        if (afterMap.isStyleLoaded()) {
          updateMapLayers();
        } else {
          afterMap.once('style.load', updateMapLayers);
        }

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
            <option value="train_2">train_2</option>
            <option value="train_3">train_3</option>
            <option value="train_5">train_5</option>
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
        </div>
      </div>
    </div>
  );
}
import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import axios from 'axios';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function MapViewer() {
  const beforeMapRef = useRef(null);
  const afterMapRef = useRef(null);
  const [selectedSite, setSelectedSite] = useState('train_2');
  
  const beforeMapInstance = useRef(null);
  const afterMapInstance = useRef(null);

  // Initialize Maps Once
  useEffect(() => {
    const satelliteStyle = {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: 'Esri, Maxar, Earthstar Geographics'
        }
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster',
          source: 'esri-satellite',
          minzoom: 0,
          maxzoom: 19
        }
      ]
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
    beforeMapInstance.current.on('move', () => {
      if (isMoving) return;
      isMoving = true;
      afterMapInstance.current.jumpTo({
        center: beforeMapInstance.current.getCenter(),
        zoom: beforeMapInstance.current.getZoom(),
        bearing: beforeMapInstance.current.getBearing(),
        pitch: beforeMapInstance.current.getPitch()
      });
      isMoving = false;
    });

    afterMapInstance.current.on('move', () => {
      if (isMoving) return;
      isMoving = true;
      beforeMapInstance.current.jumpTo({
        center: afterMapInstance.current.getCenter(),
        zoom: afterMapInstance.current.getZoom(),
        bearing: afterMapInstance.current.getBearing(),
        pitch: afterMapInstance.current.getPitch()
      });
      isMoving = false;
    });

    return () => {
      beforeMapInstance.current.remove();
      afterMapInstance.current.remove();
    };
  }, []);

  // Fetch and update data when selectedSite changes
  useEffect(() => {
    const fetchSiteData = async () => {
      try {
        const response = await axios.get(`http://127.0.0.1:8000/api/analyze/${selectedSite}`);
        const geojson = response.data;

        const afterMap = afterMapInstance.current;
        const beforeMap = beforeMapInstance.current;

        if (!afterMap) return;

        const applyData = () => {
          if (afterMap.getSource('hotspots')) {
            afterMap.getSource('hotspots').setData(geojson);
          } else {
            afterMap.addSource('hotspots', {
              type: 'geojson',
              data: geojson
            });

            afterMap.addLayer({
              id: 'hotspots-fill',
              type: 'fill',
              source: 'hotspots',
              paint: {
                'fill-color': [
                  'match',
                  ['get', 'severity'],
                  'Critical', '#ef4444',
                  'Medium', '#f59e0b',
                  '#3b82f6'
                ],
                'fill-opacity': 0.7
              }
            });

            afterMap.addLayer({
              id: 'hotspots-outline',
              type: 'line',
              source: 'hotspots',
              paint: {
                'line-color': '#ffffff',
                'line-width': 2
              }
            });
          }

          // Compute bounds to fit view
          const bounds = new maplibregl.LngLatBounds();
          let hasCoordinates = false;

          if (geojson.features && geojson.features.length > 0) {
            geojson.features.forEach((feature) => {
              if (feature.geometry && feature.geometry.coordinates) {
                feature.geometry.coordinates[0].forEach((coord) => {
                  bounds.extend(coord);
                  hasCoordinates = true;
                });
              }
            });
          }

          if (hasCoordinates && !bounds.isEmpty()) {
            beforeMap.fitBounds(bounds, { padding: 60, maxZoom: 17, animate: false });
            afterMap.fitBounds(bounds, { padding: 60, maxZoom: 17, animate: false });
          }
        };

        if (afterMap.isStyleLoaded()) {
          applyData();
        } else {
          afterMap.once('style.load', applyData);
        }

      } catch (err) {
        console.error('Error fetching site data:', err);
      }
    };

    fetchSiteData();
  }, [selectedSite]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', position: 'relative' }}>
      {/* Top Header & Dropdown Control */}
      <div style={{ height: '55px', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 30, color: '#fff', borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '16px', letterSpacing: '0.5px' }}>BHU-DRISHTI Change Detection</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '14px', color: '#94a3b8' }}>Select Region:</label>
          <select 
            value={selectedSite} 
            onChange={(e) => setSelectedSite(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: '6px', background: '#1e293b', color: '#fff', border: '1px solid #475569', fontSize: '14px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="train_2">train_2</option>
            <option value="train_3">train_3</option>
            <option value="train_5">train_5</option>
          </select>
        </div>
      </div>

      {/* Side-by-Side Comparison Panels */}
      <div style={{ display: 'flex', flex: 1, width: '100%', position: 'relative' }}>
        <div style={{ flex: 1, height: '100%', position: 'relative', borderRight: '2px solid #334155' }}>
          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, background: 'rgba(15, 23, 42, 0.85)', color: '#fff', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', backdropFilter: 'blur(4px)' }}>
            Before Imagery
          </div>
          <div ref={beforeMapRef} style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ flex: 1, height: '100%', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, background: 'rgba(15, 23, 42, 0.85)', color: '#fff', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', backdropFilter: 'blur(4px)' }}>
            After (Change Detection Overlays)
          </div>
          <div ref={afterMapRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  );
}
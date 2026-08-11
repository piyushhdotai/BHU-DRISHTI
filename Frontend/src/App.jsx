import React from 'react';
import MapViewer from './components/MapViewer';
import './App.css';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* Platform Title Header Overlay */}
      <header style={{
        position: 'absolute',
        top: '15px',
        left: '15px',
        zIndex: 10,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        color: '#ffffff',
        padding: '12px 20px',
        borderRadius: '8px',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
        fontFamily: 'sans-serif'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#38bdf8' }}>BHU-DRISHTI</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
          Bi-temporal Geospatial Change Detection
        </p>
      </header>

      {/* Main Map Comparison Control */}
      <MapViewer />
    </div>
  );
}

export default App;
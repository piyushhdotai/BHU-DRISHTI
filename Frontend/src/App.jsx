import { useEffect, useState } from 'react';
import MapViewer from './components/MapViewer';
import SplashScreen from './components/SplashScreen';
import './App.css';

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [isSplashFadingOut, setIsSplashFadingOut] = useState(false);

  useEffect(() => {
    if (!showSplash) {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const splashDuration = mediaQuery.matches ? 250 : 2200;
    const fadeOutDelay = mediaQuery.matches ? 0 : 420;

    const finishLoadingTimer = window.setTimeout(() => {
      setIsSplashFadingOut(true);
    }, splashDuration);

    const hideTimer = window.setTimeout(() => {
      setShowSplash(false);
      setIsSplashFadingOut(false);
    }, splashDuration + fadeOutDelay);

    return () => {
      window.clearTimeout(finishLoadingTimer);
      window.clearTimeout(hideTimer);
    };
  }, [showSplash]);

  return (
    <div className="app-shell">
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
      <SplashScreen isVisible={showSplash} isFadingOut={isSplashFadingOut} />
    </div>
  );
}

export default App;
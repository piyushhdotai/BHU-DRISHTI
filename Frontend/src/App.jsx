import { useEffect, useState } from 'react';
import MapViewer from './components/MapViewer';
import SplashScreen from './components/SplashScreen';
import AuthScreen from './components/AuthScreen';
import './App.css';

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [isSplashFadingOut, setIsSplashFadingOut] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem('bhudrishti_auth') === 'true'
  );
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  const handleLogout = () => {
    localStorage.removeItem('bhudrishti_auth');
    setIsAuthenticated(false);
  };

  return (
    <div className="app-shell">
      {showSplash && <SplashScreen isVisible={showSplash} isFadingOut={isSplashFadingOut} />}

      {!showSplash && !isAuthenticated && (
        <AuthScreen onLoginSuccess={() => {
          localStorage.setItem('bhudrishti_auth', 'true');
          setIsAuthenticated(true);
        }} />
      )}

      {isAuthenticated && !showSplash && (
        <MapViewer
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        />
      )}
    </div>
  );
}

export default App;
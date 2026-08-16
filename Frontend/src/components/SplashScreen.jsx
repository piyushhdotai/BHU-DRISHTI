import './SplashScreen.css';

function SplashScreen({ isVisible, isFadingOut }) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`splash-screen ${isFadingOut ? 'splash-screen--fading' : ''}`}
      aria-live="polite"
      aria-busy={isVisible}
    >
      <div className="splash-screen__content">
        <div className="splash-screen__title">BHU-DRISHTI</div>
        <div className="splash-screen__loader" aria-hidden="true">
          <div className="splash-screen__loader-bar" />
        </div>
      </div>
    </div>
  );
}

export default SplashScreen;

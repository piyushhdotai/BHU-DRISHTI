import { useMemo, useState } from 'react';
import './AuthScreen.css';

const ADMIN_EMAIL = 'admin@bhudrishti.gov.in';
const ADMIN_PASSWORD = 'admin123';

function AuthScreen({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
  });
  const [signupForm, setSignupForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loginError, setLoginError] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState('');

  const activeEmail = useMemo(() => {
    if (mode === 'login') {
      return loginForm.email;
    }
    return signupForm.email;
  }, [loginForm.email, mode, signupForm.email]);

  const handleLoginChange = (event) => {
    const { name, value } = event.target;
    setLoginForm((prev) => ({ ...prev, [name]: value }));
    if (loginError) {
      setLoginError('');
    }
  };

  const handleSignupChange = (event) => {
    const { name, value } = event.target;
    setSignupForm((prev) => ({ ...prev, [name]: value }));
    if (signupError) {
      setSignupError('');
    }
    if (signupSuccess) {
      setSignupSuccess('');
    }
  };

  const handleLoginSubmit = (event) => {
    event.preventDefault();

    const trimmedEmail = loginForm.email.trim().toLowerCase();
    const trimmedPassword = loginForm.password;

    if (trimmedEmail === ADMIN_EMAIL && trimmedPassword === ADMIN_PASSWORD) {
      setLoginError('');
      localStorage.setItem('bhudrishti_auth', 'true');
      onLoginSuccess();
      return;
    }

    setLoginError('Invalid email or password');
  };

  const handleSignupSubmit = (event) => {
    event.preventDefault();

    const trimmedEmail = signupForm.email.trim();
    const password = signupForm.password;
    const confirmPassword = signupForm.confirmPassword;

    if (password !== confirmPassword) {
      setSignupError('Passwords do not match');
      setSignupSuccess('');
      return;
    }

    setSignupError('');
    setSignupSuccess('Account created — please log in');

    setMode('login');
    setLoginForm((prev) => ({ ...prev, email: trimmedEmail.toLowerCase() }));
    setSignupForm({
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    });
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
    setLoginError('');
    setSignupError('');
    setSignupSuccess('');
  };

  return (
    <div className="auth-screen" aria-live="polite">
      <div className="auth-screen__content">
        <div className="auth-screen__brand">BHU-DRISHTI</div>

        <div className="auth-screen__card">
          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="auth-screen__form" noValidate>
              <div className="auth-screen__field-group">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  value={loginForm.email}
                  onChange={handleLoginChange}
                  autoComplete="email"
                  placeholder="admin@bhudrishti.gov.in"
                />
              </div>

              <div className="auth-screen__field-group">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  value={loginForm.password}
                  onChange={handleLoginChange}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                />
              </div>

              {loginError && <p className="auth-screen__error">{loginError}</p>}

              <button type="submit" className="auth-screen__button">Log in</button>
            </form>
          ) : (
            <form onSubmit={handleSignupSubmit} className="auth-screen__form" noValidate>
              <div className="auth-screen__field-group">
                <label htmlFor="signup-name">Name</label>
                <input
                  id="signup-name"
                  name="name"
                  type="text"
                  value={signupForm.name}
                  onChange={handleSignupChange}
                  autoComplete="name"
                  placeholder="Your name"
                />
              </div>

              <div className="auth-screen__field-group">
                <label htmlFor="signup-email">Email</label>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  value={signupForm.email}
                  onChange={handleSignupChange}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>

              <div className="auth-screen__field-group">
                <label htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  value={signupForm.password}
                  onChange={handleSignupChange}
                  autoComplete="new-password"
                  placeholder="Create a password"
                />
              </div>

              <div className="auth-screen__field-group">
                <label htmlFor="signup-confirm-password">Confirm Password</label>
                <input
                  id="signup-confirm-password"
                  name="confirmPassword"
                  type="password"
                  value={signupForm.confirmPassword}
                  onChange={handleSignupChange}
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                />
              </div>

              {signupError && <p className="auth-screen__error">{signupError}</p>}
              {signupSuccess && <p className="auth-screen__success">{signupSuccess}</p>}

              <button type="submit" className="auth-screen__button">Sign up</button>
            </form>
          )}

          <p className="auth-screen__toggle">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button type="button" className="auth-screen__link" onClick={toggleMode}>
              {mode === 'login' ? 'Sign Up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default AuthScreen;

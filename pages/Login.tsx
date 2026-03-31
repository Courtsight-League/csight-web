
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, Mail, Loader2 } from 'lucide-react';
import { signInWithGoogle, loginWithEmail, getCurrentUser, resendSignupConfirmation } from '../services/authService';
import { Role } from '../types';
import Logo from '../components/Logo';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('courtsight_remember_email') ? true : false);

  // If already logged in, skip this page and honor any postAuthRedirect
  useEffect(() => {
    const existing = getCurrentUser();
    if (existing) {
      const postAuth = sessionStorage.getItem('postAuthRedirect') || localStorage.getItem('postAuthRedirect');
      if (postAuth) {
        sessionStorage.removeItem('postAuthRedirect');
        localStorage.removeItem('postAuthRedirect');
        navigate(postAuth, { replace: true });
        return;
      }
      const isAdmin = [Role.ADMIN_FULL, Role.ADMIN_MEDIA, Role.ADMIN_SCOREKEEPER, Role.ADMIN_COMMISSIONER].includes(existing.role);
      navigate(isAdmin ? '/admin' : '/my-season', { replace: true });
    }
  }, [navigate]);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setResendMessage(null);
    setShowResendConfirmation(false);
    setIsGoogleLoading(true);
    try {
      // Mark this as a login flow; clear any stale registration flags
      sessionStorage.removeItem('postAuthRedirect');
      localStorage.removeItem('postAuthRedirect');
      sessionStorage.removeItem('startedFromRegistration');
      localStorage.removeItem('startedFromRegistration');
      sessionStorage.setItem('authFlow', 'login');
      localStorage.setItem('authFlow', 'login');

      const user = await signInWithGoogle();

      // If a session already exists, signInWithGoogle returns the hydrated user (no redirect).
      if (user) {
        const postAuth = sessionStorage.getItem('postAuthRedirect') || localStorage.getItem('postAuthRedirect');
        if (postAuth) {
          sessionStorage.removeItem('postAuthRedirect');
          localStorage.removeItem('postAuthRedirect');
          navigate(postAuth, { replace: true });
          setIsGoogleLoading(false);
          return;
        }
        const isAdmin = [Role.ADMIN_FULL, Role.ADMIN_MEDIA, Role.ADMIN_SCOREKEEPER, Role.ADMIN_COMMISSIONER].includes(user.role);
        navigate(isAdmin ? '/admin' : '/my-season');
        setIsGoogleLoading(false);
      }
      // Otherwise, Supabase will redirect; keep the "Connecting..." state until the page unloads.
    } catch (error: any) {
      console.error("Login failed", error);
      setErrorMsg(error?.message || 'Google sign-in failed. Please try again.');
      setIsGoogleLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setResendMessage(null);
    setShowResendConfirmation(false);
    if (rememberMe) {
      localStorage.setItem('courtsight_remember_email', email);
    } else {
      localStorage.removeItem('courtsight_remember_email');
    }
    setIsLoading(true);
    try {
      const user = await loginWithEmail(email, password);
      // Simulate successful login and redirect
      setTimeout(() => {
        const postAuth = sessionStorage.getItem('postAuthRedirect') || localStorage.getItem('postAuthRedirect');
        if (postAuth) {
          sessionStorage.removeItem('postAuthRedirect');
          localStorage.removeItem('postAuthRedirect');
          navigate(postAuth, { replace: true });
          return;
        }
        // Check for any admin role
        if ([Role.ADMIN_FULL, Role.ADMIN_MEDIA, Role.ADMIN_SCOREKEEPER, Role.ADMIN_COMMISSIONER].includes(user.role)) {
            navigate('/admin');
        } else {
            navigate('/my-season');
        }
      }, 500);
    } catch (error: any) {
      const message = error?.message || 'Invalid email or password.';
      setErrorMsg(message);
      const normalizedMessage = message.toLowerCase();
      setShowResendConfirmation(
        normalizedMessage.includes('email not confirmed') ||
          normalizedMessage.includes('email_not_confirmed')
      );
      console.error("Login failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMsg('Enter your email address first to resend confirmation.');
      return;
    }
    setResendLoading(true);
    setResendMessage(null);
    try {
      await resendSignupConfirmation(normalizedEmail);
      setResendMessage(`Confirmation email sent to ${normalizedEmail}. Check inbox/spam.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to resend confirmation email.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
      <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-fadeIn">
        
        {/* Header */}
        <div className="bg-neutral-900 p-8 border-b border-white/5 text-center">
           <Link to="/" className="inline-block mb-6 text-white">
              <Logo className="h-12 w-auto mx-auto" />
           </Link>
           <h1 className="font-sports text-3xl font-bold text-white uppercase">Member Login</h1>
           <p className="text-gray-400 mt-2 text-sm">Access your stats, team schedule, and media.</p>
        </div>

        <div className="p-8">
          
          {/* Google Sign In */}
          <button 
            onClick={handleGoogleLogin}
            disabled={isGoogleLoading || isLoading}
            className="w-full bg-white hover:bg-gray-100 text-black font-bold py-3 rounded flex items-center justify-center gap-3 transition-colors border border-gray-200 shadow-lg shadow-white/5 disabled:opacity-70"
          >
            {isGoogleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
               <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
            )}
            {isGoogleLoading ? 'Connecting...' : 'Sign in with Google'}
          </button>

          <div className="relative my-8 text-center">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
              <div className="relative z-10 inline-block px-4 bg-brand-dark text-gray-500 text-xs uppercase font-bold">Or sign in with email</div>
          </div>

          {errorMsg && (
            <div className="mb-6 bg-brand-red/10 border border-brand-red/40 text-brand-red text-sm px-4 py-3 rounded-lg flex items-start gap-2">
              <span className="font-bold">Login failed:</span>
              <span className="flex-1">{errorMsg}</span>
            </div>
          )}
          {showResendConfirmation && (
            <div className="mb-6 flex items-center justify-between gap-3 bg-white/5 border border-white/10 text-gray-200 text-xs px-4 py-3 rounded-lg">
              <span>Email not confirmed yet.</span>
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendLoading || isLoading || isGoogleLoading}
                className="px-3 py-2 rounded bg-brand-lime text-black font-bold uppercase tracking-wide text-[11px] disabled:opacity-60"
              >
                {resendLoading ? 'Sending...' : 'Resend Email'}
              </button>
            </div>
          )}
          {resendMessage && (
            <div className="mb-6 bg-brand-lime/10 border border-brand-lime/40 text-brand-lime text-xs px-4 py-3 rounded-lg">
              {resendMessage}
            </div>
          )}

          {/* Email Form */}
          <form onSubmit={handleEmailLogin} className="space-y-6">
            <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Email Address</label>
                <div className="relative">
                    <input 
                        type="email" 
                        required 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-black border border-white/20 rounded px-4 py-3 pl-10 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" 
                        placeholder="you@example.com" 
                    />
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-5 h-5" />
                </div>
            </div>

            <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Password</label>
                <div className="relative">
                    <input 
                        type="password" 
                        required 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-black border border-white/20 rounded px-4 py-3 pl-10 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" 
                        placeholder="••••••••" 
                    />
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-5 h-5" />
                </div>
            </div>

            <div className="flex items-center justify-between text-xs">
                <label className="flex items-center text-gray-400 hover:text-white cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="mr-2 rounded bg-black border-gray-700 text-brand-lime focus:ring-0" 
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    Remember me
                </label>
                <Link to="/forgot-password" className="text-brand-lime hover:underline">Forgot password?</Link>
            </div>

            <button 
                type="submit" 
                disabled={isLoading || isGoogleLoading}
                className="w-full bg-brand-lime hover:bg-white text-black font-sports font-bold text-xl uppercase py-3 rounded transition-all transform hover:scale-[1.01] shadow-xl tracking-wider flex items-center justify-center gap-2 disabled:opacity-70 disabled:scale-100"
            >
                {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
                Log In
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-gray-400">
            Don't have an account? <Link to="/register" className="text-brand-lime font-bold hover:underline">Register Now</Link>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Login;

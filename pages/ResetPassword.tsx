import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Lock, Loader2, ArrowLeft } from 'lucide-react';
import Logo from '../components/Logo';
import { supabase } from '../services/supabaseClient';

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // On mount, process the recovery token from the URL hash (access_token, refresh_token)
  useEffect(() => {
    const hash = location.hash?.replace('#', '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      supabase.auth
        .setSession({ access_token, refresh_token })
        .catch((err) => console.error('Set session error', err))
        .finally(() => {
          // Clean the URL (remove hash) after setting session
          window.history.replaceState({}, document.title, window.location.pathname);
        });
    }
  }, [location.hash]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setStatus('loading');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        throw error;
      }
      setStatus('success');
      // Optionally, return to login after a short delay
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err: any) {
      console.error('Reset password error', err);
      setStatus('error');
      setErrorMsg(err?.message || 'Unable to reset password. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
      <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-fadeIn">
        <div className="bg-neutral-900 p-8 border-b border-white/5 text-center">
          <Link to="/" className="inline-block mb-6 text-white">
            <Logo className="h-12 w-auto mx-auto" />
          </Link>
          <h1 className="font-sports text-3xl font-bold text-white uppercase">Set New Password</h1>
          <p className="text-gray-400 mt-2 text-sm">Enter a new password to complete your reset.</p>
        </div>

        <div className="p-8 space-y-6">
          {status === 'success' ? (
            <div className="bg-brand-lime/10 border border-brand-lime/30 text-brand-lime text-sm px-4 py-3 rounded-lg">
              Password updated. Redirecting to login...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {errorMsg && (
                <div className="bg-brand-red/10 border border-brand-red/40 text-brand-red text-sm px-4 py-3 rounded-lg">
                  {errorMsg}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">New Password</label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-black border border-white/20 rounded px-4 py-3 pl-10 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700"
                    placeholder="Min 8 characters"
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-5 h-5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Confirm Password</label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full bg-black border border-white/20 rounded px-4 py-3 pl-10 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700"
                    placeholder="Re-enter password"
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-5 h-5" />
                </div>
              </div>

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-brand-lime hover:bg-white text-black font-sports font-bold text-xl uppercase py-3 rounded transition-all transform hover:scale-[1.01] shadow-xl tracking-wider flex items-center justify-center gap-2 disabled:opacity-70 disabled:scale-100"
              >
                {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin" />}
                Update Password
              </button>
            </form>
          )}

          <div className="text-center">
            <Link to="/login" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
              <ArrowLeft className="w-4 h-4" />
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;

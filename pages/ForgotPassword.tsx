import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Loader2, ArrowLeft } from 'lucide-react';
import { requestPasswordReset } from '../services/authService';
import Logo from '../components/Logo';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg(null);
    try {
      await requestPasswordReset(email);
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message || 'Unable to send reset link. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
      <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-fadeIn">
        <div className="bg-neutral-900 p-8 border-b border-white/5 text-center">
          <Link to="/" className="inline-block mb-6 text-white">
            <Logo className="h-12 w-auto mx-auto" />
          </Link>
          <h1 className="font-sports text-3xl font-bold text-white uppercase">Reset Password</h1>
          <p className="text-gray-400 mt-2 text-sm">Enter your account email and we’ll send a reset link.</p>
        </div>

        <div className="p-8 space-y-6">
          {status === 'success' ? (
            <div className="bg-brand-lime/10 border border-brand-lime/30 text-brand-lime text-sm px-4 py-3 rounded-lg">
              Check your email for a reset link. You can close this tab after updating your password.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {errorMsg && (
                <div className="bg-brand-red/10 border border-brand-red/40 text-brand-red text-sm px-4 py-3 rounded-lg">
                  {errorMsg}
                </div>
              )}
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

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-brand-lime hover:bg-white text-black font-sports font-bold text-xl uppercase py-3 rounded transition-all transform hover:scale-[1.01] shadow-xl tracking-wider flex items-center justify-center gap-2 disabled:opacity-70 disabled:scale-100"
              >
                {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin" />}
                Send Reset Link
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

export default ForgotPassword;

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import LoadingOverlay from '../components/LoadingOverlay';
import { confirmClaimToken, previewClaimToken, resendClaimInvite } from '../services/playerClaimWorkflowService';

type ClaimPreviewProfile = {
  id: string;
  fullName: string;
  teamName: string;
  seasonLabel: string;
  division?: string;
  claimed?: boolean;
  preferred?: boolean;
};

type ClaimPreviewStatus = 'ready' | 'expired' | 'already_claimed' | 'invalid';

const ClaimProfile: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<ClaimPreviewStatus>('invalid');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [profiles, setProfiles] = useState<ClaimPreviewProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [confirmedIdentity, setConfirmedIdentity] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setMessage(null);
      if (!token) {
        setStatus('invalid');
        setLoading(false);
        return;
      }
      try {
        const result = await previewClaimToken(token);
        if (cancelled) return;
        const nextStatus = result.status || 'invalid';
        setStatus(nextStatus);
        setMaskedEmail(result.emailMasked || '');
        const nextProfiles = (result.profiles || []) as ClaimPreviewProfile[];
        setProfiles(nextProfiles);
        const preferred =
          nextProfiles.find((profile) => profile.preferred && !profile.claimed) ||
          nextProfiles.find((profile) => !profile.claimed) ||
          nextProfiles[0] ||
          null;
        setSelectedProfileId(preferred?.id || '');
        setMessage(result.message || null);
      } catch (err: any) {
        if (cancelled) return;
        setStatus('invalid');
        setError(err?.message || 'Unable to load claim details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await resendClaimInvite({ token });
      setMessage(result.message || 'If your record exists, a new claim email has been sent.');
    } catch (err: any) {
      setError(err?.message || 'Unable to resend claim email.');
    } finally {
      setResending(false);
    }
  };

  const handleConfirmClaim = async () => {
    if (!token) return;
    if (!selectedProfileId) {
      setError('Select your profile first.');
      return;
    }
    if (!password || password.length < 8 || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError('Use at least 8 characters with one number and one special character.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await confirmClaimToken({
        token,
        playerId: selectedProfileId,
        password,
      });

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: result.email,
        password,
      });
      if (signInErr) {
        setMessage('Profile claimed successfully. Please log in manually with your new credentials.');
        return;
      }
      navigate('/my-season', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Unable to claim profile.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
        <LoadingOverlay message="Loading claim details..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 text-white">
      <div className="max-w-3xl mx-auto bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-2xl">
        <h1 className="font-sports text-3xl uppercase mb-2">Claim Your Profile</h1>
        <p className="text-sm text-gray-400 mb-6">
          Verify your identity and set your account password to access your stats.
        </p>

        {error && <div className="mb-4 text-sm text-brand-red">{error}</div>}
        {message && <div className="mb-4 text-sm text-brand-lime">{message}</div>}

        {(status === 'invalid' || status === 'expired' || status === 'already_claimed') && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <p className="text-sm text-gray-300">
                {status === 'expired' && 'This claim link has expired.'}
                {status === 'already_claimed' &&
                  'This profile has already been claimed. If this is incorrect, contact support.'}
                {status === 'invalid' && 'This claim link is invalid or no longer available.'}
              </p>
            </div>
            {(status === 'expired' || status === 'invalid') && (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="px-4 py-3 rounded bg-brand-lime text-black font-bold uppercase text-sm disabled:opacity-60"
              >
                {resending ? 'Sending...' : 'Request New Claim Link'}
              </button>
            )}
            <div className="text-sm text-gray-400">
              <Link to="/contact" className="text-brand-lime hover:underline">
                This Isn't Me / Contact Support
              </Link>
            </div>
          </div>
        )}

        {status === 'ready' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <p className="text-xs uppercase text-brand-grey font-bold mb-2">Profile Confirmation</p>
              <p className="text-sm text-gray-300">
                Email on file: <span className="text-white font-semibold">{maskedEmail || 'Masked email unavailable'}</span>
              </p>
            </div>

            <div className="space-y-3">
              {profiles.map((profile) => (
                <label
                  key={profile.id}
                  className={`block rounded-xl border p-4 cursor-pointer transition ${
                    selectedProfileId === profile.id
                      ? 'border-brand-lime bg-brand-lime/10'
                      : 'border-white/10 bg-black/40 hover:border-white/20'
                  } ${profile.claimed ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="claim-profile"
                      className="mt-1"
                      checked={selectedProfileId === profile.id}
                      onChange={() => setSelectedProfileId(profile.id)}
                      disabled={Boolean(profile.claimed)}
                    />
                    <div>
                      <div className="font-semibold text-white">{profile.fullName}</div>
                      <div className="text-sm text-gray-400">
                        {profile.teamName} • {profile.seasonLabel}
                        {profile.division ? ` • ${profile.division}` : ''}
                      </div>
                      {profile.claimed && <div className="text-xs text-brand-red mt-1">Already claimed</div>}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setConfirmedIdentity(true)}
                disabled={!selectedProfile || Boolean(selectedProfile?.claimed)}
                className="px-4 py-3 rounded bg-brand-lime text-black font-bold uppercase text-sm disabled:opacity-60"
              >
                Yes, This Is Me
              </button>
              <Link
                to="/contact"
                className="px-4 py-3 rounded border border-white/20 text-gray-200 font-bold uppercase text-sm hover:border-brand-lime hover:text-brand-lime"
              >
                This Isn't Me
              </Link>
            </div>

            {confirmedIdentity && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-4">
                <p className="text-xs uppercase text-brand-grey font-bold">Set Password</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white"
                    placeholder="Password"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white"
                    placeholder="Confirm password"
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Use at least 8 characters, one number, and one special character.
                </p>
                <button
                  type="button"
                  onClick={handleConfirmClaim}
                  disabled={submitting}
                  className="px-4 py-3 rounded bg-brand-lime text-black font-bold uppercase text-sm disabled:opacity-60"
                >
                  {submitting ? 'Claiming...' : 'Claim My Profile'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaimProfile;

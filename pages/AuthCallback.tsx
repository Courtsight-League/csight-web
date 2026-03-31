import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hydrateUserFromSupabase } from '../services/authService';
import { Loader2 } from 'lucide-react';
import { Role } from '../types';
import { supabase } from '../services/supabaseClient';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const getSafeRedirect = (value: string | null) => {
    if (!value) return null;
    try {
      const configured = (import.meta.env.VITE_PUBLIC_SITE_URL || '').trim();
      const base = (configured || window.location.origin).replace(/\/+$/, '');
      const target = new URL(value, base);
      const baseUrl = new URL(base);
      if (target.origin !== baseUrl.origin) return null;
      return target.toString();
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        const user = await hydrateUserFromSupabase();
        const nextParam = getSafeRedirect(new URLSearchParams(window.location.search).get('next'));

        if (!user) {
          const fallbackRedirect = sessionStorage.getItem('postAuthRedirect') || localStorage.getItem('postAuthRedirect');
          const target = nextParam || fallbackRedirect || '/login';
          sessionStorage.removeItem('postAuthRedirect');
          localStorage.removeItem('postAuthRedirect');
          if (nextParam) {
            window.location.replace(nextParam);
            return;
          }
          navigate(target, { replace: true });
          return;
        }

        // Handle deep-link return (always prefer stored redirect)
        const redirectPath = sessionStorage.getItem('postAuthRedirect') || localStorage.getItem('postAuthRedirect');
        const startedFromReg = sessionStorage.getItem('startedFromRegistration') || localStorage.getItem('startedFromRegistration');
        const authFlow = sessionStorage.getItem('authFlow') || localStorage.getItem('authFlow');
        sessionStorage.removeItem('postAuthRedirect');
        localStorage.removeItem('postAuthRedirect');
        sessionStorage.removeItem('startedFromRegistration');
        localStorage.removeItem('startedFromRegistration');
        sessionStorage.removeItem('authFlow');
        localStorage.removeItem('authFlow');

        // If started from registration: always send back to that tab and set skip flag
        if (authFlow === 'register' || startedFromReg || nextParam) {
          const target = nextParam || redirectPath || '/portal/register?type=individual';
          try {
            sessionStorage.setItem('skipRegistrationRedirectOnce', 'true');
          } catch {}
          window.location.replace(target);
          return;
        }

        // Otherwise (normal sign-in): if player exists, go dashboard; else honor redirect if any
        let hasPlayer = false;
        try {
          const { data: currentSeason } = await supabase
            .from('seasons')
            .select('id')
            .eq('is_current', true)
            .maybeSingle();
          const seasonId = currentSeason?.id || null;
          if (seasonId) {
            const { data: existingPlayer } = await supabase
              .from('players')
              .select('id')
              .eq('user_id', user.id)
              .eq('season_id', seasonId)
              .maybeSingle();
            hasPlayer = !!existingPlayer?.id;
          }
        } catch {
          hasPlayer = false;
        }

        if (hasPlayer) {
          const isAdmin = [Role.ADMIN_FULL, Role.ADMIN_MEDIA, Role.ADMIN_SCOREKEEPER, Role.ADMIN_COMMISSIONER].includes(user.role);
          navigate(isAdmin ? '/admin' : '/my-season', { replace: true });
          return;
        }

        if (nextParam || redirectPath) {
          window.location.replace(nextParam || redirectPath as string);
          return;
        }

        // Fallback: role-based landing
        if (
          [Role.ADMIN_FULL, Role.ADMIN_MEDIA, Role.ADMIN_SCOREKEEPER, Role.ADMIN_COMMISSIONER].includes(
            user.role
          )
        ) {
          navigate('/admin', { replace: true });
        } else {
          navigate('/my-season', { replace: true });
        }
      } catch (err: any) {
        console.error('Auth callback error', err);
        const fallbackRedirect = sessionStorage.getItem('postAuthRedirect') || localStorage.getItem('postAuthRedirect');
        const target = fallbackRedirect || '/login';
        sessionStorage.removeItem('postAuthRedirect');
        localStorage.removeItem('postAuthRedirect');
        navigate(target, { replace: true });
      }
    };

    run();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-black text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 bg-brand-lime text-black rounded"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-black text-white">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-brand-lime" />
        <p className="text-sm text-gray-300">
          Finishing sign-in… please wait
        </p>
      </div>
    </div>
  );
};

export default AuthCallback;

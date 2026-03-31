import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { signTeamAssetUrl } from './dataCache';
import { User, Role } from '../types';

const STORAGE_KEY = 'courtsight_user';

type ProfileRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string | null;
};

/* ----------------- helpers ----------------- */

function mapAdminRoleToEnum(role?: string | null): Role | null {
  if (!role) return null;
  const normalized = role.toString().toLowerCase();
  if (normalized.includes('full')) return Role.ADMIN_FULL;
  if (normalized.includes('commission')) return Role.ADMIN_COMMISSIONER;
  if (normalized.includes('score')) return Role.ADMIN_SCOREKEEPER;
  if (normalized.includes('media')) return Role.ADMIN_MEDIA;
  if (normalized.includes('member')) return Role.MEMBER;
  return null;
}

async function fetchAdminRole(email?: string | null): Promise<Role | null> {
  if (!email) return null;
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('role')
      .ilike('email', email)
      .maybeSingle();
    if (error) {
      console.warn('admin role lookup failed', error.message);
      return null;
    }
    return mapAdminRoleToEnum(data?.role);
  } catch (err) {
    console.warn('admin role lookup error', err);
    return null;
  }
}

function deriveRoleFromEmailFallback(email?: string | null): Role {
  if (!email) return Role.MEMBER;

  switch (email.toLowerCase()) {
    case 'admin@courtsight.com':
      return Role.ADMIN_FULL;
    case 'media@courtsight.com':
      return Role.ADMIN_MEDIA;
    case 'score@courtsight.com':
      return Role.ADMIN_SCOREKEEPER;
    case 'commish@courtsight.com':
      return Role.ADMIN_COMMISSIONER;
    default:
      return Role.MEMBER;
  }
}

function capitalizeFirst(value: string | null | undefined) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function buildUser(
  authUser: SupabaseUser,
  profile?: ProfileRow | null,
  adminRoleOverride?: Role | null
): Promise<User> {
  const email = authUser.email ?? '';

  const nameFromProfile = profile?.display_name ?? null;
  const nameFromMeta = (authUser.user_metadata as any)?.full_name ?? null;

  const name = capitalizeFirst(
    nameFromProfile ||
    nameFromMeta ||
    email.split('@')[0] ||
    ''
  );

  const avatarFromProfile = (profile?.avatar_url || '').trim();
  const avatarFromMeta = String((authUser.user_metadata as any)?.avatar_url || '').trim();
  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}`;
  let avatarUrl = fallbackAvatar;
  if (avatarFromProfile) {
    const signed = await signTeamAssetUrl(avatarFromProfile);
    avatarUrl = signed || avatarFromProfile || fallbackAvatar;
  } else if (avatarFromMeta) {
    const signed = await signTeamAssetUrl(avatarFromMeta);
    avatarUrl = signed || avatarFromMeta || fallbackAvatar;
  }

  const role = adminRoleOverride || deriveRoleFromEmailFallback(email);

  return {
    id: authUser.id,
    email,
    name,
    avatarUrl,
    role,
  };
}

async function ensureProfile(authUser: SupabaseUser): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error loading profile', error.message);
  }

  if (data) return data;

  const displayName =
    (authUser.user_metadata as any)?.full_name ??
    authUser.email?.split('@')[0] ??
    null;

  const avatarUrl =
    (authUser.user_metadata as any)?.avatar_url ?? null;

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert({
      user_id: authUser.id,
      display_name: displayName,
      phone: null,
      avatar_url: avatarUrl,
      email: authUser.email ?? null,
      email_address: authUser.email ?? null,
    })
    .select()
    .single();

  if (insertError) {
    console.error('Error creating profile', insertError.message);
    throw insertError;
  }

  return inserted;
}

/* -------------- public helpers -------------- */

export const getStoredUser = (): User | null => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? (JSON.parse(stored) as User) : null;
};

// Backwards compat for components using this name
export const getCurrentUser = (): User | null => getStoredUser();

export const logout = async (): Promise<void> => {
  // Clear local cache first so UI updates even if network fails
  localStorage.removeItem(STORAGE_KEY);
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch (err) {
    console.error('Supabase sign-out error', (err as any)?.message || err);
  }
};

export const hydrateUserFromSupabase = async (): Promise<User | null> => {
  // Handle implicit/hybrid flows that return tokens in the hash
  const hash = window.location.hash?.replace('#', '');
  if (hash) {
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const error = params.get('error_description') || params.get('error');
    if (error) {
      console.error('OAuth error', error);
    }
    if (access_token && refresh_token) {
      const { error: setError } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (setError) {
        console.error('Set session error', setError.message);
      } else {
        // Clean the URL so we don't reprocess tokens
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
    }
  }

  // If we have an OAuth code/hash in the URL (PKCE), exchange it for a session first.
  try {
    const url = window.location.href;
    if (url.includes('code=') || url.includes('access_token=')) {
      await supabase.auth.exchangeCodeForSession(url);
    }
  } catch (exchangeError: any) {
    console.error('Auth code exchange error', exchangeError?.message || exchangeError);
  }

  // Pull latest session and process any OAuth hash fragment
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error('Session load error', sessionError.message);
  }

  const authUser = sessionData?.session?.user;
  if (!authUser) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  const [profile, adminRole] = await Promise.all([
    ensureProfile(authUser),
    fetchAdminRole(authUser.email),
  ]);

  const user = await buildUser(authUser, profile, adminRole);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event('courtsight:user-updated'));

  return user;
};

/* -------------- login flows -------------- */

export const loginWithEmail = async (
  email: string,
  password: string
): Promise<User> => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    console.error('Email login error', error?.message);
    throw new Error(error?.message || 'Invalid email or password');
  }

  const user = await hydrateUserFromSupabase();
  if (!user) {
    throw new Error('Unable to load user profile');
  }

  return user;
};

export const registerWithEmail = async (
  email: string,
  password: string,
  opts?: { fullName?: string }
): Promise<{ userId: string | null; user: User | null }> => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: opts?.fullName ?? null,
      },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    console.error('Email signup error', error?.message);
    throw new Error(error?.message || 'Unable to create account');
  }

  const identities = (data.user as any)?.identities;
  if (!data.session && data.user?.id && Array.isArray(identities) && identities.length === 0) {
    throw new Error('This email is already registered. Please log in to continue.');
  }

  // Some projects require email confirmation and won't return a session
  if (!data.session) {
    return { userId: data.user?.id ?? null, user: null };
  }

  const user = await hydrateUserFromSupabase();
  if (!user) {
    throw new Error('Unable to load user profile');
  }
  return { userId: user.id, user };
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    console.error('Password reset error', error?.message);
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('user') && msg.includes('not') && msg.includes('found')) {
      throw new Error('Account not found. Please register first.');
    }
    throw new Error(error?.message || 'Unable to send reset email');
  }
};

export const resendSignupConfirmation = async (email: string): Promise<void> => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Email is required.');
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalized,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    console.error('Resend signup confirmation error', error?.message);
    throw new Error(error?.message || 'Unable to resend confirmation email.');
  }
};

/**
 * Google OAuth entry point.
 * - If a valid session already exists, reuse it and return the hydrated user (avoids re-prompt).
 * - Otherwise, clear any stale cache and start the PKCE OAuth redirect flow.
 */
export const signInWithGoogle = async (): Promise<User | null> => {
  // If we're already authenticated, skip the OAuth redirect.
  const { data: existing, error: sessionError } = await supabase.auth.getSession();
  if (!sessionError && existing?.session?.user) {
    return hydrateUserFromSupabase();
  }

  // Ensure any stale mock/local session is cleared before redirecting
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  localStorage.removeItem(STORAGE_KEY);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      flowType: 'pkce',
      queryParams: { prompt: 'select_account' },
      skipBrowserRedirect: true, // handle redirect manually to avoid false errors surfacing
    },
  });

  if (data?.url) {
    window.location.assign(data.url);
    return null; // redirect
  }

  // No redirect URL; surface the error.
  if (error) {
    console.error('Google login error', error);
    throw error;
  }

  throw new Error('Google login did not return a redirect URL.');
};

import { supabase } from './supabaseClient';
import { apiBaseUrl } from './apiBase';

const buildAuthHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
};

const requestAdminApi = async <T>(path: string, init?: RequestInit): Promise<{ data: T | null; error: Error | null }> => {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(await buildAuthHeaders()),
        ...(init?.headers || {}),
      },
    });

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;

    if (!response.ok) {
      return {
        data: null,
        error: new Error(payload?.error || payload?.message || `Request failed (${response.status})`),
      };
    }

    return { data: payload as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error('Admin API request failed.'),
    };
  }
};

export const supabaseAdmin: any = {
  from: supabase.from.bind(supabase),
  storage: supabase.storage,
  auth: {
    admin: {
      async inviteUserByEmail(email: string, options?: { redirectTo?: string; data?: Record<string, any> }) {
        return requestAdminApi<{ user?: { id?: string; email?: string } }>('/admin/auth/invite-user', {
          method: 'POST',
          body: JSON.stringify({
            email,
            redirectTo: options?.redirectTo,
            data: options?.data,
          }),
        });
      },
      async createUser(payload: Record<string, any>) {
        return requestAdminApi<{ user?: { id?: string; email?: string } }>('/admin/auth/create-user', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },
      async getUserByEmail(email: string) {
        return requestAdminApi<{ user?: { id?: string; email?: string } }>(
          `/admin/auth/user-by-email?email=${encodeURIComponent(email)}`
        );
      },
      async getUserById(userId: string) {
        return requestAdminApi<{ user?: { id?: string; email?: string } }>(
          `/admin/auth/user-by-id/${encodeURIComponent(userId)}`
        );
      },
    },
  },
};

import { supabase } from './supabaseClient';
import { apiBaseUrl } from './apiBase';

export type ResolvedAdminRole = 'ADMIN_FULL' | 'ADMIN_COMMISSIONER' | 'ADMIN_SCOREKEEPER' | 'ADMIN_MEDIA' | string | null;

const endpoint = `${apiBaseUrl}/admin-role`;

type Payload = {
  userId?: string | null;
  email?: string | null;
};

export async function fetchAdminRoleFromServer(payload: Payload): Promise<ResolvedAdminRole> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn('Admin role endpoint returned', response.status);
      return null;
    }
    const data = (await response.json()) as { role?: ResolvedAdminRole };
    return data.role ?? null;
  } catch (err) {
    console.warn('Failed to reach admin role endpoint', err);
    return null;
  }
}

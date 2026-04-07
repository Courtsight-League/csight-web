import { Role } from '../types';
import { apiBaseUrl } from './apiBase';
import { supabase } from './supabaseClient';

const endpoint = `${apiBaseUrl}/admin-users`;

type CreateAdminUserPayload = {
  email: string;
  displayName: string;
  role: Role;
};

type CreateAdminUserResult = {
  email: string;
  tempPassword: string;
  userId: string | null;
  createdNewUser: boolean;
  message: string;
};

const buildAuthHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
};

export async function createAdminUserViaServer(
  payload: CreateAdminUserPayload
): Promise<CreateAdminUserResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: await buildAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Failed to create admin user.');
  }

  return {
    email: String(data?.email || payload.email),
    tempPassword: String(data?.tempPassword || ''),
    userId: data?.userId ?? null,
    createdNewUser: Boolean(data?.createdNewUser),
    message: String(data?.message || 'Admin user updated.'),
  };
}

// services/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';
import { apiBaseUrl } from './apiBase';

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabaseProxyUrl = `${apiBaseUrl}/supabase`;

if (!supabaseAnonKey) {
  console.error(
    'Missing Supabase environment variables. Please set VITE_SUPABASE_ANON_KEY and VITE_API_BASE_URL in .env.local'
  );
}

// Named export so other files can do: import { supabase } from './supabaseClient';
export const supabase = createClient(supabaseProxyUrl, supabaseAnonKey);

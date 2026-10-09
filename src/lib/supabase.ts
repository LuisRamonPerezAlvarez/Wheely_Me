import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export const AUTH_REDIRECT_URL = 'wheelyme://account';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

let client: SupabaseClient<Database> | null = null;

/**
 * Devuelve el cliente compartido. Se crea de forma diferida para que la app
 * local siga arrancando mientras se configura el proyecto remoto.
 */
export function getSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Supabase no está configurado. Agrega EXPO_PUBLIC_SUPABASE_URL y ' +
        'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY a .env.local.'
    );
  }

  client ??= createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return client;
}

export async function completeAuthFromUrl(url: string) {
  const client = getSupabaseClient();
  const parameterText = url.includes('#')
    ? url.slice(url.indexOf('#') + 1)
    : url.includes('?')
      ? url.slice(url.indexOf('?') + 1)
      : '';
  const params = new URLSearchParams(parameterText);
  const errorDescription = params.get('error_description');
  if (errorDescription) throw new Error(errorDescription);

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return false;

  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return true;
}

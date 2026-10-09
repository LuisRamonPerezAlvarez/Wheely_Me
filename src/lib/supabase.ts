import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export const AUTH_REDIRECT_URL = 'wheelyme://account';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

let client: SupabaseClient<Database> | null = null;
const authCallbackPromises = new Map<string, Promise<boolean>>();

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
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return client;
}

async function completeAuthFromUrlOnce(url: string) {
  const client = getSupabaseClient();
  const callbackUrl = new URL(url);
  const queryParams = new URLSearchParams(callbackUrl.search);
  const fragmentParams = new URLSearchParams(callbackUrl.hash.slice(1));
  const errorDescription =
    fragmentParams.get('error_description') ?? queryParams.get('error_description');
  if (errorDescription) throw new Error(errorDescription);

  const authCode = queryParams.get('code');
  if (authCode) {
    const { error } = await client.auth.exchangeCodeForSession(authCode);
    if (error) throw error;
    return true;
  }

  const accessToken =
    fragmentParams.get('access_token') ?? queryParams.get('access_token');
  const refreshToken =
    fragmentParams.get('refresh_token') ?? queryParams.get('refresh_token');
  if (!accessToken || !refreshToken) return false;

  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return true;
}

export function completeAuthFromUrl(url: string) {
  const existingCompletion = authCallbackPromises.get(url);
  if (existingCompletion) return existingCompletion;

  const completion = completeAuthFromUrlOnce(url);
  authCallbackPromises.set(url, completion);
  const removeCachedCompletion = () => {
    setTimeout(() => {
      if (authCallbackPromises.get(url) === completion) authCallbackPromises.delete(url);
    }, 30_000);
  };
  void completion.then(removeCachedCompletion, removeCachedCompletion);
  return completion;
}

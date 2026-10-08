import { supabase } from './supabase';

export type Profile = {
  id: string;
  username: string;
  coins: number;
  equipped_skin_id: number | null;
  created_at: string;
};

export type Skin = {
  id: number;
  name: string;
  color: string;
  price_coins: number | null;
  price_cents: number | null;
};

export type LeaderboardRow = { rank: number; username: string; best_score: number };

/** Inicia sesión anónima si no hay sesión guardada. Devuelve el id del usuario. */
export async function ensureSession(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;

  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) throw error ?? new Error('No se pudo iniciar sesión');
  return anon.user.id;
}

/** Perfil del jugador actual, o null si todavía no lo ha creado. */
export async function getProfile(): Promise<Profile | null> {
  const userId = await ensureSession();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProfile(username: string): Promise<Profile> {
  await ensureSession();
  const { data, error } = await supabase.rpc('create_profile', { p_username: username });
  if (error) throw error;
  return data as Profile;
}

export async function submitScore(args: {
  score: number;
  distance: number;
  coins: number;
  durationSeconds: number;
}) {
  await ensureSession();
  const { error } = await supabase.rpc('submit_score', {
    p_score: Math.floor(args.score),
    p_distance: Math.floor(args.distance),
    p_coins: args.coins,
    p_duration_s: Math.floor(args.durationSeconds),
  });
  if (error) throw error;
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  await ensureSession();
  const { data, error } = await supabase.rpc('get_leaderboard');
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export async function getSkins(): Promise<Skin[]> {
  await ensureSession();
  const { data, error } = await supabase.from('skins').select('*').order('id');
  if (error) throw error;
  return data ?? [];
}

export async function getOwnedSkinIds(): Promise<number[]> {
  const userId = await ensureSession();
  const { data, error } = await supabase
    .from('user_skins')
    .select('skin_id')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.skin_id);
}

export async function buySkinWithCoins(skinId: number): Promise<Profile> {
  const { data, error } = await supabase.rpc('buy_skin_with_coins', { p_skin_id: skinId });
  if (error) throw error;
  return data as Profile;
}

export async function equipSkin(skinId: number): Promise<Profile> {
  const { data, error } = await supabase.rpc('equip_skin', { p_skin_id: skinId });
  if (error) throw error;
  return data as Profile;
}

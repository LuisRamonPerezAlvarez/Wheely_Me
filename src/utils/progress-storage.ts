import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

export const HIGH_SCORE_STORAGE_KEY = 'highScore';
const PENDING_HIGH_SCORE_KEY = 'pendingHighScore';

export async function loadHighScore() {
  const value = await AsyncStorage.getItem(HIGH_SCORE_STORAGE_KEY);
  const parsed = value === null ? 0 : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function saveHighScoreLocally(score: number) {
  const normalizedScore = Math.max(0, Math.floor(score));
  await AsyncStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(normalizedScore));
  return normalizedScore;
}

export async function saveHighScore(score: number) {
  const normalizedScore = await saveHighScoreLocally(score);
  await AsyncStorage.setItem(PENDING_HIGH_SCORE_KEY, String(normalizedScore));
  void flushPendingHighScore();
  return normalizedScore;
}

export async function clearPendingHighScore() {
  await AsyncStorage.removeItem(PENDING_HIGH_SCORE_KEY);
}

export async function flushPendingHighScore() {
  if (!isSupabaseConfigured) return;

  try {
    const pending = await AsyncStorage.getItem(PENDING_HIGH_SCORE_KEY);
    if (pending === null) return;

    const score = Number.parseInt(pending, 10);
    if (!Number.isInteger(score) || score < 0) {
      await AsyncStorage.removeItem(PENDING_HIGH_SCORE_KEY);
      return;
    }

    const client = getSupabaseClient();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return;

    const { data: remoteScore, error } = await client.rpc('submit_high_score', {
      p_high_score: score,
    });
    if (error) return;

    await saveHighScoreLocally(Number(remoteScore));
    await AsyncStorage.removeItem(PENDING_HIGH_SCORE_KEY);
  } catch {
    // El récord se conserva localmente hasta recuperar la conexión.
  }
}

import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getSupabaseClient } from '@/lib/supabase';

const REWARDS_CHANNEL_ID = 'daily-rewards';

export async function registerCurrentDeviceForPushNotifications() {
  if (
    isRunningInExpoGo() ||
    !Device.isDevice ||
    (Platform.OS !== 'android' && Platform.OS !== 'ios')
  ) {
    return false;
  }

  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return false;

  const notifications = await import('expo-notifications');
  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync(REWARDS_CHANNEL_ID, {
      name: 'Recompensas',
      description: 'Avisos de recompensas de Wheely Me',
      importance: notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 180, 250],
      lightColor: '#FFD54F',
      sound: 'default',
    });
  }

  const permissions = await notifications.getPermissionsAsync();
  if (!permissions.granted) return false;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('No se encontró el projectId de EAS.');

  const expoPushToken = await notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await client.rpc('register_push_token', {
    p_expo_push_token: expoPushToken.data,
    p_platform: Platform.OS,
  });

  if (error) throw error;
  return true;
}
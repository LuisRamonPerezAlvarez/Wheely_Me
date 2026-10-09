import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

const REWARDS_CHANNEL_ID = 'daily-rewards';
const DAILY_REWARD_KIND = 'wheely-daily-reward';
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;
type NotificationsModule = typeof import('expo-notifications');

let notificationsPromise: Promise<NotificationsModule> | null = null;

async function loadNotifications() {
  if (Platform.OS === 'android' && isRunningInExpoGo()) return null;

  notificationsPromise ??= import('expo-notifications').then(notifications => {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    return notifications;
  });

  return notificationsPromise;
}

async function requireNotifications() {
  const notifications = await loadNotifications();
  if (!notifications) {
    throw new Error('Las notificaciones requieren el APK de Wheely Me en Android.');
  }

  return notifications;
}

async function ensureAndroidChannel(notifications: NotificationsModule) {
  if (Platform.OS !== 'android') return;

  await notifications.setNotificationChannelAsync(REWARDS_CHANNEL_ID, {
    name: 'Recompensas',
    description: 'Avisos de recompensas de Wheely Me',
    importance: notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 180, 250],
    lightColor: '#FFD54F',
    sound: 'default',
  });
}

async function requestPermissionOnce(notifications: NotificationsModule) {
  await ensureAndroidChannel(notifications);

  let permissions = await notifications.getPermissionsAsync();
  if (permissions.status === 'undetermined') {
    permissions = await notifications.requestPermissionsAsync();
  }

  return permissions.granted;
}

async function ensureDailyRewardWith(notifications: NotificationsModule) {
  const scheduled = await notifications.getAllScheduledNotificationsAsync();
  const dailyRewards = scheduled.filter(
    notification => notification.content.data?.kind === DAILY_REWARD_KIND
  );

  if (dailyRewards.length > 0) {
    await Promise.all(
      dailyRewards
        .slice(1)
        .map(notification =>
          notifications.cancelScheduledNotificationAsync(notification.identifier)
        )
    );
    return dailyRewards[0].identifier;
  }

  return notifications.scheduleNotificationAsync({
    content: {
      title: 'Wheely Me',
      body: 'Tu recompensa diaria de 50 monedas te está esperando.',
      sound: 'default',
      data: { kind: DAILY_REWARD_KIND },
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: ONE_DAY_IN_SECONDS,
      repeats: true,
      channelId: REWARDS_CHANNEL_ID,
    },
  });
}

export async function ensureDailyRewardNotification() {
  const notifications = await requireNotifications();
  return ensureDailyRewardWith(notifications);
}

export async function initializeLocalNotifications() {
  try {
    const notifications = await loadNotifications();
    if (!notifications) return false;

    const permissionGranted = (await notifications.getPermissionsAsync()).granted;
    if (permissionGranted) await ensureDailyRewardWith(notifications);
    return permissionGranted;
  } catch {
    return false;
  }
}

export async function enableRewardNotifications() {
  const notifications = await requireNotifications();
  const permissionGranted = await requestPermissionOnce(notifications);
  if (!permissionGranted) return false;

  await ensureDailyRewardWith(notifications);
  await notifications.scheduleNotificationAsync({
    content: {
      title: 'Recordatorios activados',
      body: 'Te avisaremos cuando tu recompensa diaria de 50 monedas esté disponible.',
      sound: 'default',
      data: { kind: 'wheely-reminders-enabled' },
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
      repeats: false,
      channelId: REWARDS_CHANNEL_ID,
    },
  });

  return true;
}

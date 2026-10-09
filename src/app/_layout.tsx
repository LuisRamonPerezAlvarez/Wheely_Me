import type { NotificationResponse } from 'expo-notifications';
import { isRunningInExpoGo } from 'expo';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { CloudSyncProvider } from '@/components/cloud-sync-provider';
import { LightInversionProvider } from '@/components/light-inversion-provider';
import { initializeLocalNotifications } from '@/lib/local-notifications';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    void initializeLocalNotifications();
  }, []);

  useEffect(() => {
    if (isRunningInExpoGo()) return;

    let isActive = true;
    let responseSubscription: { remove: () => void } | undefined;

    const openNotificationRoute = (response: NotificationResponse) => {
      if (response.notification.request.content.data?.url === '/store') {
        router.push('/store');
      }
    };

    void import('expo-notifications').then(async notifications => {
      if (!isActive) return;

      responseSubscription = notifications.addNotificationResponseReceivedListener(
        openNotificationRoute
      );
      const response = await notifications.getLastNotificationResponseAsync();
      if (isActive && response) openNotificationRoute(response);
    }).catch(error => {
      console.warn('No se pudo inicializar la navegación de notificaciones:', error);
    });

    return () => {
      isActive = false;
      responseSubscription?.remove();
    };
  }, []);

  return (
    <CloudSyncProvider>
      <LightInversionProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }} />
          <AnimatedSplashOverlay />
        </ThemeProvider>
      </LightInversionProvider>
    </CloudSyncProvider>
  );
}

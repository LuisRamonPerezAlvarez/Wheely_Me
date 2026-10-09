import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloudSync } from '@/components/cloud-sync-provider';
import { AUTH_REDIRECT_URL, completeAuthFromUrl, getSupabaseClient } from '@/lib/supabase';

type AccountMode = 'overview' | 'link' | 'restore';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function getFriendlyGoogleError(message: string, action: 'link' | 'restore') {
  const normalized = message.toLowerCase();
  if (normalized.includes('manual linking')) {
    return 'La vinculación de identidades está desactivada en Supabase. Activa “Enable Manual Linking”.';
  }
  if (normalized.includes('provider is not enabled') || normalized.includes('google is not enabled')) {
    return 'Google no está habilitado como proveedor en Supabase Auth.';
  }
  if (normalized.includes('identity') && normalized.includes('already')) {
    return 'Ese Google ya está vinculado a otra cuenta de Wheely Me. Usa “Recuperar con Google”.';
  }
  if (
    normalized.includes('fetch failed')
    || normalized.includes('network request failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
  ) {
    return 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  }
  if (message) return `No se pudo ${action === 'link' ? 'vincular' : 'iniciar sesión con'} Google: ${message}`;
  return `No se pudo ${action === 'link' ? 'vincular' : 'iniciar sesión con'} Google. Inténtalo de nuevo.`;
}

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { status: cloudStatus, revision: cloudRevision, syncNow } = useCloudSync();
  const [mode, setMode] = useState<AccountMode>('overview');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadAccount = useCallback(async () => {
    try {
      const { data, error } = await getSupabaseClient().auth.getUser();
      if (error) throw error;
      setIsAnonymous(data.user?.is_anonymous !== false);
      setCurrentEmail(data.user?.email ?? null);
    } catch {
      setMessage('No se pudo consultar la cuenta. Revisa tu conexión.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cloudRevision;
      void loadAccount();
    }, [cloudRevision, loadAccount])
  );

  const resetForm = (nextMode: AccountMode) => {
    setMode(nextMode);
    setMessage('');
  };

  const handleGoogleAuth = async (action: 'link' | 'restore') => {
    if (isLoading) return;

    setIsLoading(true);
    setMessage('');
    try {
      const client = getSupabaseClient();
      const authResult = action === 'link'
        ? await client.auth.linkIdentity({
            provider: 'google',
            options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
          })
        : await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
          });
      if (authResult.error) throw authResult.error;
      if (!authResult.data.url) throw new Error('Supabase no devolvió la URL de Google.');

      const browserResult = await WebBrowser.openAuthSessionAsync(
        authResult.data.url,
        AUTH_REDIRECT_URL
      );
      if (browserResult.type !== 'success') {
        setMessage('Inicio con Google cancelado.');
        return;
      }

      const completed = await completeAuthFromUrl(browserResult.url);
      if (!completed) {
        throw new Error('Google no devolvió una sesión válida. Revisa la URL de retorno en Supabase.');
      }

      await syncNow();
      await loadAccount();
      if (action === 'restore') setMode('overview');
      setMessage(
        action === 'link'
          ? 'Google quedó vinculado. Tu progreso se conserva en esta cuenta.'
          : 'Sesión recuperada con Google. Wheely Me sincronizará tu progreso desde la nube.'
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(`No se pudo ${action === 'link' ? 'vincular' : 'recuperar'} con Google:`, error);
      setMessage(getFriendlyGoogleError(errorMessage, action));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
            paddingLeft: Math.max(insets.left, 24),
            paddingRight: Math.max(insets.right, 24),
          },
        ]}
      >
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>‹ VOLVER</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.title}>CUENTA</Text>

          {mode === 'overview' ? (
            <>
              <Text style={styles.statusTitle}>
                {isAnonymous ? 'Progreso guardado en este dispositivo' : 'Progreso protegido'}
              </Text>
              <Text style={styles.description}>
                {isAnonymous
                  ? 'Vincula Google para recuperar tus monedas y récord si cambias de teléfono.'
                  : `Cuenta vinculada${currentEmail ? ` a ${currentEmail}` : ''}.`}
              </Text>
              <Text style={styles.cloudStatus}>
                Nube:{' '}
                {cloudStatus === 'ready'
                  ? 'sincronizada'
                  : cloudStatus === 'loading'
                    ? 'conectando...'
                    : 'sin conexión'}
              </Text>

              {isAnonymous && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton]}
                  onPress={() => resetForm('link')}
                  disabled={isLoading}
                >
                  <Text style={styles.actionButtonText}>GUARDAR MI PROGRESO</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => resetForm('restore')}
                disabled={isLoading}
              >
                <Text style={styles.actionButtonText}>RECUPERAR OTRA CUENTA</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.statusTitle}>
                {mode === 'link' ? 'Guardar progreso' : 'Recuperar cuenta'}
              </Text>
              <Text style={styles.description}>
                {mode === 'link'
                  ? 'Vincula Google a esta cuenta para conservar tu progreso y recuperarlo en otros dispositivos.'
                  : 'Inicia sesión con Google para recuperar el progreso asociado a tu cuenta.'}
              </Text>

              {Platform.OS !== 'web' ? (
                <TouchableOpacity
                  style={[styles.actionButton, styles.googleButton, isLoading && styles.disabled]}
                  onPress={() => void handleGoogleAuth(mode)}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.actionButtonText}>
                      {mode === 'link' ? 'VINCULAR PROGRESO CON GOOGLE' : 'CONTINUAR CON GOOGLE'}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : (
                <Text style={styles.message}>La cuenta con Google se configura desde la app móvil.</Text>
              )}

              {message !== '' && <Text style={styles.message}>{message}</Text>}

              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => resetForm('overview')}
                disabled={isLoading}
              >
                <Text style={styles.actionButtonText}>CANCELAR</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'overview' && message !== '' && <Text style={styles.message}>{message}</Text>}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1733',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 24,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 24,
    backgroundColor: '#17264A',
  },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 4,
  },
  statusTitle: {
    marginTop: 12,
    color: '#FFD54F',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    maxWidth: 450,
    marginTop: 8,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  cloudStatus: {
    marginTop: 6,
    color: '#80CBC4',
    fontSize: 12,
    fontWeight: '700',
  },
  message: {
    marginTop: 12,
    color: '#FFCC80',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionButton: {
    minWidth: 190,
    minHeight: 44,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  primaryButton: {
    backgroundColor: '#43A047',
  },
  secondaryButton: {
    backgroundColor: '#208AEF',
  },
  googleButton: {
    backgroundColor: '#DB4437',
  },
  cancelButton: {
    backgroundColor: '#5F6368',
  },
  disabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
});

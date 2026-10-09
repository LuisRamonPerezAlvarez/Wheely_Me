import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloudSync } from '@/components/cloud-sync-provider';
import { getSupabaseClient } from '@/lib/supabase';

type AccountMode = 'overview' | 'link' | 'restore';

function getFriendlyError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('already') || normalized.includes('registered')) {
    return 'Ese correo ya tiene una cuenta. Usa “Recuperar cuenta”.';
  }
  if (normalized.includes('rate limit')) return 'Espera un momento antes de solicitar otro código.';
  if (normalized.includes('invalid') && normalized.includes('token')) {
    return 'El código no es válido o ya venció.';
  }
  if (normalized.includes('expired')) return 'El código venció. Solicita uno nuevo.';
  return 'No fue posible completar la operación. Revisa tu conexión e intenta nuevamente.';
}

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { status: cloudStatus, revision: cloudRevision, syncNow } = useCloudSync();
  const [mode, setMode] = useState<AccountMode>('overview');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
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
    setEmail('');
    setCode('');
    setCodeSent(false);
    setMessage('');
  };

  const handleSendCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessage('Ingresa un correo electrónico válido.');
      return;
    }

    setIsLoading(true);
    setMessage('');
    try {
      const client = getSupabaseClient();
      const result = mode === 'link'
        ? await client.auth.updateUser({ email: normalizedEmail })
        : await client.auth.signInWithOtp({
            email: normalizedEmail,
            options: { shouldCreateUser: false },
          });
      if (result.error) throw result.error;

      setEmail(normalizedEmail);
      setCodeSent(true);
      setMessage(`Enviamos un código de 6 dígitos a ${normalizedEmail}. Revisa también spam.`);
    } catch (error) {
      setMessage(getFriendlyError(error instanceof Error ? error.message : ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setMessage('Ingresa el código de 6 dígitos.');
      return;
    }

    setIsLoading(true);
    setMessage('');
    try {
      const client = getSupabaseClient();
      const { error } = await client.auth.verifyOtp({
        email,
        token: code.trim(),
        type: mode === 'link' ? 'email_change' : 'email',
      });
      if (error) throw error;

      await syncNow();
      await loadAccount();
      setMode('overview');
      setCode('');
      setCodeSent(false);
      setMessage(
        mode === 'link'
          ? 'Tu progreso quedó protegido con este correo.'
          : 'Cuenta recuperada y progreso sincronizado.'
      );
    } catch (error) {
      setMessage(getFriendlyError(error instanceof Error ? error.message : ''));
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
                  ? 'Vincula un correo para recuperar tus monedas y récord si cambias de teléfono.'
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
                >
                  <Text style={styles.actionButtonText}>GUARDAR MI PROGRESO</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => resetForm('restore')}
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
                  ? 'El mismo jugador conservará sus monedas y récord.'
                  : 'Enviaremos un código de 6 dígitos al correo de la cuenta existente.'}
              </Text>

              <TextInput
                style={styles.input}
                value={email}
                onChangeText={value => {
                  setEmail(value);
                  setMessage('');
                }}
                editable={!codeSent && !isLoading}
                placeholder="correo@ejemplo.com"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />

              {codeSent && (
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={value => {
                    setCode(value.replace(/\D/g, '').slice(0, 6));
                    setMessage('');
                  }}
                  placeholder="000000"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              )}

              {message !== '' && <Text style={styles.message}>{message}</Text>}

              <View style={styles.formActions}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.cancelButton]}
                  onPress={() => resetForm('overview')}
                  disabled={isLoading}
                >
                  <Text style={styles.actionButtonText}>CANCELAR</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton, isLoading && styles.disabled]}
                  onPress={codeSent ? handleVerifyCode : handleSendCode}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.actionButtonText}>
                      {codeSent ? 'VERIFICAR CÓDIGO' : 'ENVIAR CÓDIGO'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
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
  input: {
    width: '100%',
    maxWidth: 390,
    height: 48,
    marginTop: 16,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#64B5F6',
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  codeInput: {
    maxWidth: 220,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
    color: '#FFCC80',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  formActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
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

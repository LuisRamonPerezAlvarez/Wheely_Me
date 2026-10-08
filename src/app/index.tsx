import * as LocalAuthentication from 'expo-local-authentication';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadCoinWallet } from '@/utils/coin-storage';
import { loadPlayerPhotoUri, savePlayerPhoto } from '@/utils/player-photo';
import { INVERTED_VIEW_STYLE, useLightInversion } from '@/components/light-inversion-provider';

export default function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const isColorInverted = useLightInversion();
  const [coinCount, setCoinCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [hardwareAvailable, setHardwareAvailable] = useState(true);
  const [biometricEnrolled, setBiometricEnrolled] = useState(true);
  const [playerPhotoUri, setPlayerPhotoUri] = useState<string | null>(null);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      loadCoinWallet().then(wallet => {
        if (isActive) setCoinCount(wallet.coinCount);
      });
      loadPlayerPhotoUri().then(uri => {
        if (isActive) setPlayerPhotoUri(uri);
      });

      return () => {
        isActive = false;
      };
    }, [])
  );

  useEffect(() => {
    let isMounted = true;

    const checkBiometricSupport = async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!isMounted) return;
      setHardwareAvailable(hasHardware);

      if (!hasHardware) return;

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isMounted) return;
      setBiometricEnrolled(isEnrolled);
    };

    void checkBiometricSupport();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleStartGame = useCallback(async () => {
    if (isAuthenticating) return;

    if (!hardwareAvailable || !biometricEnrolled) {
      setStatusMessage(
        !hardwareAvailable
          ? 'Este dispositivo no soporta autenticación biométrica.'
          : 'Configura tu huella digital en Ajustes > Seguridad.'
      );
      return;
    }

    setIsAuthenticating(true);
    setStatusMessage('');

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verifica tu identidad para jugar',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });

      if (result.success) {
        router.push('/game');
      } else if (result.error === 'user_cancel') {
        setStatusMessage('Autenticación cancelada.');
      } else if (result.error === 'not_enrolled') {
        setStatusMessage('No tienes una huella digital configurada.');
      } else if (result.error === 'lockout') {
        setStatusMessage('Demasiados intentos fallidos. Intenta más tarde.');
      } else {
        setStatusMessage('Autenticación fallida. Intenta de nuevo.');
      }
    } catch {
      setStatusMessage('Ocurrió un error durante la autenticación.');
    } finally {
      setIsAuthenticating(false);
    }
  }, [biometricEnrolled, hardwareAvailable, isAuthenticating]);

  const handleTakePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permiso requerido',
          'Debes permitir el acceso a la cámara para personalizar tu personaje.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        shape: 'oval',
        quality: 0.8,
        cameraType: ImagePicker.CameraType.front,
      });

      if (!result.canceled) {
        setPendingPhotoUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Cámara no disponible', 'No fue posible abrir la cámara en este dispositivo.');
    }
  };

  const handleAcceptPhoto = async () => {
    if (!pendingPhotoUri || isSavingPhoto) return;

    setIsSavingPhoto(true);
    try {
      const savedUri = await savePlayerPhoto(pendingPhotoUri);
      setPlayerPhotoUri(savedUri);
      setPendingPhotoUri(null);
    } catch {
      Alert.alert('No se pudo guardar', 'Intenta tomar la fotografía nuevamente.');
    } finally {
      setIsSavingPhoto(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 15),
          paddingBottom: Math.max(insets.bottom, 15),
          paddingLeft: Math.max(insets.left, 24),
          paddingRight: Math.max(insets.right, 24),
        },
      ]}
    >
      <View style={styles.sun} />
      <View style={styles.ground} />

      <View style={styles.brandSection}>
        <Text style={styles.title}>Wheely Me</Text>
        <Text style={styles.subtitle}>Mantén el equilibrio y llega más lejos</Text>
        <View style={styles.profileRow}>
          <View style={styles.profilePhotoFrame}>
            {playerPhotoUri ? (
              <Image source={{ uri: playerPhotoUri }} style={styles.profilePhoto} contentFit="cover" />
            ) : (
              <View style={styles.profilePlaceholder} />
            )}
          </View>
          <View style={styles.profileActions}>
            <Text style={styles.profileTitle}>Personalizar personaje</Text>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={handleTakePhoto}
              activeOpacity={0.75}
            >
              <Text style={styles.photoButtonText}>TOMAR FOTO</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.coinBalance}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.coinText}>Monedas: {coinCount}</Text>
        </View>
      </View>

      <View style={styles.menuSection}>
        <TouchableOpacity
          style={[styles.menuButton, styles.playButton, isAuthenticating && styles.buttonDisabled]}
          onPress={handleStartGame}
          disabled={isAuthenticating}
          activeOpacity={0.75}
        >
          <Text style={styles.menuButtonText}>
            {isAuthenticating ? 'VERIFICANDO...' : 'INICIAR JUEGO'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuButton, styles.storeButton]}
          onPress={() => router.push('/store')}
          activeOpacity={0.75}
        >
          <Text style={styles.menuButtonText}>TIENDA</Text>
        </TouchableOpacity>

        {statusMessage !== '' && (
          <Text style={styles.statusMessage}>{statusMessage}</Text>
        )}
      </View>

      <Modal
        visible={pendingPhotoUri !== null}
        transparent
        animationType="fade"
        style={isColorInverted ? INVERTED_VIEW_STYLE : undefined}
        onRequestClose={() => {
          if (!isSavingPhoto) setPendingPhotoUri(null);
        }}
      >
        <View style={styles.photoModalBackdrop}>
          <View style={styles.photoModalCard}>
            <Text style={styles.photoModalTitle}>Vista previa</Text>
            {pendingPhotoUri && (
              <Image
                source={{ uri: pendingPhotoUri }}
                style={styles.photoPreview}
                contentFit="cover"
              />
            )}
            <View style={styles.photoModalActions}>
              <TouchableOpacity
                style={[styles.photoModalButton, styles.cancelPhotoButton]}
                onPress={() => setPendingPhotoUri(null)}
                disabled={isSavingPhoto}
                activeOpacity={0.75}
              >
                <Text style={styles.photoModalButtonText}>CANCELAR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.photoModalButton, styles.acceptPhotoButton]}
                onPress={handleAcceptPhoto}
                disabled={isSavingPhoto}
                activeOpacity={0.75}
              >
                <Text style={styles.photoModalButtonText}>
                  {isSavingPhoto ? 'GUARDANDO...' : 'ACEPTAR FOTO'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#0A1733',
    overflow: 'hidden',
  },
  sun: {
    position: 'absolute',
    top: -90,
    right: -50,
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
  },
  ground: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 28,
    backgroundColor: '#2E7D32',
    borderTopWidth: 4,
    borderTopColor: '#4CAF50',
  },
  brandSection: {
    flex: 1,
    maxWidth: 430,
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  title: {
    color: '#fff',
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(32, 138, 239, 0.65)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  subtitle: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 15,
    textAlign: 'center',
  },
  profileRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePhotoFrame: {
    width: 66,
    height: 66,
    overflow: 'hidden',
    borderRadius: 33,
    borderWidth: 3,
    borderColor: '#FFD54F',
    backgroundColor: '#FFD700',
  },
  profilePhoto: {
    width: '100%',
    height: '100%',
  },
  profilePlaceholder: {
    flex: 1,
    backgroundColor: '#FFD700',
  },
  profileActions: {
    marginLeft: 12,
    alignItems: 'flex-start',
  },
  profileTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  photoButton: {
    marginTop: 5,
    paddingVertical: 7,
    paddingHorizontal: 15,
    borderRadius: 16,
    backgroundColor: '#7E57C2',
  },
  photoButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  coinBalance: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,213,79,0.55)',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  coinIcon: {
    marginRight: 8,
    fontSize: 20,
  },
  coinText: {
    color: '#FFD54F',
    fontSize: 18,
    fontWeight: '800',
  },
  menuSection: {
    flex: 1,
    maxWidth: 360,
    alignItems: 'stretch',
    paddingHorizontal: 20,
  },
  menuButton: {
    minHeight: 54,
    marginVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    elevation: 5,
  },
  playButton: {
    backgroundColor: '#FF7043',
  },
  storeButton: {
    backgroundColor: '#208AEF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  menuButtonText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 1,
  },
  statusMessage: {
    minHeight: 20,
    marginTop: 8,
    color: '#FFAB91',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  photoModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  photoModalCard: {
    width: 360,
    alignItems: 'center',
    padding: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#1A2649',
  },
  photoModalTitle: {
    marginBottom: 10,
    color: '#fff',
    fontSize: 21,
    fontWeight: '900',
  },
  photoPreview: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 3,
    borderColor: '#FFD54F',
  },
  photoModalActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  photoModalButton: {
    minWidth: 130,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderRadius: 20,
  },
  cancelPhotoButton: {
    backgroundColor: '#5F6368',
  },
  acceptPhotoButton: {
    backgroundColor: '#43A047',
  },
  photoModalButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
});

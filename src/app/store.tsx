import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { INVERTED_VIEW_STYLE, useLightInversion } from '@/components/light-inversion-provider';
import { addPurchasedCoins, loadCoinWallet } from '@/utils/coin-storage';

const TEST_PURCHASE_CODE = '12345';

const COIN_PACKAGES = [
  { amount: 100, displayPrice: '$5.00 MXN' },
  { amount: 500, displayPrice: '$25.00 MXN' },
  { amount: 1000, displayPrice: '$50.00 MXN' },
  { amount: 5000, displayPrice: '$250.00 MXN' },
  { amount: 10000, displayPrice: '$500.00 MXN' },
];

type CoinPackage = (typeof COIN_PACKAGES)[number];

export default function StoreScreen() {
  const insets = useSafeAreaInsets();
  const isColorInverted = useLightInversion();
  const [coinCount, setCoinCount] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState<CoinPackage | null>(null);
  const [purchaseCode, setPurchaseCode] = useState('');
  const [feedback, setFeedback] = useState('');
  const [purchaseSucceeded, setPurchaseSucceeded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      loadCoinWallet().then(wallet => {
        if (isActive) setCoinCount(wallet.coinCount);
      });

      return () => {
        isActive = false;
      };
    }, [])
  );

  const openPurchase = (coinPackage: CoinPackage) => {
    setSelectedPackage(coinPackage);
    setPurchaseCode('');
    setFeedback('');
    setPurchaseSucceeded(false);
  };

  const closePurchase = () => {
    if (isProcessing) return;
    setSelectedPackage(null);
    setPurchaseCode('');
    setFeedback('');
    setPurchaseSucceeded(false);
  };

  const confirmPurchase = async () => {
    if (!selectedPackage || isProcessing) return;

    if (purchaseCode.trim() !== TEST_PURCHASE_CODE) {
      setPurchaseSucceeded(false);
      setFeedback('Código de compra inválido.');
      return;
    }

    setIsProcessing(true);
    try {
      const updatedBalance = await addPurchasedCoins(selectedPackage.amount);
      setCoinCount(updatedBalance);
      setPurchaseCode('');
      setPurchaseSucceeded(true);
      setFeedback('¡Compra realizada correctamente!');
    } catch {
      setPurchaseSucceeded(false);
      setFeedback('No se pudo guardar la compra. Intenta nuevamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
          paddingLeft: Math.max(insets.left, 20),
          paddingRight: Math.max(insets.right, 20),
        },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={styles.backButtonText}>‹ VOLVER</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>TIENDA</Text>
          <Text style={styles.balance}>🪙 Monedas actuales: {coinCount}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.packagesRow}>
        {COIN_PACKAGES.map(coinPackage => (
          <View key={coinPackage.amount} style={styles.packageCard}>
            <Text style={styles.packageIcon}>🪙</Text>
            <Text style={styles.packageAmount}>{coinPackage.amount}</Text>
            <Text style={styles.packageLabel}>Monedas</Text>
            <Text style={styles.packagePrice}>{coinPackage.displayPrice}</Text>
            <Text style={styles.testLabel}>Compra de prueba con código</Text>
            <TouchableOpacity
              style={styles.buyButton}
              onPress={() => openPurchase(coinPackage)}
              activeOpacity={0.75}
            >
              <Text style={styles.buyButtonText}>COMPRAR</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <Text style={styles.disclaimer}>Simulación local: no se realizará ningún cobro real.</Text>

      <Modal
        visible={selectedPackage !== null}
        transparent
        animationType="fade"
        style={isColorInverted ? INVERTED_VIEW_STYLE : undefined}
        onRequestClose={closePurchase}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.purchaseModal}>
            <Text style={styles.modalTitle}>CÓDIGO DE COMPRA</Text>
            <Text style={styles.modalPackage}>
              Paquete: {selectedPackage?.amount ?? 0} monedas
            </Text>
            <Text style={styles.inputLabel}>Ingresa tu código:</Text>
            <TextInput
              style={styles.codeInput}
              value={purchaseCode}
              onChangeText={value => {
                setPurchaseCode(value);
                setFeedback('');
                setPurchaseSucceeded(false);
              }}
              placeholder="Código"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="number-pad"
              maxLength={5}
              autoFocus
              textAlign="center"
            />

            {feedback !== '' && (
              <Text style={purchaseSucceeded ? styles.successMessage : styles.errorMessage}>
                {feedback}
              </Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={closePurchase}
                disabled={isProcessing}
                activeOpacity={0.75}
              >
                <Text style={styles.modalButtonText}>CANCELAR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, isProcessing && styles.buttonDisabled]}
                onPress={confirmPurchase}
                disabled={isProcessing}
                activeOpacity={0.75}
              >
                <Text style={styles.modalButtonText}>
                  {isProcessing ? 'GUARDANDO...' : 'CONFIRMAR COMPRA'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101936',
  },
  header: {
    minHeight: 65,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 130,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 130,
  },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 4,
  },
  balance: {
    marginTop: 2,
    color: '#FFD54F',
    fontSize: 16,
    fontWeight: '800',
  },
  packagesRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  packageCard: {
    flex: 1,
    maxWidth: 230,
    minHeight: 195,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,213,79,0.4)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  packageIcon: {
    fontSize: 30,
  },
  packageAmount: {
    color: '#FFD54F',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 34,
  },
  packageLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  packagePrice: {
    marginTop: 5,
    color: '#80CBC4',
    fontSize: 14,
    fontWeight: '800',
  },
  testLabel: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    textAlign: 'center',
  },
  buyButton: {
    minWidth: 125,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#208AEF',
  },
  buyButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  disclaimer: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  purchaseModal: {
    width: '100%',
    maxWidth: 480,
    paddingVertical: 20,
    paddingHorizontal: 26,
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: '#1A2649',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  modalPackage: {
    marginTop: 4,
    color: '#FFD54F',
    fontSize: 15,
    fontWeight: '700',
  },
  inputLabel: {
    marginTop: 12,
    marginBottom: 5,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  codeInput: {
    width: 210,
    height: 44,
    color: '#fff',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#64B5F6',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  successMessage: {
    minHeight: 18,
    marginTop: 8,
    color: '#81C784',
    fontSize: 13,
    fontWeight: '700',
  },
  errorMessage: {
    minHeight: 18,
    marginTop: 8,
    color: '#FF8A80',
    fontSize: 13,
    fontWeight: '700',
  },
  modalActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    minWidth: 145,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderRadius: 20,
  },
  cancelButton: {
    backgroundColor: '#5F6368',
  },
  confirmButton: {
    backgroundColor: '#43A047',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

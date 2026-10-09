import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloudSync } from '@/components/cloud-sync-provider';
import {
  openStripeTestCheckout,
  STRIPE_TEST_PRODUCTS,
  type StripeTestProduct,
} from '@/lib/stripe-checkout';
import { loadCoinWallet } from '@/utils/coin-storage';

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

const isStripeTestMode = process.env.EXPO_PUBLIC_STRIPE_TEST_MODE === 'true';

export default function StoreScreen() {
  const insets = useSafeAreaInsets();
  const { revision: cloudRevision, syncNow } = useCloudSync();
  const [coinCount, setCoinCount] = useState(0);
  const [processingProductId, setProcessingProductId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const refreshBalance = useCallback(async () => {
    await syncNow();
    const wallet = await loadCoinWallet();
    setCoinCount(wallet.coinCount);
    return wallet.coinCount;
  }, [syncNow]);

  useFocusEffect(
    useCallback(() => {
      void cloudRevision;
      let active = true;

      loadCoinWallet().then(wallet => {
        if (active) setCoinCount(wallet.coinCount);
      });

      return () => {
        active = false;
      };
    }, [cloudRevision])
  );

  const handlePurchase = async (product: StripeTestProduct) => {
    if (processingProductId || !isStripeTestMode) return;

    const balanceBeforeCheckout = coinCount;
    setProcessingProductId(product.id);
    setMessage('Abriendo pago seguro...');

    try {
      await openStripeTestCheckout(product.id);
      setMessage('Confirmando compra...');

      let updatedBalance = balanceBeforeCheckout;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await wait(1_500);
        updatedBalance = await refreshBalance();
        if (updatedBalance >= balanceBeforeCheckout + product.amount) break;
      }

      setMessage(
        updatedBalance >= balanceBeforeCheckout + product.amount
          ? `Se agregaron ${product.amount.toLocaleString('es-MX')} monedas.`
          : 'Tu saldo se actualizará en unos segundos.'
      );
    } catch {
      setMessage('No se pudo abrir el pago. Intenta de nuevo.');
    } finally {
      setProcessingProductId(null);
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
          <Text style={styles.backButtonText}>{'<'} VOLVER</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>TIENDA</Text>
          <View style={styles.balancePill}>
            <Text style={styles.balanceLabel}>SALDO</Text>
            <Text style={styles.balance}>{coinCount.toLocaleString('es-MX')}</Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.modeNotice}>
        <Text style={styles.modeNoticeTitle}>
          {isStripeTestMode ? 'MODO DE PRUEBA' : 'COMPRAS NO DISPONIBLES'}
        </Text>
        <Text style={styles.modeNoticeText}>
          {isStripeTestMode
            ? 'Checkout de Stripe de prueba: no uses una tarjeta real.'
            : 'La venta de monedas requiere integrar Google Play Billing antes de publicar.'}
        </Text>
      </View>

      <View style={styles.packagesRow}>
        {STRIPE_TEST_PRODUCTS.map(product => {
          const isProcessing = processingProductId === product.id;
          const purchasesDisabled = processingProductId !== null || !isStripeTestMode;

          return (
            <View key={product.id} style={styles.packageCard}>
              <View style={styles.coinBadge}>
                <Text style={styles.coinBadgeText}>W</Text>
              </View>
              <Text style={styles.packageAmount}>{product.amount.toLocaleString('es-MX')}</Text>
              <Text style={styles.packageLabel}>MONEDAS</Text>
              <View style={styles.divider} />
              <Text style={styles.packagePrice}>{product.price}</Text>
              <TouchableOpacity
                style={[styles.buyButton, purchasesDisabled && styles.buttonDisabled]}
                onPress={() => void handlePurchase(product)}
                disabled={purchasesDisabled}
                activeOpacity={0.75}
              >
                <Text style={styles.buyButtonText}>
                  {isProcessing ? 'PROCESANDO...' : isStripeTestMode ? 'PROBAR COMPRA' : 'NO DISPONIBLE'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {message !== '' && (
        <View style={styles.messageBanner}>
          <Text style={styles.storeMessage}>{message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B132B' },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center' },
  backButton: {
    width: 106,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#16213E',
  },
  backButtonText: { color: '#DCE6FF', fontSize: 13, fontWeight: '800' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 106 },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', letterSpacing: 3 },
  balancePill: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,213,79,0.1)',
  },
  balanceLabel: { color: '#AAB7D6', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  balance: { color: '#FFD54F', fontSize: 15, fontWeight: '900' },
  packagesRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  modeNotice: {
    alignSelf: 'center',
    maxWidth: 600,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,213,79,0.45)',
    backgroundColor: 'rgba(255,213,79,0.08)',
  },
  modeNoticeTitle: {
    color: '#FFD54F',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  modeNoticeText: {
    marginTop: 3,
    color: '#DCE6FF',
    fontSize: 11,
    textAlign: 'center',
  },
  packageCard: {
    flex: 1,
    maxWidth: 220,
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(138,164,255,0.22)',
    backgroundColor: '#16213E',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  coinBadge: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    borderWidth: 3,
    borderColor: '#FFCA28',
    backgroundColor: '#F59E0B',
  },
  coinBadgeText: { color: '#5D3A00', fontSize: 20, fontWeight: '900' },
  packageAmount: {
    marginTop: 6,
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  packageLabel: { color: '#8FA3CC', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  divider: { width: 32, height: 1, marginVertical: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  packagePrice: { color: '#FFD54F', fontSize: 15, fontWeight: '900' },
  buyButton: {
    width: '100%',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#3478F6',
  },
  buyButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  messageBanner: {
    alignSelf: 'center',
    marginBottom: 2,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(52,120,246,0.16)',
  },
  storeMessage: {
    color: '#CFE0FF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
});

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadCoinWallet } from '@/utils/coin-storage';
import { loadHighScore } from '@/utils/progress-storage';

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const [highScore, setHighScore] = useState(0);
  const [coinCount, setCoinCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      Promise.all([loadHighScore(), loadCoinWallet()])
        .then(([score, wallet]) => {
          if (!active) return;
          setHighScore(score);
          setCoinCount(wallet.coinCount);
        })
        .catch(error => {
          console.error('No se pudieron cargar las estadísticas del jugador:', error);
        });

      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, 18),
          paddingBottom: Math.max(insets.bottom, 24),
          paddingLeft: Math.max(insets.left, 20),
          paddingRight: Math.max(insets.right, 20),
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>WHEELY ME</Text>
        <Text style={styles.title}>GUÍA DE JUEGO</Text>
        <Text style={styles.subtitle}>Domina el equilibrio y supera tu récord.</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🏆</Text>
          <Text style={styles.statLabel}>TU RÉCORD</Text>
          <Text style={styles.statValue}>{highScore.toLocaleString('es-MX')}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🪙</Text>
          <Text style={styles.statLabel}>TUS MONEDAS</Text>
          <Text style={styles.statValue}>{coinCount.toLocaleString('es-MX')}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONTROLES</Text>
        <View style={styles.instructionRow}>
          <Text style={styles.instructionIcon}>📱</Text>
          <View style={styles.instructionCopy}>
            <Text style={styles.instructionTitle}>Inclina el teléfono</Text>
            <Text style={styles.instructionText}>
              Gira suavemente a izquierda o derecha para equilibrar el vehículo.
            </Text>
          </View>
        </View>
        <View style={styles.instructionRow}>
          <Text style={styles.instructionIcon}>🛑</Text>
          <View style={styles.instructionCopy}>
            <Text style={styles.instructionTitle}>Mantén pulsado FRENO</Text>
            <Text style={styles.instructionText}>
              Reduce la velocidad para controlar mejor las pendientes.
            </Text>
          </View>
        </View>
        <View style={styles.instructionRow}>
          <Text style={styles.instructionIcon}>⚖️</Text>
          <View style={styles.instructionCopy}>
            <Text style={styles.instructionTitle}>Centra el sensor en pausa</Text>
            <Text style={styles.instructionText}>
              Usa CENTRAR si el teléfono no está nivelado al comenzar.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONSEJOS</Text>
        <Text style={styles.tipText}>• Recoge monedas durante el recorrido.</Text>
        <Text style={styles.tipText}>• Evita volcar o sacudir demasiado el teléfono.</Text>
        <Text style={styles.tipText}>• Compra potenciadores antes de iniciar una partida.</Text>
        <Text style={styles.tipText}>• Puedes continuar tras un choque por 50 monedas.</Text>
      </View>

      <View style={styles.powerUpsSection}>
        <Text style={styles.sectionTitle}>POTENCIADORES</Text>
        <View style={styles.powerUpsRow}>
          <View style={styles.powerUpCard}>
            <Text style={styles.powerUpIcon}>🧲</Text>
            <Text style={styles.powerUpName}>IMÁN</Text>
            <Text style={styles.powerUpPrice}>25 monedas</Text>
          </View>
          <View style={styles.powerUpCard}>
            <Text style={styles.powerUpIcon}>🛡️</Text>
            <Text style={styles.powerUpName}>ESCUDO</Text>
            <Text style={styles.powerUpPrice}>50 monedas</Text>
          </View>
          <View style={styles.powerUpCard}>
            <Text style={styles.powerUpIcon}>⚡</Text>
            <Text style={styles.powerUpName}>VELOCIDAD</Text>
            <Text style={styles.powerUpPrice}>30 monedas</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A1733' },
  content: { flexGrow: 1, width: '100%', maxWidth: 900, alignSelf: 'center', gap: 16 },
  header: { alignItems: 'center', marginBottom: 2 },
  eyebrow: { color: '#8FA3CC', fontSize: 11, fontWeight: '900', letterSpacing: 3 },
  title: { marginTop: 4, color: '#FFFFFF', fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  subtitle: { marginTop: 4, color: '#B8C6E3', fontSize: 14, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(138,164,255,0.2)',
    borderRadius: 16,
    backgroundColor: '#16213E',
  },
  statIcon: { fontSize: 26 },
  statLabel: { flex: 1, color: '#AAB7D6', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  statValue: { color: '#FFD54F', fontSize: 20, fontWeight: '900' },
  section: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(138,164,255,0.2)',
    borderRadius: 18,
    backgroundColor: '#121E3A',
  },
  sectionTitle: { marginBottom: 10, color: '#FFD54F', fontSize: 13, fontWeight: '900', letterSpacing: 1.3 },
  instructionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 12 },
  instructionIcon: { width: 32, fontSize: 22, textAlign: 'center' },
  instructionCopy: { flex: 1 },
  instructionTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  instructionText: { marginTop: 2, color: '#B8C6E3', fontSize: 12, lineHeight: 17 },
  tipText: { marginTop: 5, color: '#DCE6FF', fontSize: 13, lineHeight: 18 },
  powerUpsSection: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(138,164,255,0.2)',
    borderRadius: 18,
    backgroundColor: '#121E3A',
  },
  powerUpsRow: { flexDirection: 'row', gap: 10 },
  powerUpCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 88,
    padding: 8,
    borderRadius: 14,
    backgroundColor: '#1B2A4B',
  },
  powerUpIcon: { fontSize: 22 },
  powerUpName: { marginTop: 4, color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  powerUpPrice: { marginTop: 3, color: '#FFD54F', fontSize: 10, fontWeight: '700' },
});

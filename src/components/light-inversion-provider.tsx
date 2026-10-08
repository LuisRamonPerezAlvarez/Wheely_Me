import { LightSensor } from 'expo-sensors';
import { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

const LIGHT_INVERSION_THRESHOLD_LUX = 7000;
const LIGHT_SENSOR_INTERVAL_MS = 300;
const STABLE_READING_COUNT = 3;

const LightInversionContext = createContext(false);

export const INVERTED_VIEW_STYLE: ViewStyle = {
  filter: [{ invert: 1 }],
};

export function useLightInversion() {
  return useContext(LightInversionContext);
}

export function LightInversionProvider({ children }: { children: ReactNode }) {
  const [isInverted, setIsInverted] = useState(false);
  const isInvertedRef = useRef(false);
  const pendingModeRef = useRef<boolean | null>(null);
  const stableReadingsRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    let subscription: ReturnType<typeof LightSensor.addListener> | undefined;

    const subscribe = async () => {
      const isAvailable = await LightSensor.isAvailableAsync();
      if (!isMounted || !isAvailable) return;

      LightSensor.setUpdateInterval(LIGHT_SENSOR_INTERVAL_MS);
      subscription = LightSensor.addListener(({ illuminance }) => {
        if (!isMounted) return;

        // Cada lectura se clasifica con el límite exacto. Exigimos tres lecturas
        // consecutivas del mismo lado para evitar parpadeos cerca de 7000 lx.
        const nextMode = illuminance > LIGHT_INVERSION_THRESHOLD_LUX;
        if (nextMode === isInvertedRef.current) {
          pendingModeRef.current = null;
          stableReadingsRef.current = 0;
          return;
        }

        if (pendingModeRef.current === nextMode) {
          stableReadingsRef.current += 1;
        } else {
          pendingModeRef.current = nextMode;
          stableReadingsRef.current = 1;
        }

        if (stableReadingsRef.current >= STABLE_READING_COUNT) {
          isInvertedRef.current = nextMode;
          setIsInverted(nextMode);
          pendingModeRef.current = null;
          stableReadingsRef.current = 0;
        }
      });
    };

    void subscribe().catch(() => {
      if (!isMounted) return;
      isInvertedRef.current = false;
      setIsInverted(false);
    });

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  return (
    <LightInversionContext.Provider value={isInverted}>
      <View style={[styles.app, isInverted && INVERTED_VIEW_STYLE]}>{children}</View>
    </LightInversionContext.Provider>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
  },
});

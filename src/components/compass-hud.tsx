import { Magnetometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type CompassHudProps = {
  left: number;
  top: number;
};

const LANDSCAPE_HEADING_OFFSET = 0;
const UPDATE_INTERVAL_MS = 32;
const SMOOTHING_FACTOR = 0.3;

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function getCardinalDirection(heading: number) {
  if (heading >= 315 || heading < 45) return 'N';
  if (heading < 135) return 'E';
  if (heading < 225) return 'S';
  return 'O';
}

export function CompassHud({ left, top }: CompassHudProps) {
  const [heading, setHeading] = useState(0);
  const [isAvailable, setIsAvailable] = useState(true);
  const headingRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    let subscription: ReturnType<typeof Magnetometer.addListener> | undefined;

    Magnetometer.isAvailableAsync()
      .then(available => {
        if (!isMounted) return;

        setIsAvailable(available);
        if (!available) return;

        Magnetometer.setUpdateInterval(UPDATE_INTERVAL_MS);
        subscription = Magnetometer.addListener(({ x, y }) => {
          if (!isMounted) return;

          // El magnetómetro conserva sus ejes naturales (portrait) en Android.
          // Convertimos el vector norte en rumbo y compensamos el HUD horizontal.
          const magneticNorthAngle = Math.atan2(y, x) * (180 / Math.PI);
          const rawHeading = normalizeDegrees(
            magneticNorthAngle + LANDSCAPE_HEADING_OFFSET
          );
          
          const normCurrent = normalizeDegrees(headingRef.current);
          let delta = rawHeading - normCurrent;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;

          const smoothedHeading = headingRef.current + delta * SMOOTHING_FACTOR;

          headingRef.current = smoothedHeading;
          setHeading(smoothedHeading);
        });
      })
      .catch(() => {
        if (isMounted) setIsAvailable(false);
      });

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  const normalizedHeading = normalizeDegrees(heading);
  const roundedHeading = Math.round(normalizedHeading) % 360;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { left, top }]}
      accessibilityLabel={
        isAvailable
          ? `Brújula: ${getCardinalDirection(normalizedHeading)}, ${roundedHeading} grados`
          : 'Brújula no disponible'
      }
    >
      <View style={styles.pointer} />
      <View style={[styles.dial, { transform: [{ rotate: `${-heading}deg` }] }]}>
        <Text style={[styles.cardinal, styles.north, { transform: [{ rotate: `${heading}deg` }] }]}>N</Text>
        <Text style={[styles.cardinal, styles.east, { transform: [{ rotate: `${heading}deg` }] }]}>E</Text>
        <Text style={[styles.cardinal, styles.south, { transform: [{ rotate: `${heading}deg` }] }]}>S</Text>
        <Text style={[styles.cardinal, styles.west, { transform: [{ rotate: `${heading}deg` }] }]}>O</Text>
      </View>
      <View style={styles.readout}>
        <Text style={styles.direction}>{isAvailable ? getCardinalDirection(normalizedHeading) : '—'}</Text>
        <Text style={styles.degrees}>{isAvailable ? `${roundedHeading}°` : 'N/D'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 41,
    backgroundColor: 'rgba(10, 18, 30, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    zIndex: 12,
    elevation: 4,
  },
  dial: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  cardinal: {
    position: 'absolute',
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
    textAlign: 'center',
    width: 18,
  },
  north: {
    top: 2,
    left: 24,
    color: '#ff5252',
  },
  east: {
    top: 26,
    right: 0,
  },
  south: {
    bottom: 2,
    left: 24,
  },
  west: {
    top: 26,
    left: 0,
  },
  pointer: {
    position: 'absolute',
    top: -1,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ffd54f',
    zIndex: 2,
  },
  readout: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  direction: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 14,
  },
  degrees: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 8,
    lineHeight: 9,
  },
});

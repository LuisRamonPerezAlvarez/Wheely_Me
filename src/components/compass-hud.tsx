import { Magnetometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

type CompassHudProps = {
  left: number;
  top: number;
  active: boolean;
};

const LANDSCAPE_HEADING_OFFSET = 0;
const UPDATE_INTERVAL_MS = 32;
const SMOOTHING_FACTOR = 0.3;
const DIAL_SIZE = 84;
const DIAL_CENTER = DIAL_SIZE / 2;
const TICK_RADIUS = 36;
const TICK_COUNT = 24;

const TICKS = Array.from({ length: TICK_COUNT }, (_, index) => {
  const angle = index * (360 / TICK_COUNT);
  const isMajor = index % 6 === 0;
  const length = isMajor ? 8 : index % 3 === 0 ? 6 : 3;
  const radians = (angle * Math.PI) / 180;

  return {
    key: index,
    isMajor,
    length,
    style: {
      left: DIAL_CENTER + Math.sin(radians) * TICK_RADIUS - 1,
      top: DIAL_CENTER - Math.cos(radians) * TICK_RADIUS - length / 2,
    },
  };
});

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function getCardinalDirection(heading: number) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return directions[Math.round(heading / 45) % directions.length];
}

function getCardinalPosition(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    left: DIAL_CENTER + Math.sin(radians) * radius - 8,
    top: DIAL_CENTER - Math.cos(radians) * radius - 7,
  };
}

export function CompassHud({ left, top, active }: CompassHudProps) {
  const [heading, setHeading] = useState(0);
  const [isAvailable, setIsAvailable] = useState(true);
  const [hasReading, setHasReading] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const headingRef = useRef(0);
  const hasReadingRef = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppIsActive(state === 'active');
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active || !appIsActive) return;

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
          if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return;

          const magneticNorthAngle = Math.atan2(y, x) * (180 / Math.PI);
          const rawHeading = normalizeDegrees(
            magneticNorthAngle + LANDSCAPE_HEADING_OFFSET
          );
          
          let smoothedHeading = rawHeading;
          if (hasReadingRef.current) {
            const normCurrent = normalizeDegrees(headingRef.current);
            let delta = rawHeading - normCurrent;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            smoothedHeading = headingRef.current + delta * SMOOTHING_FACTOR;
          }

          headingRef.current = smoothedHeading;
          setHeading(smoothedHeading);
          if (!hasReadingRef.current) {
            hasReadingRef.current = true;
            setHasReading(true);
          }
        });
      })
      .catch(() => {
        if (isMounted) setIsAvailable(false);
      });

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, [active, appIsActive]);

  const normalizedHeading = normalizeDegrees(heading);
  const roundedHeading = Math.round(normalizedHeading) % 360;
  const showHeading = isAvailable && hasReading;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { left, top }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        showHeading
          ? `Brújula: ${getCardinalDirection(normalizedHeading)}, ${roundedHeading} grados`
          : 'Brújula sin lectura disponible'
      }
    >
      <View style={styles.dialFrame}>
        <View style={[styles.dial, { transform: [{ rotate: `${-heading}deg` }] }]}>
          {TICKS.map(tick => (
            <View
              key={tick.key}
              style={[
                styles.tick,
                tick.isMajor && styles.majorTick,
                { ...tick.style, transform: [{ rotate: `${tick.key * (360 / TICK_COUNT)}deg` }] },
              ]}
            />
          ))}
          <Text
            style={[
              styles.cardinal,
              styles.north,
              getCardinalPosition(0, 25),
              { transform: [{ rotate: `${heading}deg` }] },
            ]}
          >
            N
          </Text>
          <Text
            style={[
              styles.cardinal,
              getCardinalPosition(90, 25),
              { transform: [{ rotate: `${heading}deg` }] },
            ]}
          >
            E
          </Text>
          <Text
            style={[
              styles.cardinal,
              getCardinalPosition(180, 25),
              { transform: [{ rotate: `${heading}deg` }] },
            ]}
          >
            S
          </Text>
          <Text
            style={[
              styles.cardinal,
              getCardinalPosition(270, 25),
              { transform: [{ rotate: `${heading}deg` }] },
            ]}
          >
            O
          </Text>
        </View>

        <View style={styles.fixedMarker} />
        <View style={styles.readout}>
          <Text style={styles.direction}>{showHeading ? getCardinalDirection(normalizedHeading) : '—'}</Text>
          <Text style={styles.degrees}>{showHeading ? `${roundedHeading}°` : 'N/D'}</Text>
        </View>
      </View>
      <Text style={styles.label}>BRÚJULA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 98,
    height: 112,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 213, 79, 0.45)',
    backgroundColor: 'rgba(8, 18, 38, 0.9)',
    zIndex: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  dialFrame: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 44,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(19, 36, 65, 0.95)',
  },
  dial: {
    position: 'absolute',
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_CENTER,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: 3,
    borderRadius: 1,
    backgroundColor: 'rgba(220, 230, 255, 0.48)',
  },
  majorTick: {
    width: 2,
    height: 8,
    borderRadius: 1,
    backgroundColor: 'rgba(220, 230, 255, 0.85)',
  },
  cardinal: {
    position: 'absolute',
    width: 16,
    color: '#E8EEF9',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 14,
    textAlign: 'center',
  },
  north: {
    color: '#FF6B6B',
  },
  fixedMarker: {
    position: 'absolute',
    top: 2,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFD54F',
    zIndex: 3,
  },
  readout: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 213, 79, 0.55)',
    borderRadius: 17,
    backgroundColor: '#0A1733',
  },
  direction: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },
  degrees: {
    color: '#FFD54F',
    fontSize: 8,
    fontWeight: '800',
    lineHeight: 9,
  },
  label: {
    marginTop: 3,
    color: '#DCE6FF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
});

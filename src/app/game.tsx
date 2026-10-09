import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Accelerometer, LightSensor } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompassHud } from '@/components/compass-hud';
import { loadCoinWallet, queueWalletOperation, saveCoinWallet } from '@/utils/coin-storage';
import { loadPlayerPhotoUri } from '@/utils/player-photo';
import { loadHighScore, saveHighScore } from '@/utils/progress-storage';

// Ancho máximo estimado para generar estrellas uniformemente sin depender del ancho inicial de la pantalla
const MAX_BG_WIDTH = 2000;

const NUM_STARS = 40;
const STARS = Array.from({ length: NUM_STARS }).map(() => ({
  top: Math.random() * 200,
  left: Math.random() * MAX_BG_WIDTH,
  size: Math.random() * 3 + 1,
}));

// Nubes: ahora usamos posiciones absolutas más separadas para landscape (pantalla más ancha)
const CLOUDS = [
  { top: 18, left: 100 },
  { top: 55, left: 600 },
  { top: 25, left: 1200 }, // Añadimos una nube extra para rellenar la pantalla horizontal
];

const CONTINUE_COST = 50;
const COIN_SPACING = 180;
const COIN_OFFSET = 120;
const COIN_SIZE = 30;
const COIN_COLLISION_DISTANCE = 69;
const COIN_VERTICAL_COLLISION_DISTANCE = 54;
const COIN_RENDER_MARGIN = 80;
const CONTINUE_PHYSICS_DELAY_MS = 750;
const MAGNET_RADIUS = 165;
const MAGNET_PULL_SPEED = 260;
const SPEED_ACCELERATION_MULTIPLIER = 1.25;
const SHAKE_WINDOW_SIZE = 6;
const SHAKE_SAMPLE_THRESHOLD = 1.2;
const SHAKE_AVERAGE_THRESHOLD = 0.8;
const SHAKE_REQUIRED_SAMPLES = 3;
const SHAKE_IGNORE_AFTER_CONTINUE_MS = 1500;
const SHAKE_FLIGHT_DURATION_MS = 550;
const STOPPED_SPEED_THRESHOLD = 3;
const STOPPED_CONFIRMATION_MS = 250;
const STRAIGHTEN_RATE_DEGREES_PER_SECOND = 140;
const BRAKE_DAMPING_PER_SECOND = 10;
const BRAKE_STOP_SPEED = 3;
const TERRAIN_BASE_HEIGHT = 70;
const TERRAIN_START_DISTANCE = 380;
const TERRAIN_SECTION_LENGTH = 900;
const TERRAIN_DIFFICULTY_DISTANCE = 6500;
const TERRAIN_MIN_AMPLITUDE = 28; // Amplitud mínima
const TERRAIN_MAX_AMPLITUDE = 125; // Amplitud máxima
const TERRAIN_GIANT_HILL_MULTIPLIER = 1.3; // Multiplicador de colinas grandes
const TERRAIN_MIN_HEIGHT = 18; // Altura mínima del terreno
const TERRAIN_MAX_HEIGHT = 190; // Altura máxima del terreno
const TERRAIN_SAMPLE_STEP = 6; // Paso entre cada muestra del terreno
const TERRAIN_SLOPE_SAMPLE = 8; // Muestra la pendiente
const TERRAIN_GRAVITY = 460; // Gravedad
const TERRAIN_MIN_JUMP_SPEED = 185; // Velocidad mínima para saltar
const TERRAIN_JUMP_LOOKAHEAD = 42; // Añade el salto
const TERRAIN_LANDING_RESPONSE = 0.7; // Respuesta del terreno al aterrizar
const CAR_WIDTH = 100; // Ancho del auto
const CAR_HEIGHT = 75; // Ancho del auto
const CHARACTER_SIZE = 48; // Tamaño del personaje
const CAR_BODY_HEIGHT = 35; // Tamaño de la foto
const WHEEL_TRACK_WIDTH = 75; // Distancia entre las ruedas
const WHEEL_SIZE = 28; // Tamaño de las llantas 
const CAR_TERRAIN_CLEARANCE = 15; // Distancia entre el auto y el terreno
const CAR_WHEEL_HALF_SPAN = 35; // Distancia entre el centro del auto y las llantas

type GameOverType = 'rollover' | 'shake' | null;

type PowerUpId = 'magnet' | 'shield' | 'speed';

type PowerUpSelection = Record<PowerUpId, boolean>;

const EMPTY_POWER_UPS: PowerUpSelection = {
  magnet: false,
  shield: false,
  speed: false,
};

const POWER_UPS: {
  id: PowerUpId;
  name: string;
  icon: string;
  price: number;
  description: string;
}[] = [
    { id: 'magnet', name: 'IMÁN', icon: '🧲', price: 25, description: 'Atrae monedas cercanas' },
    { id: 'shield', name: 'ESCUDO', icon: '🛡️', price: 50, description: 'Evita un vuelco' },
    { id: 'speed', name: 'VELOCIDAD', icon: '⚡', price: 30, description: 'Aumenta la velocidad' },
  ];

function getCoinWorldX(coinId: number) {
  return COIN_OFFSET + coinId * COIN_SPACING;
}

function terrainNoise(sectionIndex: number, offset: number) {
  const value = Math.sin((sectionIndex + 1) * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function getTerrainHeight(worldX: number) {
  const distanceFromStart = Math.abs(worldX);
  if (distanceFromStart <= TERRAIN_START_DISTANCE) return TERRAIN_BASE_HEIGHT;

  const terrainX = distanceFromStart - TERRAIN_START_DISTANCE;
  const sectionIndex = Math.floor(terrainX / TERRAIN_SECTION_LENGTH);
  const terrainSeedIndex = worldX >= 0 ? sectionIndex : -sectionIndex - 1;
  const sectionProgress = (
    terrainX - sectionIndex * TERRAIN_SECTION_LENGTH
  ) / TERRAIN_SECTION_LENGTH;
  const difficulty = Math.min(1, terrainX / TERRAIN_DIFFICULTY_DISTANCE);

  // Cada sección empieza y termina plana. La envolvente con seno al cuadrado
  // hace que la pendiente llegue suavemente a cero antes del siguiente tramo.
  const flatEdge = (
    0.09 + terrainNoise(terrainSeedIndex, 4) * 0.1
  ) * (1 - difficulty * 0.25);
  if (sectionProgress <= flatEdge || sectionProgress >= 1 - flatEdge) {
    return TERRAIN_BASE_HEIGHT;
  }

  const hillProgress = (
    sectionProgress - flatEdge
  ) / (1 - flatEdge * 2);
  const envelope = Math.sin(Math.PI * hillProgress) ** 2;
  let amplitude = (
    TERRAIN_MIN_AMPLITUDE
    + (TERRAIN_MAX_AMPLITUDE - TERRAIN_MIN_AMPLITUDE) * difficulty
  ) * (0.82 + terrainNoise(terrainSeedIndex, 1) * 0.36);
  if (difficulty > 0.4 && terrainNoise(terrainSeedIndex, 5) > 0.82) {
    amplitude *= TERRAIN_GIANT_HILL_MULTIPLIER;
  }
  const terrainType = terrainNoise(terrainSeedIndex, 2);
  const direction = terrainNoise(terrainSeedIndex, 3) > 0.32 ? 1 : -1;

  let profile: number;
  if (terrainType < 0.16) {
    // Cambio bajo y largo: sirve como transición sencilla al principio.
    profile = direction * 0.55 * envelope;
  } else if (terrainType < 0.5) {
    // Loma redondeada, positiva o en forma de depresión suave.
    profile = direction * envelope;
  } else if (terrainType < 0.82) {
    // Dos cambios consecutivos dentro de la misma sección.
    profile = Math.sin(Math.PI * 2 * hillProgress) * envelope * 0.95;
  } else {
    // Loma grande y pronunciada, reservada para algunas secciones avanzadas.
    profile = direction * Math.sin(Math.PI * hillProgress) ** 4 * 1.18;
  }

  // Al avanzar aparecen cambios consecutivos más marcados sin volver el inicio hostil.
  profile += Math.sin(Math.PI * 4 * hillProgress) * envelope * difficulty * 0.22;

  return Math.max(
    TERRAIN_MIN_HEIGHT,
    Math.min(TERRAIN_MAX_HEIGHT, TERRAIN_BASE_HEIGHT + amplitude * profile)
  );
}

function getTerrainAngle(worldX: number) {
  const rise = getTerrainHeight(worldX + TERRAIN_SLOPE_SAMPLE)
    - getTerrainHeight(worldX - TERRAIN_SLOPE_SAMPLE);
  return -Math.atan2(rise, TERRAIN_SLOPE_SAMPLE * 2) * (180 / Math.PI);
}

function getCarContactHeight(worldX: number) {
  const centerHeight = getTerrainHeight(worldX);
  const wheelAverageHeight = (
    getTerrainHeight(worldX - CAR_WHEEL_HALF_SPAN)
    + getTerrainHeight(worldX + CAR_WHEEL_HALF_SPAN)
  ) / 2;
  return Math.max(centerHeight, wheelAverageHeight) + CAR_TERRAIN_CLEARANCE;
}

function isCoinWithinCarPath(
  previousCarX: number,
  previousCarBottom: number,
  nextCarX: number,
  nextCarBottom: number,
  coinWorldX: number,
  coinBottom: number
) {
  const coinCenterY = coinBottom + COIN_SIZE / 2;
  const carCenterOffset = CAR_HEIGHT / 2;
  const startX = (previousCarX - coinWorldX) / COIN_COLLISION_DISTANCE;
  const startY = (previousCarBottom + carCenterOffset - coinCenterY)
    / COIN_VERTICAL_COLLISION_DISTANCE;
  const endX = (nextCarX - coinWorldX) / COIN_COLLISION_DISTANCE;
  const endY = (nextCarBottom + carCenterOffset - coinCenterY)
    / COIN_VERTICAL_COLLISION_DISTANCE;
  const pathX = endX - startX;
  const pathY = endY - startY;
  const pathLengthSquared = pathX * pathX + pathY * pathY;
  const closestPointRatio = pathLengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, -(startX * pathX + startY * pathY) / pathLengthSquared));
  const closestX = startX + pathX * closestPointRatio;
  const closestY = startY + pathY * closestPointRatio;

  return closestX * closestX + closestY * closestY <= 1;
}

function saveCoinRun(coinCount: number, collectedCoinIds: Set<number>) {
  void saveCoinWallet(coinCount, collectedCoinIds);
}

// Nube caricaturizada: base plana + burbujas uniformes encima
function Cloud({ top, left }: { top: number; left: number }) {
  return (
    <View style={{ position: 'absolute', top, left }}>
      {/* Burbujas superiores: 5 círculos uniformes bien alineados */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginLeft: 8 }}>
        <View style={{ width: 30, height: 30, backgroundColor: '#fff', borderRadius: 15, marginRight: -4 }} />
        <View style={{ width: 38, height: 38, backgroundColor: '#fff', borderRadius: 19, marginRight: -4 }} />
        <View style={{ width: 44, height: 44, backgroundColor: '#fff', borderRadius: 22, marginRight: -4 }} />
        <View style={{ width: 30, height: 30, backgroundColor: '#fff', borderRadius: 15, marginRight: -4 }} />
      </View>
      {/* Base plana: rectángulo que une todo por abajo */}
      <View style={{
        width: 148, height: 28,
        backgroundColor: '#fff',
        borderRadius: 14,
        marginTop: -14,
      }} />
    </View>
  );
}

export default function WheelyMeGame() {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [carX, setCarX] = useState(0);
  const [carBottom, setCarBottom] = useState(
    TERRAIN_BASE_HEIGHT + CAR_TERRAIN_CLEARANCE
  );
  const [carAngle, setCarAngle] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameOverReason, setGameOverReason] = useState('');
  const [gameOverType, setGameOverType] = useState<GameOverType>(null);
  const [shakeFlightActive, setShakeFlightActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [coinCount, setCoinCount] = useState(0);
  const [collectedCoinIds, setCollectedCoinIds] = useState<Set<number>>(() => new Set());
  const [magnetizedCoinPositions, setMagnetizedCoinPositions] = useState<Map<number, number>>(
    () => new Map()
  );
  const [coinStorageLoaded, setCoinStorageLoaded] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [selectedPowerUps, setSelectedPowerUps] = useState<PowerUpSelection>({ ...EMPTY_POWER_UPS });
  const [activePowerUps, setActivePowerUps] = useState<PowerUpSelection>({ ...EMPTY_POWER_UPS });
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [tiltDisplay, setTiltDisplay] = useState('0°');
  const [lightDisplay, setLightDisplay] = useState('0 lx');
  const [backgroundColor, setBackgroundColor] = useState('#87CEEB');
  const [starOpacity, setStarOpacity] = useState(0);
  const [playerPhotoUri, setPlayerPhotoUri] = useState<string | null>(null);
  const [isBraking, setIsBraking] = useState(false);
  const [shakeFlightY] = useState(() => new Animated.Value(0));
  const [shakeFlightSpin] = useState(() => new Animated.Value(0));

  const velocityX = useRef(0);
  const velocityY = useRef(0);
  const velocityAngle = useRef(0);
  const carBottomRef = useRef(TERRAIN_BASE_HEIGHT + CAR_TERRAIN_CLEARANCE);
  const isAirborneRef = useRef(false);
  const carAngleRef = useRef(0);
  const isBrakingRef = useRef(false);
  const stoppedSinceRef = useRef<number | null>(null);
  const loopRef = useRef<number>(null);
  const carXRef = useRef(0);
  const coinCountRef = useRef(0);
  const collectedCoinIdsRef = useRef<Set<number>>(new Set());
  const coinStorageLoadedRef = useRef(false);
  const physicsResumeAtRef = useRef(0);
  const magnetizedCoinPositionsRef = useRef<Map<number, number>>(new Map());
  const magnetActiveRef = useRef(false);
  const shieldAvailableRef = useRef(false);
  const speedActiveRef = useRef(false);
  const gameplayActiveRef = useRef(false);
  const shakeSamplesRef = useRef<number[]>([]);
  const previousAccelerationRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const shakeIgnoreUntilRef = useRef(0);
  const scoreRef = useRef(0);

  // Pause: usamos un ref para que el game loop lo lea sincrónicamente
  // (setState es asíncrono y el loop no lo vería a tiempo)
  const pausedRef = useRef(false);
  const lastTimeRef = useRef(0);

  // Gyroscope / Accelerometer references
  const tiltRef = useRef(0);
  const calibratedZeroRef = useRef(0);

  // Cargar récord y las monedas de la partida actual al iniciar
  useEffect(() => {
    loadHighScore().then(setHighScore);

    loadCoinWallet()
      .then(wallet => {
        const restoredIds = new Set(wallet.collectedCoinIds);

        coinCountRef.current = wallet.coinCount;
        collectedCoinIdsRef.current = restoredIds;
        setCoinCount(wallet.coinCount);
        setCollectedCoinIds(restoredIds);
      })
      .finally(() => {
        coinStorageLoadedRef.current = true;
        setCoinStorageLoaded(true);
      });

    loadPlayerPhotoUri().then(setPlayerPhotoUri);
  }, []);

  // Setup Accelerometer
  useEffect(() => {
    let isMounted = true;
    Accelerometer.setUpdateInterval(50);
    const subscription = Accelerometer.addListener(data => {
      if (!isMounted) return;
      // En landscape, el eje Y (data.y) es el que detecta la inclinación de "volante" (izquierda/derecha).
      const tiltDegrees = (data.y * 90);
      tiltRef.current = tiltDegrees;

      const adjustedTilt = tiltDegrees - calibratedZeroRef.current;
      const direction = adjustedTilt < 0 ? '←' : '→';
      setTiltDisplay(`Giroscopio: ${direction} ${Math.abs(Math.round(adjustedTilt))}°`);

      const now = Date.now();
      if (
        !gameplayActiveRef.current
        || pausedRef.current
        || now < physicsResumeAtRef.current
        || now < shakeIgnoreUntilRef.current
      ) {
        shakeSamplesRef.current = [];
        previousAccelerationRef.current = data;
        return;
      }

      const previous = previousAccelerationRef.current;
      previousAccelerationRef.current = data;
      if (!previous) return;

      const magnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
      const dynamicAcceleration = Math.abs(magnitude - 1);
      const vectorChange = Math.sqrt(
        (data.x - previous.x) ** 2
        + (data.y - previous.y) ** 2
        + (data.z - previous.z) ** 2
      );
      const shakeIntensity = Math.max(dynamicAcceleration, vectorChange * 0.75);
      const samples = [...shakeSamplesRef.current, shakeIntensity].slice(-SHAKE_WINDOW_SIZE);
      shakeSamplesRef.current = samples;

      if (samples.length < SHAKE_WINDOW_SIZE) return;

      const strongSamples = samples.filter(sample => sample >= SHAKE_SAMPLE_THRESHOLD).length;
      const averageIntensity = samples.reduce((total, sample) => total + sample, 0) / samples.length;

      if (
        strongSamples >= SHAKE_REQUIRED_SAMPLES
        && averageIntensity >= SHAKE_AVERAGE_THRESHOLD
      ) {
        gameplayActiveRef.current = false;
        pausedRef.current = true;
        shakeSamplesRef.current = [];
        previousAccelerationRef.current = null;
        setGameOverType('shake');
        setGameOverReason('Te fuiste a volar por temblar');
        setShakeFlightActive(true);
        shakeFlightY.setValue(0);
        shakeFlightSpin.setValue(0);

        Animated.parallel([
          Animated.timing(shakeFlightY, {
            toValue: -220,
            duration: SHAKE_FLIGHT_DURATION_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(shakeFlightSpin, {
            toValue: 1,
            duration: SHAKE_FLIGHT_DURATION_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (!isMounted) return;

          const finalScore = Math.floor(scoreRef.current);
          setHighScore(previousHighScore => {
            if (finalScore > previousHighScore) {
              void saveHighScore(finalScore);
              return finalScore;
            }
            return previousHighScore;
          });
          setGameOver(true);
        });
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [shakeFlightSpin, shakeFlightY]);

  // Setup LightSensor
  useEffect(() => {
    let subscription: any;
    let isMounted = true;

    // Algunos dispositivos no soportan sensor de luz. Verificamos primero.
    LightSensor.isAvailableAsync().then(isAvailable => {
      if (!isMounted) return;

      if (isAvailable) {
        // Aumentamos un poco la frecuencia de actualización para que se sienta más responsivo
        LightSensor.setUpdateInterval(300);
        subscription = LightSensor.addListener(({ illuminance }) => {
          if (!isMounted) return;
          setLightDisplay(`Luz: ${Math.round(illuminance)} lx`);

          // En Android, los sensores varían muchísimo. Algunos leen 100 lux en un cuarto oscuro
          // y otros 5000 lux con luz normal. Amplié drásticamente los rangos para que notes
          // el cambio. Por favor, mira los números en pantalla para calibrarlo con precisión.
          if (illuminance < 10) {
            setBackgroundColor('#000022'); // Muy oscuro (Noche)
          } else if (illuminance < 500) {
            setBackgroundColor('#4169E1'); // Oscuro (Atardecer)
          } else if (illuminance < 2500) {
            setBackgroundColor('#87CEEB'); // Normal (Día claro en interiores)
          } else {
            setBackgroundColor('#E0FFFF'); // Muy claro (Sol / Linterna directa)
          }

          // Estrellas: Solo se ven si es "de noche" (illuminance < 800)
          // La opacidad va de 0 a 1 dependiendo de qué tan oscuro esté.
          if (illuminance >= 800) {
            setStarOpacity(0);
          } else {
            setStarOpacity(1 - (illuminance / 800));
          }
        });
      } else {
        setLightDisplay('Luz: No soportado');
      }
    });

    return () => {
      isMounted = false;
      if (subscription) subscription.remove();
    };
  }, []);

  // Game loop
  useEffect(() => {
    if (!gameStarted || gameOver) return;

    lastTimeRef.current = Date.now();

    const tick = () => {
      const now = Date.now();

      // Si está pausado, no procesamos nada de física/puntuación.
      // Solo reprogramamos el siguiente frame y reseteamos lastTime
      // para que al reanudar no haya un salto enorme de dt.
      if (pausedRef.current || now < physicsResumeAtRef.current) {
        lastTimeRef.current = now;
        loopRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      // Calculate adjusted tilt
      const currentTilt = tiltRef.current - calibratedZeroRef.current;
      const braking = isBrakingRef.current;

      // --- Movimiento horizontal ---
      // El freno tiene prioridad total sobre la inclinación mientras está pulsado.
      if (braking) {
        velocityX.current *= Math.exp(-BRAKE_DAMPING_PER_SECOND * dt);
        if (Math.abs(velocityX.current) <= BRAKE_STOP_SPEED) {
          velocityX.current = 0;
        }
      } else if (Math.abs(currentTilt) > 3) {
        const factor = currentTilt / 30;
        const accelerationMultiplier = speedActiveRef.current
          ? SPEED_ACCELERATION_MULTIPLIER
          : 1;
        velocityX.current += 150 * accelerationMultiplier * factor * dt;
      } else {
        velocityX.current *= 0.95; // Fricción al estar plano
      }
      // Amortiguación natural de la velocidad horizontal (resistencia del aire / ruedas)
      if (!braking) velocityX.current *= 0.99;

      const canSettleNaturally = !braking && Math.abs(currentTilt) <= 3;
      if (canSettleNaturally && Math.abs(velocityX.current) < STOPPED_SPEED_THRESHOLD) {
        velocityX.current = 0;
        stoppedSinceRef.current ??= now;
      } else if (!braking) {
        stoppedSinceRef.current = null;
      }

      const hasSettled = stoppedSinceRef.current !== null
        && now - stoppedSinceRef.current >= STOPPED_CONFIRMATION_MS;
      const brakeHasStopped = braking && velocityX.current === 0;
      const shouldStraighten = brakeHasStopped || hasSettled;

      const previousCarX = carXRef.current;
      const previousCarBottom = carBottomRef.current;
      const nextCarX = previousCarX + velocityX.current * dt;
      const previousGroundHeight = getCarContactHeight(previousCarX);
      const nextGroundHeight = getCarContactHeight(nextCarX);
      const nextTerrainHeight = getTerrainHeight(nextCarX);
      const previousSurfaceAngle = getTerrainAngle(previousCarX);
      const surfaceAngle = getTerrainAngle(nextCarX);
      let landedThisFrame = false;
      let landingSpeed = 0;

      if (isAirborneRef.current) {
        velocityY.current -= TERRAIN_GRAVITY * dt;
        const nextBottom = carBottomRef.current + velocityY.current * dt;

        if (nextBottom <= nextGroundHeight) {
          landedThisFrame = true;
          landingSpeed = Math.abs(velocityY.current);
          isAirborneRef.current = false;
          velocityY.current = 0;
          carBottomRef.current = nextGroundHeight;
        } else {
          carBottomRef.current = nextBottom;
        }
      } else {
        const travelDirection = Math.sign(velocityX.current);
        const approachHeight = travelDirection === 0
          ? nextTerrainHeight
          : getTerrainHeight(nextCarX - travelDirection * TERRAIN_JUMP_LOOKAHEAD);
        const departureHeight = travelDirection === 0
          ? nextTerrainHeight
          : getTerrainHeight(nextCarX + travelDirection * TERRAIN_JUMP_LOOKAHEAD);
        const climbedIntoCrest = nextTerrainHeight - approachHeight > 2;
        const groundDropsAhead = departureHeight - nextTerrainHeight < -2;

        carBottomRef.current = nextGroundHeight;
        velocityY.current = dt > 0
          ? (nextGroundHeight - previousGroundHeight) / dt
          : 0;

        if (
          !braking
          && Math.abs(velocityX.current) >= TERRAIN_MIN_JUMP_SPEED
          && climbedIntoCrest
          && groundDropsAhead
        ) {
          isAirborneRef.current = true;
          carBottomRef.current += 1;
        }
      }

      setCarBottom(carBottomRef.current);

      // --- Física de rotación tipo vehículo ---
      // La gravedad actúa como un RESORTE que intenta devolver el carrito a 0°.
      // Mientras el ángulo sea pequeño, lo corrige. Si pasa el punto crítico, lo tumba.
      const TIPPING_ANGLE = 35; // Ángulo a partir del cual el carrito empieza a caer sin control
      const GRAVITY_RESTORE = 120; // Fuerza con la que la gravedad lo endereza
      const GRAVITY_TOPPLE = 180; // Fuerza con la que la gravedad lo tumba si ya pasó el umbral

      const carAngleSnapshot = carAngleRef.current;
      const targetSurfaceAngle = isAirborneRef.current ? 0 : surfaceAngle;
      const relativeSurfaceAngle = carAngleSnapshot - targetSurfaceAngle;

      if (shouldStraighten) {
        velocityAngle.current = 0;
      } else if (Math.abs(relativeSurfaceAngle) < TIPPING_ANGLE) {
        // En contacto, la suspensión busca la pendiente; en el aire busca estabilidad.
        velocityAngle.current -= relativeSurfaceAngle * GRAVITY_RESTORE * dt;
      } else {
        // Pasó el punto crítico: la gravedad lo TUMBA en la misma dirección
        velocityAngle.current += Math.sign(relativeSurfaceAngle) * GRAVITY_TOPPLE * dt;
      }

      if (!shouldStraighten && !isAirborneRef.current) {
        // Un cambio brusco de pendiente transmite un impulso angular mayor a alta velocidad.
        velocityAngle.current += (surfaceAngle - previousSurfaceAngle) * 2.4;
      }

      if (landedThisFrame && !shouldStraighten) {
        const landingMismatch = surfaceAngle - carAngleSnapshot;
        velocityAngle.current += landingMismatch * TERRAIN_LANDING_RESPONSE;
        velocityAngle.current += Math.sign(velocityX.current)
          * Math.min(22, landingSpeed * 0.08);
      }

      // Amortiguación angular (las ruedas / suspensión absorben oscilaciones)
      if (!shouldStraighten) velocityAngle.current *= 0.88;

      // Pequeño impulso de desequilibrio por velocidad lateral alta
      // (simula que el carrito se desequilibra un poco cuando va muy rápido)
      const speedFactor = Math.abs(velocityX.current) / 400;
      if (!shouldStraighten && speedFactor > 0.5) {
        velocityAngle.current += Math.sign(velocityX.current) * speedFactor * 8 * dt;
      }

      carXRef.current = nextCarX;
      setCarX(nextCarX);

      // Detectamos todas las monedas atravesadas durante este frame para que una
      // velocidad alta no permita saltarse una colisión.
      if (coinStorageLoadedRef.current) {
        const coinSearchDistance = magnetActiveRef.current
          ? MAGNET_RADIUS
          : COIN_COLLISION_DISTANCE;
        const pathStart = Math.min(previousCarX, nextCarX) - coinSearchDistance;
        const pathEnd = Math.max(previousCarX, nextCarX) + coinSearchDistance;
        const firstTouchedCoin = Math.ceil((pathStart - COIN_OFFSET) / COIN_SPACING);
        const lastTouchedCoin = Math.floor((pathEnd - COIN_OFFSET) / COIN_SPACING);
        const newlyCollected: number[] = [];
        let coinPositionsChanged = false;

        for (let coinId = firstTouchedCoin; coinId <= lastTouchedCoin; coinId += 1) {
          if (collectedCoinIdsRef.current.has(coinId)) continue;

          let coinWorldX = magnetizedCoinPositionsRef.current.get(coinId)
            ?? getCoinWorldX(coinId);

          if (magnetActiveRef.current) {
            const distanceToCar = nextCarX - coinWorldX;
            if (Math.abs(distanceToCar) <= MAGNET_RADIUS) {
              const pullDistance = Math.min(
                Math.abs(distanceToCar),
                MAGNET_PULL_SPEED * dt
              );
              coinWorldX += Math.sign(distanceToCar) * pullDistance;
              magnetizedCoinPositionsRef.current.set(coinId, coinWorldX);
              coinPositionsChanged = true;
            }
          }

          const coinBottom = getTerrainHeight(coinWorldX) + 18;
          const touchedByCar = isCoinWithinCarPath(
            previousCarX,
            previousCarBottom,
            nextCarX,
            carBottomRef.current,
            coinWorldX,
            coinBottom
          );

          if (touchedByCar) {
            collectedCoinIdsRef.current.add(coinId);
            magnetizedCoinPositionsRef.current.delete(coinId);
            coinPositionsChanged = true;
            newlyCollected.push(coinId);
          }
        }

        if (coinPositionsChanged) {
          setMagnetizedCoinPositions(new Map(magnetizedCoinPositionsRef.current));
        }

        if (newlyCollected.length > 0) {
          const nextCoinCount = coinCountRef.current + newlyCollected.length;
          coinCountRef.current = nextCoinCount;
          setCoinCount(nextCoinCount);
          setCollectedCoinIds(new Set(collectedCoinIdsRef.current));
          saveCoinRun(nextCoinCount, collectedCoinIdsRef.current);
          void queueWalletOperation(newlyCollected.length, 'game_reward');
        }
      }

      setCarAngle(prev => {
        const maxStraightenStep = STRAIGHTEN_RATE_DEGREES_PER_SECOND * dt;
        const newAngle = shouldStraighten
          ? Math.abs(prev) <= maxStraightenStep
            ? 0
            : prev - Math.sign(prev) * maxStraightenStep
          : prev + velocityAngle.current * dt;

        carAngleRef.current = newAngle;
        // Game over if tilted beyond 70 degrees
        if (Math.abs(newAngle) > 70) {
          if (shieldAvailableRef.current) {
            shieldAvailableRef.current = false;
            setActivePowerUps(current => ({ ...current, shield: false }));
            velocityX.current = 0;
            velocityY.current = 0;
            velocityAngle.current = 0;
            isAirborneRef.current = false;
            carBottomRef.current = getCarContactHeight(carXRef.current);
            setCarBottom(carBottomRef.current);
            physicsResumeAtRef.current = Date.now() + CONTINUE_PHYSICS_DELAY_MS;
            carAngleRef.current = 0;
            return 0;
          }

          gameplayActiveRef.current = false;
          setGameOverType('rollover');
          setGameOver(true);
          setGameOverReason('¡Inclinaste demasiado el carrito y se volteó!');
          // Comparar y guardar récord
          setScore(currentScore => {
            const finalScore = Math.floor(currentScore);
            setHighScore(prevHigh => {
              if (finalScore > prevHigh) {
                void saveHighScore(finalScore);
                return finalScore;
              }
              return prevHigh;
            });
            return currentScore;
          });
        }
        return newAngle;
      });

      setScore(prev => {
        const nextScore = prev + (Math.abs(velocityX.current) * dt) * 0.1;
        scoreRef.current = nextScore;
        return nextScore;
      });

      loopRef.current = requestAnimationFrame(tick);
    };

    loopRef.current = requestAnimationFrame(tick);

    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    };
  }, [gameOver, gameStarted]);

  const resetWorldProgress = () => {
    const emptyCollectedCoins = new Set<number>();
    collectedCoinIdsRef.current = emptyCollectedCoins;
    setCollectedCoinIds(emptyCollectedCoins);
    magnetizedCoinPositionsRef.current.clear();
    setMagnetizedCoinPositions(new Map());
    saveCoinRun(coinCountRef.current, emptyCollectedCoins);

    setCarX(0);
    carXRef.current = 0;
    const initialCarBottom = TERRAIN_BASE_HEIGHT + CAR_TERRAIN_CLEARANCE;
    setCarBottom(initialCarBottom);
    carBottomRef.current = initialCarBottom;
    setCarAngle(0);
    carAngleRef.current = 0;
    setGameOver(false);
    setGameOverReason('');
    setGameOverType(null);
    setShakeFlightActive(false);
    setScore(0);
    scoreRef.current = 0;
    velocityX.current = 0;
    velocityY.current = 0;
    velocityAngle.current = 0;
    isAirborneRef.current = false;
    isBrakingRef.current = false;
    stoppedSinceRef.current = null;
    setIsBraking(false);
    physicsResumeAtRef.current = 0;
    shakeIgnoreUntilRef.current = 0;
    shakeSamplesRef.current = [];
    previousAccelerationRef.current = null;
    shakeFlightY.setValue(0);
    shakeFlightSpin.setValue(0);
    pausedRef.current = false;
    setPaused(false);
  };

  const handleBuyPowerUp = (powerUpId: PowerUpId) => {
    if (selectedPowerUps[powerUpId]) return;

    const powerUp = POWER_UPS.find(item => item.id === powerUpId);
    if (!powerUp) return;

    if (coinCountRef.current < powerUp.price) {
      setPurchaseMessage(`Necesitas ${powerUp.price - coinCountRef.current} monedas más`);
      return;
    }

    const remainingCoins = coinCountRef.current - powerUp.price;
    coinCountRef.current = remainingCoins;
    setCoinCount(remainingCoins);
    setSelectedPowerUps(current => ({ ...current, [powerUpId]: true }));
    setPurchaseMessage(`${powerUp.name} preparado para la siguiente partida`);
    saveCoinRun(remainingCoins, collectedCoinIdsRef.current);
    void queueWalletOperation(-powerUp.price, 'power_up');
  };

  const handleStartGame = () => {
    if (!coinStorageLoaded) return;

    resetWorldProgress();
    magnetActiveRef.current = selectedPowerUps.magnet;
    shieldAvailableRef.current = selectedPowerUps.shield;
    speedActiveRef.current = selectedPowerUps.speed;
    setActivePowerUps({ ...selectedPowerUps });
    setPurchaseMessage('');
    gameplayActiveRef.current = true;
    setGameStarted(true);
  };

  const handleReturnToMenuFromPowerUps = () => {
    // Reembolsar monedas de los potenciadores seleccionados si se cancela la partida
    let refundAmount = 0;
    POWER_UPS.forEach(pu => {
      if (selectedPowerUps[pu.id]) {
        refundAmount += pu.price;
      }
    });

    if (refundAmount > 0) {
      const remainingCoins = coinCountRef.current + refundAmount;
      coinCountRef.current = remainingCoins;
      setCoinCount(remainingCoins);
      saveCoinRun(remainingCoins, collectedCoinIdsRef.current);
      void queueWalletOperation(refundAmount, 'refund');
    }

    setSelectedPowerUps({ ...EMPTY_POWER_UPS });
    setPurchaseMessage('');

    router.dismissTo('/');
  };

  const handleRestart = () => {
    resetWorldProgress();
    magnetActiveRef.current = false;
    shieldAvailableRef.current = false;
    speedActiveRef.current = false;
    setActivePowerUps({ ...EMPTY_POWER_UPS });
    setSelectedPowerUps({ ...EMPTY_POWER_UPS });
    setPurchaseMessage('');
    gameplayActiveRef.current = false;
    setGameStarted(false);
  };

  const handleContinue = () => {
    if (coinCountRef.current < CONTINUE_COST) return;

    const remainingCoins = coinCountRef.current - CONTINUE_COST;
    coinCountRef.current = remainingCoins;
    setCoinCount(remainingCoins);
    saveCoinRun(remainingCoins, collectedCoinIdsRef.current);
    void queueWalletOperation(-CONTINUE_COST, 'continue');

    // Conservamos posición y progreso, pero estabilizamos la física antes de
    // reactivar el loop para evitar otro Game Over inmediato.
    setCarAngle(0);
    carAngleRef.current = 0;
    const safeTerrainHeight = getCarContactHeight(carXRef.current);
    setCarBottom(safeTerrainHeight);
    carBottomRef.current = safeTerrainHeight;
    velocityX.current = 0;
    velocityY.current = 0;
    velocityAngle.current = 0;
    isAirborneRef.current = false;
    isBrakingRef.current = false;
    stoppedSinceRef.current = null;
    setIsBraking(false);
    physicsResumeAtRef.current = Date.now() + CONTINUE_PHYSICS_DELAY_MS;
    shakeIgnoreUntilRef.current = Date.now()
      + CONTINUE_PHYSICS_DELAY_MS
      + SHAKE_IGNORE_AFTER_CONTINUE_MS;
    shakeSamplesRef.current = [];
    previousAccelerationRef.current = null;
    shakeFlightY.setValue(0);
    shakeFlightSpin.setValue(0);
    setShakeFlightActive(false);
    setGameOverType(null);
    gameplayActiveRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    setGameOverReason('');
    setGameOver(false);
  };

  const handleCalibrate = () => {
    calibratedZeroRef.current = tiltRef.current;
    handleResume();
  };

  const handleBrakePressIn = () => {
    isBrakingRef.current = true;
    stoppedSinceRef.current = null;
    setIsBraking(true);
  };

  const handleBrakePressOut = () => {
    isBrakingRef.current = false;
    setIsBraking(false);
  };

  const handlePause = () => {
    isBrakingRef.current = false;
    setIsBraking(false);
    gameplayActiveRef.current = false;
    shakeSamplesRef.current = [];
    previousAccelerationRef.current = null;
    pausedRef.current = true;
    setPaused(true);
  };

  const handleResume = () => {
    shakeSamplesRef.current = [];
    previousAccelerationRef.current = null;
    shakeIgnoreUntilRef.current = Date.now() + 500;
    gameplayActiveRef.current = true;
    pausedRef.current = false;
    setPaused(false);
  };

  const handlePauseRestart = () => {
    handleRestart();
  };

  const handleReturnToMenu = () => {
    isBrakingRef.current = false;
    gameplayActiveRef.current = false;
    pausedRef.current = true;
    velocityX.current = 0;
    velocityY.current = 0;
    velocityAngle.current = 0;
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    router.dismissTo('/');
  };

  const firstVisibleCoin = Math.floor(
    (carX - SCREEN_WIDTH / 2 - COIN_RENDER_MARGIN - COIN_OFFSET) / COIN_SPACING
  );
  const lastVisibleCoin = Math.ceil(
    (carX + SCREEN_WIDTH / 2 + COIN_RENDER_MARGIN - COIN_OFFSET) / COIN_SPACING
  );
  const visibleCoinIds = Array.from(
    { length: Math.max(0, lastVisibleCoin - firstVisibleCoin + 1) },
    (_, index) => firstVisibleCoin + index
  );
  const firstTerrainWorldX = Math.floor(
    (carX - SCREEN_WIDTH / 2 - TERRAIN_SAMPLE_STEP * 2) / TERRAIN_SAMPLE_STEP
  ) * TERRAIN_SAMPLE_STEP;
  const terrainSamples = Array.from(
    { length: Math.ceil(SCREEN_WIDTH / TERRAIN_SAMPLE_STEP) + 5 },
    (_, index) => firstTerrainWorldX + index * TERRAIN_SAMPLE_STEP
  );
  const shakeFlightRotation = shakeFlightSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '540deg'],
  });

  if (!gameStarted) {
    return (
      <View style={[
        styles.powerUpScreen,
        {
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
          paddingLeft: Math.max(insets.left, 20),
          paddingRight: Math.max(insets.right, 20),
        },
      ]}>
        <TouchableOpacity
          style={[styles.powerUpReturnButton, {
            top: Math.max(insets.top, 12) + 5,
            left: Math.max(insets.left, 20),
          }]}
          onPress={handleReturnToMenuFromPowerUps}
          activeOpacity={0.7}
        >
          <Text style={styles.powerUpReturnText}>[ VOLVER AL MENÚ ]</Text>
        </TouchableOpacity>

        <Text style={styles.powerUpTitle}>POTENCIADORES</Text>
        <Text style={styles.powerUpBalance}>
          MONEDAS: {coinStorageLoaded ? coinCount : '...'}
        </Text>

        <View style={styles.powerUpCards}>
          {POWER_UPS.map(powerUp => {
            const isSelected = selectedPowerUps[powerUp.id];
            const canAfford = coinCount >= powerUp.price;

            return (
              <View
                key={powerUp.id}
                style={[styles.powerUpCard, isSelected && styles.powerUpCardSelected]}
              >
                <Text style={styles.powerUpIcon}>{powerUp.icon}</Text>
                <Text style={styles.powerUpName}>
                  {isSelected ? '✓ ' : ''}{powerUp.name}
                </Text>
                <Text style={styles.powerUpDescription}>{powerUp.description}</Text>
                <Text style={styles.powerUpPrice}>{powerUp.price} monedas</Text>
                <TouchableOpacity
                  style={[
                    styles.buyPowerUpButton,
                    isSelected && styles.buyPowerUpButtonSelected,
                    !canAfford && !isSelected && styles.buyPowerUpButtonDisabled,
                  ]}
                  onPress={() => handleBuyPowerUp(powerUp.id)}
                  disabled={!coinStorageLoaded || isSelected}
                  activeOpacity={0.75}
                >
                  <Text style={styles.buyPowerUpButtonText}>
                    {isSelected
                      ? 'PREPARADO'
                      : canAfford
                        ? 'COMPRAR'
                        : `FALTAN ${powerUp.price - coinCount}`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <View style={styles.powerUpFooter}>
          <Text style={styles.purchaseMessage}>{purchaseMessage}</Text>
          <TouchableOpacity
            style={[styles.startGameButton, !coinStorageLoaded && styles.buyPowerUpButtonDisabled]}
            onPress={handleStartGame}
            disabled={!coinStorageLoaded}
            activeOpacity={0.75}
          >
            <Text style={styles.startGameButtonText}>
              {coinStorageLoaded ? 'COMENZAR' : 'CARGANDO...'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.gameArea}>
        {/* Estrellas dinámicas en el fondo (Parallax lento) */}
        <View style={[StyleSheet.absoluteFill, { opacity: starOpacity }]}>
          {STARS.map((star, i) => {
            // Evitar que aparezcan de golpe calculando un área de renderizado ligeramente más grande que la pantalla
            const wrapWidth = SCREEN_WIDTH + 50;
            const starX = ((star.left - carX * 0.1) % wrapWidth + wrapWidth) % wrapWidth - 25;
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  top: star.top,
                  left: starX,
                  width: star.size,
                  height: star.size,
                  backgroundColor: '#FFF',
                  borderRadius: star.size / 2,
                }}
              />
            );
          })}
        </View>

        {/* Nubes - siempre visibles (Parallax medio) */}
        {CLOUDS.map((cloud, i) => {
          const wrapWidth = SCREEN_WIDTH + 200;
          const cloudX = ((cloud.left - carX * 0.3) % wrapWidth + wrapWidth) % wrapWidth - 150;
          return <Cloud key={`cloud-${i}`} top={cloud.top} left={cloudX} />;
        })}

        {/* Altura determinista por coordenada: solo se dibuja el tramo visible. */}
        {terrainSamples.map(worldX => {
          const terrainHeight = getTerrainHeight(worldX);
          const terrainScreenX = SCREEN_WIDTH / 2 + worldX - carX;

          return (
            <View
              key={`terrain-${worldX}`}
              style={[
                styles.terrainColumn,
                {
                  left: terrainScreenX,
                  width: TERRAIN_SAMPLE_STEP + 1,
                  height: terrainHeight,
                },
              ]}
            />
          );
        })}

        {/* Monedas en coordenadas del mundo; se desplazan con la cámara. */}
        {visibleCoinIds.map(coinId => {
          if (collectedCoinIds.has(coinId)) return null;

          const coinWorldX = magnetizedCoinPositions.get(coinId)
            ?? getCoinWorldX(coinId);
          const coinScreenX = SCREEN_WIDTH / 2 + 10 + coinWorldX - carX;
          const coinBottom = getTerrainHeight(coinWorldX) + 18;
          return (
            <View
              key={`coin-${coinId}`}
              style={[
                styles.coin,
                { left: coinScreenX - COIN_SIZE / 2, bottom: coinBottom },
              ]}
            >
              <View style={styles.coinInner}>
                <Text style={styles.coinSymbol}>★</Text>
              </View>
            </View>
          );
        })}

        {/* Car - Ahora permanece fijo en el centro horizontalmente (la cámara lo sigue) */}
        <Animated.View style={[
          styles.carContainer,
          {
            bottom: carBottom,
            transform: [
              { translateX: SCREEN_WIDTH / 2 - CAR_WIDTH / 2 + 10 },
              { translateY: shakeFlightY },
              { rotate: `${carAngle}deg` },
              { rotate: shakeFlightRotation },
            ],
          },
        ]}>
          <View style={styles.characterPlaceholder}>
            {playerPhotoUri && (
              <Image
                source={{ uri: playerPhotoUri }}
                style={styles.characterFace}
                contentFit="cover"
              />
            )}
          </View>
          <View style={styles.carBody} />
          <View style={styles.wheelsContainer}>
            <View style={styles.wheel} />
            <View style={styles.wheel} />
          </View>
        </Animated.View>
      </View>

      {/* Interfaz de usuario superior (HUD) adaptada para landscape con Safe Areas */}
      <View style={[styles.hudContainer, {
        paddingTop: Math.max(insets.top, 15),
        paddingLeft: Math.max(insets.left, 20),
        paddingRight: Math.max(insets.right, 20)
      }]}>
        <Text style={styles.title}>Wheely Me</Text>
        <View style={styles.hudRight}>
          <View style={styles.scoreContainer}>
            <Text style={styles.score}>Puntaje: {Math.floor(score)}</Text>
            <Text style={styles.highScore}>Récord: {highScore}</Text>
            <Text style={styles.coinCounter}>🪙 {coinCount}</Text>
            {(activePowerUps.magnet || activePowerUps.shield || activePowerUps.speed) && (
              <Text style={styles.activePowerUps}>
                {activePowerUps.magnet ? '🧲 ' : ''}
                {activePowerUps.shield ? '🛡️ ' : ''}
                {activePowerUps.speed ? '⚡' : ''}
              </Text>
            )}
          </View>
          {/* Botón de pausa: solo visible cuando el juego está activo y no pausado */}
          {!gameOver && !paused && !shakeFlightActive && (
            <TouchableOpacity
              style={styles.pauseButton}
              onPress={handlePause}
              activeOpacity={0.7}
            >
              <Text style={styles.pauseButtonIcon}>⏸</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <CompassHud
        top={Math.max(insets.top, 15) + 44}
        left={Math.max(insets.left, 20)}
        active={!paused}
      />

      {/* Indicadores de sensores adaptados para que no estorben */}
      <View style={[styles.sensorIndicator, {
        bottom: Math.max(insets.bottom, 15),
        left: Math.max(insets.left, 20)
      }]}>
        <Text style={styles.sensorText}>{tiltDisplay}</Text>
        <Text style={styles.sensorText}>{lightDisplay}</Text>
      </View>

      {gameOver && (
        <View style={styles.gameOverContainer}>
          <Text style={styles.gameOverText}>¡Fin del juego!</Text>
          <Text style={styles.gameOverReason}>
            {gameOverType === 'shake' ? 'Te fuiste a volar por temblar' : gameOverReason}
          </Text>
          {Math.floor(score) >= highScore && highScore > 0 && (
            <Text style={styles.newRecordText}>¡Nuevo récord! 🏆</Text>
          )}
          <Text style={styles.gameOverScore}>Puntaje: {Math.floor(score)}</Text>
          <Text style={styles.gameOverScore}>Récord: {highScore}</Text>
          <Text style={styles.gameOverCoins}>🪙 {coinCount} monedas</Text>
          <View style={[styles.gameOverButtonRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TouchableOpacity
              style={[
                styles.continueButton,
                coinCount < CONTINUE_COST && styles.continueButtonDisabled,
              ]}
              onPress={handleContinue}
              disabled={coinCount < CONTINUE_COST}
              activeOpacity={0.75}
            >
              <Text style={styles.continueButtonText}>Continuar — {CONTINUE_COST} monedas</Text>
              {coinCount < CONTINUE_COST && (
                <Text style={styles.continueRequirement}>
                  Faltan {CONTINUE_COST - coinCount}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.restartButton} onPress={handleRestart}>
              <Text style={styles.restartButtonText}>Reiniciar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.gameOverReturnMenuButton}
              onPress={handleReturnToMenu}
            >
              <Text style={styles.gameOverReturnMenuText}>VOLVER AL MENÚ</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Menú de pausa */}
      {paused && !gameOver && (
        <View style={styles.pauseOverlay}>
          <View style={styles.pauseMenu}>
            <Text style={styles.pauseTitle}>PAUSA</Text>
            <TouchableOpacity
              style={styles.pauseMenuButton}
              onPress={handleResume}
              activeOpacity={0.7}
            >
              <Text style={styles.pauseMenuButtonText}>▶  CONTINUAR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pauseMenuButton, styles.pauseRestartButton]}
              onPress={handlePauseRestart}
              activeOpacity={0.7}
            >
              <Text style={styles.pauseMenuButtonText}>🔄  REINICIAR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pauseMenuButton, styles.pauseCenterButton]}
              onPress={handleCalibrate}
              activeOpacity={0.7}
            >
              <Text style={styles.pauseMenuButtonText}>⚖️  CENTRAR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pauseMenuButton, styles.pauseMenuReturnButton]}
              onPress={handleReturnToMenu}
              activeOpacity={0.7}
            >
              <Text style={styles.pauseMenuButtonText}>⌂  VOLVER AL MENÚ</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!paused && !gameOver && !shakeFlightActive && (
        <TouchableOpacity
          style={[
            styles.brakeButton,
            isBraking && styles.brakeButtonActive,
            {
              bottom: Math.max(insets.bottom, 15),
              right: Math.max(insets.right, 20),
            },
          ]}
          onPressIn={handleBrakePressIn}
          onPressOut={handleBrakePressOut}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Freno"
          accessibilityHint="Mantén pulsado para detener y enderezar el carrito"
        >
          <Text style={styles.brakeIcon}>🛑</Text>
          <Text style={styles.brakeText}>Freno</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  powerUpScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101936',
  },
  powerUpReturnButton: {
    position: 'absolute',
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    zIndex: 10,
  },
  powerUpReturnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  powerUpTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
  },
  powerUpBalance: {
    marginTop: 3,
    marginBottom: 10,
    color: '#FFD54F',
    fontSize: 18,
    fontWeight: '800',
  },
  powerUpCards: {
    width: '100%',
    maxWidth: 760,
    flexDirection: 'row',
    gap: 12,
  },
  powerUpCard: {
    flex: 1,
    minHeight: 138,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  powerUpCardSelected: {
    borderColor: '#66BB6A',
    backgroundColor: 'rgba(76,175,80,0.18)',
  },
  powerUpIcon: {
    fontSize: 25,
    lineHeight: 29,
  },
  powerUpName: {
    marginTop: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  powerUpDescription: {
    minHeight: 30,
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  powerUpPrice: {
    marginTop: 3,
    color: '#FFD54F',
    fontSize: 12,
    fontWeight: '800',
  },
  buyPowerUpButton: {
    minWidth: 105,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderRadius: 15,
    backgroundColor: '#208AEF',
  },
  buyPowerUpButtonSelected: {
    backgroundColor: '#43A047',
  },
  buyPowerUpButtonDisabled: {
    backgroundColor: '#5F6368',
    opacity: 0.7,
  },
  buyPowerUpButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  powerUpFooter: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  purchaseMessage: {
    minHeight: 17,
    marginTop: 3,
    color: '#FFCC80',
    fontSize: 12,
    fontWeight: '600',
  },
  startGameButton: {
    minWidth: 210,
    paddingVertical: 10,
    paddingHorizontal: 34,
    alignItems: 'center',
    borderRadius: 24,
    backgroundColor: '#FF7043',
    elevation: 3,
  },
  startGameButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  hudContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    zIndex: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 5,
  },
  hudRight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  score: {
    fontSize: 20,
    color: '#fff',
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  highScore: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  coinCounter: {
    marginTop: 2,
    color: '#FFD54F',
    fontSize: 16,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  activePowerUps: {
    marginTop: 1,
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
  },
  sensorIndicator: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    zIndex: 10,
  },
  sensorText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  terrainColumn: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: '#4CAF50',
    borderTopWidth: 4,
    borderTopColor: '#2E8B57',
  },
  coin: {
    position: 'absolute',
    bottom: 78,
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFC107',
    borderWidth: 2,
    borderColor: '#FFF176',
    elevation: 2,
    shadowColor: '#FF8F00',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
  },
  coinInner: {
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F57F17',
  },
  coinSymbol: {
    color: '#F57F17',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },
  carContainer: {
    position: 'absolute',
    bottom: TERRAIN_BASE_HEIGHT + CAR_TERRAIN_CLEARANCE,
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  characterPlaceholder: {
    width: CHARACTER_SIZE,
    height: CHARACTER_SIZE,
    backgroundColor: '#FFD700', // Gold character
    borderRadius: CHARACTER_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FFF3B0',
    marginBottom: -10,
    zIndex: 1,
  },
  characterFace: {
    width: '100%',
    height: '100%',
  },
  carBody: {
    width: CAR_WIDTH,
    height: CAR_BODY_HEIGHT,
    backgroundColor: '#FF4500', // Orange red car
    borderRadius: 10,
  },
  wheelsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: WHEEL_TRACK_WIDTH,
    position: 'absolute',
    bottom: -CAR_TERRAIN_CLEARANCE,
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    backgroundColor: '#333',
    borderRadius: WHEEL_SIZE / 2,
    borderWidth: 2,
    borderColor: '#ccc',
  },
  brakeButton: {
    position: 'absolute',
    backgroundColor: '#ffff00',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  brakeButtonActive: {
    backgroundColor: '#8E0000',
    transform: [{ scale: 0.96 }],
  },
  brakeIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  brakeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  gameOverContainer: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    paddingHorizontal: 40,
  },
  gameOverText: {
    fontSize: 50,
    color: '#FF3333',
    fontWeight: 'bold',
    marginBottom: 10,
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 10,
  },
  gameOverReason: {
    fontSize: 18,
    color: '#FFF',
    marginBottom: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
    fontWeight: '500',
  },
  newRecordText: {
    fontSize: 22,
    color: '#FFD700',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  gameOverScore: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 4,
  },
  gameOverCoins: {
    marginTop: 4,
    color: '#FFD54F',
    fontSize: 18,
    fontWeight: '800',
  },
  continueButton: {
    minWidth: 250,
    paddingVertical: 11,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: '#F9A825',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#FFF176',
  },
  continueButtonDisabled: {
    backgroundColor: '#5F6368',
    borderColor: '#8A8D91',
    opacity: 0.75,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  continueRequirement: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
  restartButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 30,
  },
  restartButtonText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  gameOverReturnMenuButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  gameOverReturnMenuText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  gameOverButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 15,
    marginTop: 20,
    width: '100%',
  },
  // --- Estilos del sistema de pausa ---
  pauseButton: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  pauseButtonIcon: {
    fontSize: 20,
    color: '#fff',
  },
  pauseOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  pauseMenu: {
    backgroundColor: 'rgba(30,30,50,0.95)',
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  pauseTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 6,
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 8,
  },
  pauseMenuButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 9,
    paddingHorizontal: 32,
    borderRadius: 30,
    marginVertical: 4,
    minWidth: 230,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  pauseRestartButton: {
    backgroundColor: '#FF7043',
  },
  pauseCenterButton: {
    backgroundColor: '#208AEF',
  },
  pauseMenuReturnButton: {
    backgroundColor: '#7E57C2',
  },
  pauseMenuButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
});

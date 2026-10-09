import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

export const COIN_STORAGE_KEY = 'currentRunCoins';
const PENDING_WALLET_OPERATIONS_KEY = 'pendingWalletOperations';

export type WalletOperationKind =
  | 'game_reward'
  | 'power_up'
  | 'continue'
  | 'refund';

const WALLET_OPERATION_KINDS: readonly WalletOperationKind[] = [
  'game_reward',
  'power_up',
  'continue',
  'refund',
];

type PendingWalletOperation = {
  id: string;
  amount: number;
  kind: WalletOperationKind;
  createdAt: string;
};

let queueLock: Promise<void> = Promise.resolve();
let isFlushing = false;

function createOperationId() {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function mutateQueue(action: () => Promise<void>) {
  queueLock = queueLock.then(action, action);
  return queueLock;
}

async function loadPendingOperations(): Promise<PendingWalletOperation[]> {
  try {
    const value = await AsyncStorage.getItem(PENDING_WALLET_OPERATIONS_KEY);
    if (!value) return [];

    const parsed = JSON.parse(value) as PendingWalletOperation[];
    return Array.isArray(parsed)
      ? parsed.filter(operation =>
          typeof operation.id === 'string'
          && Number.isInteger(operation.amount)
          && operation.amount !== 0
          && WALLET_OPERATION_KINDS.includes(operation.kind)
        )
      : [];
  } catch {
    return [];
  }
}

export type CoinWallet = {
  coinCount: number;
  collectedCoinIds: number[];
};

const EMPTY_WALLET: CoinWallet = {
  coinCount: 0,
  collectedCoinIds: [],
};

export async function loadCoinWallet(): Promise<CoinWallet> {
  try {
    const storedValue = await AsyncStorage.getItem(COIN_STORAGE_KEY);
    if (storedValue === null) return { ...EMPTY_WALLET };

    const parsed = JSON.parse(storedValue) as Partial<CoinWallet>;
    const coinCount = Number.isInteger(parsed.coinCount) && parsed.coinCount! >= 0
      ? parsed.coinCount!
      : 0;
    const collectedCoinIds = Array.isArray(parsed.collectedCoinIds)
      ? parsed.collectedCoinIds.filter(Number.isInteger)
      : [];

    return { coinCount, collectedCoinIds };
  } catch {
    return { ...EMPTY_WALLET };
  }
}

export async function saveCoinWallet(
  coinCount: number,
  collectedCoinIds: Iterable<number>
) {
  const wallet: CoinWallet = {
    coinCount: Math.max(0, Math.floor(coinCount)),
    collectedCoinIds: Array.from(collectedCoinIds),
  };

  await AsyncStorage.setItem(COIN_STORAGE_KEY, JSON.stringify(wallet));
}

export async function queueWalletOperation(amount: number, kind: WalletOperationKind) {
  const normalizedAmount = Math.trunc(amount);
  if (normalizedAmount === 0) return;

  const operation: PendingWalletOperation = {
    id: createOperationId(),
    amount: normalizedAmount,
    kind,
    createdAt: new Date().toISOString(),
  };

  await mutateQueue(async () => {
    const pending = await loadPendingOperations();
    pending.push(operation);
    await AsyncStorage.setItem(PENDING_WALLET_OPERATIONS_KEY, JSON.stringify(pending));
  });

  void flushPendingWalletOperations();
}

export async function clearPendingWalletOperations() {
  await mutateQueue(() => AsyncStorage.removeItem(PENDING_WALLET_OPERATIONS_KEY));
}

export async function flushPendingWalletOperations() {
  if (!isSupabaseConfigured || isFlushing) return;

  isFlushing = true;
  try {
    await queueLock;
    const client = getSupabaseClient();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return;

    const pending = await loadPendingOperations();
    for (const operation of pending) {
      const { data: remoteBalance, error } = await client.rpc('apply_wallet_operation', {
        p_operation_id: operation.id,
        p_amount: operation.amount,
        p_kind: operation.kind,
      });

      if (error) return;

      const wallet = await loadCoinWallet();
      await saveCoinWallet(Number(remoteBalance), wallet.collectedCoinIds);
      await mutateQueue(async () => {
        const latest = await loadPendingOperations();
        const remaining = latest.filter(item => item.id !== operation.id);
        await AsyncStorage.setItem(PENDING_WALLET_OPERATIONS_KEY, JSON.stringify(remaining));
      });
    }
  } catch {
    // Sin conexión: las operaciones permanecen en la cola para el próximo intento.
  } finally {
    isFlushing = false;
  }
}

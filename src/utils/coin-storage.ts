import AsyncStorage from '@react-native-async-storage/async-storage';

export const COIN_STORAGE_KEY = 'currentRunCoins';

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

export async function addPurchasedCoins(amount: number) {
  const wallet = await loadCoinWallet();
  const nextCoinCount = wallet.coinCount + amount;
  await saveCoinWallet(nextCoinCount, wallet.collectedCoinIds);
  return nextCoinCount;
}

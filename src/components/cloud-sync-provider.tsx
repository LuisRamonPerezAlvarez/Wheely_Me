import * as Linking from 'expo-linking';
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { AppState } from 'react-native';

import { registerCurrentDeviceForPushNotifications } from '@/lib/push-notifications';
import {
    completeAuthFromUrl,
    getSupabaseClient,
    isSupabaseConfigured,
} from '@/lib/supabase';
import {
    clearPendingWalletOperations,
    flushPendingWalletOperations,
    loadCoinWallet,
    saveCoinWallet,
} from '@/utils/coin-storage';
import {
    clearPendingHighScore,
    flushPendingHighScore,
    loadHighScore,
    saveHighScoreLocally,
} from '@/utils/progress-storage';

type CloudSyncStatus = 'loading' | 'ready' | 'offline' | 'disabled';

type CloudSyncValue = {
  status: CloudSyncStatus;
  revision: number;
  syncNow: () => Promise<void>;
};

const CloudSyncContext = createContext<CloudSyncValue>({
  status: 'loading',
  revision: 0,
  syncNow: async () => {},
});

async function pullCloudState() {
  const client = getSupabaseClient();
  const [{ data: wallet, error: walletError }, { data: progress, error: progressError }] =
    await Promise.all([
      client.from('wallets').select('balance').single(),
      client.from('player_progress').select('high_score').single(),
    ]);

  if (walletError) throw walletError;
  if (progressError) throw progressError;

  const localWallet = await loadCoinWallet();
  await Promise.all([
    saveCoinWallet(Number(wallet.balance), localWallet.collectedCoinIds),
    saveHighScoreLocally(Number(progress.high_score)),
  ]);
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CloudSyncStatus>(
    isSupabaseConfigured ? 'loading' : 'disabled'
  );
  const [revision, setRevision] = useState(0);
  const syncingRef = useRef<Promise<void> | null>(null);

  const syncNow = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setStatus('disabled');
      return;
    }

    if (syncingRef.current) return syncingRef.current;

    const task = (async () => {
      try {
        const client = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;

        let session = sessionData.session;
        if (!session) {
          const signInResult = await client.auth.signInAnonymously();
          if (signInResult.error) throw signInResult.error;
          session = signInResult.data.session;
        }

        if (!session) throw new Error('No fue posible crear la sesión anónima.');

        const [localWallet, localHighScore] = await Promise.all([
          loadCoinWallet(),
          loadHighScore(),
        ]);
        const { data: migrationRows, error: migrationError } = await client.rpc(
          'migrate_local_player',
          {
            p_coin_balance: localWallet.coinCount,
            p_high_score: localHighScore,
          }
        );
        if (migrationError) throw migrationError;

        const migration = migrationRows[0];
        if (migration?.migration_applied) {
          await Promise.all([
            clearPendingWalletOperations(),
            clearPendingHighScore(),
            saveCoinWallet(Number(migration.coin_balance), localWallet.collectedCoinIds),
            saveHighScoreLocally(Number(migration.saved_high_score)),
          ]);
        } else {
          await flushPendingWalletOperations();
          await flushPendingHighScore();
          await pullCloudState();
        }

        setStatus('ready');
        setRevision(value => value + 1);
      } catch {
        setStatus('offline');
      }
    })();

    syncingRef.current = task;
    try {
      await task;
    } finally {
      syncingRef.current = null;
    }
  }, []);

  useEffect(() => {
    const syncAndRegisterPush = () => {
      void syncNow().finally(() => {
        if (!isSupabaseConfigured) return;
        void registerCurrentDeviceForPushNotifications().catch(error => {
          console.warn('No se pudo sincronizar el token push:', error);
        });
      });
    };

    const initialSync = setTimeout(syncAndRegisterPush, 0);
    const client = isSupabaseConfigured ? getSupabaseClient() : null;
    const authSubscription = client?.auth.onAuthStateChange(() => {
      setTimeout(syncAndRegisterPush, 0);
    }).data.subscription;

    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void client?.auth.refreshSession().finally(() => void syncNow());
      }
    });
    const handleUrl = ({ url }: { url: string }) => {
      void completeAuthFromUrl(url).then(completed => {
        if (completed) void syncNow();
      }).catch(() => {});
    };
    const linkSubscription = Linking.addEventListener('url', handleUrl);
    void Linking.getInitialURL().then(url => {
      if (url) handleUrl({ url });
    });

    return () => {
      clearTimeout(initialSync);
      authSubscription?.unsubscribe();
      linkSubscription.remove();
      subscription.remove();
    };
  }, [syncNow]);

  const value = useMemo(
    () => ({ status, revision, syncNow }),
    [revision, status, syncNow]
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync() {
  return useContext(CloudSyncContext);
}

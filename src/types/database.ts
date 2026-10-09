export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
  local_migration_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type WalletRow = {
  user_id: string;
  balance: number;
  created_at: string;
  updated_at: string;
};

type WalletTransactionRow = {
  id: number;
  user_id: string;
  amount: number;
  balance_after: number;
  kind: string;
  reference_id: string;
  metadata: Json;
  created_at: string;
};

type PlayerProgressRow = {
  user_id: string;
  high_score: number;
  games_played: number;
  total_distance: number;
  created_at: string;
  updated_at: string;
};

type GameRunRow = {
  id: string;
  user_id: string;
  score: number;
  coins_collected: number;
  distance: number;
  game_over_reason: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

type PurchaseRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_transaction_id: string;
  product_id: string;
  coin_amount: number;
  status: string;
  purchased_at: string | null;
  created_at: string;
  updated_at: string;
};

type PushTokenRow = {
  id: number;
  user_id: string;
  expo_push_token: string;
  platform: 'android' | 'ios';
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        {
          id: string;
          display_name?: string | null;
          avatar_path?: string | null;
          local_migration_completed_at?: string | null;
        },
        {
          display_name?: string | null;
          avatar_path?: string | null;
          local_migration_completed_at?: string | null;
        }
      >;
      wallets: Table<WalletRow, { user_id: string; balance?: number }, { balance?: number }>;
      wallet_transactions: Table<
        WalletTransactionRow,
        {
          user_id: string;
          amount: number;
          balance_after: number;
          kind: string;
          reference_id: string;
          metadata?: Json;
        },
        never
      >;
      player_progress: Table<
        PlayerProgressRow,
        {
          user_id: string;
          high_score?: number;
          games_played?: number;
          total_distance?: number;
        },
        { high_score?: number; games_played?: number; total_distance?: number }
      >;
      game_runs: Table<
        GameRunRow,
        {
          id?: string;
          user_id: string;
          score?: number;
          coins_collected?: number;
          distance?: number;
          game_over_reason?: string | null;
          started_at?: string;
          ended_at?: string | null;
        },
        { ended_at?: string | null }
      >;
      purchases: Table<
        PurchaseRow,
        {
          id?: string;
          user_id: string;
          provider: string;
          provider_transaction_id: string;
          product_id: string;
          coin_amount: number;
          status?: string;
          purchased_at?: string | null;
        },
        { status?: string; purchased_at?: string | null }
      >;
      push_tokens: Table<
        PushTokenRow,
        {
          user_id: string;
          expo_push_token: string;
          platform: 'android' | 'ios';
          enabled?: boolean;
          updated_at?: string;
        },
        { enabled?: boolean; updated_at?: string }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      register_push_token: {
        Args: { p_expo_push_token: string; p_platform: string };
        Returns: undefined;
      };
      migrate_local_player: {
        Args: { p_coin_balance: number; p_high_score: number };
        Returns: {
          coin_balance: number;
          saved_high_score: number;
          migration_applied: boolean;
        }[];
      };
      apply_wallet_operation: {
        Args: { p_operation_id: string; p_amount: number; p_kind: string };
        Returns: number;
      };
      submit_high_score: {
        Args: { p_high_score: number };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

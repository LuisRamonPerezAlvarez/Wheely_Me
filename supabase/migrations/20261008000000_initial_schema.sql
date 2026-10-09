-- Esquema inicial de Wheely Me.
-- Las tablas financieras son de solo lectura para el cliente. Los cambios de
-- saldo se realizarán más adelante desde funciones seguras/webhooks.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind text not null check (
    kind in ('game_reward', 'power_up', 'continue', 'purchase', 'refund', 'adjustment')
  ),
  reference_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, reference_id)
);

create table public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  high_score bigint not null default 0 check (high_score >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  total_distance double precision not null default 0 check (total_distance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score bigint not null default 0 check (score >= 0),
  coins_collected integer not null default 0 check (coins_collected >= 0),
  distance double precision not null default 0 check (distance >= 0),
  game_over_reason text check (
    game_over_reason is null or game_over_reason in ('rollover', 'shake', 'quit')
  ),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('apple', 'google', 'stripe')),
  provider_transaction_id text not null,
  product_id text not null,
  coin_amount integer not null check (coin_amount > 0),
  status text not null default 'pending' check (
    status in ('pending', 'completed', 'refunded', 'failed')
  ),
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index wallet_transactions_user_created_idx
  on public.wallet_transactions (user_id, created_at desc);
create index game_runs_user_created_idx
  on public.game_runs (user_id, created_at desc);
create index purchases_user_created_idx
  on public.purchases (user_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

create trigger player_progress_set_updated_at
before update on public.player_progress
for each row execute function public.set_updated_at();

create trigger purchases_set_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.wallets (user_id) values (new.id);
  insert into public.player_progress (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.player_progress enable row level security;
alter table public.game_runs enable row level security;
alter table public.purchases enable row level security;

create policy "Users can read their profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can read their wallet"
on public.wallets for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their wallet history"
on public.wallet_transactions for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their progress"
on public.player_progress for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their runs"
on public.game_runs for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their purchases"
on public.purchases for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.profiles from anon, authenticated;
revoke all on public.wallets from anon, authenticated;
revoke all on public.wallet_transactions from anon, authenticated;
revoke all on public.player_progress from anon, authenticated;
revoke all on public.game_runs from anon, authenticated;
revoke all on public.purchases from anon, authenticated;

grant select, update (display_name, avatar_path) on public.profiles to authenticated;
grant select on public.wallets to authenticated;
grant select on public.wallet_transactions to authenticated;
grant select on public.player_progress to authenticated;
grant select on public.game_runs to authenticated;
grant select on public.purchases to authenticated;

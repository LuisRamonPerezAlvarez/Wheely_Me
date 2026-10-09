-- Sincronización local-first y operaciones atómicas del monedero.

alter table public.profiles
add column local_migration_completed_at timestamptz;

alter table public.wallet_transactions
drop constraint wallet_transactions_kind_check;

alter table public.wallet_transactions
add constraint wallet_transactions_kind_check check (
  kind in (
    'game_reward',
    'power_up',
    'continue',
    'purchase',
    'refund',
    'adjustment',
    'test_purchase'
  )
);

create function public.migrate_local_player(
  p_coin_balance bigint,
  p_high_score bigint
)
returns table (
  coin_balance bigint,
  saved_high_score bigint,
  migration_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  migration_time timestamptz;
  current_balance bigint;
  next_balance bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_coin_balance < 0 or p_coin_balance > 1000000 then
    raise exception 'Invalid local coin balance' using errcode = '22023';
  end if;

  if p_high_score < 0 or p_high_score > 1000000000 then
    raise exception 'Invalid local high score' using errcode = '22023';
  end if;

  select local_migration_completed_at
  into migration_time
  from public.profiles
  where id = current_user_id
  for update;

  if not found then
    raise exception 'Player profile not found' using errcode = 'P0002';
  end if;

  select balance
  into current_balance
  from public.wallets
  where user_id = current_user_id
  for update;

  if migration_time is null then
    next_balance := greatest(current_balance, p_coin_balance);

    if next_balance > current_balance then
      insert into public.wallet_transactions (
        user_id,
        amount,
        balance_after,
        kind,
        reference_id,
        metadata
      ) values (
        current_user_id,
        next_balance - current_balance,
        next_balance,
        'adjustment',
        'legacy-local-migration',
        jsonb_build_object('source', 'async_storage')
      ) on conflict (user_id, reference_id) do nothing;

      update public.wallets
      set balance = next_balance
      where user_id = current_user_id;
    end if;

    update public.player_progress
    set high_score = greatest(high_score, p_high_score)
    where user_id = current_user_id;

    update public.profiles
    set local_migration_completed_at = now()
    where id = current_user_id;

    migration_applied := true;
  else
    next_balance := current_balance;
    migration_applied := false;
  end if;

  select high_score
  into saved_high_score
  from public.player_progress
  where user_id = current_user_id;

  coin_balance := next_balance;
  return next;
end;
$$;

create function public.apply_wallet_operation(
  p_operation_id text,
  p_amount bigint,
  p_kind text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_balance bigint;
  next_balance bigint;
  previous_balance bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(p_operation_id) < 8 or char_length(p_operation_id) > 120 then
    raise exception 'Invalid operation id' using errcode = '22023';
  end if;

  if p_kind not in ('game_reward', 'power_up', 'continue', 'refund', 'test_purchase') then
    raise exception 'Invalid wallet operation kind' using errcode = '22023';
  end if;

  if p_amount = 0 or p_amount < -10000 or p_amount > 10000 then
    raise exception 'Invalid wallet operation amount' using errcode = '22023';
  end if;

  select balance
  into current_balance
  from public.wallets
  where user_id = current_user_id
  for update;

  -- El bloqueo del monedero serializa dos reintentos simultáneos del mismo
  -- dispositivo antes de comprobar la clave idempotente.
  select balance_after
  into previous_balance
  from public.wallet_transactions
  where user_id = current_user_id and reference_id = p_operation_id;

  if found then
    return previous_balance;
  end if;

  next_balance := current_balance + p_amount;
  if next_balance < 0 then
    raise exception 'Insufficient coins' using errcode = '22003';
  end if;

  insert into public.wallet_transactions (
    user_id,
    amount,
    balance_after,
    kind,
    reference_id
  ) values (
    current_user_id,
    p_amount,
    next_balance,
    p_kind,
    p_operation_id
  );

  update public.wallets
  set balance = next_balance
  where user_id = current_user_id;

  return next_balance;
end;
$$;

create function public.submit_high_score(p_high_score bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved_score bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_high_score < 0 or p_high_score > 1000000000 then
    raise exception 'Invalid high score' using errcode = '22023';
  end if;

  update public.player_progress
  set high_score = greatest(high_score, p_high_score)
  where user_id = current_user_id
  returning high_score into saved_score;

  return saved_score;
end;
$$;

revoke all on function public.migrate_local_player(bigint, bigint) from public, anon;
revoke all on function public.apply_wallet_operation(text, bigint, text) from public, anon;
revoke all on function public.submit_high_score(bigint) from public, anon;

grant execute on function public.migrate_local_player(bigint, bigint) to authenticated;
grant execute on function public.apply_wallet_operation(text, bigint, text) to authenticated;
grant execute on function public.submit_high_score(bigint) to authenticated;

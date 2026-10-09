create table public.daily_reward_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz
);

alter table public.daily_reward_claims enable row level security;
revoke all on public.daily_reward_claims from public, anon, authenticated;

create function public.daily_reward(p_claim boolean default false)
returns table (
  claimed boolean,
  available boolean,
  next_claim_at timestamptz,
  reward_amount integer,
  coin_balance bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  last_claimed_at timestamptz;
  claim_time timestamptz;
  resulting_balance bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.daily_reward_claims (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  select daily_reward_claims.claimed_at
  into last_claimed_at
  from public.daily_reward_claims
  where daily_reward_claims.user_id = current_user_id
  for update;

  claim_time := clock_timestamp();
  claimed := false;
  reward_amount := 50;

  if p_claim and (
    last_claimed_at is null
    or claim_time >= last_claimed_at + interval '24 hours'
  ) then
    update public.wallets
    set balance = wallets.balance + reward_amount
    where wallets.user_id = current_user_id
    returning wallets.balance into resulting_balance;

    if not found then
      raise exception 'Player wallet not found' using errcode = 'P0002';
    end if;

    update public.daily_reward_claims
    set claimed_at = claim_time
    where daily_reward_claims.user_id = current_user_id;

    insert into public.wallet_transactions (
      user_id,
      amount,
      balance_after,
      kind,
      reference_id,
      metadata
    ) values (
      current_user_id,
      reward_amount,
      resulting_balance,
      'game_reward',
      'daily-reward:' || gen_random_uuid()::text,
      jsonb_build_object('source', 'daily_reward')
    );

    claimed := true;
    available := false;
    next_claim_at := claim_time + interval '24 hours';
    coin_balance := resulting_balance;
    return next;
  end if;

  select wallets.balance
  into resulting_balance
  from public.wallets
  where wallets.user_id = current_user_id;

  if last_claimed_at is null
     or claim_time >= last_claimed_at + interval '24 hours' then
    available := true;
    next_claim_at := null;
  else
    available := false;
    next_claim_at := last_claimed_at + interval '24 hours';
  end if;

  coin_balance := resulting_balance;
  return next;
end;
$$;

revoke all on function public.daily_reward(boolean) from public, anon;
grant execute on function public.daily_reward(boolean) to authenticated;

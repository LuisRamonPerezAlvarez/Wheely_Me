-- Acredita pagos de Stripe en modo de prueba de forma atómica e idempotente.
-- Solamente el service role usado por el webhook puede ejecutar esta función.

create or replace function public.apply_wallet_operation(
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

  -- Las compras ya no pueden ser acreditadas por un cliente autenticado.
  if p_kind not in ('game_reward', 'power_up', 'continue', 'refund') then
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
    user_id, amount, balance_after, kind, reference_id
  ) values (
    current_user_id, p_amount, next_balance, p_kind, p_operation_id
  );

  update public.wallets
  set balance = next_balance
  where user_id = current_user_id;

  return next_balance;
end;
$$;

create function public.credit_stripe_test_purchase(
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_product_id text,
  p_amount_total integer,
  p_purchased_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_coin_amount integer;
  expected_amount_total integer;
  current_balance bigint;
  next_balance bigint;
  inserted_purchase_id uuid;
  existing_user_id uuid;
begin
  select product.coin_amount, product.amount_total
  into expected_coin_amount, expected_amount_total
  from (values
    ('coins_100'::text, 100, 1000),
    ('coins_500'::text, 500, 2500),
    ('coins_1000'::text, 1000, 5000),
    ('coins_5000'::text, 5000, 25000),
    ('coins_10000'::text, 10000, 50000)
  ) as product(product_id, coin_amount, amount_total)
  where product.product_id = p_product_id;

  if expected_coin_amount is null or p_amount_total <> expected_amount_total then
    raise exception 'Invalid Stripe product or total' using errcode = '22023';
  end if;

  if p_checkout_session_id !~ '^cs_test_' or char_length(p_checkout_session_id) > 255 then
    raise exception 'Invalid test checkout session' using errcode = '22023';
  end if;

  select balance
  into current_balance
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Player wallet not found' using errcode = 'P0002';
  end if;

  insert into public.purchases (
    user_id,
    provider,
    provider_transaction_id,
    product_id,
    coin_amount,
    status,
    purchased_at
  ) values (
    p_user_id,
    'stripe',
    p_checkout_session_id,
    p_product_id,
    expected_coin_amount,
    'completed',
    p_purchased_at
  )
  on conflict (provider, provider_transaction_id) do nothing
  returning id into inserted_purchase_id;

  if inserted_purchase_id is null then
    select user_id into existing_user_id
    from public.purchases
    where provider = 'stripe' and provider_transaction_id = p_checkout_session_id;

    if existing_user_id is distinct from p_user_id then
      raise exception 'Checkout session already belongs to another user' using errcode = '23505';
    end if;

    return current_balance;
  end if;

  next_balance := current_balance + expected_coin_amount;

  insert into public.wallet_transactions (
    user_id,
    amount,
    balance_after,
    kind,
    reference_id,
    metadata
  ) values (
    p_user_id,
    expected_coin_amount,
    next_balance,
    'purchase',
    'stripe-test:' || p_checkout_session_id,
    jsonb_build_object(
      'checkout_session_id', p_checkout_session_id,
      'payment_intent_id', p_payment_intent_id,
      'product_id', p_product_id,
      'stripe_mode', 'test'
    )
  );

  update public.wallets
  set balance = next_balance
  where user_id = p_user_id;

  return next_balance;
end;
$$;

revoke all on function public.credit_stripe_test_purchase(
  uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated;

grant execute on function public.credit_stripe_test_purchase(
  uuid, text, text, text, integer, timestamptz
) to service_role;

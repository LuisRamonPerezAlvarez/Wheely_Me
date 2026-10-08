-- Wheely_Me: esquema de base de datos (PostgreSQL / Supabase)
-- Ejecutar completo en: Supabase > SQL Editor > New query.
-- Es re-ejecutable: usa IF NOT EXISTS / OR REPLACE donde es posible.

-- =========================================================
-- 1. TABLAS
-- =========================================================

-- Perfil del jugador (1:1 con auth.users de Supabase).
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  username          text not null unique
                      check (char_length(username) between 3 and 20),
  coins             integer not null default 0 check (coins >= 0),
  equipped_skin_id  integer,                       -- FK se agrega abajo (skins aún no existe)
  created_at        timestamptz not null default now()
);

-- Catálogo de skins del carrito.
create table if not exists public.skins (
  id           serial primary key,
  name         text not null unique,
  color        text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  price_coins  integer check (price_coins >= 0),   -- null = no se compra con monedas
  price_cents  integer check (price_cents >= 0),   -- null = no se compra con dinero real
  is_active    boolean not null default true,
  -- Debe poder comprarse de al menos una forma (o ser gratis con 0 monedas).
  check (price_coins is not null or price_cents is not null)
);

alter table public.profiles
  drop constraint if exists profiles_equipped_skin_fk;
alter table public.profiles
  add constraint profiles_equipped_skin_fk
  foreign key (equipped_skin_id) references public.skins (id) on delete set null;

-- Skins que posee cada jugador (N:M entre profiles y skins).
create table if not exists public.user_skins (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  skin_id      integer not null references public.skins (id) on delete restrict,
  acquired_at  timestamptz not null default now(),
  primary key (user_id, skin_id)
);

-- Una fila por partida terminada (puntajes + sensores usados).
create table if not exists public.scores (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  score             integer not null check (score >= 0),
  distance          integer not null default 0 check (distance >= 0),
  coins_collected   integer not null default 0 check (coins_collected >= 0),
  duration_s        integer not null default 0 check (duration_s >= 0),
  created_at        timestamptz not null default now()
);
create index if not exists scores_user_idx  on public.scores (user_id, created_at desc);
create index if not exists scores_rank_idx  on public.scores (score desc);

-- Historial de pagos con dinero real (Stripe). Lo escribe SOLO el servidor.
create table if not exists public.purchases (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  skin_id       integer references public.skins (id) on delete set null,
  coins_amount  integer check (coins_amount > 0),  -- si fue paquete de monedas
  amount_cents  integer not null check (amount_cents > 0),
  currency      text not null default 'mxn',
  provider      text not null default 'stripe',
  provider_ref  text unique,                       -- id del PaymentIntent (evita duplicados)
  status        text not null default 'pending'
                  check (status in ('pending', 'paid', 'failed', 'refunded')),
  created_at    timestamptz not null default now(),
  check (skin_id is not null or coins_amount is not null)
);
create index if not exists purchases_user_idx on public.purchases (user_id, created_at desc);

-- =========================================================
-- 2. SEGURIDAD (Row Level Security)
-- El cliente (app) NO puede escribir monedas, puntajes ni compras directamente.
-- Todo pasa por las funciones de la sección 3.
-- =========================================================

alter table public.profiles   enable row level security;
alter table public.skins      enable row level security;
alter table public.user_skins enable row level security;
alter table public.scores     enable row level security;
alter table public.purchases  enable row level security;

drop policy if exists "skins: lectura pública"      on public.skins;
create policy "skins: lectura pública" on public.skins
  for select using (is_active);

drop policy if exists "profiles: ver propio"        on public.profiles;
create policy "profiles: ver propio" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "user_skins: ver propias"     on public.user_skins;
create policy "user_skins: ver propias" on public.user_skins
  for select using (auth.uid() = user_id);

drop policy if exists "scores: ver propios"         on public.scores;
create policy "scores: ver propios" on public.scores
  for select using (auth.uid() = user_id);

drop policy if exists "purchases: ver propias"      on public.purchases;
create policy "purchases: ver propias" on public.purchases
  for select using (auth.uid() = user_id);

-- Sin políticas de insert/update/delete => el cliente no puede modificar nada directo.

-- =========================================================
-- 3. FUNCIONES (RPC) llamadas desde la app
-- =========================================================

-- Crea el perfil del jugador (la app llama esto tras iniciar sesión anónima).
create or replace function public.create_profile(p_username text)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  insert into public.profiles (id, username)
  values (auth.uid(), p_username)
  returning * into v_profile;

  -- Skin inicial gratuita (la de menor id con precio 0 monedas).
  insert into public.user_skins (user_id, skin_id)
  select auth.uid(), id from public.skins where price_coins = 0 order by id limit 1
  on conflict do nothing;

  update public.profiles
     set equipped_skin_id = (select skin_id from public.user_skins where user_id = auth.uid() limit 1)
   where id = auth.uid()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Registra una partida y suma las monedas recogidas al perfil.
create or replace function public.submit_score(
  p_score int, p_distance int, p_coins int, p_duration_s int
)
returns public.scores
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.scores;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  -- Tope básico anti-trampa: no más de 50 puntos/seg ni 20 monedas/seg.
  if p_duration_s > 0 and (p_score > p_duration_s * 50 or p_coins > p_duration_s * 20) then
    raise exception 'Partida inválida';
  end if;

  insert into public.scores (user_id, score, distance, coins_collected, duration_s)
  values (auth.uid(), p_score, p_distance, p_coins, p_duration_s)
  returning * into v_row;

  update public.profiles set coins = coins + p_coins where id = auth.uid();
  return v_row;
end;
$$;

-- Compra una skin con monedas (transacción atómica: cobra y entrega).
create or replace function public.buy_skin_with_coins(p_skin_id int)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  v_price int;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select price_coins into v_price from public.skins
   where id = p_skin_id and is_active;
  if v_price is null then
    raise exception 'Esta skin no se compra con monedas';
  end if;
  if exists (select 1 from public.user_skins where user_id = auth.uid() and skin_id = p_skin_id) then
    raise exception 'Ya tienes esta skin';
  end if;

  update public.profiles set coins = coins - v_price
   where id = auth.uid() and coins >= v_price
  returning * into v_profile;
  if not found then
    raise exception 'Monedas insuficientes';
  end if;

  insert into public.user_skins (user_id, skin_id) values (auth.uid(), p_skin_id);
  return v_profile;
end;
$$;

-- Equipa una skin que el jugador ya posee.
create or replace function public.equip_skin(p_skin_id int)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not exists (select 1 from public.user_skins where user_id = auth.uid() and skin_id = p_skin_id) then
    raise exception 'No posees esta skin';
  end if;
  update public.profiles set equipped_skin_id = p_skin_id
   where id = auth.uid() returning * into v_profile;
  return v_profile;
end;
$$;

-- Ranking global: mejor puntaje por jugador (top 50).
create or replace function public.get_leaderboard()
returns table (rank bigint, username text, best_score int)
language sql security definer set search_path = public stable
as $$
  select row_number() over (order by max(s.score) desc) as rank,
         p.username,
         max(s.score)::int as best_score
    from public.scores s
    join public.profiles p on p.id = s.user_id
   group by p.id, p.username
   order by best_score desc
   limit 50;
$$;

-- Las funciones solo las puede llamar un usuario con sesión (incluye anónima).
revoke all on function public.create_profile(text)              from public, anon;
revoke all on function public.submit_score(int,int,int,int)     from public, anon;
revoke all on function public.buy_skin_with_coins(int)          from public, anon;
revoke all on function public.equip_skin(int)                   from public, anon;
revoke all on function public.get_leaderboard()                 from public, anon;
grant execute on function public.create_profile(text)           to authenticated;
grant execute on function public.submit_score(int,int,int,int)  to authenticated;
grant execute on function public.buy_skin_with_coins(int)       to authenticated;
grant execute on function public.equip_skin(int)                to authenticated;
grant execute on function public.get_leaderboard()              to authenticated;

-- =========================================================
-- 4. DATOS INICIALES
-- =========================================================
insert into public.skins (name, color, price_coins, price_cents) values
  ('Clásico',   '#E53935', 0,   null),
  ('Océano',    '#1E88E5', 100, null),
  ('Bosque',    '#43A047', 150, null),
  ('Dorado',    '#FBC02D', null, 3900),
  ('Neón',      '#8E24AA', 300, 4900)
on conflict (name) do nothing;

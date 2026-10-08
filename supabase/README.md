# Base de datos (Supabase / PostgreSQL)

Esta carpeta y `src/lib/` son independientes del resto de la app: no modifican ninguna pantalla.

## Puesta en marcha
1. Crear un proyecto en [supabase.com](https://supabase.com).
2. Authentication → Sign In / Providers → activar **Allow anonymous sign-ins**.
3. SQL Editor → pegar y ejecutar todo [`schema.sql`](./schema.sql) (se puede re-ejecutar).
4. Copiar `.env.example` a `.env.local` y poner la URL y la clave `anon`
   (Project Settings → API). `.env.local` no se sube a git.

## Modelo
```
auth.users 1──1 profiles 1──N scores
                  │  └──N purchases ──N:1 skins
                  └─ N──M user_skins ──M─ skins
```
El cliente **no puede** escribir monedas, puntajes ni compras directamente (RLS);
todo pasa por funciones del servidor.

## Cómo usarla desde la app (`src/lib/db.ts`)
```ts
import { getProfile, createProfile, submitScore, getLeaderboard,
         getSkins, getOwnedSkinIds, buySkinWithCoins, equipSkin } from '@/lib/db';

// 1) Al entrar: perfil (null si es la primera vez)
const profile = await getProfile();
if (!profile) await createProfile('nombre_de_usuario'); // 3 a 20 caracteres, único

// 2) Al terminar una partida
await submitScore({ score, distance, coins, durationSeconds });

// 3) Ranking global (top 50, mejor puntaje por jugador)
const rows = await getLeaderboard();
```
- `submitScore` suma `coins` al perfil y rechaza partidas imposibles
  (más de 50 puntos/s o 20 monedas/s).
- Los pagos con dinero real deben registrarse en `purchases` desde un servidor
  (nunca desde la app).

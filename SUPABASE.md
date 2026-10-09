# Base de datos de Wheely Me

La primera migración crea:

- `profiles`: nombre y referencia de avatar del jugador.
- `wallets`: saldo actual de monedas.
- `wallet_transactions`: historial inmutable de entradas y gastos.
- `player_progress`: récord y estadísticas acumuladas.
- `game_runs`: historial de partidas.
- `purchases`: compras verificadas de Apple, Google o Stripe web.

Todas las tablas tienen Row Level Security. El cliente solo puede leer sus
propios registros y editar su nombre/avatar; los tokens push solo se pueden
administrar para el usuario autenticado. El saldo, compras, progreso e historial
se escriben desde funciones seguras o webhooks, no desde la aplicación.

## Crear el proyecto remoto

1. Crea o abre un proyecto en Supabase.
2. En **Authentication > Providers**, habilita Anonymous Sign-Ins para el
   futuro acceso automático de jugadores.
3. Abre **SQL Editor**, copia el contenido de
   `supabase/migrations/20261008000000_initial_schema.sql` y ejecútalo.
4. Ejecuta después, una sola vez, el contenido de
   `supabase/migrations/20261008010000_player_sync.sql`.
5. Ejecuta las migraciones restantes en orden, incluida
   `supabase/migrations/20261008030000_push_notifications.sql` y
   `supabase/migrations/20261009000000_server_daily_rewards.sql`.
5. Copia `.env.example` como `.env.local`.
6. En **Project Settings > API**, copia la URL y la Publishable key en
   `.env.local`. Nunca coloques una Secret key dentro de la app.
7. Reinicia Expo después de cambiar las variables de entorno.

El cliente está en `src/lib/supabase.ts`. Se inicializa de forma diferida para
que el juego continúe arrancando mientras todavía no existan credenciales.

## Vinculación y recuperación de cuenta

En **Authentication > Configuration**, activa **Enable Manual Linking** y
mantén Anonymous Sign-Ins habilitado para crear nuevas cuentas de juego.
En **Authentication > URL Configuration**, usa `wheelyme://account` como Site
URL y agrega `wheelyme://**` a las URLs de redirección permitidas para que los
enlaces abran la aplicación instalada.

### Google OAuth

1. En Google Cloud Console, crea un cliente OAuth de tipo **Web application**.
2. Añade como URI de redirección autorizada `https://<project-ref>.supabase.co/auth/v1/callback`.
3. En **Supabase > Authentication > Providers > Google**, habilita Google y
   guarda el Client ID y Client Secret de Google. Esas credenciales se guardan
   solo en Supabase; no las agregues a la app.
4. Mantén `wheelyme://account` en las URLs de redirección permitidas de Supabase.

En **Cuenta**, “Guardar progreso con Google” usa `linkIdentity` sobre la sesión
anónima actual. Esto requiere **Enable Manual Linking** y conserva el mismo
`user_id`, monedas y récord. “Recuperar otra cuenta” permite “Continuar con
Google” en otro dispositivo; el inicio de sesión restaura la sesión existente,
después de lo cual la app sincroniza el progreso desde la nube.

Google identity solo puede vincularse a una cuenta de Wheely Me. Si ya está
vinculada a otra cuenta, usa recuperación con Google en vez de vincularla a la
cuenta anónima actual. Google es el único método de vinculación y recuperación
que muestra la pantalla Cuenta; no se solicita un código por correo.

### Prueba de vinculación y recuperación Google

1. En el dispositivo que tiene el progreso anónimo, inicia Wheely Me y confirma
   que la nube esté sincronizada. En **Cuenta**, usa **Guardar mi progreso** y
   luego **Vincular progreso con Google**.
2. Confirma en Supabase Auth que la identidad `google` quedó en el mismo usuario
   que tenía el progreso antes de vincular.
3. En otro dispositivo o instalación limpia, elige **Recuperar otra cuenta** >
   **Continuar con Google** y selecciona la misma cuenta.
4. Comprueba que el saldo y récord coinciden. No desinstales ni borres los datos
   de la instalación original hasta confirmar la vinculación.

## Monedero y recompensa diaria

La recompensa diaria debe reclamarse con conexión y con una sesión autenticada.
`daily_reward` valida el cooldown de 24 horas usando el reloj del servidor,
bloquea reclamos concurrentes y acredita las 50 monedas en la misma transacción.
No se crea una operación local pendiente para esta recompensa. Aplica la
migración `20261009000000_server_daily_rewards.sql` en el proyecto Supabase
antes de instalar la versión que usa el nuevo RPC.

## Compras móviles

El checkout Stripe del proyecto es exclusivamente de prueba. El perfil EAS
`preview` activa explícitamente esa ruta y la pantalla advierte que no se use
una tarjeta real. El perfil `production` no habilita el checkout. Antes de
vender monedas digitales dentro de la app publicada en Google Play, integra
Google Play Billing y valida las compras del lado del servidor conforme a las
políticas vigentes de Google Play. Consulta la
[guía oficial de Play Billing](https://developer.android.com/google/play/billing)
y la [política de pagos de Google Play](https://support.google.com/googleplay/android-developer/answer/9858738).
No basta con cambiar las claves de Stripe.

## Siguiente etapa

La app ya inicia sesión de forma anónima, migra el saldo local una sola vez y
encola sin conexión las recompensas, potenciadores, continuaciones y récords.
La siguiente etapa de monetización móvil será integrar Google Play Billing (y
StoreKit si se publica en iOS), validar las compras en el servidor y registrar
cada transacción de forma idempotente. Stripe debe limitarse a ventas web o a
los casos permitidos por las políticas aplicables.

## Notificaciones push

El botón **Activar recordatorios** solicita permiso, programa la recompensa
local y registra el Expo Push Token del dispositivo en `push_tokens`. El token
queda asociado a la sesión de Supabase del usuario y protegido por RLS. El flujo
push remoto solo se habilita en un APK/build nativo; Expo Go se limita al aviso
local.

Para Android, registra en Firebase el paquete `com.araly.wheelyme`, configura
FCM V1 en las credenciales Android del proyecto EAS y guarda el archivo
`google-services.json` en la raíz. Después configura
`android.googleServicesFile` en `app.json` y genera un APK nuevo. No guardes la
clave de cuenta de servicio FCM en el repositorio ni en la aplicación.

Despliega `stripe-webhook`, `send-push` y `check-push-receipts` después de
aplicar la migración y vincular el CLI al proyecto:

```sh
npx supabase functions deploy stripe-webhook
npx supabase functions deploy send-push
npx supabase functions deploy check-push-receipts
```

`stripe-webhook` acredita la compra y llama a `send-push` con la clave service
role; esa función rechaza llamadas de clientes y deduplica por sesión de Stripe.
`check-push-receipts` debe ejecutarse periódicamente (cada 15 minutos) mediante
Supabase Cron o un scheduler autenticado con la service role. Revisa recibos de
Expo y desactiva tokens que devuelvan `DeviceNotRegistered`.

Con FCM configurado en EAS, genera el APK actualizado con
`npx eas-cli@latest build --platform android --profile preview`.

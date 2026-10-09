// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const REWARDS_CHANNEL_ID = 'daily-rewards';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server is not configured' }, 500);
  if (request.headers.get('Authorization') !== `Bearer ${serviceRoleKey}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid push event' }, 400);

  const userId = typeof body.userId === 'string' ? body.userId : '';
  const eventKey = typeof body.eventKey === 'string' ? body.eventKey : '';
  const coins = Number(body.coins);
  if (
    !userId ||
    !/^stripe:cs_test_[A-Za-z0-9]+$/.test(eventKey) ||
    body.notificationType !== 'purchase_completed' ||
    !Number.isInteger(coins) ||
    coins < 1 ||
    coins > 10000
  ) {
    return json({ error: 'Invalid push event' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: tokens, error: tokenError } = await supabase
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (tokenError) {
    console.error(tokenError);
    return json({ error: 'Could not load push tokens' }, 500);
  }
  if (tokens.length === 0) return json({ sent: 0 });

  const { error: queueError } = await supabase.from('push_deliveries').upsert(
    tokens.map(({ expo_push_token }) => ({
      event_key: eventKey,
      user_id: userId,
      notification_type: 'purchase_completed',
      expo_push_token,
      status: 'queued',
    })),
    { onConflict: 'event_key,expo_push_token', ignoreDuplicates: true }
  );
  if (queueError) {
    console.error(queueError);
    return json({ error: 'Could not queue push notifications' }, 500);
  }

  const { data: pending, error: pendingError } = await supabase
    .from('push_deliveries')
    .select('expo_push_token')
    .eq('event_key', eventKey)
    .in('status', ['queued', 'failed']);
  if (pendingError) {
    console.error(pendingError);
    return json({ error: 'Could not load queued push notifications' }, 500);
  }

  const activeTokens = new Set(tokens.map(token => token.expo_push_token));
  const pendingTokens = pending
    .map(delivery => delivery.expo_push_token)
    .filter(token => activeTokens.has(token));
  if (pendingTokens.length === 0) return json({ sent: 0, duplicate: true });

  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < pendingTokens.length; offset += 100) {
    const batch = pendingTokens.slice(offset, offset + 100);
    const messages = batch.map(token => ({
      to: token,
      title: 'Compra completada',
      body: `Tus ${coins} monedas ya están disponibles.`,
      sound: 'default',
      channelId: REWARDS_CHANNEL_ID,
      data: { url: '/store', type: 'purchase_completed', coins },
    }));

    let expoResponse;
    try {
      expoResponse = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
    } catch (error) {
      console.error('Expo Push Service request failed:', error);
      return json({ error: 'Expo Push Service is temporarily unavailable' }, 502);
    }

    const result = await expoResponse.json();
    if (!expoResponse.ok || !Array.isArray(result.data) || result.data.length !== batch.length) {
      console.error('Expo Push Service rejected the batch:', result);
      return json({ error: 'Expo Push Service rejected the batch' }, 502);
    }

    for (let index = 0; index < batch.length; index += 1) {
      const ticket = result.data[index];
      const expoPushToken = batch[index];
      const ticketId = ticket.status === 'ok' ? ticket.id : null;
      const errorCode = ticketId ? null : ticket.details?.error ?? 'UnknownError';
      const status = ticketId ? 'ticketed' : 'failed';
      const { error: updateError } = await supabase
        .from('push_deliveries')
        .update({ status, expo_ticket_id: ticketId, error_code: errorCode })
        .eq('event_key', eventKey)
        .eq('expo_push_token', expoPushToken);

      if (updateError) {
        console.error(updateError);
        return json({ error: 'Could not store Expo push ticket' }, 500);
      }

      if (ticketId) {
        sent += 1;
      } else {
        failed += 1;
        if (errorCode === 'DeviceNotRegistered') {
          await supabase
            .from('push_tokens')
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq('expo_push_token', expoPushToken);
        }
      }
    }
  }

  return json({ sent, failed });
});
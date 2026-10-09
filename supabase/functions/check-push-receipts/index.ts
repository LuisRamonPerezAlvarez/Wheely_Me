// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_EXPIRATION_MS = 24 * 60 * 60 * 1000;

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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const cutoff = new Date(Date.now() - RECEIPT_DELAY_MS).toISOString();
  const { data: deliveries, error: queryError } = await supabase
    .from('push_deliveries')
    .select('id, expo_push_token, expo_ticket_id, created_at')
    .eq('status', 'ticketed')
    .is('receipt_checked_at', null)
    .not('expo_ticket_id', 'is', null)
    .lt('created_at', cutoff)
    .limit(1000);

  if (queryError) {
    console.error(queryError);
    return json({ error: 'Could not load push receipts' }, 500);
  }
  if (deliveries.length === 0) return json({ checked: 0 });

  const expiredAt = Date.now() - RECEIPT_EXPIRATION_MS;
  const receiptCandidates = deliveries.filter(
    delivery => new Date(delivery.created_at).getTime() > expiredAt
  );
  const expiredDeliveries = deliveries.filter(
    delivery => new Date(delivery.created_at).getTime() <= expiredAt
  );

  for (const delivery of expiredDeliveries) {
    await supabase
      .from('push_deliveries')
      .update({ status: 'failed', error_code: 'ReceiptUnavailable', receipt_checked_at: new Date().toISOString() })
      .eq('id', delivery.id);
  }

  let checked = 0;
  for (let offset = 0; offset < receiptCandidates.length; offset += 1000) {
    const batch = receiptCandidates.slice(offset, offset + 1000);
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: batch.map(delivery => delivery.expo_ticket_id) }),
    });
    if (!response.ok) return json({ error: 'Expo receipt lookup failed' }, 502);

    const result = await response.json();
    for (const delivery of batch) {
      const receipt = result?.data?.[delivery.expo_ticket_id];
      if (!receipt) continue;

      const errorCode = receipt.status === 'error' ? receipt.details?.error ?? 'UnknownError' : null;
      const { error: updateError } = await supabase
        .from('push_deliveries')
        .update({
          status: receipt.status === 'ok' ? 'delivered' : 'failed',
          error_code: errorCode,
          receipt_checked_at: new Date().toISOString(),
        })
        .eq('id', delivery.id);
      if (updateError) {
        console.error(updateError);
        return json({ error: 'Could not save push receipt' }, 500);
      }

      if (errorCode === 'DeviceNotRegistered') {
        await supabase
          .from('push_tokens')
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq('expo_push_token', delivery.expo_push_token);
      }
      checked += 1;
    }
  }

  return json({ checked, expired: expiredDeliveries.length });
});
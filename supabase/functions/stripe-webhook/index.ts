// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';

const products = {
  coins_100: { coins: 100, amount: 1000 },
  coins_500: { coins: 500, amount: 2500 },
  coins_1000: { coins: 1000, amount: 5000 },
  coins_5000: { coins: 5000, amount: 25000 },
  coins_10000: { coins: 10000, amount: 50000 },
};

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const signature = request.headers.get('Stripe-Signature');

  if (!stripeSecretKey?.startsWith('sk_test_') || !webhookSecret || !signature) {
    return new Response('Stripe test webhook is not configured', { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
  } catch (error) {
    console.error(error);
    return new Response('Invalid webhook signature', { status: 400 });
  }

  if (event.livemode) return new Response('Live events are disabled', { status: 400 });

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object;
    const productId = session.metadata?.product_id ?? '';
    const product = products[productId as keyof typeof products];
    const userId = session.client_reference_id;

    if (
      session.mode !== 'payment' ||
      session.payment_status !== 'paid' ||
      !product ||
      !userId ||
      session.amount_total !== product.amount ||
      session.currency !== 'mxn'
    ) {
      return new Response('Invalid checkout session', { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response('Supabase service credentials are missing', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { error } = await supabase.rpc('credit_stripe_test_purchase', {
      p_user_id: userId,
      p_checkout_session_id: session.id,
      p_payment_intent_id:
        typeof session.payment_intent === 'string' ? session.payment_intent : '',
      p_product_id: productId,
      p_amount_total: session.amount_total,
      p_purchased_at: new Date(event.created * 1000).toISOString(),
    });

    if (error) {
      console.error(error);
      return new Response('Could not credit purchase', { status: 500 });
    }

    const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        eventKey: `stripe:${session.id}`,
        notificationType: 'purchase_completed',
        coins: product.coins,
      }),
    });

    if (!pushResponse.ok) {
      console.error('Push dispatch failed:', await pushResponse.text());
      return new Response('Purchase credited; push dispatch will be retried', { status: 500 });
    }
  }

  return new Response('ok', { status: 200 });
});

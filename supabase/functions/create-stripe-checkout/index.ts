// @ts-nocheck
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const products = {
  coins_100: { coins: 100, amount: 1000 },
  coins_500: { coins: 500, amount: 2500 },
  coins_1000: { coins: 1000, amount: 5000 },
  coins_5000: { coins: 5000, amount: 25000 },
  coins_10000: { coins: 10000, amount: 50000 },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const authorization = request.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !authorization) {
      return json({ error: 'Missing Supabase configuration' }, 500);
    }
    if (!stripeSecretKey?.startsWith('sk_test_')) {
      return json({ error: 'Stripe test mode is not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return json({ error: 'Authentication required' }, 401);

    const body = await request.json();
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    const product = products[productId as keyof typeof products];
    if (!product) return json({ error: 'Unknown product' }, 400);

    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    });
    const returnUrl = `${supabaseUrl}/functions/v1/stripe-return`;
    const metadata = {
      user_id: data.user.id,
      product_id: productId,
      coin_amount: String(product.coins),
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: data.user.id,
      metadata,
      payment_intent_data: { metadata },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'mxn',
            unit_amount: product.amount,
            product_data: { name: `${product.coins} monedas de Wheely Me` },
          },
        },
      ],
      success_url: `${returnUrl}?status=success`,
      cancel_url: `${returnUrl}?status=cancelled`,
    });

    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error(error);
    return json({ error: 'Could not create checkout session' }, 500);
  }
});

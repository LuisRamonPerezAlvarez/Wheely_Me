import * as WebBrowser from 'expo-web-browser';

import { getSupabaseClient } from '@/lib/supabase';

export const STRIPE_TEST_PRODUCTS = [
  { id: 'coins_100', amount: 100, price: '$10 MXN' },
  { id: 'coins_500', amount: 500, price: '$25 MXN' },
  { id: 'coins_1000', amount: 1_000, price: '$50 MXN' },
  { id: 'coins_5000', amount: 5_000, price: '$250 MXN' },
  { id: 'coins_10000', amount: 10_000, price: '$500 MXN' },
] as const;

export type StripeTestProduct = (typeof STRIPE_TEST_PRODUCTS)[number];

export async function openStripeTestCheckout(productId: StripeTestProduct['id']) {
  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke('create-stripe-checkout', {
    body: { productId },
  });

  if (error) throw error;
  if (typeof data?.url !== 'string') {
    throw new Error('Stripe no devolvió una URL de pago.');
  }

  return WebBrowser.openBrowserAsync(data.url, {
    toolbarColor: '#101936',
    controlsColor: '#FFFFFF',
  });
}

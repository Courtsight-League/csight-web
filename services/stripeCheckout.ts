import { loadStripe } from '@stripe/stripe-js';
import { MerchCheckoutPayload } from '../types';
import { apiBaseUrl } from './apiBase';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const normalizedBase = apiBaseUrl;

const stripePromise = publishableKey ? loadStripe(publishableKey) : null;
const createSessionUrl = normalizedBase
  ? `${normalizedBase}/api/merch/create-checkout-session`
  : '/api/merch/create-checkout-session';

export const createStripeCheckoutSession = async (payload: MerchCheckoutPayload) => {
  const response = await fetch(createSessionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Unable to create checkout session (${response.status}): ${errorBody || response.statusText}`
    );
  }
  const data = await response.json();
  if (!data.sessionId) {
    throw new Error('Stripe checkout session missing sessionId');
  }
  return data;
};

export const redirectToStripeCheckout = async (sessionId: string) => {
  if (!stripePromise) {
    throw new Error('Stripe publishable key is not configured.');
  }
  const stripe = await stripePromise;
  if (!stripe) {
    throw new Error('Unable to initialize Stripe.');
  }
  const { error } = await stripe.redirectToCheckout({ sessionId });
  if (error) {
    throw error;
  }
};

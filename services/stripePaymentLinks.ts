import { supabase } from './supabaseClient';

export type StripePaymentLinks = {
  teamFull: string;
  individualFull: string;
  teamDeposit: string;
  individualDeposit: string;
};

export const STRIPE_PAYMENT_LINK_SETTING_KEYS = {
  teamFull: 'stripe_payment_link_team_full',
  individualFull: 'stripe_payment_link_individual_full',
  teamDeposit: 'stripe_payment_link_team_deposit',
  individualDeposit: 'stripe_payment_link_individual_deposit',
  deposit: 'stripe_payment_link_deposit',
} as const;

export const STRIPE_PAYMENT_LINK_KEYS_FOR_LOAD = Array.from(
  new Set([
    STRIPE_PAYMENT_LINK_SETTING_KEYS.teamFull,
    STRIPE_PAYMENT_LINK_SETTING_KEYS.individualFull,
    STRIPE_PAYMENT_LINK_SETTING_KEYS.teamDeposit,
    STRIPE_PAYMENT_LINK_SETTING_KEYS.individualDeposit,
    STRIPE_PAYMENT_LINK_SETTING_KEYS.deposit,
  ])
);

const HARDCODED_STRIPE_PAYMENT_LINKS = {
  teamFull: 'https://buy.stripe.com/3cs3fP3gb6dg3JK8wM',
  individualFull: 'https://buy.stripe.com/00gcQp4kf9ps4NO28c',
  deposit: 'https://buy.stripe.com/dR68A9183eJM0xy9AN',
} as const;

const normalizeSettingValue = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');

export const getDefaultStripePaymentLinks = (): StripePaymentLinks => {
  const teamFull =
    normalizeSettingValue(import.meta.env.VITE_STRIPE_PAYMENT_LINK_TEAM_FULL as string | undefined) ||
    HARDCODED_STRIPE_PAYMENT_LINKS.teamFull;
  const individualFull =
    normalizeSettingValue(import.meta.env.VITE_STRIPE_PAYMENT_LINK_INDIVIDUAL_FULL as string | undefined) ||
    HARDCODED_STRIPE_PAYMENT_LINKS.individualFull;

  const sharedDeposit =
    normalizeSettingValue(import.meta.env.VITE_STRIPE_PAYMENT_LINK_DEPOSIT as string | undefined) ||
    HARDCODED_STRIPE_PAYMENT_LINKS.deposit;
  const teamDeposit =
    normalizeSettingValue(import.meta.env.VITE_STRIPE_PAYMENT_LINK_TEAM_DEPOSIT as string | undefined) ||
    sharedDeposit;
  const individualDeposit =
    normalizeSettingValue(import.meta.env.VITE_STRIPE_PAYMENT_LINK_INDIVIDUAL_DEPOSIT as string | undefined) ||
    sharedDeposit;

  return {
    teamFull,
    individualFull,
    teamDeposit,
    individualDeposit,
  };
};

export const resolveStripePaymentLinks = (
  settings: ReadonlyMap<string, string> | null | undefined
): StripePaymentLinks => {
  const defaults = getDefaultStripePaymentLinks();
  if (!settings) return defaults;

  const teamFull = normalizeSettingValue(settings.get(STRIPE_PAYMENT_LINK_SETTING_KEYS.teamFull)) || defaults.teamFull;
  const individualFull =
    normalizeSettingValue(settings.get(STRIPE_PAYMENT_LINK_SETTING_KEYS.individualFull)) ||
    defaults.individualFull;

  const sharedDeposit =
    normalizeSettingValue(settings.get(STRIPE_PAYMENT_LINK_SETTING_KEYS.deposit)) ||
    defaults.teamDeposit ||
    defaults.individualDeposit;
  const teamDeposit =
    normalizeSettingValue(settings.get(STRIPE_PAYMENT_LINK_SETTING_KEYS.teamDeposit)) || sharedDeposit;
  const individualDeposit =
    normalizeSettingValue(settings.get(STRIPE_PAYMENT_LINK_SETTING_KEYS.individualDeposit)) || sharedDeposit;

  return {
    teamFull,
    individualFull,
    teamDeposit,
    individualDeposit,
  };
};

export const loadStripePaymentLinks = async (): Promise<StripePaymentLinks> => {
  const defaults = getDefaultStripePaymentLinks();
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('key,value')
      .in('key', STRIPE_PAYMENT_LINK_KEYS_FOR_LOAD);
    if (error) throw error;

    const settings = new Map<string, string>();
    (data || []).forEach((row: any) => {
      if (row?.key && typeof row?.value === 'string') {
        settings.set(row.key, row.value);
      }
    });

    return resolveStripePaymentLinks(settings);
  } catch (err) {
    console.warn('Stripe payment links lookup failed, using defaults', err);
    return defaults;
  }
};

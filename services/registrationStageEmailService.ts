import { supabase } from './supabaseClient';

type RegistrationStageEmailPayload = {
  stage: 'league_registration' | 'payment' | 'stats_portal_registration' | 'claim_profile_invite';
  subject: string;
  body: string;
  bodyHtml?: string;
  recipientEmail?: string;
  includeAdminRecipients?: boolean;
  metadata?: Record<string, any> | null;
};

const functionName =
  (import.meta.env.VITE_REGISTRATION_EMAIL_FUNCTION_NAME as string | undefined)?.trim() ||
  'registration-stage-email';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitMessage = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('429') ||
    normalized.includes('rate_limit_exceeded') ||
    normalized.includes('too many requests') ||
    normalized.includes('rate limit')
  );
};

export const sendRegistrationStageEmail = async (
  payload: RegistrationStageEmailPayload
): Promise<void> => {
  const maxAttempts = 4;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: payload,
    });

    if (error) {
      // Supabase Functions errors often hide the response body behind `error.context`.
      let contextDetails = '';
      try {
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.text === 'function') {
          contextDetails = await ctx.text();
        }
      } catch {
        // ignore
      }
      const message = error.message || 'Registration stage email request failed.';
      const combinedMessage = contextDetails ? `${message}: ${contextDetails}` : message;
      lastError = new Error(combinedMessage);
      if (attempt < maxAttempts && isRateLimitMessage(combinedMessage)) {
        await sleep(700 * attempt);
        continue;
      }
      throw lastError;
    }

    if (data && typeof data === 'object' && (data as any).ok === false) {
      const message = (data as any).error || 'Registration stage email request failed.';
      lastError = new Error(message);
      if (attempt < maxAttempts && isRateLimitMessage(message)) {
        await sleep(700 * attempt);
        continue;
      }
      throw lastError;
    }

    return;
  }

  throw lastError || new Error('Registration stage email request failed.');
};

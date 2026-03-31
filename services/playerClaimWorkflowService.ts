import { supabase } from './supabaseClient';

const functionName =
  (import.meta.env.VITE_PLAYER_CLAIM_FUNCTION_NAME as string | undefined)?.trim() ||
  'player-claim-workflow';

const parseJsonLike = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeFunctionError = (message: string, contextDetails: string) => {
  if (/Failed to send a request to the Edge Function/i.test(message)) {
    return `Claim workflow service is unreachable (${functionName}). This usually means the Edge Function is not deployed on this Supabase project or CORS/preflight is failing.`;
  }

  const parsed = contextDetails ? parseJsonLike(contextDetails) : null;
  const code = String((parsed as any)?.code || '').toUpperCase();
  const detailMessage = String((parsed as any)?.message || contextDetails || '').trim();

  if (code === 'NOT_FOUND' || /Requested function was not found/i.test(detailMessage)) {
    return `Claim workflow service is not deployed (${functionName}). Deploy this Supabase Edge Function first.`;
  }
  if (detailMessage) {
    return `${message}: ${detailMessage}`;
  }
  return message;
};

const invokeClaimWorkflow = async <TResponse = any>(payload: Record<string, any>): Promise<TResponse> => {
  const { data, error } = await supabase.functions.invoke(functionName, { body: payload });
  if (error) {
    let contextDetails = '';
    try {
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx.text === 'function') {
        contextDetails = await ctx.text();
      }
    } catch {
      // ignore
    }
    const message = error.message || 'Claim workflow request failed.';
    throw new Error(normalizeFunctionError(message, contextDetails));
  }
  if (data && typeof data === 'object' && (data as any).ok === false) {
    throw new Error((data as any).error || 'Claim workflow request failed.');
  }
  return (data || {}) as TResponse;
};

export type SendClaimInviteOpts = {
  playerId?: string | null;
  email: string;
  playerName?: string | null;
  teamName?: string | null;
  seasonName?: string | null;
  createdBy?: string | null;
};

export const sendClaimInviteEmail = (opts: SendClaimInviteOpts) =>
  invokeClaimWorkflow<{
    ok: boolean;
    sent: boolean;
    tokenId?: string;
    expiresAt?: string;
    claimUrl?: string;
  }>({
    action: 'send_claim_email',
    ...opts,
  });

export const previewClaimToken = (token: string) =>
  invokeClaimWorkflow<{
    ok: boolean;
    status: 'ready' | 'expired' | 'already_claimed' | 'invalid';
    emailMasked?: string;
    message?: string;
    expiresAt?: string;
    profiles?: Array<{
      id: string;
      fullName: string;
      teamName: string;
      seasonLabel: string;
      division?: string;
      claimed?: boolean;
      preferred?: boolean;
    }>;
  }>({
    action: 'preview_claim',
    token,
  });

export const confirmClaimToken = (args: { token: string; playerId?: string | null; password: string }) =>
  invokeClaimWorkflow<{
    ok: boolean;
    status: 'claimed';
    email: string;
    playerId: string;
    userId: string;
    claimStatus?: string;
    paymentStatus?: string;
  }>({
    action: 'confirm_claim',
    ...args,
  });

export const resendClaimInvite = (args: { token?: string | null; email?: string | null }) =>
  invokeClaimWorkflow<{
    ok: boolean;
    sent: boolean;
    message?: string;
    expiresAt?: string;
  }>({
    action: 'resend_claim_email',
    ...args,
  });

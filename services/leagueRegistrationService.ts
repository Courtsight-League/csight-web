import { supabase } from './supabaseClient';
import { supabaseAdmin } from './supabaseAdminClient';

const TABLE_NAME = 'league_registrations';

let tableUnavailable = false;

export type LeagueRegistrationLeadInput = {
  registrationType: 'team' | 'free-agent';
  seasonId: string;
  divisionId: string;
  seasonLabel: string;
  divisionLabel: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  teamName: string;
  receiveUpdates?: boolean;
};

export type LeaguePaymentChoice = 'full' | 'deposit' | 'later';

const runWithFallback = async <T>(
  run: (client: typeof supabase) => Promise<{ data: T | null; error: any }>
) => {
  let result = await run(supabase);
  if (result.error && supabaseAdmin) {
    result = await run(supabaseAdmin as any);
  }
  return result;
};

const isMissingTable = (error: any) => {
  const code = (error?.code || '').toString();
  const message = (error?.message || '').toString().toLowerCase();
  // Missing table can surface as a Postgres error (42P01) or as a PostgREST schema-cache error.
  return (
    code === '42P01' ||
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes("could not find the table 'public.") ||
    message.includes('could not find the table')
  );
};

export const createLeagueRegistrationLead = async (
  input: LeagueRegistrationLeadInput
): Promise<{ id: string | null; saved: boolean; error?: string }> => {
  if (tableUnavailable) {
    return { id: null, saved: false, error: 'league_registrations table unavailable' };
  }

  const payload: Record<string, any> = {
    registration_type: input.registrationType,
    season_id: input.seasonId,
    division_id: input.divisionId,
    season_label: input.seasonLabel,
    division_label: input.divisionLabel,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    team_name: input.teamName || null,
    payment_choice: null,
    status: 'submitted',
    source: 'website',
    submitted_at: new Date().toISOString(),
    metadata: {
      stage: 'league_registration',
      receiveUpdates: !!input.receiveUpdates,
    },
  };

  const result = await runWithFallback<{ id: string }>((client) =>
    client.from(TABLE_NAME).insert(payload).select('id').maybeSingle()
  );

  if (result.error) {
    if (isMissingTable(result.error)) {
      tableUnavailable = true;
    }
    return { id: null, saved: false, error: result.error.message || 'Unable to save lead' };
  }

  return { id: result.data?.id ?? null, saved: true };
};

export const updateLeagueRegistrationLead = async (
  leadId: string,
  input: LeagueRegistrationLeadInput
): Promise<{ saved: boolean; error?: string }> => {
  if (!leadId || tableUnavailable) return { saved: false, error: 'Missing lead id.' };

  const payload: Record<string, any> = {
    registration_type: input.registrationType,
    season_id: input.seasonId,
    division_id: input.divisionId,
    season_label: input.seasonLabel,
    division_label: input.divisionLabel,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    team_name: input.teamName || null,
    payment_choice: null,
    status: 'submitted',
    linked_user_id: null,
    linked_team_id: null,
    linked_player_id: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
    metadata: {
      stage: 'league_registration',
      receiveUpdates: !!input.receiveUpdates,
      edited: true,
    },
  };

  const runUpdate = async (client: typeof supabase) =>
    client.from(TABLE_NAME).update(payload).eq('id', leadId).select('id').maybeSingle();

  let result = await runUpdate(supabase);
  if ((!result.error && !result.data) && supabaseAdmin) {
    result = await runUpdate(supabaseAdmin as any);
  } else if (result.error && supabaseAdmin) {
    result = await runUpdate(supabaseAdmin as any);
  }

  if (result.error) {
    if (isMissingTable(result.error)) {
      tableUnavailable = true;
    }
    return { saved: false, error: result.error.message || 'Unable to update lead' };
  }
  if (!result.data?.id) {
    return { saved: false, error: 'No matching lead row was updated (check RLS/admin key).' };
  }
  return { saved: true };
};

export const updateLeagueRegistrationLeadPayment = async (
  leadId: string,
  paymentChoice: LeaguePaymentChoice
): Promise<{ saved: boolean; error?: string }> => {
  if (!leadId || tableUnavailable) return { saved: false };

  const runUpdate = async (client: typeof supabase) =>
    client
      .from(TABLE_NAME)
      .update({
        payment_choice: paymentChoice,
        status: 'payment_selected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .select('id')
      .maybeSingle();

  let result = await runUpdate(supabase);
  // RLS can return "no rows" with no error. Treat that as a failed write and fallback.
  if ((!result.error && !result.data) && supabaseAdmin) {
    result = await runUpdate(supabaseAdmin as any);
  } else if (result.error && supabaseAdmin) {
    result = await runUpdate(supabaseAdmin as any);
  }

  if (result.error) {
    if (isMissingTable(result.error)) {
      tableUnavailable = true;
    }
    return { saved: false, error: result.error.message || 'Unable to update payment choice' };
  }
  if (!result.data?.id) {
    return { saved: false, error: 'No matching lead row was updated (check RLS/admin key).' };
  }
  return { saved: true };
};

export const markLeagueRegistrationLeadCompleted = async (
  leadId: string,
  payload: {
    userId: string | null;
    teamId: string | null;
    playerId: string | null;
  }
): Promise<{ saved: boolean; error?: string }> => {
  if (!leadId || tableUnavailable) return { saved: false };

  const runUpdate = async (client: typeof supabase) =>
    client
      .from(TABLE_NAME)
      .update({
        status: 'completed',
        linked_user_id: payload.userId,
        linked_team_id: payload.teamId,
        linked_player_id: payload.playerId,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .select('id')
      .maybeSingle();

  let result = await runUpdate(supabase);
  // RLS can return "no rows" with no error. Treat that as failed write and fallback.
  if ((!result.error && !result.data) && supabaseAdmin) {
    result = await runUpdate(supabaseAdmin as any);
  } else if (result.error && supabaseAdmin) {
    result = await runUpdate(supabaseAdmin as any);
  }

  if (result.error) {
    if (isMissingTable(result.error)) {
      tableUnavailable = true;
    }
    return { saved: false, error: result.error.message || 'Unable to mark registration completed' };
  }
  if (!result.data?.id) {
    return { saved: false, error: 'No matching lead row was updated (check RLS/admin key).' };
  }
  return { saved: true };
};


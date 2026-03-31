import { supabase } from './supabaseClient';
import { supabaseAdmin } from './supabaseAdminClient';

export const JERSEY_MANAGEMENT_SITE_KEY = 'jersey_management_config_v1';

export type JerseyDesignStatus = 'pending_review' | 'approved_pending_mockup' | 'mockup_approved';

export type JerseyTeamWorkflow = {
  teamId: string;
  seasonId: string;
  status: JerseyDesignStatus;
  uploadedDesignPaths: string[];
  approvedDesignPath?: string | null;
  finalMockupPath?: string | null;
  updatedAt: string;
};

export type JerseyManagementSettings = {
  teams: JerseyTeamWorkflow[];
};

const defaultSettings = (): JerseyManagementSettings => ({ teams: [] });

const sanitizePath = (value: any) => String(value || '').trim();

const normalizeStatus = (value: any): JerseyDesignStatus => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'approved_pending_mockup') return 'approved_pending_mockup';
  if (normalized === 'mockup_approved') return 'mockup_approved';
  return 'pending_review';
};

export const normalizeJerseyManagementSettings = (input: any): JerseyManagementSettings => {
  const fallback = defaultSettings();
  if (!input || typeof input !== 'object') return fallback;
  const teamsInput = Array.isArray((input as any).teams) ? (input as any).teams : [];
  const teams = teamsInput
    .map((row: any) => {
      const teamId = String(row?.teamId || '').trim();
      const seasonId = String(row?.seasonId || '').trim();
      if (!teamId || !seasonId) return null;
      const uploadedDesignPaths = Array.isArray(row?.uploadedDesignPaths)
        ? row.uploadedDesignPaths.map(sanitizePath).filter(Boolean)
        : [];
      return {
        teamId,
        seasonId,
        status: normalizeStatus(row?.status),
        uploadedDesignPaths,
        approvedDesignPath: sanitizePath(row?.approvedDesignPath) || null,
        finalMockupPath: sanitizePath(row?.finalMockupPath) || null,
        updatedAt: String(row?.updatedAt || new Date().toISOString()),
      } as JerseyTeamWorkflow;
    })
    .filter((row): row is JerseyTeamWorkflow => !!row);
  return { teams };
};

export const parseJerseyManagementValue = (value: string | null | undefined): JerseyManagementSettings => {
  if (!value || typeof value !== 'string') return defaultSettings();
  try {
    return normalizeJerseyManagementSettings(JSON.parse(value));
  } catch {
    return defaultSettings();
  }
};

export const serializeJerseyManagementSettings = (settings: JerseyManagementSettings): string =>
  JSON.stringify(normalizeJerseyManagementSettings(settings));

export const loadJerseyManagementSettings = async (): Promise<JerseyManagementSettings> => {
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', JERSEY_MANAGEMENT_SITE_KEY)
      .maybeSingle();
    if (error) throw error;
    return parseJerseyManagementValue((data as any)?.value);
  } catch (err) {
    console.warn('jersey management settings lookup failed, using defaults', err);
    return defaultSettings();
  }
};

export const saveJerseyManagementSettings = async (settings: JerseyManagementSettings): Promise<void> => {
  const payload = {
    key: JERSEY_MANAGEMENT_SITE_KEY,
    value: serializeJerseyManagementSettings(settings),
  };

  let error = (await supabase.from('site_settings').upsert(payload, { onConflict: 'key' })).error;
  if (error && supabaseAdmin) {
    error = (await supabaseAdmin.from('site_settings').upsert(payload, { onConflict: 'key' })).error;
  }
  if (error) throw error;
};

export const upsertTeamJerseyWorkflow = (
  settings: JerseyManagementSettings,
  next: Omit<JerseyTeamWorkflow, 'updatedAt'> & { updatedAt?: string | null }
): JerseyManagementSettings => {
  const normalized = normalizeJerseyManagementSettings(settings);
  const idx = normalized.teams.findIndex((row) => row.teamId === next.teamId && row.seasonId === next.seasonId);
  const entry: JerseyTeamWorkflow = {
    teamId: next.teamId,
    seasonId: next.seasonId,
    status: normalizeStatus(next.status),
    uploadedDesignPaths: Array.from(new Set((next.uploadedDesignPaths || []).map(sanitizePath).filter(Boolean))),
    approvedDesignPath: sanitizePath(next.approvedDesignPath) || null,
    finalMockupPath: sanitizePath(next.finalMockupPath) || null,
    updatedAt: next.updatedAt ? String(next.updatedAt) : new Date().toISOString(),
  };
  if (idx >= 0) {
    normalized.teams[idx] = entry;
  } else {
    normalized.teams.push(entry);
  }
  return normalized;
};


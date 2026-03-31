import { supabase } from './supabaseClient';

export const REGISTRATION_CAPACITY_SITE_KEY = 'registration_capacity_config';

export type RegistrationCapacityType = 'team' | 'free-agent';

export type RegistrationCapacityPair = {
  teamMax: number | null;
  freeAgentMax: number | null;
};

export type RegistrationDivisionCapacityConfig = {
  divisionId: string;
  teamMax: number | null;
  freeAgentMax: number | null;
};

export type RegistrationSeasonCapacityConfig = {
  seasonId: string;
  teamMax: number | null;
  freeAgentMax: number | null;
  divisions: RegistrationDivisionCapacityConfig[];
};

export type RegistrationCapacitySettings = {
  league: RegistrationCapacityPair;
  seasons: RegistrationSeasonCapacityConfig[];
};

const DEFAULT_REGISTRATION_CAPACITY_SETTINGS: RegistrationCapacitySettings = {
  league: {
    teamMax: null,
    freeAgentMax: null,
  },
  seasons: [],
};

const normalizeLimit = (value: any): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return null;
  return normalized;
};

const normalizePair = (raw: any): RegistrationCapacityPair => ({
  teamMax: normalizeLimit(raw?.teamMax),
  freeAgentMax: normalizeLimit(raw?.freeAgentMax),
});

export const getDefaultRegistrationCapacitySettings = (): RegistrationCapacitySettings =>
  JSON.parse(JSON.stringify(DEFAULT_REGISTRATION_CAPACITY_SETTINGS)) as RegistrationCapacitySettings;

export const normalizeRegistrationCapacitySettings = (input: any): RegistrationCapacitySettings => {
  const defaults = getDefaultRegistrationCapacitySettings();
  if (!input || typeof input !== 'object') return defaults;

  const seenSeasonIds = new Set<string>();
  const seasons: RegistrationSeasonCapacityConfig[] = [];
  const sourceSeasons = Array.isArray(input.seasons) ? input.seasons : [];

  sourceSeasons.forEach((rawSeason: any) => {
    const seasonId = typeof rawSeason?.seasonId === 'string' ? rawSeason.seasonId.trim() : '';
    if (!seasonId || seenSeasonIds.has(seasonId)) return;
    seenSeasonIds.add(seasonId);

    const pair = normalizePair(rawSeason);

    const seenDivisionIds = new Set<string>();
    const divisions: RegistrationDivisionCapacityConfig[] = [];
    const rawDivisions = Array.isArray(rawSeason?.divisions) ? rawSeason.divisions : [];
    rawDivisions.forEach((rawDivision: any) => {
      const divisionId = typeof rawDivision?.divisionId === 'string' ? rawDivision.divisionId.trim() : '';
      if (!divisionId || seenDivisionIds.has(divisionId)) return;
      seenDivisionIds.add(divisionId);
      const divisionPair = normalizePair(rawDivision);
      divisions.push({
        divisionId,
        teamMax: divisionPair.teamMax,
        freeAgentMax: divisionPair.freeAgentMax,
      });
    });

    seasons.push({
      seasonId,
      teamMax: pair.teamMax,
      freeAgentMax: pair.freeAgentMax,
      divisions,
    });
  });

  return {
    league: normalizePair(input.league),
    seasons,
  };
};

export const parseRegistrationCapacityValue = (
  value: string | null | undefined
): RegistrationCapacitySettings => {
  if (!value || typeof value !== 'string') return getDefaultRegistrationCapacitySettings();
  try {
    return normalizeRegistrationCapacitySettings(JSON.parse(value));
  } catch {
    return getDefaultRegistrationCapacitySettings();
  }
};

export const serializeRegistrationCapacitySettings = (settings: RegistrationCapacitySettings): string =>
  JSON.stringify(normalizeRegistrationCapacitySettings(settings));

const pickEffectiveLimit = (...limits: Array<number | null | undefined>): number | null => {
  for (const candidate of limits) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate);
    }
  }
  return null;
};

export const resolveEffectiveRegistrationCapacity = (
  settings: RegistrationCapacitySettings | null | undefined,
  registrationType: RegistrationCapacityType,
  seasonId: string,
  divisionId: string
): number | null => {
  if (!settings) return null;
  const season = settings.seasons.find((row) => row.seasonId === seasonId);
  const division = season?.divisions.find((row) => row.divisionId === divisionId);

  if (registrationType === 'team') {
    return pickEffectiveLimit(division?.teamMax, season?.teamMax);
  }
  return pickEffectiveLimit(division?.freeAgentMax, season?.freeAgentMax);
};

export const loadRegistrationCapacitySettings = async (): Promise<RegistrationCapacitySettings> => {
  const defaults = getDefaultRegistrationCapacitySettings();
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', REGISTRATION_CAPACITY_SITE_KEY)
      .maybeSingle();
    if (error) throw error;
    return parseRegistrationCapacityValue((data as any)?.value);
  } catch (err) {
    console.warn('Registration capacity settings lookup failed, using defaults', err);
    return defaults;
  }
};

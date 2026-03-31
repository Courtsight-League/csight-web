import { supabase } from './supabaseClient';

export const BADGE_SETTINGS_SITE_KEY = 'badge_settings_config';

export type TrophyTierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
export type PlayerMilestoneCategoryKey = 'points' | 'assists' | 'rebounds' | 'steals' | 'blocks';
export type TeamBadgeKey = 'champion' | 'top-offense' | 'top-defense' | 'sportsmanship';
export type PlayerAwardKey = 'mvp' | 'dpos' | 'finals-mvp' | 'mip';

export type PlayerMilestoneConfig = {
  key: PlayerMilestoneCategoryKey;
  label: string;
  filePrefix: string;
  thresholds: [number, number, number, number];
  badgeFiles: Record<TrophyTierName, string>;
};

export type PlayerAwardBadgeConfig = {
  key: PlayerAwardKey;
  label: string;
  file: string;
};

export type TeamBadgeConfig = {
  key: TeamBadgeKey;
  label: string;
  file: string;
};

export type TeamRatingThresholds = {
  elite: number;
  outstanding: number;
  aboveAverage: number;
  average: number;
};

export type BadgeSettings = {
  playerMilestones: PlayerMilestoneConfig[];
  playerAwards: PlayerAwardBadgeConfig[];
  teamBadges: TeamBadgeConfig[];
  teamRatingThresholds: TeamRatingThresholds;
};

const TROPHY_TIERS: TrophyTierName[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];

const DEFAULT_BADGE_SETTINGS: BadgeSettings = {
  playerMilestones: [
    {
      key: 'points',
      label: 'Points',
      filePrefix: 'points',
      thresholds: [200, 400, 600, 1000],
      badgeFiles: {
        Bronze: 'points-bronze.png',
        Silver: 'points-silver.png',
        Gold: 'points-gold.png',
        Platinum: 'points-platinum.png',
      },
    },
    {
      key: 'assists',
      label: 'Assists',
      filePrefix: 'assists',
      thresholds: [50, 80, 120, 200],
      badgeFiles: {
        Bronze: 'assists-bronze.png',
        Silver: 'assists-silver.png',
        Gold: 'assists-gold.png',
        Platinum: 'assists-platinum.png',
      },
    },
    {
      key: 'rebounds',
      label: 'Rebounds',
      filePrefix: 'rebounds',
      thresholds: [70, 120, 160, 300],
      badgeFiles: {
        Bronze: 'rebounds-bronze.png',
        Silver: 'rebounds-silver.png',
        Gold: 'rebounds-gold.png',
        Platinum: 'rebounds-platinum.png',
      },
    },
    {
      key: 'steals',
      label: 'Steals',
      filePrefix: 'steals',
      thresholds: [12, 20, 30, 50],
      badgeFiles: {
        Bronze: 'steals-bronze.png',
        Silver: 'steals-silver.png',
        Gold: 'steals-gold.png',
        Platinum: 'steals-platinum.png',
      },
    },
    {
      key: 'blocks',
      label: 'Blocks',
      filePrefix: 'blocks',
      thresholds: [10, 15, 20, 30],
      badgeFiles: {
        Bronze: 'blocks-bronze.png',
        Silver: 'blocks-silver.png',
        Gold: 'blocks-gold.png',
        Platinum: 'blocks-platinum.png',
      },
    },
  ],
  playerAwards: [
    { key: 'mvp', label: 'MVP Trophy', file: 'seasonmvp.png' },
    { key: 'dpos', label: 'DPOS', file: 'dpos.png' },
    { key: 'finals-mvp', label: 'Finals MVP', file: 'finalsmvp.png' },
    { key: 'mip', label: 'MIP', file: 'mip.png' },
  ],
  teamBadges: [
    { key: 'champion', label: 'Champion', file: 'champion.png' },
    { key: 'top-offense', label: 'Top Offense', file: 'topoffense.png' },
    { key: 'top-defense', label: 'Top Defense', file: 'topdefense.png' },
    { key: 'sportsmanship', label: 'Sportsmanship', file: 'sportsmanship.png' },
  ],
  teamRatingThresholds: {
    elite: 90,
    outstanding: 80,
    aboveAverage: 70,
    average: 50,
  },
};

const toInt = (value: any, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
};

const normalizeMilestoneThresholds = (
  rawThresholds: any,
  fallback: [number, number, number, number]
): [number, number, number, number] => {
  const source = Array.isArray(rawThresholds) ? rawThresholds : fallback;
  const normalized: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const candidate = toInt(source[i], fallback[i]);
    const minValue = i === 0 ? 1 : normalized[i - 1] + 1;
    normalized.push(Math.max(candidate, minValue));
  }
  return [normalized[0], normalized[1], normalized[2], normalized[3]];
};

const normalizeTeamRatingThresholds = (
  rawThresholds: any,
  fallback: TeamRatingThresholds
): TeamRatingThresholds => {
  const elite = toInt(rawThresholds?.elite, fallback.elite);
  const outstanding = Math.min(toInt(rawThresholds?.outstanding, fallback.outstanding), Math.max(elite - 1, 0));
  const aboveAverage = Math.min(
    toInt(rawThresholds?.aboveAverage, fallback.aboveAverage),
    Math.max(outstanding - 1, 0)
  );
  const average = Math.min(toInt(rawThresholds?.average, fallback.average), Math.max(aboveAverage - 1, 0));
  return { elite, outstanding, aboveAverage, average };
};

export const getDefaultBadgeSettings = (): BadgeSettings =>
  JSON.parse(JSON.stringify(DEFAULT_BADGE_SETTINGS)) as BadgeSettings;

export const normalizeBadgeSettings = (input: any): BadgeSettings => {
  const defaults = getDefaultBadgeSettings();
  if (!input || typeof input !== 'object') return defaults;

  const inputMilestones = Array.isArray(input.playerMilestones) ? input.playerMilestones : [];
  const playerMilestones = defaults.playerMilestones.map((baseMilestone) => {
    const rawMilestone =
      inputMilestones.find((item: any) => item && item.key === baseMilestone.key) || {};
    const thresholds = normalizeMilestoneThresholds(rawMilestone.thresholds, baseMilestone.thresholds);
    const badgeFiles = TROPHY_TIERS.reduce((acc, tier) => {
      const rawFile = (rawMilestone.badgeFiles && rawMilestone.badgeFiles[tier]) || baseMilestone.badgeFiles[tier];
      acc[tier] = typeof rawFile === 'string' && rawFile.trim() ? rawFile.trim() : baseMilestone.badgeFiles[tier];
      return acc;
    }, {} as Record<TrophyTierName, string>);
    return {
      key: baseMilestone.key,
      label:
        typeof rawMilestone.label === 'string' && rawMilestone.label.trim()
          ? rawMilestone.label.trim()
          : baseMilestone.label,
      filePrefix:
        typeof rawMilestone.filePrefix === 'string' && rawMilestone.filePrefix.trim()
          ? rawMilestone.filePrefix.trim()
          : baseMilestone.filePrefix,
      thresholds,
      badgeFiles,
    };
  });

  const inputAwards = Array.isArray(input.playerAwards) ? input.playerAwards : [];
  const playerAwards = defaults.playerAwards.map((baseAward) => {
    const rawAward = inputAwards.find((item: any) => item && item.key === baseAward.key) || {};
    return {
      key: baseAward.key,
      label:
        typeof rawAward.label === 'string' && rawAward.label.trim()
          ? rawAward.label.trim()
          : baseAward.label,
      file:
        typeof rawAward.file === 'string' && rawAward.file.trim()
          ? rawAward.file.trim()
          : baseAward.file,
    };
  });

  const inputTeamBadges = Array.isArray(input.teamBadges) ? input.teamBadges : [];
  const teamBadges = defaults.teamBadges.map((baseBadge) => {
    const rawBadge = inputTeamBadges.find((item: any) => item && item.key === baseBadge.key) || {};
    return {
      key: baseBadge.key,
      label:
        typeof rawBadge.label === 'string' && rawBadge.label.trim()
          ? rawBadge.label.trim()
          : baseBadge.label,
      file:
        typeof rawBadge.file === 'string' && rawBadge.file.trim()
          ? rawBadge.file.trim()
          : baseBadge.file,
    };
  });

  const teamRatingThresholds = normalizeTeamRatingThresholds(
    input.teamRatingThresholds,
    defaults.teamRatingThresholds
  );

  return {
    playerMilestones,
    playerAwards,
    teamBadges,
    teamRatingThresholds,
  };
};

export const parseBadgeSettingsValue = (value: string | null | undefined): BadgeSettings => {
  if (!value || typeof value !== 'string') return getDefaultBadgeSettings();
  try {
    const parsed = JSON.parse(value);
    return normalizeBadgeSettings(parsed);
  } catch {
    return getDefaultBadgeSettings();
  }
};

export const serializeBadgeSettings = (settings: BadgeSettings): string =>
  JSON.stringify(normalizeBadgeSettings(settings));

export const loadBadgeSettings = async (): Promise<BadgeSettings> => {
  const defaults = getDefaultBadgeSettings();
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', BADGE_SETTINGS_SITE_KEY)
      .maybeSingle();
    if (error) throw error;
    return parseBadgeSettingsValue((data as any)?.value);
  } catch (err) {
    console.warn('Badge settings lookup failed, using defaults', err);
    return defaults;
  }
};

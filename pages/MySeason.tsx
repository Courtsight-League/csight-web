import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getStoredUser } from '../services/authService';
import { createNotifications } from '../services/notificationService';
import { getSeasonList, getTeamDirectory, signTeamAssetUrl } from '../services/dataCache';
import { getDefaultBadgeSettings, loadBadgeSettings } from '../services/badgeSettings';
import { User } from '../types';
import { Calendar, MapPin, Activity, Users, Share2 } from 'lucide-react';
import LoadingOverlay from '../components/LoadingOverlay';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { normalizeJerseyNumberInput } from '../utils/jerseyNumber';
import ShareStatsModal from '../components/ShareStatsModal';
import BadgeCylinderCarousel from '../components/BadgeCylinderCarousel';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type HeroData = {
  seasonLabel: string;
  teamLabel: string;
  jerseyNumber?: string | null;
  nameLine1: string;
  nameLine2: string;
  ppg: string | number;
  rpg: string | number;
  apg: string | number;
  spg: string | number;
};

const splitPublicDisplayName = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return { line1: 'PLAYER', line2: '' };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const line1 = (parts.shift() || 'PLAYER').toUpperCase();
  const line2 = parts.join(' ').toUpperCase();
  return { line1, line2 };
};

type HeroStatSet = Pick<HeroData, 'ppg' | 'rpg' | 'apg' | 'spg'>;

type GameStatRow = {
  game_id?: string | null;
  season_id?: string | null;
  points?: number | string | null;
  rebounds?: number | string | null;
  assists?: number | string | null;
  steals?: number | string | null;
};

type StatTotals = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  games: number;
};

const toStatNumber = (value: number | string | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const accumulateStatTotals = (rows: GameStatRow[], filter?: (row: GameStatRow) => boolean): StatTotals =>
  rows.reduce(
    (acc, row) => {
      if (!row) return acc;
      if (filter && !filter(row)) return acc;
      acc.pts += toStatNumber(row.points);
      acc.reb += toStatNumber(row.rebounds);
      acc.ast += toStatNumber(row.assists);
      acc.stl += toStatNumber(row.steals);
      acc.games += 1;
      return acc;
    },
    { pts: 0, reb: 0, ast: 0, stl: 0, games: 0 }
  );

const buildHeroStatSetFromTotals = (totals: StatTotals): HeroStatSet => {
  const gp = totals.games || 1;
  return {
    ppg: formatDecimal(totals.pts / gp),
    rpg: formatDecimal(totals.reb / gp),
    apg: formatDecimal(totals.ast / gp),
    spg: formatDecimal(totals.stl / gp),
  };
};

// type HeroStatSet = Pick<HeroData, 'ppg' | 'rpg' | 'apg' | 'spg'>;

type FocusGame = {
  id: string;
  date: string;
  time: string;
  location: string;
  opponentName: string;
  opponentId?: string | null;
  opponentLogo?: string;
  myTeamId?: string | null;
  myTeamLabel?: string;
  isHome: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  homeLogo?: string;
  awayLogo?: string;
  myTeamLogo?: string;
};

type PlayerProfileOption = {
  id: string;
  seasonId?: string | null;
  seasonLabel: string;
  teamId?: string | null;
  teamLabel: string;
  jerseyNumber?: string | null;
  division?: string | null;
  displayName: string;
};

type PaymentStatus = 'paid' | 'pending' | 'pending-stripe' | 'unknown';

type GameLogRow = {
  id: string;
  gameId?: string;
  date: string;
  time?: string;
  location?: string;
  seasonId?: string | null;
  opponent: string;
  opponentId?: string | null;
  myTeamId?: string | null;
  result: 'W' | 'L' | 'TBD';
  resultColor: 'win' | 'loss' | 'tbd';
  position?: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk?: number | null;
  fgm?: number | null;
  fga?: number | null;
  tpm?: number | null;
  tpa?: number | null;
  ftm?: number | null;
  fta?: number | null;
  tov?: number | null;
  seasonLabel?: string;
  fg?: string;
  three?: string;
  opponentLogo?: string;
  myTeamLogo?: string;
  myTeamLabel?: string;
  isHome?: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
};

type CareerStatRow = {
  seasonLabel: string;
  teamLabel: string;
  division: string;
  divisionLabel: string;
  divisionKey: string;
  seasonId?: string | null;
  gp: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  teamId?: string | null;
  teamLogo?: string;
};

type StatsTabKey = 'career' | 'gamelogs';

const STATS_TAB_OPTIONS: Array<{ key: StatsTabKey; label: string }> = [
  { key: 'career', label: 'Career Stats' },
  { key: 'gamelogs', label: 'Game Logs' },
];

type TrophyTierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
type PlayerTrophyCategoryKey = 'points' | 'assists' | 'rebounds' | 'steals' | 'blocks';

type PlayerTrophyTierStatus = {
  tier: TrophyTierName;
  threshold: number;
  unlocked: boolean;
  unlockedAt?: string;
  badgeUrl?: string;
};

type PlayerTrophyCategoryView = {
  key: PlayerTrophyCategoryKey;
  label: string;
  total: number;
  tiers: PlayerTrophyTierStatus[];
  highestUnlocked?: PlayerTrophyTierStatus;
  nextTier?: {
    tier: TrophyTierName;
    threshold: number;
    remaining: number;
    progress: number;
  };
};

type PlayerAwardBadge = {
  key: string;
  label: string;
  seasonLabel: string;
  assignedAt?: string;
  url: string;
};

type PlayerBadgeItem = {
  key: string;
  label: string;
  url: string;
  fallbackUrl: string;
  tooltip?: string;
};

const TROPHY_TIERS: TrophyTierName[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];

const DEFAULT_PLAYER_BADGE_SETTINGS = getDefaultBadgeSettings();

const PLAYER_TROPHY_TABLE = 'player_trophy_overrides';

const formatSeasonLabel = (season?: { name?: string | null; year?: string | number | null }) => {
  const name = season?.name || 'Season';
  const year = season?.year ? `${season.year}` : '';
  if (year && name.includes(year)) return name;
  return `${name}${year ? ` ${year}` : ''}`.trim();
};

const seasonTokenOrder: Record<string, number> = {
  winter: 1,
  spring: 2,
  summer: 3,
  fall: 4,
  autumn: 4,
};

const seasonLabelChronologyValue = (label?: string | null): number => {
  const normalized = (label || '').trim().toLowerCase();
  if (!normalized) return 0;

  const seasonToken =
    Object.keys(seasonTokenOrder).find((token) => normalized.includes(token)) || '';
  const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
  const yearValue = yearMatch ? Number(yearMatch[0]) : 0;
  const seasonOrder = seasonToken ? seasonTokenOrder[seasonToken] || 0 : 0;

  if (!yearValue) return 0;
  return yearValue * 10 + seasonOrder;
};

const parseBool = (value: any, fallback = true) => {
  if (value === true || value === 'true' || value === 'TRUE' || value === 't' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 'FALSE' || value === 'f' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
};

const isSeasonRegistrationOpen = (season: any) => {
  if (!season || typeof season !== 'object') return true;
  if (Object.prototype.hasOwnProperty.call(season, 'registration_open')) {
    return parseBool((season as any).registration_open, true);
  }
  if (Object.prototype.hasOwnProperty.call(season, 'is_public')) {
    return parseBool((season as any).is_public, true);
  }
  return true;
};

const formatDecimal = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0.0');

const formatPercentage = (made: number, attempts: number) => {
  if (!Number.isFinite(attempts) || attempts <= 0) return '0%';
  return `${((made / attempts) * 100).toFixed(1)}%`;
};

const formatPercentageCompact = (made: number | null | undefined, attempts: number | null | undefined) => {
  if (attempts == null) return '-';
  if (!Number.isFinite(attempts) || attempts <= 0) return '0%';
  const safeMade = made == null ? 0 : Number(made);
  if (!Number.isFinite(safeMade)) return '0%';
  return `${Math.round((safeMade / attempts) * 100)}%`;
};

const teamPath = (teamId?: string | null) => (teamId ? `/team/${teamId}` : '#');

const formatTrophyDate = (value?: string) => {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
};

const getFixedScheduleDateTimeParts = (value?: string | null) => {
  if (!value) return { date: '', time: '' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };
  const iso = parsed.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  };
};

const formatScheduleDateLabel = (
  value?: string | null,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
) => {
  if (!value) return '';
  const dateOnlyMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
        12,
        0,
        0
      )
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || '');
  return parsed.toLocaleDateString('en-US', options);
};

const getTierColor = (tier: TrophyTierName) => {
  switch (tier) {
    case 'Bronze':
      return '#b87333';
    case 'Silver':
      return '#c0c0c0';
    case 'Gold':
      return '#f7d354';
    case 'Platinum':
      return '#8bd3ff';
    default:
      return '#9ca3af';
  }
};

const buildBadgePlaceholder = (line1: string, line2: string, accent: string) => {
  const safeLine1 = line1.replace(/[^a-z0-9 ]/gi, '').trim().toUpperCase();
  const safeLine2 = line2.replace(/[^a-z0-9 ]/gi, '').trim().toUpperCase();
  const line1Y = safeLine2 ? 110 : 126;
  const line2Y = 142;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b1b1b"/>
      <stop offset="100%" stop-color="#090909"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="224" height="224" rx="28" fill="url(#bg)" stroke="${accent}" stroke-width="4"/>
  <text x="120" y="${line1Y}" fill="${accent}" font-family="Arial, sans-serif" font-size="24" text-anchor="middle" font-weight="700">${safeLine1}</text>
  ${safeLine2 ? `<text x="120" y="${line2Y}" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" text-anchor="middle" font-weight="700">${safeLine2}</text>` : ''}
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const AWARD_PLACEHOLDER_LINES: Record<string, [string, string]> = {
  mvp: ['MVP', 'TROPHY'],
  dpos: ['DPOS', ''],
  'finals-mvp': ['FINALS', 'MVP'],
  mip: ['MIP', ''],
};

const MySeason: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [resolvedProfileAvatarUrl, setResolvedProfileAvatarUrl] = useState<string>('');
  const [loadingHero, setLoadingHero] = useState<boolean>(true);
  const [hero, setHero] = useState<HeroData | null>(null);
  const [currentSeasonHeroStats, setCurrentSeasonHeroStats] = useState<HeroStatSet | null>(null);
  const [heroActiveInCurrentSeason, setHeroActiveInCurrentSeason] = useState(false);
  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(null);
  const [activeSeasonLabel, setActiveSeasonLabel] = useState('');
  const [nextGame, setNextGame] = useState<FocusGame | null>(null);
  const [lastGame, setLastGame] = useState<FocusGame | null>(null);
  const [gameLogs, setGameLogs] = useState<GameLogRow[]>([]);
  const [careerStats, setCareerStats] = useState<CareerStatRow[]>([]);
  const [myTeamName, setMyTeamName] = useState<string>('');
  const [myTeamLogo, setMyTeamLogo] = useState<string>('');
  const [allSeasons, setAllSeasons] = useState<any[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [lastJerseyNumber, setLastJerseyNumber] = useState<string | null>(() => {
    try {
      const anon = normalizeJerseyNumberInput(localStorage.getItem('courtsight_last_jersey_number'));
      const userScoped = (() => {
        const current = getStoredUser();
        if (!current) return null;
        return normalizeJerseyNumberInput(localStorage.getItem(`courtsight_last_jersey_number_${current.id}`));
      })();
      const pick = userScoped ?? anon;
      return pick || null;
    } catch {
      return null;
    }
  });
  const [lastTeamId, setLastTeamId] = useState<string | null>(() => {
    try {
      const current = getStoredUser();
      const scoped = current ? localStorage.getItem(`courtsight_last_team_id_${current.id}`) : null;
      return scoped || localStorage.getItem('courtsight_last_team_id') || null;
    } catch {
      return null;
    }
  });
  const [playerProfiles, setPlayerProfiles] = useState<PlayerProfileOption[]>([]);
  const [publicDisplayName, setPublicDisplayName] = useState<string>('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(() => {
    try {
      const stored = getStoredUser();
      if (!stored) return null;
      return localStorage.getItem(`courtsight_selected_player_id_${stored.id}`) || null;
    } catch {
      return null;
    }
  });
  const displayJersey = useMemo(
    () => (hero?.jerseyNumber != null ? hero.jerseyNumber : lastJerseyNumber),
    [hero?.jerseyNumber, lastJerseyNumber]
  );
  const careerRowsForDisplay = useMemo(() => {
    if (!careerStats.length) return [];
    return careerStats.map((row) => {
      const gp = row.gp || 1;
      const safeMean = (value: number) => (gp ? value / gp : 0);
      const teamAvatar =
        row.teamLogo ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(row.teamLabel || 'Team')}&background=111827&color=10b981&rounded=true`;
      return {
        ...row,
        ppg: safeMean(row.pts),
        rpg: safeMean(row.reb),
        apg: safeMean(row.ast),
        spg: safeMean(row.stl),
        bpg: safeMean(row.blk),
        tovAvg: safeMean(row.tov),
        fgmAvg: safeMean(row.fgm),
        fgaAvg: safeMean(row.fga),
        teamAvatar,
      };
    });
  }, [careerStats]);

  useEffect(() => {
    let active = true;
    const loadPublicDisplayName = async () => {
      const stored = getStoredUser();
      if (!stored?.id) {
        if (active) setPublicDisplayName('');
        return;
      }
      try {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', stored.id)
          .maybeSingle();
        if (!active) return;
        const resolved = String((profileRow as any)?.display_name || '').trim();
        setPublicDisplayName(resolved || String(stored.name || '').trim());
      } catch {
        if (!active) return;
        setPublicDisplayName(String(stored.name || '').trim());
      }
    };
    loadPublicDisplayName();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!careerRowsForDisplay.length) return;
    console.debug(
      'career divisions',
      careerRowsForDisplay.map((row) => ({
        season: row.seasonLabel,
        team: row.teamLabel,
        division: row.divisionLabel,
      }))
    );
  }, [careerRowsForDisplay]);
  const careerTotals = useMemo(() => {
    if (!careerStats.length) return null;
    return careerStats.reduce(
      (acc, row) => ({
        gp: acc.gp + row.gp,
        pts: acc.pts + row.pts,
        reb: acc.reb + row.reb,
        ast: acc.ast + row.ast,
        stl: acc.stl + row.stl,
        blk: acc.blk + row.blk,
        tov: acc.tov + row.tov,
        fgm: acc.fgm + row.fgm,
        fga: acc.fga + row.fga,
        tpm: acc.tpm + row.tpm,
        tpa: acc.tpa + row.tpa,
        ftm: acc.ftm + row.ftm,
        fta: acc.fta + row.fta,
      }),
      { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 }
    );
  }, [careerStats]);
  const careerAverageStats = useMemo(() => {
    if (!careerTotals || !careerTotals.gp) {
      return {
        ppg: formatDecimal(Number(hero?.ppg) || 0),
        rpg: formatDecimal(Number(hero?.rpg) || 0),
        apg: formatDecimal(Number(hero?.apg) || 0),
        spg: formatDecimal(Number(hero?.spg) || 0),
      };
    }
    const gp = careerTotals.gp || 1;
    return {
      ppg: formatDecimal(careerTotals.pts / gp),
      rpg: formatDecimal(careerTotals.reb / gp),
      apg: formatDecimal(careerTotals.ast / gp),
      spg: formatDecimal(careerTotals.stl / gp),
    };
  }, [careerTotals, hero]);
  const activeSeasonHeroStats = useMemo(() => {
    if (!activeSeasonId) return null;
    const entry = careerRowsForDisplay.find(
      (row) =>
        (row.seasonId && row.seasonId === activeSeasonId) ||
        (!!activeSeasonLabel && row.seasonLabel === activeSeasonLabel)
    );
    if (!entry || !entry.gp) return null;
    const gp = entry.gp || 1;
    return {
      ppg: formatDecimal(entry.pts / gp),
      rpg: formatDecimal(entry.reb / gp),
      apg: formatDecimal(entry.ast / gp),
      spg: formatDecimal(entry.stl / gp),
    };
  }, [activeSeasonId, activeSeasonLabel, careerRowsForDisplay]);
  const normalizeJoinCode = (value: string) =>
    String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinSeasonId, setJoinSeasonId] = useState<string>('');
  const [joinDivision, setJoinDivision] = useState<string>('ALL');
  const [joinTeamId, setJoinTeamId] = useState<string>('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('pending');
  const [careerTrophies, setCareerTrophies] = useState<PlayerTrophyCategoryView[]>([]);
  const [awardBadges, setAwardBadges] = useState<PlayerAwardBadge[]>([]);
  const [playerBadges, setPlayerBadges] = useState<PlayerBadgeItem[]>([]);
  const [loadingTrophies, setLoadingTrophies] = useState<boolean>(false);
  const [statsTab, setStatsTab] = useState<StatsTabKey>('career');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTeamId, setShareTeamId] = useState<string>('');
  const [shareGameId, setShareGameId] = useState<string>('');
  const [seasonRecord, setSeasonRecord] = useState<{ wins: number; losses: number } | null>(null);

  useEffect(() => {
    const syncUser = () => setUser(getStoredUser());
    window.addEventListener('courtsight:user-updated', syncUser as EventListener);
    return () => window.removeEventListener('courtsight:user-updated', syncUser as EventListener);
  }, []);

  useEffect(() => {
    let active = true;
    const resolveAvatar = async () => {
      const raw = (user?.avatarUrl || '').trim();
      if (!raw) {
        if (active) setResolvedProfileAvatarUrl('');
        return;
      }
      try {
        const resolved = await signTeamAssetUrl(raw);
        if (active) setResolvedProfileAvatarUrl((resolved || raw).trim());
      } catch {
        if (active) setResolvedProfileAvatarUrl(raw);
      }
    };
    resolveAvatar();
    return () => {
      active = false;
    };
  }, [user?.id, user?.avatarUrl]);
  const startCreateTeamFlow = () => {
    try {
      sessionStorage.setItem('skipRegistrationRedirectOnce', 'true');
    } catch {
      // ignore storage errors
    }
  };
  useEffect(() => {
    if (!user) {
      setSelectedPlayerId(null);
      setPlayerProfiles([]);
      return;
    }
    try {
      const saved = localStorage.getItem(`courtsight_selected_player_id_${user.id}`);
      if (saved) {
        setSelectedPlayerId(saved);
      }
    } catch {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    if (!user || !selectedPlayerId) return;
    try {
      localStorage.setItem(`courtsight_selected_player_id_${user.id}`, selectedPlayerId);
    } catch {
      // ignore
    }
  }, [selectedPlayerId, user?.id]);

  const loadHero = useCallback(async (preferredPlayerId?: string | null) => {
    setLoadingHero(true);
    setLoadingTrophies(true);
    const stored = getStoredUser();
    setUser(stored);
    setCurrentSeasonHeroStats(null);
    setHeroActiveInCurrentSeason(false);
    setActiveSeasonId(null);
    setActiveSeasonLabel('');
    if (!stored) {
      setLoadingHero(false);
      setLoadingTrophies(false);
      setCareerTrophies([]);
      setAwardBadges([]);
      setPlayerBadges([]);
      return;
    }
    let heroSeasonLabelCandidate = '';
    const asPaymentStatus = (val: any): PaymentStatus | null => {
      if (val === 'paid' || val === 'pending' || val === 'pending-stripe' || val === 'unknown') return val;
      return null;
    };
    const persistPaymentStatus = (status: PaymentStatus) => {
      setPaymentStatus(status);
      if (stored?.id) {
        try {
          localStorage.setItem(`courtsight_payment_status_${stored.id}`, status);
        } catch {}
      }
    };

    // Load payment status (profile column if exists; fallback to local)
    let resolvedPayment: PaymentStatus = 'pending';
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('payment_status')
        .eq('user_id', stored.id)
        .maybeSingle();
      const payVal = asPaymentStatus(profileRow?.payment_status);
      if (payVal && payVal !== 'unknown') {
        resolvedPayment = payVal;
      } else {
        const localPay = asPaymentStatus(localStorage.getItem(`courtsight_payment_status_${stored.id}`));
        resolvedPayment = localPay || 'pending';
      }
    } catch {
      const localPay = asPaymentStatus(localStorage.getItem(`courtsight_payment_status_${stored?.id || ''}`));
      resolvedPayment = localPay || 'pending';
    }
    persistPaymentStatus(resolvedPayment);
    try {
        // 1) Season (is_current, else latest known from cached season list)
        const { data: current } = await supabase
          .from('seasons')
          .select('id,name,year,is_current,start_date')
          .eq('is_current', true)
          .maybeSingle();
        const activeSeasonId = current?.id || null;
        const activeSeasonLabelLocal = current ? formatSeasonLabel(current) : '';
        setActiveSeasonId(activeSeasonId);
        setActiveSeasonLabel(activeSeasonLabelLocal);
        let seasonRow = current;
        // All seasons for modal filter
        const seasonLookup: Record<string, string> = {};
        const seasonStartLookup: Record<string, number> = {};
        if (current?.id && current?.start_date) {
          const currentSeasonStart = new Date(current.start_date).getTime();
          if (Number.isFinite(currentSeasonStart) && currentSeasonStart > 0) {
            seasonStartLookup[current.id] = currentSeasonStart;
          }
        }
        try {
          const seasonList = await getSeasonList();
          if (seasonList) {
            const registrationOpenSeasons = seasonList.filter(isSeasonRegistrationOpen);
            setAllSeasons(registrationOpenSeasons);
            setJoinSeasonId((prev) => {
              if (prev && registrationOpenSeasons.some((season) => season.id === prev)) return prev;
              return registrationOpenSeasons[0]?.id || '';
            });
            seasonList.forEach((season) => {
              seasonLookup[season.id] = formatSeasonLabel(season);
              if (season?.id && season?.start_date) {
                const startValue = new Date(season.start_date).getTime();
                if (Number.isFinite(startValue) && startValue > 0) {
                  seasonStartLookup[season.id] = startValue;
                }
              }
            });
            if (!seasonRow) {
              seasonRow = seasonList[0] || null;
            }
          }
        } catch {
          // ignore
        }
        if (!seasonRow) {
          setHero(null);
          setCurrentSeasonHeroStats(null);
          setHeroActiveInCurrentSeason(false);
          return;
        }

        // 1b) Load all teams for filters and signed logos
        let teamDirectory: Record<
          string,
          {
            name: string;
            logo?: string | null;
            division?: string | null;
            seasonId?: string | null;
          }
        > = {};
        const teamLogoLookup = new Map<string, string>();
        const resolveTeamLogo = (teamId?: string | null, label?: string) => {
          if (teamId && teamDirectory[teamId]?.logo) return teamDirectory[teamId]!.logo || '';
          const fallbackName = label || 'Team';
          return (
            teamLogoLookup.get(fallbackName) ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=111827&color=10b981`
          );
        };
        try {
          const teamRows = await getTeamDirectory();
          if (teamRows) {
            const mapped: Record<
              string,
              { name: string; logo?: string | null; division?: string | null; seasonId?: string | null }
            > = {};
            teamRows.forEach((team) => {
              mapped[team.id] = {
                name: team.name,
                logo: team.logo || '',
                division: team.division || 'D1',
                seasonId: team.seasonId || null,
              };
              if (team.logo) {
                teamLogoLookup.set(team.name, team.logo);
              }
            });
            teamDirectory = mapped;
            setAllTeams(
              teamRows.map((team) => ({
                id: team.id,
                name: team.name,
                shortName: team.shortName || '',
                seasonId: team.seasonId || '',
                division: team.division || 'D1',
              }))
            );
          }
        } catch {
          teamDirectory = {};
        }

        // 2) Player for this user/season (allows toggling between linked player profiles)
        const playerSelect =
          'id,team_id,first_name,last_name,jersey_number,position,season_id,payment_status,teams:team_id(name,short_name,division)';
        const { data: playerRows } = await supabase
          .from('players')
          .select(playerSelect)
          .eq('user_id', stored.id)
          .order('created_at', { ascending: false });
        let availablePlayers = playerRows || [];
        const normalizeNameToken = (value?: string | null) =>
          (value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const nameParts = (stored.name || '')
          .trim()
          .split(/\s+/)
          .map((part) => part.trim())
          .filter(Boolean);
        const firstNameGuess = nameParts[0] || '';
        const lastNameGuess = nameParts.slice(1).join(' ');
        const normalizedFirst = normalizeNameToken(firstNameGuess);
        const normalizedLast = normalizeNameToken(lastNameGuess);
        const seenPlayerIds = new Set<string>(availablePlayers.map((row) => String(row?.id || '')));
        const linkedJerseyNumbers = new Set(
          availablePlayers
            .map((row) => normalizeJerseyNumberInput(row?.jersey_number ?? null))
            .filter(Boolean)
        );
        const linkedTeamIds = new Set(
          availablePlayers.map((row) => (row?.team_id ? String(row.team_id) : '')).filter(Boolean)
        );
        const shouldIncludeFallbackCandidate = (row: any) => {
          const candidateId = row?.id ? String(row.id) : '';
          if (!candidateId || seenPlayerIds.has(candidateId)) return false;
          if (preferredPlayerId && candidateId === preferredPlayerId) return true;
          const rowFirst = normalizeNameToken(row?.first_name);
          const rowLast = normalizeNameToken(row?.last_name);
          const nameExact =
            (normalizedFirst && normalizedLast && rowFirst === normalizedFirst && rowLast === normalizedLast) ||
            (normalizedFirst && !normalizedLast && rowFirst === normalizedFirst) ||
            (!normalizedFirst && normalizedLast && rowLast === normalizedLast);
          if (!nameExact) return false;
          if (!availablePlayers.length) return true;
          const candidateJersey = normalizeJerseyNumberInput(row?.jersey_number ?? null);
          if (candidateJersey && linkedJerseyNumbers.has(candidateJersey)) return true;
          if (row?.team_id && linkedTeamIds.has(String(row.team_id))) return true;
          if (!linkedJerseyNumbers.size && !linkedTeamIds.size) return true;
          return false;
        };
        const pushFallbackPlayer = (row: any) => {
          if (!shouldIncludeFallbackCandidate(row)) return;
          const playerId = String(row.id);
          seenPlayerIds.add(playerId);
          availablePlayers.push(row);
        };
        if (preferredPlayerId || firstNameGuess || lastNameGuess) {
          if (preferredPlayerId) {
            try {
              const { data: preferredRow } = await supabase
                .from('players')
                .select(playerSelect)
                .eq('id', preferredPlayerId)
                .maybeSingle();
              if (preferredRow) {
                pushFallbackPlayer(preferredRow);
              }
            } catch {
              // ignore fallback lookup failure
            }
          }
          if (firstNameGuess || lastNameGuess) {
            try {
              let nameQuery = supabase.from('players').select(playerSelect);
              if (firstNameGuess) {
                nameQuery = nameQuery.ilike('first_name', `%${firstNameGuess}%`);
              }
              if (lastNameGuess) {
                nameQuery = nameQuery.ilike('last_name', `%${lastNameGuess}%`);
              }
              const { data: nameRows } = await nameQuery
                .order('created_at', { ascending: false })
                .limit(30);
              (nameRows || []).forEach((row) => pushFallbackPlayer(row));
            } catch {
              // ignore fallback lookup failure
            }
          }
        }
        if (import.meta.env.DEV && availablePlayers.length) {
          console.debug('my-season player resolution', {
            userId: stored.id,
            preferredPlayerId: preferredPlayerId || null,
            playerCount: availablePlayers.length,
            playerIds: availablePlayers.map((row) => row.id),
          });
        }
        const buildPlayerInfo = (
          teamId?: string | null,
          seasonId?: string | null,
          overrideSeasonLabel?: string,
          overrideTeamLabel?: string,
          overrideDivision?: string
        ) => {
          const teamInfo = teamId ? teamDirectory[teamId] : undefined;
          const resolvedSeasonId = seasonId || teamInfo?.seasonId || null;
          const resolvedSeasonLabel =
            overrideSeasonLabel ||
            (resolvedSeasonId ? seasonLookup[resolvedSeasonId] : '') ||
            formatSeasonLabel();
          const divisionLabel = overrideDivision || teamInfo?.division || 'D1';
          return {
            seasonId: resolvedSeasonId,
            seasonLabel: resolvedSeasonLabel,
            teamId: teamId || null,
            teamLabel: overrideTeamLabel || teamInfo?.name || 'Team',
            division: divisionLabel,
          };
        };
        const playerIds = availablePlayers.map((p) => p.id).filter(Boolean);
        const trackedTeamIds = Array.from(
          new Set(availablePlayers.map((p) => p.team_id).filter(Boolean))
        );
        if (import.meta.env.DEV && trackedTeamIds.length) {
          console.debug(
            'tracked player teams',
            trackedTeamIds.map((teamId) => ({
              id: teamId,
              name: teamDirectory[teamId]?.name,
              division: teamDirectory[teamId]?.division,
              seasonId: teamDirectory[teamId]?.seasonId,
            }))
          );
        }
        const profileDisplayName = String(publicDisplayName || stored.name || '').trim();
        const profiles: PlayerProfileOption[] = availablePlayers.map((p) => ({
          id: p.id,
          teamId: p.team_id || null,
          seasonId: p.season_id || null,
          seasonLabel: (p.season_id && seasonLookup[p.season_id]) || formatSeasonLabel(),
          teamLabel: p.teams?.name || teamDirectory[p.team_id]?.name || 'Team',
          jerseyNumber: normalizeJerseyNumberInput(p.jersey_number ?? null),
          division: p.teams?.division || teamDirectory[p.team_id]?.division || 'D1',
          displayName: profileDisplayName || `Player${p.jersey_number != null ? ` #${p.jersey_number}` : ''}`,
        }));
        setPlayerProfiles(profiles);
        if (!availablePlayers.length) {
          setHero(null);
          setNextGame(null);
          setLastGame(null);
          setGameLogs([]);
          setMyTeamName('');
          setMyTeamLogo('');
          setSeasonRecord(null);
          setSelectedPlayerId(null);
          setCareerTrophies([]);
          setAwardBadges([]);
          setPlayerBadges([]);
          setCurrentSeasonHeroStats(null);
          setHeroActiveInCurrentSeason(false);
          setLoadingHero(false);
          return;
        }
        const resolvePlayerId = () => {
          if (preferredPlayerId && availablePlayers.some((p) => p.id === preferredPlayerId)) {
            return preferredPlayerId;
          }
          const seasonMatch = seasonRow ? availablePlayers.find((p) => p.season_id === seasonRow.id) : null;
          if (seasonMatch) return seasonMatch.id;
          return availablePlayers[0].id;
        };
        const activePlayerId = resolvePlayerId();
        setSelectedPlayerId(activePlayerId);
        const playerRow = availablePlayers.find((p) => p.id === activePlayerId) || null;

        if (!playerRow) {
          // No player for this user; clear cached team so the UI shows "no team"
          try {
            localStorage.removeItem('courtsight_last_team_id');
            localStorage.removeItem(`courtsight_last_team_id_${stored.id}`);
          } catch {}
          setLastTeamId(null);
          setHero(null);
          setCareerTrophies([]);
          setAwardBadges([]);
          setPlayerBadges([]);
          setCurrentSeasonHeroStats(null);
          setHeroActiveInCurrentSeason(false);
          setSeasonRecord(null);
          setLoadingHero(false);
          return;
        }

        // If payment status is stored on players, use it as a fallback (especially after admin updates)
        const playerPayment = asPaymentStatus((playerRow as any)?.payment_status);
        if (playerPayment && (resolvedPayment !== 'paid' || playerPayment === 'paid')) {
          resolvedPayment = playerPayment;
          persistPaymentStatus(resolvedPayment);
        }

        // Align seasonLabel to player's season if different
        if (!playerRow.season_id || playerRow.season_id !== seasonRow.id) {
          const { data: playerSeason } = await supabase
            .from('seasons')
            .select('id,name,year')
            .eq('id', playerRow.season_id)
            .maybeSingle();
          if (playerSeason) {
            seasonRow = playerSeason as any;
          }
        }
        const trophySeasonLabel = formatSeasonLabel(seasonRow);
        const buildBadgeUrl = (path: string) =>
          supabase.storage.from('public-assets').getPublicUrl(path).data.publicUrl;
        const toNumber = (value: any) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : 0;
        };
        const badgeSettings = await loadBadgeSettings();
        const playerTrophyCategories = badgeSettings.playerMilestones.map((category) => ({
          key: category.key as PlayerTrophyCategoryKey,
          label: category.label,
          thresholds: category.thresholds,
          filePrefix: category.filePrefix,
        }));
        const playerMilestoneBadgeFiles = badgeSettings.playerMilestones.reduce(
          (acc, category) => {
            acc[category.key as PlayerTrophyCategoryKey] = category.badgeFiles;
            return acc;
          },
          {
            points: DEFAULT_PLAYER_BADGE_SETTINGS.playerMilestones.find((category) => category.key === 'points')
              ?.badgeFiles || {},
            assists: DEFAULT_PLAYER_BADGE_SETTINGS.playerMilestones.find((category) => category.key === 'assists')
              ?.badgeFiles || {},
            rebounds: DEFAULT_PLAYER_BADGE_SETTINGS.playerMilestones.find((category) => category.key === 'rebounds')
              ?.badgeFiles || {},
            steals: DEFAULT_PLAYER_BADGE_SETTINGS.playerMilestones.find((category) => category.key === 'steals')
              ?.badgeFiles || {},
            blocks: DEFAULT_PLAYER_BADGE_SETTINGS.playerMilestones.find((category) => category.key === 'blocks')
              ?.badgeFiles || {},
          } as Record<PlayerTrophyCategoryKey, Partial<Record<TrophyTierName, string>>>
        );
        const playerAwardBadges = badgeSettings.playerAwards.map((award) => ({
          key: award.key,
          label: award.label,
          file: award.file,
        }));

        let allPlayerStats: any[] = [];
        if (playerIds.length) {
          try {
            const { data: statsData } = await supabase
              .from('game_stats')
              .select(
                'id,player_id,game_id,team_id,points,rebounds,assists,steals,blocks,turnovers,fgm,fga,tpm,tpa,ftm,fta,created_at'
              )
              .in('player_id', playerIds);
            allPlayerStats = statsData || [];
          } catch (err) {
            console.warn('Load player stats failed', err);
          }
        }
        if (!allPlayerStats.length && playerRow?.id) {
          try {
            const { data: fallbackStats } = await supabase
              .from('game_stats')
              .select(
                'id,player_id,game_id,team_id,points,rebounds,assists,steals,blocks,turnovers,fgm,fga,tpm,tpa,ftm,fta,created_at'
              )
              .eq('player_id', playerRow.id);
            allPlayerStats = fallbackStats || [];
          } catch (err) {
            console.warn('Load fallback player stats failed', err);
          }
        }

        const loadPlayerTrophies = async (
          statRows: any[],
          gameDateMap: Map<string, string>
        ) => {
          const totals: Record<PlayerTrophyCategoryKey, number> = {
            points: 0,
            assists: 0,
            rebounds: 0,
            steals: 0,
            blocks: 0,
          };
          const unlockDates: Record<PlayerTrophyCategoryKey, Partial<Record<TrophyTierName, string>>> = {
            points: {},
            assists: {},
            rebounds: {},
            steals: {},
            blocks: {},
          };

          const statLines: Array<
            Record<PlayerTrophyCategoryKey, number> & { dateValue: string | null; timestamp: number }
          > = statRows.map((row) => {
            const points = toNumber(row.points ?? row.pts);
            const assists = toNumber(row.assists ?? row.ast);
            const rebounds = toNumber(row.rebounds ?? row.reb);
            const steals = toNumber(row.steals ?? row.stl);
            const blocks = toNumber(row.blocks ?? row.blk);
            const dateValue = gameDateMap.get(row.game_id) || row.created_at || null;
            const rawTime = dateValue ? new Date(dateValue).getTime() : Number.MAX_SAFE_INTEGER;
            const timestamp = Number.isNaN(rawTime) ? Number.MAX_SAFE_INTEGER : rawTime;
            totals.points += points;
            totals.assists += assists;
            totals.rebounds += rebounds;
            totals.steals += steals;
            totals.blocks += blocks;
            return { points, assists, rebounds, steals, blocks, dateValue, timestamp };
          });

          statLines.sort((a, b) => a.timestamp - b.timestamp);

          const playerInfoMap: Record<
            string,
            {
              seasonId?: string | null;
              seasonLabel: string;
              teamId?: string | null;
              teamLabel: string;
              division: string;
            }
          > = {};
          profiles.forEach((p) => {
            playerInfoMap[p.id] = buildPlayerInfo(
              p.teamId || null,
              p.seasonId || null,
              p.seasonLabel,
              p.teamLabel,
              p.division
            );
          });

          const careerAccumulator: Record<
            string,
            { row: CareerStatRow; games: Set<string> }
          > = {};
          const addToCareerMap = (info: ReturnType<typeof buildPlayerInfo>) => {
            const seasonKey = info.seasonId || info.seasonLabel || 'unknown';
            const teamKey = info.teamId || info.teamLabel || 'team';
            const divisionKey = (info.division || 'D1').toUpperCase();
            const key = `${seasonKey}|${teamKey}|${divisionKey}`;
            if (!careerAccumulator[key]) {
              careerAccumulator[key] = {
            row: {
              seasonLabel: info.seasonLabel,
              teamLabel: info.teamLabel,
              seasonId: info.seasonId,
              division: divisionKey,
                  divisionLabel: info.division || 'D1',
                  divisionKey,
                  gp: 0,
                  pts: 0,
                  reb: 0,
                  ast: 0,
                  stl: 0,
                  blk: 0,
                  tov: 0,
                  fgm: 0,
                  fga: 0,
                  tpm: 0,
                  tpa: 0,
                  ftm: 0,
                  fta: 0,
                  teamId: info.teamId,
                  teamLogo: resolveTeamLogo(info.teamId, info.teamLabel),
                },
                games: new Set<string>(),
              };
            }
            return { key, entry: careerAccumulator[key] };
          };
          // Seed career rows from team memberships so new/active teams show up even before stats exist.
          profiles.forEach((profile) => {
            const info = playerInfoMap[profile.id];
            if (!info?.teamId) return;
            addToCareerMap(info);
          });
          const getOrCreatePlayerInfo = (playerId: string, row?: any) => {
            if (!playerId) return null;
            if (playerInfoMap[playerId]) return playerInfoMap[playerId];
            const seasonId = row?.season_id || null;
            const teamId = row?.team_id || null;
            const seasonLabel =
              row?.season_label ||
              (seasonId ? seasonLookup[seasonId] : '') ||
              formatSeasonLabel();
            const teamLabel = row?.team_name || teamDirectory[teamId || '']?.name || 'Team';
            const fallbackDivision =
              row?.division ||
              row?.division_label ||
              (teamId ? teamDirectory[teamId]?.division : undefined);
            const info = buildPlayerInfo(
              teamId,
              seasonId,
              seasonLabel,
              teamLabel,
              fallbackDivision
            );
            playerInfoMap[playerId] = info;
            return info;
          };
          const resolveInfoForStatRow = (row: any) => {
            const statTeamId = row?.team_id || null;
            const statSeasonId = row?.season_id || null;
            const hasExplicitTeamContext = !!(
              statTeamId ||
              row?.team_name ||
              row?.division ||
              row?.division_label ||
              row?.season_label ||
              row?.season_name
            );
            // Keep team/division splits from each stat row.
            // Reusing only player-level info can merge different teams into one row.
            if (hasExplicitTeamContext || statSeasonId) {
              const seasonLabel =
                row?.season_label ||
                row?.season_name ||
                (statSeasonId ? seasonLookup[statSeasonId] : undefined) ||
                formatSeasonLabel();
              const teamLabel =
                row?.team_name ||
                (statTeamId ? teamDirectory[statTeamId]?.name || 'Team' : 'Team');
              const fallbackDivision =
                row?.division ||
                row?.division_label ||
                (statTeamId ? teamDirectory[statTeamId]?.division : undefined);
              return buildPlayerInfo(
                statTeamId,
                statSeasonId,
                seasonLabel,
                teamLabel,
                fallbackDivision
              );
            }
            return getOrCreatePlayerInfo(row?.player_id, row);
          };
          const missingPlayerIds = Array.from(
            new Set(statRows.map((row) => row.player_id).filter((id) => id && !playerInfoMap[id]))
          );
          if (missingPlayerIds.length) {
            try {
              const { data: missingPlayers } = await supabase
                .from('players')
                .select('id,team_id,season_id')
                .in('id', missingPlayerIds);
              (missingPlayers || []).forEach((p) => {
                const info = buildPlayerInfo(
                  p.team_id || null,
                  p.season_id || null,
                  p.season_id ? seasonLookup[p.season_id] : undefined,
                  p.team_id ? teamDirectory[p.team_id]?.name || 'Team' : 'Team',
                  p.team_id ? teamDirectory[p.team_id]?.division || 'D1' : undefined
                );
                playerInfoMap[p.id] = info;
              });
            } catch {
              // ignore fallback failures
            }
          }
          statRows.forEach((row, rowIndex) => {
            const info = resolveInfoForStatRow(row);
            if (!info) return;
                  const { entry } = addToCareerMap(info);
                  const safeNumber = (val: any) => {
                    const parsed = Number(val);
                    return Number.isFinite(parsed) ? parsed : 0;
                  };
            entry.row.pts += safeNumber(row.points ?? row.pts);
            entry.row.reb += safeNumber(row.rebounds ?? row.reb);
            entry.row.ast += safeNumber(row.assists ?? row.ast);
            entry.row.stl += safeNumber(row.steals ?? row.stl);
            entry.row.blk += safeNumber(row.blocks ?? row.blk);
            entry.row.tov += safeNumber(row.turnovers ?? row.tov);
            entry.row.fgm += safeNumber(row.fgm);
            entry.row.fga += safeNumber(row.fga);
            entry.row.tpm += safeNumber(row.tpm);
            entry.row.tpa += safeNumber(row.tpa);
            entry.row.ftm += safeNumber(row.ftm);
            entry.row.fta += safeNumber(row.fta);
            const safeGameId = row.game_id || row.id || `stat-${rowIndex}`;
            entry.games.add(String(safeGameId));
          });
          const careerRows = Object.values(careerAccumulator).map(({ row, games }) => ({
            ...row,
            gp: games.size,
          }));
          if (import.meta.env.DEV) {
            console.debug('career rows computed', careerRows);
          }
          setCareerStats(
            [...careerRows]
              .sort((a, b) => {
                const resolveChronology = (row: CareerStatRow) => {
                  const seasonLabelFromId = row.seasonId ? seasonLookup[row.seasonId] || '' : '';
                  const labelChronology = Math.max(
                    seasonLabelChronologyValue(row.seasonLabel),
                    seasonLabelChronologyValue(seasonLabelFromId)
                  );
                  if (labelChronology > 0) return labelChronology;

                  const startValue = row.seasonId ? seasonStartLookup[row.seasonId] || 0 : 0;
                  if (startValue > 0) {
                    const date = new Date(startValue);
                    const year = date.getUTCFullYear();
                    const month = date.getUTCMonth() + 1;
                    const seasonOrder = month <= 3 ? 1 : month <= 6 ? 2 : month <= 8 ? 3 : 4;
                    return year * 10 + seasonOrder;
                  }
                  return 0;
                };

                const aChronology = resolveChronology(a);
                const bChronology = resolveChronology(b);
                if (bChronology !== aChronology) return bChronology - aChronology;

                const aSeasonLabel = a.seasonId ? seasonLookup[a.seasonId] || a.seasonLabel || '' : a.seasonLabel || '';
                const bSeasonLabel = b.seasonId ? seasonLookup[b.seasonId] || b.seasonLabel || '' : b.seasonLabel || '';
                const seasonLabelDiff = bSeasonLabel.localeCompare(aSeasonLabel, undefined, {
                  numeric: true,
                  sensitivity: 'base',
                });
                if (seasonLabelDiff !== 0) return seasonLabelDiff;

                const labelA = a.seasonLabel || '';
                const labelB = b.seasonLabel || '';
                const fallbackLabelDiff = labelB.localeCompare(labelA, undefined, {
                  numeric: true,
                  sensitivity: 'base',
                });
                if (fallbackLabelDiff !== 0) return fallbackLabelDiff;
                if (b.gp !== a.gp) return b.gp - a.gp;
                return (a.teamLabel || '').localeCompare(b.teamLabel || '', undefined, {
                  sensitivity: 'base',
                });
              })
          );

          playerTrophyCategories.forEach((category) => {
            let runningTotal = 0;
            const thresholds = category.thresholds;
            const tierQueue = [...TROPHY_TIERS];
            statLines.forEach((line) => {
              runningTotal += line[category.key];
              while (tierQueue.length) {
                const tier = tierQueue[0];
                const threshold = thresholds[TROPHY_TIERS.indexOf(tier)];
                if (runningTotal >= threshold && !unlockDates[category.key][tier]) {
                  if (line.dateValue) {
                    unlockDates[category.key][tier] = line.dateValue;
                  }
                  tierQueue.shift();
                  continue;
                }
                break;
              }
            });
          });

          const categoryViews: PlayerTrophyCategoryView[] = playerTrophyCategories.map((category) => {
            const tiers = category.thresholds.map((threshold, idx) => {
              const tier = TROPHY_TIERS[idx];
              const unlocked = totals[category.key] >= threshold;
              const overrideFile = playerMilestoneBadgeFiles[category.key]?.[tier];
              const badgeFile = overrideFile || `${category.filePrefix}-${tier.toLowerCase()}.png`;
              return {
                tier,
                threshold,
                unlocked,
                unlockedAt: unlockDates[category.key][tier],
                badgeUrl: buildBadgeUrl(`badges/${badgeFile}`),
              };
            });
            const highestUnlocked = [...tiers].reverse().find((tier) => tier.unlocked);
            const nextTier = tiers.find((tier) => !tier.unlocked);
            const nextTierData = nextTier
              ? {
                  tier: nextTier.tier,
                  threshold: nextTier.threshold,
                  remaining: Math.max(nextTier.threshold - totals[category.key], 0),
                  progress: Math.min(totals[category.key] / nextTier.threshold, 1),
                }
              : undefined;
            return {
              key: category.key,
              label: category.label,
              total: totals[category.key],
              tiers,
              highestUnlocked,
              nextTier: nextTierData,
            };
          });
          setCareerTrophies(categoryViews);

          let awards: PlayerAwardBadge[] = [];
          try {
            if (seasonRow?.id) {
              const { data: awardRow, error: awardErr } = await supabase
                .from(PLAYER_TROPHY_TABLE)
                .select('season_id,mvp_player_id,dpos_player_id,finals_mvp_player_id,mip_player_id,updated_at')
                .eq('season_id', seasonRow.id)
                .maybeSingle();
              if (awardErr) throw awardErr;
              if (awardRow && playerRow?.id) {
                const awardMap: Record<string, string | null | undefined> = {
                  mvp: awardRow.mvp_player_id,
                  dpos: awardRow.dpos_player_id,
                  'finals-mvp': awardRow.finals_mvp_player_id,
                  mip: awardRow.mip_player_id,
                };
                awards = playerAwardBadges.filter((award) => awardMap[award.key] === playerRow.id).map(
                  (award) => ({
                    key: award.key,
                    label: award.label,
                    seasonLabel: trophySeasonLabel,
                    assignedAt: awardRow.updated_at || undefined,
                    url: buildBadgeUrl(`badges/${award.file}`),
                  })
                );
              }
            }
          } catch (err) {
            console.warn('Load player awards failed', err);
          }
          setAwardBadges(awards);

          const milestoneBadges: PlayerBadgeItem[] = categoryViews.flatMap((category) => {
            const nextTierLabel = category.nextTier
              ? `Next ${category.nextTier.tier} at ${category.nextTier.threshold} (${category.nextTier.remaining} to go)`
              : 'Max tier unlocked';
            return category.tiers
              .filter((tier) => tier.unlocked)
              .map((tier) => {
                const fallbackUrl = buildBadgePlaceholder(category.label, tier.tier, getTierColor(tier.tier));
                return {
                  key: `${category.key}-${tier.tier.toLowerCase()}`,
                  label: `${category.label} ${tier.tier}`,
                  url: tier.badgeUrl || fallbackUrl,
                  fallbackUrl,
                  tooltip: [
                    `${category.label} ${tier.tier}`,
                    `Unlocked: ${formatTrophyDate(tier.unlockedAt) || 'Date TBD'}`,
                    `Total: ${category.total}`,
                    nextTierLabel,
                  ].join('\n'),
                };
              });
          });

          const awardBadgeItems: PlayerBadgeItem[] = awards.map((award) => {
            const lines = AWARD_PLACEHOLDER_LINES[award.key] || [award.label, ''];
            const fallbackUrl = buildBadgePlaceholder(lines[0], lines[1], '#e1ff2b');
            return {
              key: `award-${award.key}`,
              label: award.label,
              url: award.url || fallbackUrl,
              fallbackUrl,
              tooltip: [
                `${award.seasonLabel} - ${award.label}`,
                award.assignedAt ? formatTrophyDate(award.assignedAt) : 'Date TBD',
              ].join('\n'),
            };
          });

          setPlayerBadges([...milestoneBadges, ...awardBadgeItems]);
        };

        // Ensure we have a team name even if the relation didn't hydrate
        let teamName = playerRow.teams?.name || null;
        if (!teamName && playerRow.team_id) {
          teamName = teamDirectory[playerRow.team_id]?.name || null;
        }
        setMyTeamName(teamName || '');
        setMyTeamLogo((playerRow.team_id && teamDirectory[playerRow.team_id]?.logo) || '');

        // Persist team id for My Team fallback
        if (playerRow.team_id) {
          try {
            localStorage.setItem('courtsight_last_team_id', playerRow.team_id);
            localStorage.setItem(`courtsight_last_team_id_${stored.id}`, playerRow.team_id);
            setLastTeamId(playerRow.team_id);
          } catch {}
        }

        setNextGame(null);
        setLastGame(null);
        setGameLogs([]);
        setSeasonRecord(null);

        const allTrackedTeams = Array.from(
          new Set(
            [
              ...(playerRow.team_id ? [playerRow.team_id] : []),
              ...trackedTeamIds.filter(Boolean),
            ].filter(Boolean)
          )
        );
        const effectiveTeamIds = allTrackedTeams;
        const relevantSeasonIds = Array.from(
          new Set(
            availablePlayers
              .map((p) => p.season_id || (p.team_id ? teamDirectory[p.team_id]?.seasonId : null))
              .filter(Boolean)
          )
        ) as string[];
        const gameSeasonLookup = new Map<string, string | null>();
        const trophyGameDateMap = new Map<string, string>();
        const gameDetailsById = new Map<string, any>();

        if (effectiveTeamIds.length) {
          const orClauses = effectiveTeamIds
            .map((id) => [`home_team_id.eq.${id}`, `away_team_id.eq.${id}`])
            .flat()
            .join(',');
          let gamesQuery = supabase
            .from('games')
            .select(
              'id,season_id,game_datetime,location,court_name,home_team_id,away_team_id,home_score,away_score,status'
            )
            .or(orClauses);
          if (relevantSeasonIds.length) {
            gamesQuery = gamesQuery.in('season_id', relevantSeasonIds);
          }
          const { data: gameRows } = await gamesQuery.order('game_datetime', { ascending: true });

          if (gameRows) {
            // Basic record for the currently-selected team in the selected season (best-effort).
            try {
              const recordTeamId = playerRow.team_id || null;
              const recordSeasonId = seasonRow?.id || null;
              if (recordTeamId) {
                let wins = 0;
                let losses = 0;
                (gameRows as any[]).forEach((g) => {
                  const status = (g?.status || '').toUpperCase();
                  if (status !== 'COMPLETED') return;
                  if (recordSeasonId && g?.season_id && g.season_id !== recordSeasonId) return;
                  if (g?.home_team_id !== recordTeamId && g?.away_team_id !== recordTeamId) return;
                  const hs = g?.home_score;
                  const as = g?.away_score;
                  if (hs == null || as == null) return;
                  const isHome = g.home_team_id === recordTeamId;
                  const isWin = (isHome && hs > as) || (!isHome && as > hs);
                  const isLoss = (isHome && hs < as) || (!isHome && as < hs);
                  if (isWin) wins += 1;
                  if (isLoss) losses += 1;
                });
                setSeasonRecord({ wins, losses });
              } else {
                setSeasonRecord(null);
              }
            } catch {
              setSeasonRecord(null);
            }

            const now = new Date();
            const mappedGames = (gameRows as any[]).map((g) => {
              const playerTeamId = effectiveTeamIds.includes(g.home_team_id)
                ? g.home_team_id
                : effectiveTeamIds.includes(g.away_team_id)
                ? g.away_team_id
                : effectiveTeamIds[0];
              const opponentId = playerTeamId === g.home_team_id ? g.away_team_id : g.home_team_id;
              const opponent = teamDirectory[opponentId] || { name: 'Opponent', logo: '' };
              const myTeam = teamDirectory[playerTeamId || playerRow.team_id] || {
                name: teamName || playerRow.teams?.name || 'Team',
                logo: '',
              };

              let dt: Date | null = null;
              let fixedDate = '';
              let fixedTime = '';
              if (g.game_datetime) {
                const d = new Date(g.game_datetime);
                dt = Number.isNaN(d.getTime()) ? null : d;
                if (dt) {
                  const parts = getFixedScheduleDateTimeParts(g.game_datetime);
                  fixedDate = parts.date;
                  fixedTime = parts.time;
                }
              } else if (g.date) {
                const iso = g.time ? `${g.date}T${g.time}` : `${g.date}`;
                const d = new Date(iso);
                dt = Number.isNaN(d.getTime()) ? null : d;
                fixedDate = g.date || '';
                fixedTime = g.time || '';
              }
              if (g.id) {
                gameSeasonLookup.set(g.id, g.season_id || null);
                if (dt) {
                  trophyGameDateMap.set(g.id, dt.toISOString());
                }
                gameDetailsById.set(String(g.id), {
                  ...g,
                  rawDate: dt,
                  date: g.date || fixedDate,
                  time: g.time || fixedTime,
                });
              }

              const displayDate = g.date || fixedDate;
              const displayTime = g.time || fixedTime;
              return {
                id: g.id,
                date: displayDate,
                time: displayTime,
                location: g.location || g.court_name || '',
                opponentName: opponent.name,
                opponentId: opponentId || null,
                opponentLogo:
                  opponent.logo ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    opponent.name
                  )}&background=111827&color=10b981`,
                homeLogo:
                  teamDirectory[g.home_team_id]?.logo ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(teamDirectory[g.home_team_id]?.name || 'Home Team')}&background=111827&color=10b981`,
                awayLogo:
                  teamDirectory[g.away_team_id]?.logo ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(teamDirectory[g.away_team_id]?.name || 'Away Team')}&background=111827&color=10b981`,
                myTeamLogo:
                  myTeam.logo ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    myTeam.name || 'Team'
                  )}&background=111827&color=10b981`,
                myTeamId: playerTeamId || playerRow.team_id || null,
                myTeamLabel: myTeam.name || teamName || playerRow.teams?.name || 'Team',
                isHome: playerTeamId === g.home_team_id,
                homeScore: g.home_score ?? null,
                awayScore: g.away_score ?? null,
                rawDate: dt,
                status: (g.status || '').toUpperCase(),
              } as any;
            });

            const scheduled = mappedGames.filter((g) => g.status === 'SCHEDULED');
            const withDates = scheduled.filter((g) => g.rawDate);
            const withoutDates = scheduled.filter((g) => !g.rawDate);
            const upcoming = withDates
              .filter((g) => (g.rawDate as Date).getTime() >= now.getTime())
              .sort((a, b) => (a.rawDate as Date).getTime() - (b.rawDate as Date).getTime());
            const completed = mappedGames
              .filter((g) => g.status === 'COMPLETED')
              .sort((a, b) => (b.rawDate as Date).getTime() - (a.rawDate as Date).getTime());

            const nextPick = upcoming[0] || withoutDates[0];
            if (nextPick) {
              setNextGame({
                id: nextPick.id,
                date: nextPick.date,
                time: nextPick.time,
                location: nextPick.location,
                opponentName: nextPick.opponentName,
                opponentId: nextPick.opponentId,
                opponentLogo: nextPick.opponentLogo,
                myTeamId: nextPick.myTeamId,
                myTeamLabel: nextPick.myTeamLabel,
                isHome: nextPick.isHome,
                homeScore: nextPick.homeScore,
                awayScore: nextPick.awayScore,
              });
            }

            if (completed[0]) {
              const c = completed[0];
              setLastGame({
                id: c.id,
                date: c.date,
                time: c.time,
                location: c.location,
                opponentName: c.opponentName,
                opponentId: c.opponentId,
                opponentLogo: c.opponentLogo,
                myTeamId: c.myTeamId,
                myTeamLabel: c.myTeamLabel,
                isHome: c.isHome,
                homeScore: c.homeScore,
                awayScore: c.awayScore,
              });
            }
          }
        }

        const referencedGameIds = Array.from(
          new Set(allPlayerStats.map((row) => row.game_id).filter(Boolean).map((id) => String(id)))
        );
        const missingGameIds = referencedGameIds.filter((id) => !gameSeasonLookup.has(id));
        if (missingGameIds.length) {
          const { data: missingGameRows } = await supabase
            .from('games')
            .select(
              'id,season_id,game_datetime,location,court_name,home_team_id,away_team_id,home_score,away_score,status'
            )
            .in('id', missingGameIds);
          (missingGameRows || []).forEach((game: any) => {
            if (!game?.id) return;
            gameSeasonLookup.set(game.id, game.season_id || null);
            let resolvedDate: Date | null = null;
            let dateValue = '';
            let fixedDate = '';
            let fixedTime = '';
            if (game.game_datetime) {
              const dt = new Date(game.game_datetime);
              if (!Number.isNaN(dt.getTime())) {
                resolvedDate = dt;
                dateValue = dt.toISOString();
                const parts = getFixedScheduleDateTimeParts(game.game_datetime);
                fixedDate = parts.date;
                fixedTime = parts.time;
              }
            }
            if (!dateValue && game.date) {
              const iso = game.time ? `${game.date}T${game.time}` : game.date;
              const dt = new Date(iso);
              if (!Number.isNaN(dt.getTime())) {
                resolvedDate = dt;
                dateValue = dt.toISOString();
              }
              fixedDate = game.date || '';
              fixedTime = game.time || '';
            }
            if (dateValue) {
              trophyGameDateMap.set(game.id, dateValue);
            }
            gameDetailsById.set(String(game.id), {
              ...game,
              rawDate: resolvedDate,
              date: game.date || fixedDate,
              time: game.time || fixedTime,
            });
          });
        }

        const logs: GameLogRow[] = [];
        allPlayerStats.forEach((stat: any, rowIndex: number) => {
          const gameId = stat?.game_id ? String(stat.game_id) : '';
          if (!gameId) return;
          const g = gameDetailsById.get(gameId);
          if (!g) return;
          const playerTeamId =
            stat?.team_id ||
            (effectiveTeamIds.includes(g.home_team_id) ? g.home_team_id : null) ||
            (effectiveTeamIds.includes(g.away_team_id) ? g.away_team_id : null) ||
            playerRow.team_id ||
            null;
          const opponentId =
            playerTeamId && g.home_team_id && g.away_team_id
              ? playerTeamId === g.home_team_id
                ? g.away_team_id
                : g.home_team_id
              : g.away_team_id || g.home_team_id || null;
          const opponent = teamDirectory[opponentId || ''] || { name: 'Opponent', logo: '' };
          const myTeam = teamDirectory[playerTeamId || ''] || {
            name: teamName || playerRow.teams?.name || 'Team',
            logo: '',
          };
          const isHome = !!playerTeamId && playerTeamId === g.home_team_id;
          const homeScore = g.home_score ?? null;
          const awayScore = g.away_score ?? null;
          const isWin =
            homeScore != null &&
            awayScore != null &&
            ((isHome && homeScore > awayScore) || (!isHome && awayScore > homeScore));
          const isLoss =
            homeScore != null &&
            awayScore != null &&
            ((isHome && homeScore < awayScore) || (!isHome && awayScore < homeScore));
          logs.push({
            id: `${gameId}-${rowIndex}`,
            gameId,
            date: g.date || '',
            time: g.time || '',
            location: g.location || g.court_name || '',
            seasonId: g.season_id || null,
            opponent: opponent.name || 'Opponent',
            opponentId: opponentId || null,
            myTeamId: playerTeamId || null,
            result: isWin ? 'W' : isLoss ? 'L' : 'TBD',
            resultColor: isWin ? 'win' : isLoss ? 'loss' : 'tbd',
            position: playerRow?.position || null,
            pts: stat.points ?? null,
            reb: stat.rebounds ?? null,
            ast: stat.assists ?? null,
            stl: stat.steals ?? null,
            blk: stat.blocks ?? null,
            fgm: stat.fgm ?? null,
            fga: stat.fga ?? null,
            tpm: stat.tpm ?? null,
            tpa: stat.tpa ?? null,
            ftm: stat.ftm ?? null,
            fta: stat.fta ?? null,
            tov: stat.turnovers ?? stat.tov ?? null,
            seasonLabel: (g.season_id && seasonLookup[g.season_id]) || '',
            fg: stat.fgm != null && stat.fga != null ? `${stat.fgm}/${stat.fga}` : undefined,
            three: stat.tpm != null && stat.tpa != null ? `${stat.tpm}/${stat.tpa}` : undefined,
            opponentLogo:
              opponent.logo ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                opponent.name || 'Opponent'
              )}&background=111827&color=10b981`,
            myTeamLogo:
              myTeam.logo ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                myTeam.name || 'Team'
              )}&background=111827&color=10b981`,
            myTeamLabel: myTeam.name || teamName || playerRow.teams?.name || 'Team',
            isHome,
            homeScore,
            awayScore,
          });
        });
        logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setGameLogs(logs);

        await loadPlayerTrophies(allPlayerStats, trophyGameDateMap);

        // 3) Simple averages from loaded game_stats
        const activePlayerStats = allPlayerStats.filter((row) => row.player_id === playerRow.id);
        const activeSeasonTotals = accumulateStatTotals(activePlayerStats, (row) => {
          if (!activeSeasonId) return false;
          if (!row.game_id) return false;
          return gameSeasonLookup.get(row.game_id) === activeSeasonId;
        });
        const hasActiveSeasonStats = Boolean(activeSeasonId && activeSeasonTotals.games > 0);
        if (hasActiveSeasonStats) {
          setCurrentSeasonHeroStats(buildHeroStatSetFromTotals(activeSeasonTotals));
          setHeroActiveInCurrentSeason(true);
          heroSeasonLabelCandidate = activeSeasonLabelLocal || formatSeasonLabel(seasonRow);
        } else {
          setCurrentSeasonHeroStats(null);
          setHeroActiveInCurrentSeason(false);
          heroSeasonLabelCandidate = formatSeasonLabel(seasonRow);
        }

        const totals = accumulateStatTotals(activePlayerStats);
        const gp = totals.games || 1;

        const seasonLabel = heroSeasonLabelCandidate || formatSeasonLabel(seasonRow);
        const teamLabel = teamName || playerRow.teams?.name || 'Team';
        const jerseyNumberRaw = playerRow.jersey_number ?? null;
        const jerseyNumber = normalizeJerseyNumberInput(jerseyNumberRaw);
        const resolvedPublicName = String(publicDisplayName || stored.name || '').trim();
        const publicNameFallback = resolvedPublicName || (jerseyNumber ? `Player #${jerseyNumber}` : 'Player');
        const publicNameLines = splitPublicDisplayName(publicNameFallback);
        let resolvedJersey = jerseyNumber ?? lastJerseyNumber ?? null;
        if (jerseyNumber) {
          try {
            localStorage.setItem('courtsight_last_jersey_number', jerseyNumber);
            localStorage.setItem(`courtsight_last_jersey_number_${stored.id}`, jerseyNumber);
          } catch {}
          setLastJerseyNumber(jerseyNumber);
          resolvedJersey = jerseyNumber;
        } else if (resolvedJersey == null) {
          // Look for any previous jersey number for this user to keep badge visible
          try {
            const { data: fallbackJersey } = await supabase
              .from('players')
              .select('jersey_number')
              .eq('user_id', stored.id)
              .not('jersey_number', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            const parsed = normalizeJerseyNumberInput(fallbackJersey?.jersey_number ?? null);
            if (parsed) {
              resolvedJersey = parsed;
              setLastJerseyNumber(parsed);
              try {
                localStorage.setItem('courtsight_last_jersey_number', parsed);
                localStorage.setItem(`courtsight_last_jersey_number_${stored.id}`, parsed);
              } catch {}
            }
          } catch {
            // ignore
          }
        }
        setHero({
          seasonLabel,
          teamLabel,
          jerseyNumber: resolvedJersey,
          nameLine1: publicNameLines.line1,
          nameLine2: publicNameLines.line2,
          ppg: (totals.pts / gp).toFixed(1),
          rpg: (totals.reb / gp).toFixed(1),
          apg: (totals.ast / gp).toFixed(1),
          spg: (totals.stl / gp).toFixed(1),
        });
      } catch (err) {
        console.error('Hero load error', err);
        setHero(null);
        setCurrentSeasonHeroStats(null);
        setHeroActiveInCurrentSeason(false);
      } finally {
        setLoadingHero(false);
        setLoadingTrophies(false);
      }
  }, [lastJerseyNumber, publicDisplayName]);

  useEffect(() => {
    loadHero(selectedPlayerId);
  }, [loadHero, selectedPlayerId, user?.id]);

  const fallbackPublicNameLines = splitPublicDisplayName(publicDisplayName || user?.name || 'Player');
  const effectiveHero: HeroData = hero || {
    seasonLabel: 'Season',
    teamLabel: 'No team linked',
    jerseyNumber: lastJerseyNumber,
    nameLine1: fallbackPublicNameLines.line1,
    nameLine2: fallbackPublicNameLines.line2,
    ppg: '0.0',
    rpg: '0.0',
    apg: '0.0',
    spg: '0.0',
  };
  const isPlaceholderHero = !hero;
  const statsToShow: HeroStatSet =
    heroActiveInCurrentSeason && currentSeasonHeroStats
      ? currentSeasonHeroStats
      : activeSeasonHeroStats || careerAverageStats;

  const shareTeamOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ id: string; label: string }> = [];
    gameLogs.forEach((log) => {
      const id = (log.myTeamId || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      options.push({
        id,
        label: (log.myTeamLabel || 'Team').trim() || 'Team',
      });
    });
    return options;
  }, [gameLogs]);

  useEffect(() => {
    if (!shareTeamOptions.length) {
      setShareTeamId('');
      return;
    }
    const exists = shareTeamOptions.some((option) => option.id === shareTeamId);
    if (!exists) {
      setShareTeamId(shareTeamOptions[0].id);
    }
  }, [shareTeamOptions, shareTeamId]);

  const shareGamesForTeam = useMemo(() => {
    if (!gameLogs.length) return [] as GameLogRow[];
    if (!shareTeamId) return gameLogs;
    return gameLogs.filter((log) => (log.myTeamId || '') === shareTeamId);
  }, [gameLogs, shareTeamId]);

  const shareGameOptions = useMemo(
    () =>
      shareGamesForTeam.map((game) => {
        const dateLabel = game.date
          ? formatScheduleDateLabel(game.date, { month: 'short', day: 'numeric' })
          : 'Date TBD';
        const timeLabel = game.time ? ` @ ${game.time}` : '';
        return {
          id: game.id,
          label: `${dateLabel}${timeLabel} vs ${game.opponent}`,
        };
      }),
    [shareGamesForTeam]
  );

  useEffect(() => {
    if (!shareGamesForTeam.length) {
      setShareGameId('');
      return;
    }
    const exists = shareGamesForTeam.some((log) => log.id === shareGameId);
    if (!exists) {
      setShareGameId(shareGamesForTeam[0].id);
    }
  }, [shareGamesForTeam, shareGameId]);

  const selectedShareGame = useMemo(
    () => shareGamesForTeam.find((log) => log.id === shareGameId) || shareGamesForTeam[0] || null,
    [shareGamesForTeam, shareGameId]
  );

  const selectedShareTeamLabel = useMemo(() => {
    if (shareTeamId) {
      const teamOption = shareTeamOptions.find((option) => option.id === shareTeamId);
      if (teamOption?.label) return teamOption.label;
    }
    return selectedShareGame?.myTeamLabel || myTeamName || effectiveHero.teamLabel || 'TEAM';
  }, [shareTeamId, shareTeamOptions, selectedShareGame?.myTeamLabel, myTeamName, effectiveHero.teamLabel]);

  const shareSummaryStats = useMemo(() => {
    const sourceRows = shareGamesForTeam.filter((row) => row.pts != null || row.reb != null || row.ast != null || row.stl != null);
    if (!sourceRows.length) {
      return {
        ppg: `${statsToShow.ppg}`,
        rpg: `${statsToShow.rpg}`,
        apg: `${statsToShow.apg}`,
      };
    }
    const toNumber = (value: number | null | undefined) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const totals = sourceRows.reduce(
      (acc, row) => {
        acc.pts += toNumber(row.pts);
        acc.reb += toNumber(row.reb);
        acc.ast += toNumber(row.ast);
        return acc;
      },
      { pts: 0, reb: 0, ast: 0 }
    );
    const gp = sourceRows.length || 1;
    return {
      ppg: formatDecimal(totals.pts / gp),
      rpg: formatDecimal(totals.reb / gp),
      apg: formatDecimal(totals.ast / gp),
    };
  }, [shareGamesForTeam, statsToShow.ppg, statsToShow.rpg, statsToShow.apg]);

  const shareRecordText = useMemo(() => {
    const wins = shareGamesForTeam.filter((row) => row.result === 'W').length;
    const losses = shareGamesForTeam.filter((row) => row.result === 'L').length;
    if (!shareGamesForTeam.length) {
      if (seasonRecord && (Number.isFinite(Number(seasonRecord.wins)) || Number.isFinite(Number(seasonRecord.losses)))) {
        return `${Number.isFinite(Number(seasonRecord.wins)) ? Number(seasonRecord.wins) : 0}-${
          Number.isFinite(Number(seasonRecord.losses)) ? Number(seasonRecord.losses) : 0
        }`;
      }
      return '-';
    }
    return `${wins}-${losses}`;
  }, [shareGamesForTeam, seasonRecord]);
  const joinDivisionOptions = useMemo(() => {
    if (!joinSeasonId) return ['ALL'];
    const divisions = new Set(
      allTeams
        .filter((t) => t.seasonId === joinSeasonId)
        .map((t) => (t.division || '').toUpperCase())
        .filter(Boolean)
    );
    return ['ALL', ...Array.from(divisions).sort()];
  }, [allTeams, joinSeasonId]);
  const normalizedJoinDivision = joinDivision === 'ALL' ? null : joinDivision;
  const joinedTeamIdsInSelection = useMemo(() => {
    if (!joinSeasonId || !normalizedJoinDivision) return [];
    return playerProfiles
      .filter(
        (profile) =>
          profile.seasonId === joinSeasonId &&
          (profile.division || 'D1').toUpperCase() === normalizedJoinDivision &&
          profile.teamId
      )
      .map((profile) => profile.teamId as string);
  }, [joinSeasonId, normalizedJoinDivision, playerProfiles]);
  const joinTeamsFiltered = useMemo(
    () => {
      if (!joinSeasonId) return [];
      return allTeams.filter(
        (t) =>
          t.seasonId === joinSeasonId &&
          (normalizedJoinDivision === null ||
            (t.division || '').toUpperCase() === normalizedJoinDivision) &&
          !joinedTeamIdsInSelection.includes(t.id)
      );
    },
    [allTeams, normalizedJoinDivision, joinSeasonId, joinedTeamIdsInSelection]
  );

  useEffect(() => {
    if (joinTeamsFiltered.length && !joinTeamId) {
      setJoinTeamId(joinTeamsFiltered[0].id);
    }
    if (!joinTeamsFiltered.length && joinTeamId) {
      setJoinTeamId('');
    }
  }, [joinTeamsFiltered, joinTeamId]);

  const alreadyJoinedSeasonDivision = useMemo(() => {
    if (!joinSeasonId || !normalizedJoinDivision) return false;
    return playerProfiles.some(
      (profile) =>
        profile.seasonId === joinSeasonId &&
        (profile.division || 'D1').toUpperCase() === normalizedJoinDivision
    );
  }, [joinSeasonId, normalizedJoinDivision, playerProfiles]);

  const handleJoinTeam = async () => {
    setJoinError(null);
    if (!user) {
      navigate('/login');
      return;
    }
    const normalizedCode = normalizeJoinCode(joinCodeInput);
    const matchedTeamByCode = normalizedCode
      ? allTeams.find(
          (team) =>
            normalizeJoinCode(team.shortName || '') === normalizedCode ||
            normalizeJoinCode(team.id || '') === normalizedCode
        ) || null
      : null;
    const resolvedSeasonId = matchedTeamByCode?.seasonId || joinSeasonId;
    const resolvedTeamId = matchedTeamByCode?.id || joinTeamId;
    const resolvedDivision = ((matchedTeamByCode?.division || joinDivision || 'ALL') as string).toUpperCase();
    const resolvedNormalizedDivision = resolvedDivision === 'ALL' ? null : resolvedDivision;
    const alreadyJoinedResolvedDivision =
      !!resolvedSeasonId &&
      !!resolvedNormalizedDivision &&
      playerProfiles.some(
        (profile) =>
          profile.seasonId === resolvedSeasonId &&
          (profile.division || 'D1').toUpperCase() === resolvedNormalizedDivision
      );

    if (alreadyJoinedResolvedDivision) {
      setJoinError('You already joined this season/division. Contact admin before switching teams.');
      return;
    }
    if (!resolvedSeasonId) {
      setJoinError('Please select a season or enter a valid team code.');
      return;
    }
    if (!resolvedTeamId) {
      setJoinError(normalizedCode ? 'Invalid team code. Ask your captain for the correct code.' : 'Please select a team.');
      return;
    }
    setJoinLoading(true);
    setLoadingHero(true);
    try {
      const parts = (user.name || 'Player').split(' ');
      const first = parts.shift() || 'Player';
      const last = parts.join(' ');
      const chosenTeam = allTeams.find((t) => t.id === resolvedTeamId);
      const chosenDivision = (chosenTeam?.division || '').toUpperCase();
      let divisionPlayers: any[] = [];
      try {
        const { data: divisionData } = await supabase
          .from('players')
          .select('id,team_id,teams(division)')
          .eq('user_id', user.id)
          .eq('season_id', resolvedSeasonId);
        divisionPlayers = divisionData || [];
      } catch {
        divisionPlayers = [];
      }
      if (chosenTeam && chosenDivision) {
        const existingDivisionPlayer = divisionPlayers.find(
          (player) =>
            (player.teams?.division || '').toUpperCase() === chosenDivision &&
            player.team_id !== resolvedTeamId
        );
        if (existingDivisionPlayer) {
          setJoinError(`You already joined a ${chosenDivision} division team for this season.`);
          setJoinLoading(false);
          setLoadingHero(false);
          return;
        }
      }
      const getTeamCaptainUserId = async (teamId: string) => {
        try {
          const { data } = await supabase
            .from('players')
            .select('user_id')
            .eq('team_id', teamId)
            .eq('is_captain', true)
            .maybeSingle();
          return data?.user_id || null;
        } catch {
          return null;
        }
      };

      const existingTeamPlayer = divisionPlayers.find((player) => player.team_id === resolvedTeamId);
      let playerIdToUpdate: string | null = null;
      if (existingTeamPlayer?.id) {
        playerIdToUpdate = existingTeamPlayer.id;
        const { error: updErr } = await supabase
          .from('players')
          .update({ team_id: resolvedTeamId })
          .eq('id', playerIdToUpdate);
        if (updErr) throw updErr;
      } else {
        const { data: latestPlayer, error: latestErr } = await supabase
          .from('players')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestErr) throw latestErr;
        if (!latestPlayer) {
          throw new Error('No player profile found. Please complete registration first.');
        }
        const payload: any = {
          user_id: user.id,
          season_id: resolvedSeasonId,
          team_id: resolvedTeamId,
          first_name: latestPlayer.first_name || first,
          last_name: latestPlayer.last_name || last,
          jersey_number: latestPlayer.jersey_number ?? null,
          position: latestPlayer.position ?? null,
          photo_url: latestPlayer.photo_url ?? null,
          is_captain: false,
          jersey_size: latestPlayer.jersey_size ?? null,
          shorts_size: latestPlayer.shorts_size ?? null,
          jersey_name: latestPlayer.jersey_name ?? null,
          referral_source: latestPlayer.referral_source ?? null,
          nba_comparison: latestPlayer.nba_comparison ?? null,
          instagram: latestPlayer.instagram ?? null,
          birth_date: latestPlayer.birth_date ?? null,
          phone: latestPlayer.phone ?? null,
        };
        const { data: inserted, error: insertErr } = await supabase
          .from('players')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (insertErr) throw insertErr;
        playerIdToUpdate = inserted?.id || null;
        if (!playerIdToUpdate) {
          throw new Error('Unable to create season profile.');
        }
      }
      // Notify team captain that a player joined (best effort)
      const captainId = resolvedTeamId ? await getTeamCaptainUserId(resolvedTeamId) : null;
      if (captainId) {
        createNotifications([
          {
            userId: captainId,
            role: null,
            teamId: resolvedTeamId,
            title: 'New Player Joined',
            body: `${first} ${last || ''} has joined your team ${chosenTeam?.name || ''}`.trim(),
            link: '/my-team',
            metadata: {
              teamId: resolvedTeamId,
              playerUserId: user.id,
            },
          },
        ]).catch((err) => console.warn('captain join notification failed', err));
      }
      // Optimistically update hero/team label so user sees change without manual refresh
      if (chosenTeam) {
        setMyTeamName(chosenTeam.name);
        setHero((prev) => {
          const nameParts = (user.name || '').split(' ');
          const fallbackFirst = nameParts.shift() || 'PLAYER';
          const fallbackLast = nameParts.join(' ');
          return (
            prev && {
              ...prev,
              teamLabel: chosenTeam.name,
              jerseyNumber: prev.jerseyNumber ?? lastJerseyNumber ?? null,
            }
          ) || {
            seasonLabel: 'Season',
            teamLabel: chosenTeam.name,
            jerseyNumber: lastJerseyNumber,
            nameLine1: fallbackFirst.toUpperCase(),
            nameLine2: fallbackLast.toUpperCase(),
            ppg: '0.0',
            rpg: '0.0',
            apg: '0.0',
            spg: '0.0',
          };
        });
      }
      setJoinOpen(false);
      setJoinLoading(false);
      try {
        localStorage.setItem('courtsight_last_team_id', resolvedTeamId);
        localStorage.setItem(`courtsight_last_team_id_${user.id}`, resolvedTeamId);
        setLastTeamId(resolvedTeamId);
      } catch {}
      setJoinCodeInput('');
      setJoinSeasonId(resolvedSeasonId);
      setJoinDivision(chosenDivision || resolvedDivision);
      setJoinTeamId(resolvedTeamId);
      if (playerIdToUpdate) {
        setSelectedPlayerId(playerIdToUpdate);
        await loadHero(playerIdToUpdate);
      } else {
        await loadHero(selectedPlayerId);
      }
    } catch (err: any) {
      console.error('Join team error', err);
      setJoinError(err?.message || 'Unable to join team. Please try again.');
      setJoinLoading(false);
      setLoadingHero(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      {loadingHero && <LoadingOverlay message="Loading..." />}
      <div className="max-w-6xl mx-auto">
        
        {/* --- HEADER SECTION --- */}
        <div className="relative bg-gradient-to-r from-brand-dark to-black border border-white/10 rounded-2xl p-8 mb-8 overflow-hidden flex flex-col md:flex-row items-center md:items-end justify-between gap-8">
          {/* Text Content */}
          <div className="relative z-10 w-full md:w-2/3">
            {/*
              Payment-based access banner temporarily disabled.
              Keep this block commented so it can be restored if needed.
            */}
            {/*
            {paymentStatus !== 'paid' && (
              <div className="mb-3 px-3 py-2 rounded-lg border border-yellow-400/60 bg-yellow-500/10 text-yellow-200 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-300 animate-pulse"></span>
                {paymentStatus === 'pending-stripe'
                  ? 'Stripe payment pending - limited access until confirmed.'
                  : paymentStatus === 'pending'
                  ? 'Payment pending - limited access until confirmed.'
                  : 'Payment status unknown - please contact admin.'}
              </div>
            )}
            */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <span className="bg-brand-lime text-black text-xs font-bold px-2 py-1 rounded uppercase">{activeSeasonLabel || effectiveHero.seasonLabel}</span>
                {displayJersey != null && (
                  <span className="px-3 py-1 rounded-full bg-brand-lime/15 text-white text-sm font-sports tracking-wide border border-brand-lime/40 shadow-sm">
                    #{displayJersey}
                  </span>
                )}
              </div>
              <Link
                to="/my-profile"
                className="md:hidden w-20 h-20 rounded-full overflow-hidden border-2 border-white/10 shadow-xl bg-black/40 flex items-center justify-center"
                title="Edit Profile"
              >
                <img
                  src={
                    resolvedProfileAvatarUrl ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(
                      effectiveHero.nameLine1 + ' ' + effectiveHero.nameLine2
                    )}&background=111827&color=10b981`
                  }
                  alt="Player"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                      effectiveHero.nameLine1 + ' ' + effectiveHero.nameLine2
                    )}&background=111827&color=10b981`;
                  }}
                />
              </Link>
            </div>
            <h1 className="font-sports text-5xl md:text-7xl font-bold text-white uppercase leading-none mb-2 tracking-tight">
              {effectiveHero.nameLine1}<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500 tracking-tight">
                {effectiveHero.nameLine2}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-gray-300 max-w-4xl">
              
              <div className="flex gap-2">
                {/*
                <button
                  type="button"
                  onClick={() => {
                    setJoinError(null);
                    setJoinCodeInput('');
                    setJoinOpen(true);
                  }}
                  className="inline-flex items-center gap-2 bg-brand-lime text-black font-sports font-bold uppercase tracking-wide px-4 py-2 rounded shadow-lg hover:scale-[1.01] transition-transform"
                >
                  <Users size={16} /> Join a Team
                </button>
                <Link
                  to="/register?type=team"
                  onClick={startCreateTeamFlow}
                  className="inline-flex items-center gap-2 bg-black border border-white/20 text-gray-100 font-sports font-bold uppercase tracking-wide px-4 py-2 rounded shadow-lg hover:border-white/60 hover:bg-white/10 transition-transform"
                >
                  <Users size={16} /> Create New Team
                </Link>
                */}
                {/* <Link
                  to="/my-profile"
                  className="inline-flex items-center gap-2 bg-black border border-white/20 text-gray-100 font-sports font-bold uppercase tracking-wide px-4 py-2 rounded shadow-lg hover:border-white/60 hover:bg-white/10 transition-transform"
                >
                  Edit Profile
                </Link> */}
              </div>
            </div>
            {playerBadges.length > 0 && (
              <div className="mt-3 w-full">
                <div className="sm:hidden">
                  <BadgeCylinderCarousel
                    items={playerBadges.map((badge) => ({
                      key: badge.key,
                      label: badge.label,
                      url: badge.url || badge.fallbackUrl,
                      tooltip: badge.tooltip,
                      fallbackUrl: badge.fallbackUrl,
                    }))}
                  />
                </div>

                <div className="hidden sm:flex sm:flex-wrap sm:justify-start sm:gap-3">
                  {playerBadges.map((badge) => (
                    <div key={badge.key} data-badge className="h-20 w-20 shrink-0 overflow-hidden md:h-24 md:w-24">
                      <img
                        src={badge.url || badge.fallbackUrl}
                        alt={`${badge.label} badge`}
                        title={badge.tooltip}
                        className="h-full w-full object-contain scale-[1.25] bg-transparent border-0 shadow-none outline-none ring-0"
                        loading="lazy"
                        onError={(e) => {
                          const target = e.currentTarget as HTMLImageElement;
                          if (target.dataset.fallbackApplied === '1') {
                            const wrapper = target.closest('[data-badge]') as HTMLElement | null;
                            if (wrapper) wrapper.style.display = 'none';
                            return;
                          }
                          target.dataset.fallbackApplied = '1';
                          if (badge.fallbackUrl) {
                            target.src = badge.fallbackUrl;
                          } else {
                            const wrapper = target.closest('[data-badge]') as HTMLElement | null;
                            if (wrapper) wrapper.style.display = 'none';
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isPlaceholderHero && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-gray-300 mb-4">
                Link your account to a team to see live stats.
              </div>
            )}
            
            {/* Season Averages Pill */}
            <div className="flex flex-wrap gap-4 md:gap-8">
                <div>
                  <div className="text-brand-grey text-xs uppercase font-bold mb-1">PPG</div>
                  <div className="font-sports text-4xl font-bold text-brand-lime">{statsToShow.ppg}</div>
                </div>
                <div>
                  <div className="text-brand-grey text-xs uppercase font-bold mb-1">RPG</div>
                  <div className="font-sports text-4xl font-bold text-white">{statsToShow.rpg}</div>
                </div>
                <div>
                  <div className="text-brand-grey text-xs uppercase font-bold mb-1">APG</div>
                  <div className="font-sports text-4xl font-bold text-white">{statsToShow.apg}</div>
                </div>
                <div>
                  <div className="text-brand-grey text-xs uppercase font-bold mb-1">SPG</div>
                  <div className="font-sports text-4xl font-bold text-white">{statsToShow.spg}</div>
                </div>
             </div>
          </div>

          {/* Optional player avatar */}
          <Link
            to="/my-profile"
            className="hidden md:flex absolute z-10 right-8 top-8 w-28 h-28 rounded-full overflow-hidden border-4 border-white/10 shadow-2xl bg-black/40 items-center justify-center"
            title="Edit Profile"
          >
            <img
              src={
                resolvedProfileAvatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(
                  effectiveHero.nameLine1 + ' ' + effectiveHero.nameLine2
                )}&background=111827&color=10b981`
              }
              alt="Player"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                  effectiveHero.nameLine1 + ' ' + effectiveHero.nameLine2
                )}&background=111827&color=10b981`;
              }}
            />
          </Link>
          
          {/* Background Decoration */}
          <div className="absolute top-0 right-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
        </div>

        {loadingTrophies && (
          <div className="text-sm text-brand-grey mb-6">Loading player badges...</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* --- NEXT GAME --- */}
          <div
            className={
              // Payment-based access styling temporarily disabled to allow pending users full access.
              // `relative bg-brand-dark border border-white/10 rounded-xl p-6 overflow-hidden group transition-colors ${paymentStatus !== 'paid' ? 'opacity-40 pointer-events-none blur-[2px]' : 'hover:border-brand-lime/50'}`
              'relative bg-brand-dark border border-white/10 rounded-xl p-6 overflow-hidden group transition-colors hover:border-brand-lime/50'
            }
          >
            <div className="flex items-center gap-2 mb-4 text-brand-lime font-bold uppercase text-sm">
               <Calendar size={16} /> Next Game
            </div>
              {nextGame ? (
                <div>
                   <div className="flex justify-between items-center mb-4">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-gray-800 rounded-full mb-2 mx-auto overflow-hidden">
                          <img
                            src={
                              nextGame.isHome
                                ? nextGame.homeLogo || nextGame.myTeamLogo || myTeamLogo
                                : nextGame.awayLogo || nextGame.opponentLogo || `https://ui-avatars.com/api/?name=${encodeURIComponent(nextGame.opponentName)}&background=111827&color=10b981`
                            }
                            alt={nextGame.isHome ? (myTeamName || effectiveHero.teamLabel) : nextGame.opponentName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        {nextGame.isHome ? (
                          nextGame.myTeamId ? (
                            <Link
                              to={teamPath(nextGame.myTeamId)}
                              className="font-sports text-xl font-bold text-white hover:text-brand-lime transition-colors"
                            >
                              {myTeamName || effectiveHero.teamLabel}
                            </Link>
                          ) : (
                            <span className="font-sports text-xl font-bold text-white">
                              {myTeamName || effectiveHero.teamLabel}
                            </span>
                          )
                        ) : nextGame.opponentId ? (
                          <Link
                            to={teamPath(nextGame.opponentId)}
                            className="font-sports text-xl font-bold text-white hover:text-brand-lime transition-colors"
                          >
                            {nextGame.opponentName}
                          </Link>
                        ) : (
                          <span className="font-sports text-xl font-bold text-white">{nextGame.opponentName}</span>
                        )}
                      </div>
                      <div className="text-2xl font-sports italic text-gray-500">VS</div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-gray-800 rounded-full mb-2 mx-auto overflow-hidden">
                          <img
                            src={
                              nextGame.isHome
                                ? nextGame.awayLogo || nextGame.opponentLogo || `https://ui-avatars.com/api/?name=${encodeURIComponent(nextGame.opponentName)}&background=111827&color=10b981`
                                : nextGame.homeLogo || nextGame.myTeamLogo || myTeamLogo
                            }
                            alt={nextGame.isHome ? nextGame.opponentName : (myTeamName || effectiveHero.teamLabel)}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        {nextGame.isHome ? (
                          nextGame.opponentId ? (
                            <Link
                              to={teamPath(nextGame.opponentId)}
                              className="font-sports text-xl font-bold text-white hover:text-brand-lime transition-colors"
                            >
                              {nextGame.opponentName}
                            </Link>
                          ) : (
                            <span className="font-sports text-xl font-bold text-white">{nextGame.opponentName}</span>
                          )
                        ) : nextGame.myTeamId ? (
                          <Link
                            to={teamPath(nextGame.myTeamId)}
                            className="font-sports text-xl font-bold text-white hover:text-brand-lime transition-colors"
                          >
                            {myTeamName || effectiveHero.teamLabel}
                          </Link>
                        ) : (
                          <span className="font-sports text-xl font-bold text-white">
                            {myTeamName || effectiveHero.teamLabel}
                          </span>
                        )}
                      </div>
                   </div>
                   <div className="bg-black/40 rounded p-3 text-center">
                      <div className="text-white font-bold text-lg mb-1">{formatScheduleDateLabel(nextGame.date, { month: 'short', day: 'numeric' })} @ {nextGame.time}</div>
                      <div className="text-gray-400 text-xs flex items-center justify-center gap-1">
                        <MapPin size={12} /> {nextGame.location}
                      </div>
                   </div>
                </div>
              ) : (
                <div className="text-gray-500 text-center py-8">No upcoming games scheduled.</div>
              )}
           </div>

          {/* --- LAST GAME STATS --- */}
          <div
            className={
              // Payment-based access styling temporarily disabled to allow pending users full access.
              // `relative bg-brand-dark border border-white/10 rounded-xl p-6 lg:col-span-2 ${paymentStatus !== 'paid' ? 'opacity-40 pointer-events-none blur-[2px]' : ''}`
              'relative bg-brand-dark border border-white/10 rounded-xl p-6 lg:col-span-2'
            }
          >
             <div className="flex items-center justify-between gap-4 mb-6">
               <div className="flex items-center gap-2 text-brand-red font-bold uppercase text-sm">
                  <Activity size={16} /> Last Game Performance
               </div>
               <button
                 type="button"
                 onClick={() => {
                   setShareOpen(true);
                 }}
                 className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-black/40 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-white/40 transition lg:min-w-[122px]"
                 title="Share your stats"
                 disabled={!selectedShareGame}
               >
                 <Share2 size={16} /> Share
               </button>
             </div>
              {lastGame ? (
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                   <div className="text-center md:text-left">
                      <div className="text-gray-400 text-sm mb-1">
                        vs{' '}
                        {lastGame.opponentId ? (
                          <Link
                            to={teamPath(lastGame.opponentId)}
                            className="text-gray-300 hover:text-brand-lime transition-colors"
                          >
                            {lastGame.opponentName}
                          </Link>
                        ) : (
                          lastGame.opponentName
                        )}
                      </div>
                      <div className="font-sports text-3xl font-bold text-white">
                        {lastGame.homeScore != null && lastGame.awayScore != null
                          ? `${(lastGame.isHome ? lastGame.homeScore : lastGame.awayScore) > (lastGame.isHome ? lastGame.awayScore : lastGame.homeScore) ? 'WIN' : 'LOSS'} `
                          : ''}
                        <span className="text-brand-grey text-xl">
                          {lastGame.homeScore != null && lastGame.awayScore != null
                            ? `${lastGame.homeScore}-${lastGame.awayScore}`
                            : 'Final'}
                        </span>
                      </div>
                   </div>
                   
                   <div className="flex gap-6">
                      <div className="text-center p-3 bg-white/5 rounded-lg min-w-[80px]">
                         <div className="text-3xl font-sports font-bold text-white">{lastGame.homeScore ?? '-'}</div>
                         <div className="text-xs text-gray-400 uppercase">{lastGame.isHome ? 'Our Score' : 'Home'}</div>
                      </div>
                      <div className="text-center p-3 bg-white/5 rounded-lg min-w-[80px]">
                         <div className="text-3xl font-sports font-bold text-white">{lastGame.awayScore ?? '-'}</div>
                         <div className="text-xs text-gray-400 uppercase">{lastGame.isHome ? 'Away' : 'Our Score'}</div>
                      </div>
                   </div>
                </div>
              ) : (
                <div className="text-gray-500">No games played yet.</div>
              )}
           </div>
        </div>

        <ShareStatsModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          selectors={{
            teamOptions: shareTeamOptions,
            selectedTeamId: shareTeamId,
            onTeamChange: setShareTeamId,
            gameOptions: shareGameOptions,
            selectedGameId: shareGameId,
            onGameChange: setShareGameId,
          }}
          data={{
            player: {
              name: `${(effectiveHero.nameLine1 || '').trim()} ${(effectiveHero.nameLine2 || '').trim()}`.trim() || 'PLAYER',
              teamLabel: selectedShareTeamLabel,
              seasonLabel: activeSeasonLabel || effectiveHero.seasonLabel || '',
              jerseyNumber: displayJersey ?? null,
              avatarUrl: resolvedProfileAvatarUrl || null,
            },
            lastGame: {
              result:
                selectedShareGame && selectedShareGame.homeScore != null && selectedShareGame.awayScore != null
                  ? (selectedShareGame.isHome ? selectedShareGame.homeScore : selectedShareGame.awayScore) >
                    (selectedShareGame.isHome ? selectedShareGame.awayScore : selectedShareGame.homeScore)
                    ? 'W'
                    : 'L'
                  : 'TBD',
              myTeamLabel: selectedShareGame?.myTeamLabel || selectedShareTeamLabel,
              myScore:
                selectedShareGame && selectedShareGame.homeScore != null && selectedShareGame.awayScore != null
                  ? `${selectedShareGame.isHome ? selectedShareGame.homeScore : selectedShareGame.awayScore}`
                  : null,
              opponentScore:
                selectedShareGame && selectedShareGame.homeScore != null && selectedShareGame.awayScore != null
                  ? `${selectedShareGame.isHome ? selectedShareGame.awayScore : selectedShareGame.homeScore}`
                  : null,
              opponentLabel: selectedShareGame?.opponent || 'Opponent',
              timeLabel: selectedShareGame?.time || null,
            },
            lastGameStats: {
              rows: [
                { key: 'pts', label: 'PTS', value: `${selectedShareGame?.pts ?? '-'}` },
                { key: 'reb', label: 'REB', value: `${selectedShareGame?.reb ?? '-'}` },
                { key: 'ast', label: 'AST', value: `${selectedShareGame?.ast ?? '-'}` },
                { key: 'stl', label: 'STL', value: `${selectedShareGame?.stl ?? '-'}` },
                { key: 'blk', label: 'BLK', value: `${selectedShareGame?.blk ?? '-'}` },
              ],
              shots: {
                fg: selectedShareGame?.fg ?? null,
                three: selectedShareGame?.three ?? null,
              },
            },
            seasonSummary: {
              title: 'SEASON SUMMARY',
              rows: [
                { key: 'ppg', label: 'PTS', value: `${shareSummaryStats.ppg}` },
                { key: 'rpg', label: 'REB', value: `${shareSummaryStats.rpg}` },
                { key: 'apg', label: 'AST', value: `${shareSummaryStats.apg}` },
              ],
              recordText: shareRecordText,
            },
            footer: {
              domainText: 'COURTSIGHT.CA',
              handleText: '@COURTSIGHTCA',
            },
          }}
        />

        {/* --- PLAYER STATS --- */}
        <div
          className={
            // Payment-based access styling temporarily disabled to allow pending users full access.
            // `relative bg-brand-dark border border-white/10 rounded-xl overflow-hidden ${paymentStatus !== 'paid' ? 'opacity-40 pointer-events-none blur-[2px]' : ''}`
            'relative bg-brand-dark border border-white/10 rounded-xl overflow-hidden'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.5em] text-brand-grey">Stats</p>
              <h3 className="font-sports text-2xl text-white uppercase tracking-wide">Career Overview</h3>
            </div>
            <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-[3px]">
              {STATS_TAB_OPTIONS.map((tab) => {
                const active = statsTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
                      active ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                    }`}
                    onClick={() => setStatsTab(tab.key)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="p-6">
            {statsTab === 'career' ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-white/60">Career Stats</div>
                    <p className="text-sm text-gray-400">All seasons & divisions</p>
                  </div>
                  {careerTotals && (
                    <div className="text-right text-xs text-gray-400 space-y-0.5">
                      <div>
                        Avg: {formatDecimal(careerTotals.pts / (careerTotals.gp || 1))} PPG •{' '}
                        {formatDecimal(careerTotals.reb / (careerTotals.gp || 1))} RPG •{' '}
                        {formatDecimal(careerTotals.ast / (careerTotals.gp || 1))} APG
                      </div>
                      <div>
                        FG%: {formatPercentage(careerTotals.fgm, careerTotals.fga)} • 3PT%:{' '}
                        {formatPercentage(careerTotals.tpm, careerTotals.tpa)} • FT%:{' '}
                        {formatPercentage(careerTotals.ftm, careerTotals.fta)}
                      </div>
                    </div>
                  )}
                </div>
                {careerRowsForDisplay.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-neutral-900 text-brand-grey font-sports uppercase text-[10px] sm:text-[11px]">
                        <tr>
                          <th
                            className="p-3 text-left border-r border-white/5"
                          >
                            Season
                          </th>
                          <th
                            className="p-3 text-left border-r border-white/5"
                          >
                            Team
                          </th>
                          <th
                            className="p-3 text-left border-r border-white/5"
                          >
                            Division
                          </th>
                          <th className="p-3 text-center">GP</th>
                          <th className="p-3 text-center">PPG</th>
                          <th className="p-3 text-center">RPG</th>
                          <th className="p-3 text-center">APG</th>
                          <th className="p-3 text-center">SPG</th>
                          <th className="p-3 text-center">BPG</th>
                          <th className="p-3 text-center">TOV</th>
                          <th className="p-3 text-center">FG%</th>
                          <th className="p-3 text-center">3PT%</th>
                          <th className="p-3 text-center">FT%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-gray-200">
                        {careerRowsForDisplay.map((row) => (
                          <tr
                            key={`${row.seasonLabel}-${row.teamLabel}-${row.teamId || 'anon'}`}
                          >
                            <td
                              className="p-3 font-semibold text-white border-r border-white/5"
                            >
                              {row.seasonLabel || 'Season'}
                            </td>
                            <td
                              className="p-3 border-r border-white/5"
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 border border-white/10 rounded-full overflow-hidden bg-gray-800 flex items-center justify-center">
                                  <img
                                    src={row.teamAvatar}
                                    alt={`${row.teamLabel} logo`}
                                    className="w-full h-full object-cover rounded-full"
                                    onError={(event) => {
                                      const target = event.currentTarget as HTMLImageElement;
                                      target.onerror = null;
                                      target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                        row.teamLabel || 'Team'
                                      )}&background=111827&color=10b981&rounded=true`;
                                    }}
                                  />
                                </div>
                                {row.teamId ? (
                                  <Link
                                    to={teamPath(row.teamId)}
                                    className="hover:text-brand-lime transition-colors"
                                  >
                                    {row.teamLabel}
                                  </Link>
                                ) : (
                                  <span>{row.teamLabel}</span>
                                )}
                              </div>
                            </td>
                            <td
                              className="p-3 border-r border-white/5"
                            >
                              {row.divisionLabel}
                            </td>
                            <td className="p-3 text-center font-bold text-white">{row.gp}</td>
                            <td className="p-3 text-center">{formatDecimal(row.ppg)}</td>
                            <td className="p-3 text-center">{formatDecimal(row.rpg)}</td>
                            <td className="p-3 text-center">{formatDecimal(row.apg)}</td>
                            <td className="p-3 text-center">{formatDecimal(row.spg)}</td>
                            <td className="p-3 text-center">{formatDecimal(row.bpg)}</td>
                            <td className="p-3 text-center">{formatDecimal(row.tovAvg)}</td>
                            <td className="p-3 text-center">{formatPercentage(row.fgm, row.fga)}</td>
                            <td className="p-3 text-center">{formatPercentage(row.tpm, row.tpa)}</td>
                            <td className="p-3 text-center">{formatPercentage(row.ftm, row.fta)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-10 text-sm">No career stats yet.</div>
                )}
              </>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-900 text-brand-grey font-sports uppercase text-[10px] sm:text-[11px]">
                    <tr>
                      <th className="p-3 text-left">Date</th>
                      <th className="p-3 text-left">Game</th>
                      <th className="p-3 text-center">Pos</th>
                      <th className="p-3 text-center">Pts</th>
                      <th className="p-3 text-center">FGM</th>
                      <th className="p-3 text-center">FGA</th>
                      <th className="p-3 text-center">FG%</th>
                      <th className="p-3 text-center">3PM</th>
                      <th className="p-3 text-center">3PA</th>
                      <th className="p-3 text-center">3P%</th>
                      <th className="p-3 text-center">REB</th>
                      <th className="p-3 text-center">AST</th>
                      <th className="p-3 text-center">STL</th>
                      <th className="p-3 text-center">BLK</th>
                      <th className="p-3 text-center">FT%</th>
                      <th className="p-3 text-center">FTA</th>
                      <th className="p-3 text-center">TOV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-gray-300">
                    {(gameLogs.length ? gameLogs : []).map((log) => (
                      <tr key={log.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-3 font-mono text-white">
                          {log.date
                            ? formatScheduleDateLabel(log.date, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-neutral-900 flex items-center justify-center shrink-0">
                              <img
                                src={
                                  log.myTeamLogo ||
                                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                    log.myTeamLabel || hero?.teamLabel || 'Team'
                                  )}&background=111827&color=10b981`
                                }
                                alt={log.myTeamLabel || 'Team'}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">
                                {log.myTeamLabel || 'Team'}
                              </div>
                              <div className="font-semibold text-white truncate">
                                <span className="text-white/70 uppercase text-[10px] tracking-[0.35em] mr-2">
                                  vs
                                </span>
                                {log.opponentId ? (
                                  <Link
                                    to={teamPath(log.opponentId)}
                                    className="hover:text-brand-lime transition-colors"
                                  >
                                    {log.opponent}
                                  </Link>
                                ) : (
                                  <span>{log.opponent || 'Opponent'}</span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-500">{log.seasonLabel || '-'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-center">{(log.position || '').toUpperCase() || '-'}</td>
                        <td className="p-3 text-center font-bold text-white">{log.pts ?? '-'}</td>
                        <td className="p-3 text-center">{log.fgm ?? '-'}</td>
                        <td className="p-3 text-center">{log.fga ?? '-'}</td>
                        <td className="p-3 text-center">
                          {formatPercentageCompact(log.fgm ?? null, log.fga ?? null)}
                        </td>
                        <td className="p-3 text-center">{log.tpm ?? '-'}</td>
                        <td className="p-3 text-center">{log.tpa ?? '-'}</td>
                        <td className="p-3 text-center">
                          {formatPercentageCompact(log.tpm ?? null, log.tpa ?? null)}
                        </td>
                        <td className="p-3 text-center">{log.reb ?? '-'}</td>
                        <td className="p-3 text-center">{log.ast ?? '-'}</td>
                        <td className="p-3 text-center">{log.stl ?? '-'}</td>
                        <td className="p-3 text-center">{log.blk ?? '-'}</td>
                        <td className="p-3 text-center">
                          {formatPercentageCompact(log.ftm ?? null, log.fta ?? null)}
                        </td>
                        <td className="p-3 text-center">{log.fta ?? '-'}</td>
                        <td className="p-3 text-center">{log.tov ?? '-'}</td>
                      </tr>
                    ))}
                    {!gameLogs.length && (
                      <tr>
                        <td colSpan={17} className="p-4 text-center text-gray-500">
                          No game logs yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Join Team Modal */}
      {joinOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !joinLoading && setJoinOpen(false)}
          ></div>
          <div className="relative bg-brand-dark border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-white font-sports text-xl uppercase">Join a Team</h3>
                <p className="text-brand-grey text-sm">Choose season, division, then team.</p>
              </div>
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => !joinLoading && setJoinOpen(false)}
                aria-label="Close"
              >
                X
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                  Season
                </label>
                <select
                  value={joinSeasonId}
                  onChange={(e) => {
                    setJoinSeasonId(e.target.value);
                    setJoinDivision('ALL');
                    setJoinTeamId('');
                  }}
                  className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none appearance-none custom-select"
                  disabled={joinLoading}
                >
                  {allSeasons.length ? (
                    sortSeasonsNewestFirst(allSeasons).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.id}
                      </option>
                    ))
                  ) : (
                    <option value="">No open registration seasons</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                  Division
                </label>
              <select
                value={joinDivision}
                onChange={(e) => {
                  setJoinDivision(e.target.value.toUpperCase());
                  setJoinTeamId('');
                }}
                className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none appearance-none custom-select"
                disabled={joinLoading}
              >
                {joinDivisionOptions.map((d) => (
                  <option key={d} value={d}>
                    {d === 'ALL' ? 'All Divisions' : d}
                  </option>
                ))}
              </select>
              {alreadyJoinedSeasonDivision && (
                <p className="mt-2 text-xs text-brand-red">
                  You already have a team in this season/division. Leave that roster before joining another.
                </p>
              )}
            </div>

              <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                  Team Code
                </label>
                <input
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => {
                    setJoinCodeInput(normalizeJoinCode(e.target.value));
                    setJoinError(null);
                  }}
                  placeholder="Enter captain code"
                  className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white text-base tracking-[0.06em] placeholder:normal-case focus:border-brand-lime focus:outline-none"
                  disabled={joinLoading}
                />
                <p className="mt-2 text-xs text-gray-500">
                  Have a team code from your captain? Enter it here to join directly.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                  Team
                </label>
                <select
                  value={joinTeamId}
                  onChange={(e) => setJoinTeamId(e.target.value)}
                  className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none appearance-none custom-select"
                  disabled={joinLoading || !joinTeamsFiltered.length}
                >
                  {joinTeamsFiltered.length ? (
                    joinTeamsFiltered.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.division ? `(${t.division})` : ''}
                      </option>
                    ))
                  ) : (
                    <option value="">No teams available</option>
                  )}
                </select>
              </div>

              {joinError && (
                <div className="text-sm text-brand-red bg-brand-red/10 border border-brand-red/40 rounded px-3 py-2">
                  {joinError}
                </div>
              )}

              <button
                onClick={handleJoinTeam}
                disabled={joinLoading || (!joinTeamId && !normalizeJoinCode(joinCodeInput))}
                className="w-full bg-brand-lime text-black font-sports font-bold uppercase tracking-wide py-3 rounded shadow-lg hover:scale-[1.01] transition-transform disabled:opacity-60 disabled:hover:scale-100"
              >
                {joinLoading ? 'Joining...' : 'Join Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MySeason;

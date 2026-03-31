import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { loadBadgeSettings, type PlayerMilestoneCategoryKey, type TrophyTierName } from '../services/badgeSettings';
import { DEFAULT_PLAYER_AVATAR } from '../constants';
import LoadingOverlay from '../components/LoadingOverlay';
import BadgeCylinderCarousel from '../components/BadgeCylinderCarousel';
import { ArrowLeft, Crown } from 'lucide-react';

type PlayerRow = {
  id: string;
  user_id?: string | null;
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | number | null;
  position: string | null;
  team_id: string | null;
  season_id: string | null;
  photo_url: string | null;
  is_captain?: boolean | null;
};

type ProfileRow = {
  display_name?: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  division?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  season_id?: string | null;
};

type SeasonRow = {
  id: string;
  name?: string | null;
  year?: string | number | null;
  start_date?: string | null;
};

type PlayerProfileLocationState = {
  returnPath?: string;
  returnLabel?: string;
  relatedPlayerIds?: string[];
};

type PlayerStatSummary = {
  gp: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
};

type PlayerGameStatRow = {
  game_id?: string | null;
  team_id?: string | null;
  season_id?: string | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;
  tov?: number | null;
  fgm?: number | null;
  fga?: number | null;
  tpm?: number | null;
  tpa?: number | null;
  ftm?: number | null;
  fta?: number | null;
  season_label?: string | null;
  season_name?: string | null;
};

type CareerStatRow = {
  seasonId?: string | null;
  seasonLabel: string;
  seasonStart?: number;
  teamId?: string | null;
  teamLabel: string;
  divisionLabel: string;
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
  teamLogo?: string;
};

type CareerTotals = {
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
};

type GameLogRow = {
  id: string;
  date: string;
  opponent: string;
  opponentId?: string | null;
  myTeamId?: string | null;
  gameLabel?: string;
  position?: string;
  result: 'W' | 'L' | 'T' | 'TBD';
  resultColor: 'win' | 'loss' | 'tie' | 'tbd';
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  fgm?: number | null;
  fga?: number | null;
  tpm?: number | null;
  tpa?: number | null;
  ftm?: number | null;
  fta?: number | null;
  tov?: number | null;
  seasonLabel: string;
  myTeamLogo?: string;
  myTeamLabel?: string;
};

type SeasonPlayerStatsRow = {
  id: string;
  season_id?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  division?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  jersey_number?: string | number | null;
  gp?: number | null;
  pts?: number | null;
  reb?: number | null;
  ast?: number | null;
  stl?: number | null;
  blk?: number | null;
  fgm?: number | null;
  fga?: number | null;
  tpm?: number | null;
  tpa?: number | null;
  fta?: number | null;
  ft_pct?: number | null;
  season_label?: string | null;
  season_name?: string | null;
};

type StatsTabKey = 'career' | 'gamelogs';

const STATS_TAB_OPTIONS: Array<{ key: StatsTabKey; label: string }> = [
  { key: 'career', label: 'Career Stats' },
  { key: 'gamelogs', label: 'Game Logs' },
];

type PlayerBadgeItem = {
  key: string;
  label: string;
  url: string;
  fallbackUrl: string;
  tooltip?: string;
};

const TROPHY_TIERS: TrophyTierName[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
const PLAYER_TROPHY_TABLE = 'player_trophy_overrides';

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

const normalizeNameToken = (value?: string | null) =>
  (value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

const resolvePublicDisplayName = (
  player: Pick<PlayerRow, 'jersey_number'>,
  profile?: ProfileRow | null
) => {
  const profileDisplayName = String(profile?.display_name || '').trim();
  if (profileDisplayName) return profileDisplayName;
  const jerseyNumber = String(player.jersey_number ?? '').trim();
  if (jerseyNumber) return `Player #${jerseyNumber}`;
  return 'Player';
};

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

const AWARD_PLACEHOLDER_LINES: Record<string, [string, string]> = {
  mvp: ['MVP', 'TROPHY'],
  dpos: ['DPOS', ''],
  'finals-mvp': ['FINALS', 'MVP'],
  mip: ['MIP', ''],
};

type StatTotals = {
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
};

const aggregateStatTotals = (rows: PlayerGameStatRow[]): StatTotals =>
  rows.reduce(
    (acc, row) => {
      acc.pts += Number(row.points) || 0;
      acc.reb += Number(row.rebounds) || 0;
      acc.ast += Number(row.assists) || 0;
      acc.stl += Number(row.steals) || 0;
      acc.blk += Number(row.blocks) || 0;
      acc.tov += Number(row.turnovers ?? row.tov) || 0;
      acc.fgm += Number(row.fgm) || 0;
      acc.fga += Number(row.fga) || 0;
      acc.tpm += Number(row.tpm) || 0;
      acc.tpa += Number(row.tpa) || 0;
      acc.ftm += Number(row.ftm) || 0;
      acc.fta += Number(row.fta) || 0;
      acc.gp += 1;
      return acc;
    },
    { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 }
  );

const finalGameStatuses = new Set(['COMPLETED', 'FINAL', 'FORFEITED']);

const formatSeasonLabel = (season?: SeasonRow | null) => {
  if (!season) return 'Season';
  const name = season.name || 'Season';
  const year = season.year ? `${season.year}` : '';
  if (year && name.includes(year)) return name;
  return `${name}${year ? ` ${year}` : ''}`.trim();
};

const formatDecimal = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0.0');

const formatPercentage = (made: number, attempts: number) => {
  if (!Number.isFinite(attempts) || attempts <= 0) return '0%';
  return `${((made / attempts) * 100).toFixed(1)}%`;
};

const formatPercentageCompact = (made: number | null, attempts: number | null) => {
  if (attempts == null) return '-';
  if (!Number.isFinite(attempts) || attempts <= 0) return '0%';
  const safeMade = made == null ? 0 : Number(made);
  if (!Number.isFinite(safeMade)) return '0%';
  return `${Math.round((safeMade / attempts) * 100)}%`;
};

const formatLogDate = (value?: string) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const resolveSeasonLabel = (
  seasonLookup: Map<string, SeasonRow>,
  seasonId: string | null | undefined,
  seasonLabelOverride?: string | null,
  seasonNameOverride?: string | null,
  fallback?: string
) => {
  if (seasonId) {
    const season = seasonLookup.get(seasonId);
    if (season) return formatSeasonLabel(season);
  }
  if (seasonLabelOverride) return seasonLabelOverride;
  if (seasonNameOverride) return seasonNameOverride;
  return fallback || 'Season';
};

const toNumber = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableNumber = (value: any) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildTeamAvatarPlaceholder = (label?: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(label || 'Team')}&background=111827&color=10b981`;

const buildCareerKey = (seasonId?: string | null, teamId?: string | null, divisionLabel?: string) =>
  `${seasonId || 'unknown'}|${teamId || 'unknown'}|${divisionLabel || 'Division'}`;

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

const careerRowChronologyValue = (row: CareerStatRow): number => {
  if (Number.isFinite(row.seasonStart) && (row.seasonStart || 0) > 0) {
    return row.seasonStart || 0;
  }
  return seasonLabelChronologyValue(row.seasonLabel);
};

const compareCareerRowsChronological = (a: CareerStatRow, b: CareerStatRow): number => {
  const chronologyDiff = careerRowChronologyValue(b) - careerRowChronologyValue(a);
  if (chronologyDiff !== 0) return chronologyDiff;

  const seasonLabelDiff = (b.seasonLabel || '').localeCompare(a.seasonLabel || '', undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (seasonLabelDiff !== 0) return seasonLabelDiff;

  const teamLabelDiff = (a.teamLabel || '').localeCompare(b.teamLabel || '', undefined, {
    sensitivity: 'base',
  });
  if (teamLabelDiff !== 0) return teamLabelDiff;

  return (a.divisionLabel || '').localeCompare(b.divisionLabel || '', undefined, {
    sensitivity: 'base',
  });
};

const SEASON_STATS_COLUMNS =
  'player_id,season_id,team_id,division,gp,pts,reb,ast,stl,blk,fgm,fga,tpm,tpa,ftm,fta,jersey_number,first_name,last_name';

const guessLabelFromPath = (path: string) => {
  if (!path) return 'Back';
  if (path.includes('/stats')) return 'Stats';
  if (path.includes('/boxscore')) return 'Scores';
  if (path.includes('/my-season')) return 'My Season';
  if (path.includes('/team')) return 'Team';
  if (path.includes('/admin')) return 'Admin';
  return 'Back';
};

const signTeamAsset = async (path?: string | null) => {
  const cleanedPath = typeof path === 'string' ? path.trim() : '';
  if (!cleanedPath) return '';
  const lower = cleanedPath.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return '';
  if (/^https?:\/\//.test(cleanedPath)) return cleanedPath;
  const marker = 'team-assets/';
  const idx = cleanedPath.indexOf(marker);
  const bucketPath = idx >= 0 ? cleanedPath.slice(idx + marker.length) : cleanedPath;
  if (!bucketPath) return '';
  try {
    const { data, error } = await supabase.storage
      .from('team-assets')
      .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
    if (error) throw error;
    return data?.signedUrl || '';
  } catch {
    return '';
  }
};

const PlayerProfile: React.FC = () => {
  const { playerId } = useParams<{ playerId: string }>();
  const location = useLocation();
  const locationState = location.state as PlayerProfileLocationState | null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [season, setSeason] = useState<SeasonRow | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string>(DEFAULT_PLAYER_AVATAR);
  const [teamLogoUrl, setTeamLogoUrl] = useState<string>('');
  const [stats, setStats] = useState<PlayerStatSummary | null>(null);
  const [careerStats, setCareerStats] = useState<CareerStatRow[]>([]);
  const [careerTotals, setCareerTotals] = useState<CareerTotals | null>(null);
  const [gameLogs, setGameLogs] = useState<GameLogRow[]>([]);
  const [playerBadges, setPlayerBadges] = useState<PlayerBadgeItem[]>([]);
  const [statsTab, setStatsTab] = useState<StatsTabKey>('career');
  const [publicDisplayName, setPublicDisplayName] = useState<string>('Player');

useEffect(() => {
    const loadProfile = async () => {
      if (!playerId) {
        setError('Player not found.');
        setLoading(false);
        return;
      }

      setCareerStats([]);
      setCareerTotals(null);
      setGameLogs([]);
      setPlayerBadges([]);
      setStatsTab('career');

      try {
        setLoading(true);
        setError(null);

        const { data: playerRow, error: playerErr } = await supabase
          .from('players')
          .select(
            'id,user_id,first_name,last_name,jersey_number,position,team_id,season_id,photo_url,is_captain'
          )
          .eq('id', playerId)
          .maybeSingle();
        if (playerErr) throw playerErr;
        if (!playerRow) {
          setError('Player not found.');
          setPlayer(null);
          setLoading(false);
          return;
        }
        setPlayer(playerRow as PlayerRow);
        if (playerRow.user_id) {
          try {
            const { data: profileRow } = await supabase
              .from('profiles')
              .select('display_name')
              .eq('user_id', playerRow.user_id)
              .maybeSingle();
            setPublicDisplayName(resolvePublicDisplayName(playerRow as PlayerRow, profileRow as ProfileRow | null));
          } catch {
            setPublicDisplayName(resolvePublicDisplayName(playerRow as PlayerRow, null));
          }
        } else {
          setPublicDisplayName(resolvePublicDisplayName(playerRow as PlayerRow, null));
        }

        const relatedPlayers = new Map<
          string,
          { id: string; team_id?: string | null; season_id?: string | null }
        >();
        relatedPlayers.set(playerRow.id, {
          id: playerRow.id,
          team_id: playerRow.team_id || null,
          season_id: playerRow.season_id || null,
        });
        const relatedPlayerIdsFromState = Array.isArray(locationState?.relatedPlayerIds)
          ? locationState.relatedPlayerIds
              .map((id) => String(id || '').trim())
              .filter(Boolean)
          : [];
        if (relatedPlayerIdsFromState.length) {
          try {
            const { data: extraPlayers } = await supabase
              .from('players')
              .select('id,team_id,season_id')
              .in('id', relatedPlayerIdsFromState);
            (extraPlayers || []).forEach((p) => {
              if (p?.id) {
                relatedPlayers.set(p.id, {
                  id: p.id,
                  team_id: p.team_id || null,
                  season_id: p.season_id || null,
                });
              }
            });
          } catch {
            // best effort: continue with the primary player and linked rows
          }
        }
        if (playerRow.user_id) {
          try {
            const { data: userPlayers } = await supabase
              .from('players')
              .select('id,team_id,season_id')
              .eq('user_id', playerRow.user_id);
            (userPlayers || []).forEach((p) => {
              if (p?.id) {
                relatedPlayers.set(p.id, {
                  id: p.id,
                  team_id: p.team_id || null,
                  season_id: p.season_id || null,
                });
              }
            });
          } catch {
            // best effort: continue with primary player only
          }
        }

        const normalizedFirst = normalizeNameToken(playerRow.first_name);
        const normalizedLast = normalizeNameToken(playerRow.last_name);
        const seenPlayerIds = new Set<string>(Array.from(relatedPlayers.keys()));
        const linkedTeamIds = new Set(
          Array.from(relatedPlayers.values())
            .map((row) => String(row.team_id || '').trim())
            .filter(Boolean)
        );
        const primaryJerseyNumber = String(playerRow.jersey_number ?? '').trim();
        const shouldIncludeFallbackCandidate = (row: any) => {
          const candidateId = String(row?.id || '').trim();
          if (!candidateId || seenPlayerIds.has(candidateId)) return false;
          const rowFirst = normalizeNameToken(row?.first_name);
          const rowLast = normalizeNameToken(row?.last_name);
          const nameExact =
            (normalizedFirst && normalizedLast && rowFirst === normalizedFirst && rowLast === normalizedLast) ||
            (normalizedFirst && !normalizedLast && rowFirst === normalizedFirst) ||
            (!normalizedFirst && normalizedLast && rowLast === normalizedLast);
          if (!nameExact) return false;
          const candidateJersey = String(row?.jersey_number ?? '').trim();
          const candidateTeamId = String(row?.team_id || '').trim();
          if (playerRow.user_id && row?.user_id && String(row.user_id).trim() === String(playerRow.user_id).trim()) {
            return true;
          }
          if (primaryJerseyNumber && candidateJersey && candidateJersey === primaryJerseyNumber) {
            return true;
          }
          if (candidateTeamId && linkedTeamIds.has(candidateTeamId)) {
            return true;
          }
          return !primaryJerseyNumber && !linkedTeamIds.size;
        };

        if (normalizedFirst || normalizedLast) {
          try {
            let nameQuery = supabase
              .from('players')
              .select('id,user_id,team_id,season_id,first_name,last_name,jersey_number');
            if (playerRow.first_name) {
              nameQuery = nameQuery.ilike('first_name', `%${playerRow.first_name}%`);
            }
            if (playerRow.last_name) {
              nameQuery = nameQuery.ilike('last_name', `%${playerRow.last_name}%`);
            }
            const { data: nameRows } = await nameQuery.order('created_at', { ascending: false }).limit(40);
            (nameRows || []).forEach((row: any) => {
              if (!shouldIncludeFallbackCandidate(row)) return;
              const candidateId = String(row.id);
              seenPlayerIds.add(candidateId);
              relatedPlayers.set(candidateId, {
                id: candidateId,
                team_id: row.team_id || null,
                season_id: row.season_id || null,
              });
            });
          } catch {
            // best effort: continue with the resolved related players
          }
        }
        const statsPlayerIds = Array.from(relatedPlayers.keys());

        const teamId = playerRow.team_id;
        let resolvedTeam: TeamRow | null = null;
        if (teamId) {
          const { data: teamRow, error: teamErr } = await supabase
            .from('teams')
            .select('id,name,division,logo_url,banner_url,season_id')
            .eq('id', teamId)
            .maybeSingle();
          if (!teamErr && teamRow) {
            resolvedTeam = teamRow as TeamRow;
            setTeam(resolvedTeam);
          }
        } else {
          setTeam(null);
        }
        const fallbackTeamLabel = resolvedTeam?.name || 'Team';

        const seasonId = playerRow.season_id || resolvedTeam?.season_id || null;
        let fallbackSeasonLabel = 'Season';
        let fallbackSeasonStart: number | undefined;
        let resolvedSeason: SeasonRow | null = null;
        if (seasonId) {
          const { data: seasonRow } = await supabase
            .from('seasons')
            .select('id,name,year,start_date')
            .eq('id', seasonId)
            .maybeSingle();
          resolvedSeason = (seasonRow as SeasonRow) || null;
          setSeason(resolvedSeason);
          if (resolvedSeason) {
            fallbackSeasonLabel = formatSeasonLabel(resolvedSeason);
            if (resolvedSeason.start_date) {
              const parsed = new Date(resolvedSeason.start_date);
              if (!Number.isNaN(parsed.getTime())) {
                fallbackSeasonStart = parsed.getTime();
              }
            }
          }
        } else {
          setSeason(null);
        }

        const signedPhoto = await signTeamAsset(playerRow.photo_url);
        setPhotoUrl(signedPhoto || DEFAULT_PLAYER_AVATAR);

        if (resolvedTeam?.logo_url) {
          const signedLogo = await signTeamAsset(resolvedTeam.logo_url);
          setTeamLogoUrl(signedLogo || '');
        } else {
          setTeamLogoUrl('');
        }

        const { data: statRows } = await supabase
          .from('game_stats')
          .select(
            'game_id,team_id,points,rebounds,assists,steals,blocks,turnovers,fgm,fga,tpm,tpa,ftm,fta,created_at'
          )
          .in('player_id', statsPlayerIds);
        const statsData = (statRows || []) as PlayerGameStatRow[];

        // Only include season stats rows that explicitly reference this player (or any linked player rows).
        // The old name-based matching could pull in another person's stats if names overlap.
        let seasonStatsRows: any[] = [];
        try {
          const { data: seasonStatRows, error: seasonStatErr } = await supabase
            .from('season_player_stats')
            .select('*')
            .in('player_id', statsPlayerIds);
          if (seasonStatErr) throw seasonStatErr;
          seasonStatsRows = (seasonStatRows || []) as any[];
        } catch (err) {
          console.warn('Load season_player_stats failed', err);
          seasonStatsRows = [];
        }

        const referencedGameIds = Array.from(
          new Set(statsData.map((row) => row.game_id).filter(Boolean))
        );
        const gameMap = new Map<string, any>();
        const gameTeamPointTotals = new Map<string, Map<string, number>>();
        if (referencedGameIds.length) {
          const { data: gameRows } = await supabase
            .from('games')
            .select(
              'id,status,season_id,game_datetime,location,home_team_id,away_team_id,home_score,away_score'
            )
            .in('id', referencedGameIds);
          (gameRows || []).forEach((game) => {
            if (game?.id) {
              gameMap.set(game.id, game);
            }
          });

          const { data: gameScoreRows } = await supabase
            .from('game_stats')
            .select('game_id,team_id,points')
            .in('game_id', referencedGameIds);
          (gameScoreRows || []).forEach((row: any) => {
            const gameId = row?.game_id;
            const teamId = row?.team_id;
            if (!gameId || !teamId) return;
            const current = gameTeamPointTotals.get(gameId) || new Map<string, number>();
            current.set(teamId, (current.get(teamId) || 0) + toNumber(row.points));
            gameTeamPointTotals.set(gameId, current);
          });
        }

        const finalGameIds = new Set<string>();
        gameMap.forEach((game) => {
          const status = String(game.status || '').toUpperCase();
          if (!status || finalGameStatuses.has(status)) {
            finalGameIds.add(game.id);
          }
        });

        const seasonIds = new Set<string>();
        const teamIds = new Set<string>();
        if (resolvedSeason?.id) seasonIds.add(resolvedSeason.id);
        if (resolvedTeam?.id) teamIds.add(resolvedTeam.id);
        Array.from(relatedPlayers.values()).forEach((related) => {
          if (related.season_id) seasonIds.add(related.season_id);
          if (related.team_id) teamIds.add(related.team_id);
        });
        statsData.forEach((row) => {
          if (row.season_id) seasonIds.add(row.season_id);
          if (row.team_id) teamIds.add(row.team_id);
        });
        seasonStatsRows.forEach((row) => {
          if (row.season_id) seasonIds.add(row.season_id);
          if (row.team_id) teamIds.add(row.team_id);
        });
        gameMap.forEach((game) => {
          if (game.season_id) seasonIds.add(game.season_id);
          if (game.home_team_id) teamIds.add(game.home_team_id);
          if (game.away_team_id) teamIds.add(game.away_team_id);
        });

        const teamLookup = new Map<string, TeamRow>();
        const teamLogoMap = new Map<string, string>();
        if (teamIds.size) {
          const { data: teamsRows } = await supabase
            .from('teams')
            .select('id,name,division,logo_url,season_id')
            .in('id', Array.from(teamIds));
          for (const row of teamsRows || []) {
            if (!row?.id) continue;
            if (row.season_id) {
              seasonIds.add(row.season_id);
            }
            const signedLogo = await signTeamAsset(row.logo_url);
            teamLookup.set(row.id, row as TeamRow);
            teamLogoMap.set(row.id, signedLogo || '');
          }
        }

        const seasonLookup = new Map<string, SeasonRow>();
        if (seasonIds.size) {
          const { data: seasonsRows } = await supabase
            .from('seasons')
            .select('id,name,year,start_date')
            .in('id', Array.from(seasonIds));
          (seasonsRows || []).forEach((row) => {
            if (row?.id) {
              seasonLookup.set(row.id, row as SeasonRow);
            }
          });
        }

        const eligibleStats = statsData.filter(
          (row) => !finalGameIds.size || !row.game_id || finalGameIds.has(row.game_id)
        );
        const statsTotals = aggregateStatTotals(eligibleStats);
        const buildBadgeUrl = (path: string) =>
          supabase.storage.from('public-assets').getPublicUrl(path).data.publicUrl;

        type CareerAccumulatorEntry = { row: CareerStatRow; gameIds: Set<string> };
        const careerAccumulator = new Map<string, CareerAccumulatorEntry>();
        const ensureCareerEntry = (
          seasonIdKey: string | null,
          teamIdKey: string | null,
          divisionLabel: string,
          seasonLabel: string,
          seasonStart?: number,
          teamLabel: string,
          teamLogo?: string
        ) => {
          const key = buildCareerKey(seasonIdKey, teamIdKey, divisionLabel);
          let entry = careerAccumulator.get(key);
          if (!entry) {
            entry = {
              row: {
                seasonId: seasonIdKey,
                seasonLabel,
                seasonStart,
                teamId: teamIdKey,
                teamLabel,
                divisionLabel,
                teamLogo: teamLogo || undefined,
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
              },
              gameIds: new Set<string>(),
            };
            careerAccumulator.set(key, entry);
          }
          return { entry, key };
        };

        // Seed career rows from memberships so active/new teams appear before first stat line.
        Array.from(relatedPlayers.values()).forEach((related) => {
          const teamIdKey = related.team_id || null;
          if (!teamIdKey) return;
          const teamInfo = teamLookup.get(teamIdKey) || null;
          const fallbackSeasonId = teamInfo?.season_id || null;
          const resolvedSeasonId = related.season_id || fallbackSeasonId;
          const seasonInfo = resolvedSeasonId ? seasonLookup.get(resolvedSeasonId) : null;
          const seasonLabel = resolveSeasonLabel(
            seasonLookup,
            resolvedSeasonId,
            undefined,
            undefined,
            fallbackSeasonLabel
          );
          const seasonStart =
            seasonInfo?.start_date && !Number.isNaN(new Date(seasonInfo.start_date).getTime())
              ? new Date(seasonInfo.start_date).getTime()
              : fallbackSeasonStart;
          const teamLabel = teamInfo?.name || fallbackTeamLabel;
          const divisionLabel = teamInfo?.division || 'Division';
          const teamLogo = teamLogoMap.get(teamIdKey) || '';

          ensureCareerEntry(
            resolvedSeasonId,
            teamIdKey,
            divisionLabel,
            seasonLabel,
            seasonStart,
            teamLabel,
            teamLogo
          );
        });

        statsData.forEach((row, rowIndex) => {
          const game = row.game_id ? gameMap.get(row.game_id) : undefined;
          const status = String(game?.status || '').toUpperCase();
          if (status && !finalGameStatuses.has(status)) return;
          const seasonIdKey = row.season_id || game?.season_id || null;
          const teamIdKey = row.team_id || resolvedTeam?.id || null;
          const teamInfo = teamIdKey ? teamLookup.get(teamIdKey) : null;
          const fallbackSeasonId = teamInfo?.season_id || null;
          const resolvedSeasonId = seasonIdKey || fallbackSeasonId;
          const seasonInfo = resolvedSeasonId ? seasonLookup.get(resolvedSeasonId) : null;
          const seasonLabel = resolveSeasonLabel(
            seasonLookup,
            resolvedSeasonId,
            row.season_label,
            row.season_name,
            fallbackSeasonLabel
          );
          const seasonStart =
            seasonInfo?.start_date && !Number.isNaN(new Date(seasonInfo.start_date).getTime())
              ? new Date(seasonInfo.start_date).getTime()
              : fallbackSeasonStart;
          const teamLabel = teamInfo?.name || fallbackTeamLabel;
          const divisionLabel = teamInfo?.division || 'Division';
          const teamLogo = teamIdKey ? teamLogoMap.get(teamIdKey) || '' : '';

          const { entry } = ensureCareerEntry(
            resolvedSeasonId,
            teamIdKey,
            divisionLabel,
            seasonLabel,
            seasonStart,
            teamLabel,
            teamLogo
          );
          entry.row.pts += toNumber(row.points);
          entry.row.reb += toNumber(row.rebounds);
          entry.row.ast += toNumber(row.assists);
          entry.row.stl += toNumber(row.steals);
          entry.row.blk += toNumber(row.blocks);
          entry.row.tov += toNumber(row.turnovers ?? row.tov);
          entry.row.fgm += toNumber(row.fgm);
          entry.row.fga += toNumber(row.fga);
          entry.row.tpm += toNumber(row.tpm);
          entry.row.tpa += toNumber(row.tpa);
          entry.row.ftm += toNumber(row.ftm);
          entry.row.fta += toNumber(row.fta);
          entry.gameIds.add(row.game_id || `stat-${rowIndex}`);
        });

        seasonStatsRows.forEach((row) => {
          const seasonIdKey = row.season_id || null;
          const teamIdKey = row.team_id || resolvedTeam?.id || null;
          const teamInfo = teamIdKey ? teamLookup.get(teamIdKey) : null;
          const fallbackSeasonId = teamInfo?.season_id || null;
          const resolvedSeasonId = seasonIdKey || fallbackSeasonId;
          const seasonInfo = resolvedSeasonId ? seasonLookup.get(resolvedSeasonId) : null;
          const seasonLabel = resolveSeasonLabel(
            seasonLookup,
            resolvedSeasonId,
            row.season_label,
            row.season_name,
            fallbackSeasonLabel
          );
          const seasonStart =
            seasonInfo?.start_date && !Number.isNaN(new Date(seasonInfo.start_date).getTime())
              ? new Date(seasonInfo.start_date).getTime()
              : fallbackSeasonStart;
          const teamLabel = teamInfo?.name || fallbackTeamLabel;
          const teamLogo = teamIdKey ? teamLogoMap.get(teamIdKey) || '' : '';
          const divisionLabel = row.division || teamInfo?.division || 'Division';

          const key = buildCareerKey(resolvedSeasonId, teamIdKey, divisionLabel);
          if (careerAccumulator.has(key)) return;
          const gpCount = Number(row.gp) || 0;
          const placeholderGames = new Set<string>();
          for (let i = 0; i < gpCount; i += 1) {
            placeholderGames.add(`fallback-${key}-${i}`);
          }
          careerAccumulator.set(key, {
            row: {
              seasonId: resolvedSeasonId,
              seasonLabel,
              seasonStart,
              teamId: teamIdKey,
              teamLabel,
              divisionLabel,
              gp: gpCount,
              pts: Number(row.pts) || 0,
              reb: Number(row.reb) || 0,
              ast: Number(row.ast) || 0,
              stl: Number(row.stl) || 0,
              blk: Number(row.blk) || 0,
              tov: Number((row as any).turnovers ?? (row as any).tov) || 0,
              fgm: Number(row.fgm) || 0,
              fga: Number(row.fga) || 0,
              tpm: Number(row.tpm) || 0,
              tpa: Number(row.tpa) || 0,
              ftm: Number(row.ftm) || 0,
              fta: Number(row.fta) || 0,
              teamLogo: teamLogo || undefined,
            },
            gameIds: placeholderGames,
          });
        });

        let careerRows = Array.from(careerAccumulator.values())
          .map(({ row, gameIds }) => ({
            ...row,
            gp: Math.max(row.gp, gameIds.size),
            teamLogo: row.teamLogo || buildTeamAvatarPlaceholder(row.teamLabel),
          }))
          .sort(compareCareerRowsChronological);
        if (!careerRows.length && statsTotals.gp > 0) {
          const fallbackTeamLogo =
            resolvedTeam?.id ? teamLogoMap.get(resolvedTeam.id) || '' : '';
          const fallbackRow: CareerStatRow = {
            seasonId: resolvedSeason?.id || null,
            seasonLabel: resolvedSeason ? formatSeasonLabel(resolvedSeason) : fallbackSeasonLabel,
            seasonStart: fallbackSeasonStart,
            teamId: resolvedTeam?.id || null,
            teamLabel: fallbackTeamLabel,
            divisionLabel: resolvedTeam?.division || 'Division',
            gp: statsTotals.gp,
            pts: statsTotals.pts,
            reb: statsTotals.reb,
            ast: statsTotals.ast,
            stl: statsTotals.stl,
            blk: statsTotals.blk,
            tov: statsTotals.tov,
            fgm: statsTotals.fgm,
            fga: statsTotals.fga,
            tpm: statsTotals.tpm,
            tpa: statsTotals.tpa,
            ftm: statsTotals.ftm,
            fta: statsTotals.fta,
            teamLogo: fallbackTeamLogo || buildTeamAvatarPlaceholder(fallbackTeamLabel),
          };
          careerRows = [fallbackRow];
        }
        setCareerStats(careerRows);

        const careerTotalsComputed = careerRows.reduce(
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
        setCareerTotals(careerTotalsComputed);

        if (careerTotalsComputed.gp > 0) {
          const gp = careerTotalsComputed.gp;
          setStats({
            gp,
            ppg: +(careerTotalsComputed.pts / gp).toFixed(1),
            rpg: +(careerTotalsComputed.reb / gp).toFixed(1),
            apg: +(careerTotalsComputed.ast / gp).toFixed(1),
            spg: +(careerTotalsComputed.stl / gp).toFixed(1),
          });
        } else {
          setStats({
            gp: 0,
            ppg: 0,
            rpg: 0,
            apg: 0,
            spg: 0,
          });
        }

        const statDateByGameId = new Map<string, string>();
        gameMap.forEach((game, gameId) => {
          const dt = String(game?.game_datetime || '').trim();
          if (dt) statDateByGameId.set(gameId, dt);
        });
        const chronologicalStatLines = eligibleStats
          .map((row) => {
            const points = toNumber(row.points);
            const assists = toNumber(row.assists);
            const rebounds = toNumber(row.rebounds);
            const steals = toNumber(row.steals);
            const blocks = toNumber(row.blocks);
            const dateValue = row.game_id ? statDateByGameId.get(row.game_id) || row.created_at || null : row.created_at || null;
            const timestamp = dateValue ? new Date(dateValue).getTime() : Number.MAX_SAFE_INTEGER;
            return {
              points,
              assists,
              rebounds,
              steals,
              blocks,
              dateValue,
              timestamp: Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp,
            };
          })
          .sort((a, b) => a.timestamp - b.timestamp);

        try {
          const badgeSettings = await loadBadgeSettings();
          const totalsByCategory: Record<PlayerMilestoneCategoryKey, number> = {
            points: statsTotals.pts,
            assists: statsTotals.ast,
            rebounds: statsTotals.reb,
            steals: statsTotals.stl,
            blocks: statsTotals.blk,
          };
          const unlockDates: Record<PlayerMilestoneCategoryKey, Partial<Record<TrophyTierName, string>>> = {
            points: {},
            assists: {},
            rebounds: {},
            steals: {},
            blocks: {},
          };

          badgeSettings.playerMilestones.forEach((category) => {
            const key = category.key as PlayerMilestoneCategoryKey;
            let runningTotal = 0;
            const pendingTiers = [...TROPHY_TIERS];
            chronologicalStatLines.forEach((line) => {
              runningTotal += Number(line[key]) || 0;
              while (pendingTiers.length) {
                const tier = pendingTiers[0];
                const threshold = category.thresholds[TROPHY_TIERS.indexOf(tier)];
                if (runningTotal >= threshold && !unlockDates[key][tier]) {
                  if (line.dateValue) unlockDates[key][tier] = line.dateValue;
                  pendingTiers.shift();
                  continue;
                }
                break;
              }
            });
          });

          const milestoneBadges: PlayerBadgeItem[] = badgeSettings.playerMilestones.flatMap((category) => {
            const key = category.key as PlayerMilestoneCategoryKey;
            const categoryTotal = totalsByCategory[key] || 0;
            return TROPHY_TIERS.flatMap((tier, idx) => {
              const threshold = category.thresholds[idx];
              if (categoryTotal < threshold) return [];
              const configuredFile = category.badgeFiles?.[tier];
              const fileName =
                (typeof configuredFile === 'string' && configuredFile.trim()) ||
                `${category.filePrefix}-${tier.toLowerCase()}.png`;
              const fallbackUrl = buildBadgePlaceholder(category.label, tier, getTierColor(tier));
              const unlockedAt = unlockDates[key][tier];
              const nextThreshold = category.thresholds[idx + 1];
              const nextTier = TROPHY_TIERS[idx + 1];
              return [
                {
                  key: `${key}-${tier.toLowerCase()}`,
                  label: `${category.label} ${tier}`,
                  url: buildBadgeUrl(`badges/${fileName}`),
                  fallbackUrl,
                  tooltip: [
                    `${category.label} ${tier}`,
                    `Unlocked: ${formatTrophyDate(unlockedAt) || 'Date TBD'}`,
                    `Total: ${categoryTotal}`,
                    nextThreshold && nextTier
                      ? `Next ${nextTier} at ${nextThreshold} (${Math.max(nextThreshold - categoryTotal, 0)} to go)`
                      : 'Max tier unlocked',
                  ].join('\n'),
                } as PlayerBadgeItem,
              ];
            });
          });

          const statsPlayerIdSet = new Set(statsPlayerIds);
          const seasonIdList = Array.from(seasonIds);
          let awardRows: any[] = [];
          try {
            let awardQuery = supabase
              .from(PLAYER_TROPHY_TABLE)
              .select('season_id,mvp_player_id,dpos_player_id,finals_mvp_player_id,mip_player_id,updated_at')
              .order('updated_at', { ascending: false });
            if (seasonIdList.length) {
              awardQuery = awardQuery.in('season_id', seasonIdList);
            }
            const { data: fetchedAwards, error: awardErr } = await awardQuery;
            if (awardErr) throw awardErr;
            awardRows = fetchedAwards || [];
          } catch (awardLoadErr) {
            console.warn('Load player awards failed', awardLoadErr);
            awardRows = [];
          }

          const awardKeyByColumn: Array<{
            key: string;
            column: 'mvp_player_id' | 'dpos_player_id' | 'finals_mvp_player_id' | 'mip_player_id';
          }> = [
            { key: 'mvp', column: 'mvp_player_id' },
            { key: 'dpos', column: 'dpos_player_id' },
            { key: 'finals-mvp', column: 'finals_mvp_player_id' },
            { key: 'mip', column: 'mip_player_id' },
          ];
          const awardConfigByKey = new Map(
            badgeSettings.playerAwards.map((award) => [award.key, award] as const)
          );
          const awardBadges: PlayerBadgeItem[] = [];
          awardRows.forEach((row, rowIndex) => {
            awardKeyByColumn.forEach(({ key, column }) => {
              const awardPlayerId = row?.[column];
              if (!awardPlayerId || !statsPlayerIdSet.has(awardPlayerId)) return;
              const config = awardConfigByKey.get(key);
              if (!config) return;
              const seasonInfo = row?.season_id ? seasonLookup.get(row.season_id) : null;
              const seasonName = formatSeasonLabel(seasonInfo || undefined);
              const lines = AWARD_PLACEHOLDER_LINES[key] || [config.label, ''];
              const fallbackUrl = buildBadgePlaceholder(lines[0], lines[1], '#e1ff2b');
              awardBadges.push({
                key: `award-${key}-${row?.season_id || rowIndex}`,
                label: config.label,
                url: buildBadgeUrl(`badges/${config.file}`),
                fallbackUrl,
                tooltip: [
                  `${seasonName} - ${config.label}`,
                  row?.updated_at ? formatTrophyDate(row.updated_at) : 'Date TBD',
                ].join('\n'),
              });
            });
          });

          setPlayerBadges([...milestoneBadges, ...awardBadges]);
        } catch (badgeErr) {
          console.warn('Load player badges failed', badgeErr);
          setPlayerBadges([]);
        }

        const logEntries = eligibleStats
          .map((row, rowIndex) => {
            const game = row.game_id ? gameMap.get(row.game_id) : undefined;
            const teamIdKey = row.team_id || resolvedTeam?.id || null;
            const teamInfo = teamIdKey ? teamLookup.get(teamIdKey) : null;
            const fallbackSeasonId = teamInfo?.season_id || null;
            const seasonIdCandidate = row.season_id || game?.season_id || fallbackSeasonId || null;
            const seasonLabelValue = resolveSeasonLabel(
              seasonLookup,
              seasonIdCandidate,
              row.season_label,
              row.season_name,
              fallbackSeasonLabel
            );

            const teamLogoUrl = teamIdKey ? teamLogoMap.get(teamIdKey) || '' : '';
            const fallbackRowTeamLabel = resolvedTeam?.name || 'Team';
            const rowTeamLabel =
              teamIdKey && teamLookup.get(teamIdKey)
                ? teamLookup.get(teamIdKey)!.name
                : fallbackRowTeamLabel;
            const baseEntry: GameLogRow = {
              id: row.game_id || `fallback-${playerId}-${rowIndex}`,
              date: game?.game_datetime || row?.created_at || '',
              opponent: 'Opponent',
              opponentId: null,
              myTeamId: teamIdKey,
              position: (playerRow as any)?.position || undefined,
              result: 'TBD',
              resultColor: 'tbd',
              pts: toNullableNumber(row.points),
              reb: toNullableNumber(row.rebounds),
              ast: toNullableNumber(row.assists),
              stl: toNullableNumber(row.steals),
              blk: toNullableNumber(row.blocks),
              fgm: toNullableNumber(row.fgm),
              fga: toNullableNumber(row.fga),
              tpm: toNullableNumber((row as any).tpm),
              tpa: toNullableNumber((row as any).tpa),
              ftm: toNullableNumber((row as any).ftm),
              fta: toNullableNumber((row as any).fta),
              tov: toNullableNumber((row as any).turnovers ?? (row as any).tov),
              seasonLabel: seasonLabelValue,
              myTeamLogo: teamLogoUrl || undefined,
              myTeamLabel: rowTeamLabel,
            };

            if (!game) {
              return baseEntry;
            }

            const status = String(game.status || '').toUpperCase();
            if (status && !finalGameStatuses.has(status)) {
              return null;
            }

            const isHome = Boolean(teamIdKey && game.home_team_id === teamIdKey);
            const opponentId = isHome ? game.away_team_id : game.home_team_id;
            const opponentLabel = opponentId
              ? teamLookup.get(opponentId)?.name || 'Opponent'
              : 'Opponent';
            const opponentLogo =
              (opponentId && (teamLogoMap.get(opponentId) || buildTeamAvatarPlaceholder(opponentLabel))) ||
              undefined;
            const gameLabel = `${rowTeamLabel} vs ${opponentLabel}`;
            let homeScore = game.home_score;
            let awayScore = game.away_score;
            const pointsByTeam = gameTeamPointTotals.get(game.id);
            if (pointsByTeam && game.home_team_id && game.away_team_id) {
              const calcHome = pointsByTeam.get(game.home_team_id);
              const calcAway = pointsByTeam.get(game.away_team_id);
              const hasCalcScore = calcHome != null && calcAway != null;
              const hasStoredScore = homeScore != null && awayScore != null;
              const storedLooksAmbiguous =
                !hasStoredScore || Number(homeScore) === Number(awayScore);
              if (hasCalcScore && storedLooksAmbiguous) {
                homeScore = calcHome;
                awayScore = calcAway;
              }
            }
            const hasScore = homeScore != null && awayScore != null;
            const isWin =
              hasScore &&
              ((isHome && Number(homeScore) > Number(awayScore)) ||
                (!isHome && Number(awayScore) > Number(homeScore)));
            const isLoss =
              hasScore &&
              ((isHome && Number(homeScore) < Number(awayScore)) ||
                (!isHome && Number(awayScore) < Number(homeScore)));
            const isTie =
              hasScore && Number(homeScore) === Number(awayScore);

            return {
              ...baseEntry,
              opponent: opponentLabel,
              opponentId,
              opponentLogo,
              gameLabel,
              result: isWin ? 'W' : isLoss ? 'L' : isTie ? 'T' : 'TBD',
              resultColor: isWin ? 'win' : isLoss ? 'loss' : isTie ? 'tie' : 'tbd',
            };
          })
          .filter((entry): entry is GameLogRow => Boolean(entry))
          .sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));
        setGameLogs(logEntries);
      } catch (err) {
        console.error('player profile load error', err);
        setError('Unable to load player profile.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [playerId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
        <LoadingOverlay message="Loading player..." />
      </div>
    );
  }

  if (error || !player) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
        <div className="text-white font-sports text-xl">{error || 'Player not found.'}</div>
      </div>
    );
  }

  const seasonLabel = formatSeasonLabel(season);
  const jerseyLabel = player.jersey_number != null ? `#${player.jersey_number}` : 'No #';
  const teamLabel = team?.name || 'Team';
  const teamLink = team?.id ? `/team/${team.id}` : '/my-team';
  const backPath = locationState?.returnPath || teamLink;
  const backLabel =
    locationState?.returnLabel || (backPath === teamLink ? 'Team' : guessLabelFromPath(backPath));

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        <Link
          to={backPath}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} /> Back to {backLabel}
        </Link>

        <div className="bg-gradient-to-br from-brand-lime/10 via-transparent to-black border border-white/10 rounded-2xl p-6 sm:p-8 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-40 pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 20% 0%, rgba(59,255,149,0.35), transparent 60%)',
            }}
          />
          <div className="absolute -top-8 left-6 w-28 h-28 rounded-full bg-brand-lime/30 blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-center gap-6">
            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-black/30 border-4 border-brand-lime overflow-hidden shadow-2xl flex items-center justify-center">
              <img
                src={photoUrl}
                alt={publicDisplayName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = DEFAULT_PLAYER_AVATAR;
                }}
              />
            </div>
            <div className="flex-1 min-w-0 text-center sm:text-left space-y-3">
              <div className="text-xs uppercase tracking-[0.7em] text-brand-grey">Player Profile</div>
              <h1 className="font-sports text-4xl sm:text-5xl text-white uppercase">{publicDisplayName}</h1>
              <div className="flex flex-wrap items-center gap-3 justify-center sm:justify-start">
                <div className="text-xs uppercase text-white/70 tracking-[0.6em]">Position</div>
                <span className="text-2xl font-bold text-white">{player.position || 'Position N/A'}</span>
                <div className="px-4 py-1 rounded-full bg-brand-lime text-black text-sm font-sports tracking-wide uppercase">
                  {jerseyLabel}
                </div>
                {player.is_captain && (
                  <Crown size={18} className="text-yellow-400 fill-yellow-400" />
                )}
              </div>
            </div>
          </div>
          {playerBadges.length > 0 && (
            <div className="relative z-10 mt-5 w-full">
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
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-black/40 border border-white/10 rounded-xl p-4">
            <div className="text-xs uppercase text-brand-grey font-bold mb-2">Games</div>
            <div className="font-sports text-3xl text-white">{stats?.gp ?? 0}</div>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-xl p-4">
            <div className="text-xs uppercase text-brand-grey font-bold mb-2">PPG</div>
            <div className="font-sports text-3xl text-white">{stats?.ppg ?? 0}</div>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-xl p-4">
            <div className="text-xs uppercase text-brand-grey font-bold mb-2">RPG</div>
            <div className="font-sports text-3xl text-white">{stats?.rpg ?? 0}</div>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-xl p-4">
            <div className="text-xs uppercase text-brand-grey font-bold mb-2">APG</div>
            <div className="font-sports text-3xl text-white">{stats?.apg ?? 0}</div>
          </div>
        </div>

        <div className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden">
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5 border-b border-white/5">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-brand-grey">Stats</p>
                <h3 className="font-sports text-2xl text-white uppercase tracking-wide">Career Overview</h3>
              </div>
              <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-[3px]">
                {STATS_TAB_OPTIONS.map((tab) => {
                  const active = statsTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setStatsTab(tab.key)}
                      className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
                        active ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-6 space-y-4">
              {statsTab === 'career' ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.3em] text-white/60">Career Stats</div>
                      <p className="text-sm text-gray-400">All seasons & divisions</p>
                    </div>
                    {careerTotals && careerTotals.gp > 0 && (
                      <div className="text-xs text-gray-400 space-y-0.5 text-right">
                        <div>
                          Avg: {formatDecimal(careerTotals.pts / Math.max(1, careerTotals.gp))} PPG •{' '}
                          {formatDecimal(careerTotals.reb / Math.max(1, careerTotals.gp))} RPG •{' '}
                          {formatDecimal(careerTotals.ast / Math.max(1, careerTotals.gp))} APG
                        </div>
                        <div>
                          FG%: {formatPercentage(careerTotals.fgm, careerTotals.fga)} • 3PT%:{' '}
                          {formatPercentage(careerTotals.tpm, careerTotals.tpa)} • FT%:{' '}
                          {formatPercentage(careerTotals.ftm, careerTotals.fta)}
                        </div>
                      </div>
                    )}
                  </div>
                  {careerStats.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs sm:text-sm">
                        <thead className="bg-neutral-900 text-brand-grey font-sports uppercase text-[10px] sm:text-[11px]">
                          <tr>
                            <th className="p-3">Season</th>
                            <th className="p-3">Team</th>
                            <th className="p-3">Division</th>
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
                        <tbody className="divide-y divide-white/5 text-gray-200 text-[13px] sm:text-sm">
                          {careerStats.map((row) => (
                            <tr key={`${row.seasonLabel}-${row.teamLabel}-${row.teamId || 'anon'}`} className="hover:bg-white/5 transition-colors">
                              <td className="p-3 font-semibold text-white">{row.seasonLabel}</td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 bg-gray-800 flex items-center justify-center">
                                    <img
                                      src={row.teamLogo || buildTeamAvatarPlaceholder(row.teamLabel)}
                                      alt={`${row.teamLabel} logo`}
                                      className="w-full h-full object-cover"
                                      onError={(event) => {
                                        const target = event.currentTarget as HTMLImageElement;
                                        if (target.dataset.fallbackApplied === '1') return;
                                        target.dataset.fallbackApplied = '1';
                                        target.src = buildTeamAvatarPlaceholder(row.teamLabel);
                                      }}
                                    />
                                  </div>
                                  {row.teamId ? (
                                    <Link
                                      to={`/team/${row.teamId}`}
                                      className="hover:text-brand-lime transition-colors"
                                    >
                                      {row.teamLabel}
                                    </Link>
                                  ) : (
                                    <span>{row.teamLabel}</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3">{row.divisionLabel}</td>
                              <td className="p-3 text-center font-bold text-white">{row.gp}</td>
                              <td className="p-3 text-center">{formatDecimal(row.pts / Math.max(1, row.gp))}</td>
                              <td className="p-3 text-center">{formatDecimal(row.reb / Math.max(1, row.gp))}</td>
                              <td className="p-3 text-center">{formatDecimal(row.ast / Math.max(1, row.gp))}</td>
                              <td className="p-3 text-center">{formatDecimal(row.stl / Math.max(1, row.gp))}</td>
                              <td className="p-3 text-center">{formatDecimal(row.blk / Math.max(1, row.gp))}</td>
                              <td className="p-3 text-center">{formatDecimal(row.tov / Math.max(1, row.gp))}</td>
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
                        <th className="p-3">Date</th>
                        <th className="p-3">Game</th>
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
                      {gameLogs.length ? (
                        gameLogs.map((log) => {
                          return (
                            <tr key={log.id} className="hover:bg-white/5 transition-colors">
                              <td className="p-3 font-mono text-white">{formatLogDate(log.date)}</td>
                              <td className="p-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-neutral-900 flex items-center justify-center shrink-0">
                                    <img
                                      src={
                                        log.myTeamLogo ||
                                        `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                          log.myTeamLabel || 'Team'
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
                                          to={`/team/${log.opponentId}`}
                                          className="hover:text-brand-lime transition-colors"
                                        >
                                          {log.opponent || 'Opponent'}
                                        </Link>
                                      ) : (
                                        <span>{log.opponent || 'Opponent'}</span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-gray-500">{log.seasonLabel}</div>
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
                          );
                        })
                      ) : (
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
      </div>
    </div>
  );
};

export default PlayerProfile;

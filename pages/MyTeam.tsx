import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { GameList } from '../components/StatsComponents';
import BadgeCylinderCarousel from '../components/BadgeCylinderCarousel';
import { supabase } from '../services/supabaseClient';
import { getStoredUser } from '../services/authService';
import { getDefaultBadgeSettings, loadBadgeSettings } from '../services/badgeSettings';
import {
  loadTeamMergeMetadata,
  resolveConnectedTeamIds,
  type TeamMergeMetadataMap,
} from '../services/teamMergeMetadata';
import { Game, RosterPlayer, Team } from '../types';
import { Activity, ArrowLeft, ChevronDown, Crown, Gauge, Info, Shield, Target, TrendingDown, TrendingUp, Users, Zap } from 'lucide-react';
import LoadingOverlay from '../components/LoadingOverlay';
import { getScheduleDateTimeParts } from '../utils/time';

const defaultBanner = '/default-team-banner.svg';

const defaultTeamFallback: Team = {
  id: 'team-placeholder',
  name: 'Your Team',
  division: 'TBD',
  logoUrl: 'https://ui-avatars.com/api/?background=111827&color=10b981&name=Your+Team',
  bannerUrl: defaultBanner,
  seasonId: '',
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  pointsAgainst: 0,
};

type TeamTrophyWinners = {
  championTeamId: string | null;
  bestOffenseTeamId: string | null;
  bestDefenseTeamId: string | null;
  niceGuysTeamId: string | null;
};

const DEFAULT_BADGE_SETTINGS = getDefaultBadgeSettings();

const InfoTip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative group inline-flex items-center">
    <Info size={14} className="text-gray-500" />
    <span className="absolute left-1/2 bottom-full -mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-3 py-1 text-[11px] text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 border border-white/10 pointer-events-none">
      {text}
    </span>
  </span>
);

const slugifyTeamName = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const FINAL_GAME_STATUSES = new Set([
  'COMPLETED',
  'FINAL',
  'FORFEITED',
  'FINISHED',
  'COMPLETE',
  'CLOSED',
]);

const isFinalGame = (game: { status?: string | null; homeScore?: number | null; awayScore?: number | null }) => {
  const status = String(game.status || '').toUpperCase();
  if (FINAL_GAME_STATUSES.has(status)) return true;
  return (
    game.homeScore != null &&
    game.awayScore != null &&
    status !== 'SCHEDULED' &&
    status !== 'CANCELED'
  );
};

const isGuestLikeName = (value: string | null | undefined) => /^guest\b/i.test(String(value || '').trim());
const normalizePlayerIdentityName = (value: string | null | undefined) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

type TeamSeasonStatRow = {
  key: string;
  seasonId: string | null;
  seasonLabel: string;
  seasonYear: number;
  teamId: string;
  teamName: string;
  teamLogoUrl: string;
  division: string;
  gp: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  tov: number;
  fgPct: number;
  threePct: number;
  ftPct: number;
  totals: {
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
  createdAtMs: number;
};

type TeamPlayerSeasonStatRow = {
  key: string;
  playerId: string | null;
  mergedPlayerIds?: string[];
  playerName: string;
  jerseyNumber: string;
  position: string | null;
  seasonsPlayed?: number;
  seasonLabel?: string;
  seasonYear?: number;
  divisionLabel?: string;
  gp: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  tov: number;
  fgPct: number;
  threePct: number;
  ftPct: number;
  totals: {
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
};

type TeamStatsSummary = {
  gp: number;
  ppg: number;
  rpg: number;
  apg: number;
  fgPct: number;
  threePct: number;
  ftPct: number;
};

type LeagueStatAverages = {
  rebounds: number;
  assists: number;
  blocks: number;
  steals: number;
};

type TeamStatAverages = {
  rpg: number;
  apg: number;
  bpg: number;
  spg: number;
};

type TeamScoringBreakdown = {
  ppg2: number;
  ppg3: number;
  ppgFT: number;
};

type TeamAdvancedMetrics = {
  poss: number;
  oppPoss: number;
  ortg: number;
  drtg: number;
  net: number;
  pace: number;
  astRatio: number;
  tovRatio: number;
  rebPct: number;
  threeRate: number;
  threeReliance: number;
  ftRate: number;
};

type TeamAnalyticsSnapshot = {
  key: string;
  label: string;
  seasonId: string | null;
  seasonYear: number;
  wins: number;
  losses: number;
  ties: number;
  gp: number;
  ppg: number;
  papg: number;
  leagueOffAvg: number | null;
  leagueDefAvg: number | null;
  leaguePaceAvg: number | null;
  leagueStatAvgs: LeagueStatAverages | null;
  teamStatAverages: TeamStatAverages | null;
  teamScoringBreakdown: TeamScoringBreakdown | null;
  advMetrics: TeamAdvancedMetrics | null;
};

const emptyTotals = () => ({
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
});

const MyTeam: React.FC = () => {
  const { teamId, teamSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [teamsForGames, setTeamsForGames] = useState<Team[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [teamGp, setTeamGp] = useState<number>(0);
  const [leagueOffAvg, setLeagueOffAvg] = useState<number | null>(null);
  const [leagueDefAvg, setLeagueDefAvg] = useState<number | null>(null);
  const [leaguePaceAvg, setLeaguePaceAvg] = useState<number | null>(null);
  const [leagueStatAvgs, setLeagueStatAvgs] = useState<LeagueStatAverages | null>(null);
  const [teamStatAverages, setTeamStatAverages] = useState<TeamStatAverages | null>(null);
  const [teamScoringBreakdown, setTeamScoringBreakdown] = useState<TeamScoringBreakdown | null>(null);
  const [teamTrophyWinners, setTeamTrophyWinners] = useState<TeamTrophyWinners | null>(null);
  const [teamMergeMetaById, setTeamMergeMetaById] = useState<TeamMergeMetadataMap>({});
  const [teamSeasonStatsRows, setTeamSeasonStatsRows] = useState<TeamSeasonStatRow[]>([]);
  const [teamSeasonStatsLoading, setTeamSeasonStatsLoading] = useState(false);
  const [analyticsSnapshots, setAnalyticsSnapshots] = useState<TeamAnalyticsSnapshot[]>([]);
  const [analyticsSnapshotsLoading, setAnalyticsSnapshotsLoading] = useState(false);
  const [selectedAnalyticsKey, setSelectedAnalyticsKey] = useState<string>('current');
  const [activePlayerStatsRows, setActivePlayerStatsRows] = useState<TeamPlayerSeasonStatRow[]>([]);
  const [, setActivePlayerStatsSummary] = useState<TeamStatsSummary | null>(null);
  const [activePlayerStatsLoading, setActivePlayerStatsLoading] = useState(false);
  const [careerPlayerStatsRows, setCareerPlayerStatsRows] = useState<TeamPlayerSeasonStatRow[]>([]);
  const [, setCareerPlayerStatsSummary] = useState<TeamStatsSummary | null>(null);
  const [careerPlayerStatsLoading, setCareerPlayerStatsLoading] = useState(false);
  const [teamStatsTab, setTeamStatsTab] = useState<'active' | 'career'>('active');
  const [teamBadgeCatalog, setTeamBadgeCatalog] = useState(DEFAULT_BADGE_SETTINGS.teamBadges);
  const [teamRatingThresholds, setTeamRatingThresholds] = useState(
    DEFAULT_BADGE_SETTINGS.teamRatingThresholds
  );
  const [advMetrics, setAdvMetrics] = useState<TeamAdvancedMetrics | null>(null);
  const eligibleBadgeKeys = useMemo(() => {
    if (!team?.id || !teamTrophyWinners) return new Set<string>();
    const keys = new Set<string>();
    if (team.id === teamTrophyWinners.championTeamId) keys.add('champion');
    if (team.id === teamTrophyWinners.bestOffenseTeamId) keys.add('top-offense');
    if (team.id === teamTrophyWinners.bestDefenseTeamId) keys.add('top-defense');
    if (team.id === teamTrophyWinners.niceGuysTeamId) keys.add('sportsmanship');
    return keys;
  }, [team?.id, teamTrophyWinners]);
  const teamBadges = useMemo(() => {
    const bucket = supabase.storage.from('public-assets');
    return teamBadgeCatalog
      .filter((badge) => eligibleBadgeKeys.has(badge.key))
      .map((badge) => ({
        ...badge,
        url: bucket.getPublicUrl(`badges/${badge.file}`).data.publicUrl,
      }));
  }, [eligibleBadgeKeys, teamBadgeCatalog]);

  const rosterReturnState = useMemo(
    () => ({
      returnPath: `${location.pathname}${location.search}`,
      returnLabel: team?.name || 'Team',
    }),
    [location.pathname, location.search, team?.name]
  );
  const currentTeamPreviousNames = useMemo(() => {
    if (!team?.id) return [];
    return teamMergeMetaById[team.id]?.previousNames || [];
  }, [team?.id, teamMergeMetaById]);
  const connectedTeamIds = useMemo(() => {
    if (!team?.id) return [];
    return resolveConnectedTeamIds(teamMergeMetaById, team.id);
  }, [team?.id, teamMergeMetaById]);

  useEffect(() => {
    let active = true;
    const loadBadgeConfig = async () => {
      const settings = await loadBadgeSettings();
      if (!active) return;
      setTeamBadgeCatalog(settings.teamBadges);
      setTeamRatingThresholds(settings.teamRatingThresholds);
    };
    loadBadgeConfig();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const loadTeam = async () => {
      try {
        setLoading(true);
        setError(null);

        const signLogo = async (path?: string | null) => {
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

        const user = getStoredUser();
        let targetTeamId: string | null = teamId || null;

        // Only use per-user cache if we have an authenticated user
        if (!targetTeamId && user) {
          try {
            targetTeamId = localStorage.getItem(`courtsight_last_team_id_${user.id}`) || null;
          } catch {
            // ignore
          }
        }

        if (!targetTeamId && user) {
          // Find current season player
          const { data: current } = await supabase
            .from('seasons')
            .select('id')
            .eq('is_current', true)
            .maybeSingle();
          const seasonId = current?.id || null;

          if (seasonId) {
            const { data: player } = await supabase
              .from('players')
              .select('team_id')
              .eq('user_id', user.id)
              .eq('season_id', seasonId)
              .maybeSingle();
            targetTeamId = player?.team_id || null;
          }

          // Fallback to latest player record if none for current season
          if (!targetTeamId) {
            const { data: latestPlayer } = await supabase
              .from('players')
              .select('team_id')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            targetTeamId = latestPlayer?.team_id || null;
          }
        }

        if (!targetTeamId) {
          setError(null);
          setTeam(defaultTeamFallback);
          setGames([]);
          setTeamsForGames([defaultTeamFallback]);
          setRoster([]);
          setTeamTrophyWinners(null);
          setLoading(false);
          return;
        }

        const teamSelect =
          'id,name,division,logo_url,banner_url,season_id';
        const { data: selectedTeamRow, error: teamErr } = await supabase
          .from('teams')
          .select(teamSelect)
          .eq('id', targetTeamId)
          .maybeSingle();
        if (teamErr || !selectedTeamRow) {
          setError(null);
          setTeam(defaultTeamFallback);
          setGames([]);
          setTeamsForGames([defaultTeamFallback]);
          setRoster([]);
          setTeamTrophyWinners(null);
          setLoading(false);
          return;
        }

        // Load games for this team (minimal columns only)
        const { data: gameRows } = await supabase
          .from('games')
          .select(
            'id,season_id,game_datetime,location,court_name,home_team_id,away_team_id,home_score,away_score,status,youtube_url,created_at'
          )
          .or(`home_team_id.eq.${targetTeamId},away_team_id.eq.${targetTeamId}`)
          .order('game_datetime', { ascending: false });

        const relatedTeamIds = Array.from(
          new Set(
            [
              targetTeamId,
              ...((gameRows || []).map((g: any) => g.home_team_id).filter(Boolean)),
              ...((gameRows || []).map((g: any) => g.away_team_id).filter(Boolean)),
            ].filter(Boolean)
          )
        ) as string[];

        let relatedTeamRows: any[] = [];
        if (relatedTeamIds.length > 1) {
          const { data: teamRows } = await supabase
            .from('teams')
            .select(teamSelect)
            .in('id', relatedTeamIds);
          relatedTeamRows = teamRows || [];
        }
        const teamRowMap = new Map<string, any>();
        [selectedTeamRow, ...relatedTeamRows].forEach((row: any) => {
          if (row?.id && !teamRowMap.has(row.id)) {
            teamRowMap.set(row.id, row);
          }
        });

        const signedTeamPairs = await Promise.all(
          Array.from(teamRowMap.values()).map(async (row: any) => {
            const [logoUrl, bannerUrl] = await Promise.all([
              signLogo(row.logo_url),
              row.id === targetTeamId ? signLogo(row.banner_url) : Promise.resolve(''),
            ]);
            const mappedTeam: Team = {
              id: row.id,
              name: row.name,
              division: row.division || 'D1',
              logoUrl: logoUrl || '',
              bannerUrl: row.id === targetTeamId ? bannerUrl || defaultBanner : defaultBanner,
              seasonId: row.season_id || '',
              wins: row.wins ?? 0,
              losses: row.losses ?? 0,
              ties: 0,
              pointsFor: row.points_for ?? 0,
              pointsAgainst: row.points_against ?? 0,
            };
            return [row.id as string, mappedTeam] as const;
          })
        );
        const signedTeams: Record<string, Team> = Object.fromEntries(signedTeamPairs);
        const selectedTeam = signedTeams[targetTeamId];
        const mergeMetadata = await loadTeamMergeMetadata(true).catch((loadErr) => {
          console.warn('my-team merge metadata load failed', loadErr);
          return {};
        });
        setTeamMergeMetaById(mergeMetadata);

        const mappedGames: Game[] = (gameRows || []).map((g: any) => {
          let date = '';
          let time = '';
          if (g.game_datetime) {
            const parts = getScheduleDateTimeParts(g.game_datetime);
            date = parts.date;
            time = parts.time;
          }
          return {
            id: g.id,
            seasonId: g.season_id || '',
            date,
            time,
            location: g.location || g.court_name || '',
            homeTeamId: g.home_team_id,
            awayTeamId: g.away_team_id,
            homeScore: g.home_score ?? undefined,
            awayScore: g.away_score ?? undefined,
            status: (g.status || 'SCHEDULED').toUpperCase(),
            youtubeLink: g.youtube_url || undefined,
            isPlayoff: false,
          };
        });

        let rosterQuery = supabase
          .from('players')
          .select('id,first_name,last_name,jersey_number,is_captain,team_id,position,season_id,is_guest')
          .eq('team_id', targetTeamId);
        if (selectedTeam.seasonId) {
          rosterQuery = rosterQuery.eq('season_id', selectedTeam.seasonId);
        }
        const rosterPromise = rosterQuery;

        // Derive record/points from finalized games to avoid stale/double-counted team table values
        let wins = 0;
        let losses = 0;
        let ties = 0;
        let pointsFor = 0;
        let pointsAgainst = 0;
        let gamesPlayed = 0;

        // League aggregates for ratings
        const leagueAgg: Record<string, { pf: number; pa: number; gp: number }> = {};
        const recordAgg: Record<string, { pf: number; pa: number; gp: number; wins: number; losses: number; ties: number }> = {};
        const addAgg = (team: string, pfVal: number, paVal: number) => {
          if (!team) return;
          const agg = leagueAgg[team] || { pf: 0, pa: 0, gp: 0 };
          agg.pf += pfVal;
          agg.pa += paVal;
          agg.gp += 1;
          leagueAgg[team] = agg;
        };
        const addRecord = (team: string, pfVal: number, paVal: number) => {
          if (!team) return;
          const rec = recordAgg[team] || { pf: 0, pa: 0, gp: 0, wins: 0, losses: 0, ties: 0 };
          rec.pf += pfVal;
          rec.pa += paVal;
          rec.gp += 1;
          if (pfVal > paVal) rec.wins += 1;
          else if (pfVal < paVal) rec.losses += 1;
          else rec.ties += 1;
          recordAgg[team] = rec;
        };

        // Use season games to compute league averages if seasonId exists
        if (selectedTeam.seasonId) {
          const { data: seasonGames } = await supabase
            .from('games')
            .select('home_team_id,away_team_id,home_score,away_score,status')
            .eq('season_id', selectedTeam.seasonId);
          (seasonGames || []).forEach((g: any) => {
            const status = String(g.status || '').toUpperCase();
            const homeScore = g.home_score;
            const awayScore = g.away_score;
            const treatAsFinal =
              (FINAL_GAME_STATUSES.has(status) ||
                (homeScore != null && awayScore != null && status !== 'SCHEDULED' && status !== 'CANCELED')) &&
              homeScore != null &&
              awayScore != null;
            if (!treatAsFinal) return;
            addAgg(g.home_team_id, homeScore, awayScore);
            addAgg(g.away_team_id, awayScore, homeScore);
            addRecord(g.home_team_id, homeScore, awayScore);
            addRecord(g.away_team_id, awayScore, homeScore);
            if (g.home_team_id === targetTeamId || g.away_team_id === targetTeamId) {
              const isHome = g.home_team_id === targetTeamId;
              const myScore = isHome ? homeScore : awayScore;
              const oppScore = isHome ? awayScore : homeScore;
              pointsFor += myScore;
              pointsAgainst += oppScore;
              gamesPlayed += 1;
              if (myScore > oppScore) wins += 1;
              else if (myScore < oppScore) losses += 1;
              else ties += 1;
            }
          });

          const entries = Object.entries(recordAgg).filter(([, rec]) => rec.gp > 0);
          const pickChampion = () => {
            return entries.reduce<string | null>((best, [teamId, rec]) => {
              if (!best) return teamId;
              const bestRec = recordAgg[best];
              const winPct = rec.wins / rec.gp;
              const bestWinPct = bestRec.wins / bestRec.gp;
              if (winPct !== bestWinPct) return winPct > bestWinPct ? teamId : best;
              if (rec.wins !== bestRec.wins) return rec.wins > bestRec.wins ? teamId : best;
              const diff = rec.pf - rec.pa;
              const bestDiff = bestRec.pf - bestRec.pa;
              if (diff !== bestDiff) return diff > bestDiff ? teamId : best;
              return rec.pf > bestRec.pf ? teamId : best;
            }, null);
          };
          const pickBestOffense = () => {
            return entries.reduce<string | null>((best, [teamId, rec]) => {
              if (!best) return teamId;
              const bestRec = recordAgg[best];
              const ppg = rec.pf / rec.gp;
              const bestPpg = bestRec.pf / bestRec.gp;
              if (ppg !== bestPpg) return ppg > bestPpg ? teamId : best;
              return rec.pf > bestRec.pf ? teamId : best;
            }, null);
          };
          const pickBestDefense = () => {
            return entries.reduce<string | null>((best, [teamId, rec]) => {
              if (!best) return teamId;
              const bestRec = recordAgg[best];
              const papg = rec.pa / rec.gp;
              const bestPapg = bestRec.pa / bestRec.gp;
              if (papg !== bestPapg) return papg < bestPapg ? teamId : best;
              return rec.pa < bestRec.pa ? teamId : best;
            }, null);
          };
          let overrideRow: {
            champion_team_id: string | null;
            best_offense_team_id: string | null;
            best_defense_team_id: string | null;
            nice_guys_team_id: string | null;
          } | null = null;
          try {
            const { data: trophyOverrides, error: trophyOverrideErr } = await supabase
              .from('team_trophy_overrides')
              .select(
                'champion_team_id,best_offense_team_id,best_defense_team_id,nice_guys_team_id'
              )
              .eq('season_id', selectedTeam.seasonId)
              .maybeSingle();
            if (trophyOverrideErr) throw trophyOverrideErr;
            overrideRow = trophyOverrides || null;
          } catch (overrideErr) {
            console.warn('team trophy override load failed', overrideErr);
          }
          setTeamTrophyWinners({
            championTeamId: overrideRow?.champion_team_id ?? pickChampion(),
            bestOffenseTeamId: overrideRow?.best_offense_team_id ?? pickBestOffense(),
            bestDefenseTeamId: overrideRow?.best_defense_team_id ?? pickBestDefense(),
            niceGuysTeamId: overrideRow?.nice_guys_team_id ?? null,
          });
        } else {
          setTeamTrophyWinners(null);
        }

        // If no season aggregation found, fall back to mapped games for this team
        if (gamesPlayed === 0) {
          mappedGames.forEach((g) => {
            if (!isFinalGame(g)) return;
            const isHome = g.homeTeamId === targetTeamId;
            const myScore = isHome ? g.homeScore : g.awayScore;
            const oppScore = isHome ? g.awayScore : g.homeScore;
            if (myScore != null && oppScore != null) {
              pointsFor += myScore;
              pointsAgainst += oppScore;
              gamesPlayed += 1;
              if (myScore > oppScore) wins += 1;
              else if (myScore < oppScore) losses += 1;
              else ties += 1;
            }
          });
        }

        // Final fallback to stored team values if no finalized games are available yet
        if (gamesPlayed === 0) {
          wins = selectedTeam.wins || 0;
          losses = selectedTeam.losses || 0;
          ties = selectedTeam.ties || 0;
          pointsFor = selectedTeam.pointsFor || 0;
          pointsAgainst = selectedTeam.pointsAgainst || 0;
        }

        // League averages for ratings
        const offPpgList: number[] = [];
        const defPapgList: number[] = [];
        Object.values(leagueAgg).forEach((agg) => {
          if (agg.gp > 0) {
            offPpgList.push(agg.pf / agg.gp);
            defPapgList.push(agg.pa / agg.gp);
          }
        });
        const offAvg = offPpgList.length ? offPpgList.reduce((a, b) => a + b, 0) / offPpgList.length : null;
        const defAvg = defPapgList.length ? defPapgList.reduce((a, b) => a + b, 0) / defPapgList.length : null;

        const mergedTeam: Team = {
          ...selectedTeam,
          wins,
          losses,
          ties,
          pointsFor,
          pointsAgainst,
        };

        const desiredSlug = slugifyTeamName(mergedTeam.name || '');
        if (targetTeamId && desiredSlug && teamSlug !== desiredSlug) {
          navigate(`/team/${targetTeamId}/${desiredSlug}`, { replace: true });
        }

        setTeam(mergedTeam);
        setGames(mappedGames);
        setTeamsForGames(Object.values(signedTeams));
        setTeamGp(gamesPlayed || Math.max(0, wins + losses + ties));
        setLeagueOffAvg(offAvg);
        setLeagueDefAvg(defAvg);
        try {
          if (user) {
            localStorage.setItem(`courtsight_last_team_id_${user.id}`, mergedTeam.id);
          }
        } catch {}

        // Load roster (query already started earlier)
        const { data: rosterRows } = await rosterPromise;

        const mappedRoster: RosterPlayer[] = (rosterRows || [])
          .map((p: any) => {
            const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
            const startsLikeGuest =
              isGuestLikeName(String(p.first_name || '')) ||
              isGuestLikeName(String(p.last_name || '')) ||
              isGuestLikeName(fullName);
            return {
              id: p.id,
              name: fullName,
              teamId: p.team_id,
              number: p.jersey_number != null ? p.jersey_number : '-',
              isCaptain: !!p.is_captain,
              position: p.position || null,
              isGuest: !!p.is_guest || startsLikeGuest,
            };
          })
          .filter((player) => !player.isGuest);
        setRoster(mappedRoster);
      } catch (err) {
        console.error('my-team load error', err);
        setError(null);
        setTeam(defaultTeamFallback);
        setGames([]);
        setTeamsForGames([defaultTeamFallback]);
        setRoster([]);
        setTeamTrophyWinners(null);
      } finally {
        setLoading(false);
      }
    };

    loadTeam();
  }, [navigate, teamId, teamSlug]);

  useEffect(() => {
    const computeAdvanced = async () => {
      try {
        if (!team?.id || games.length === 0) {
          setAdvMetrics(null);
          setLeaguePaceAvg(null);
          setLeagueStatAvgs(null);
          setTeamStatAverages(null);
          setTeamScoringBreakdown(null);
          return;
        }
        const gameIds = games
          .filter((g) => isFinalGame(g))
          .map((g) => g.id);
        if (!gameIds.length) {
          setAdvMetrics(null);
          setLeaguePaceAvg(null);
          setLeagueStatAvgs(null);
          setTeamStatAverages(null);
          setTeamScoringBreakdown(null);
          return;
        }
        const { data: statRows, error } = await supabase
          .from('game_stats')
          .select(
          'game_id, team_id, points, rebounds, offensive_rebounds, defensive_rebounds, turnovers, ftm, fta, fgm, fga, tpm, tpa, assists, blocks, steals'
          )
          .in('game_id', gameIds);
        if (error) throw error;
        if (!statRows || statRows.length === 0) {
          setAdvMetrics(null);
          setLeaguePaceAvg(null);
          setLeagueStatAvgs(null);
          setTeamStatAverages(null);
          setTeamScoringBreakdown(null);
          return;
        }

        let leagueStatRows: any[] = statRows;
        if (team.seasonId) {
          try {
            const { data: seasonGameRows } = await supabase
              .from('games')
              .select('id,status,home_score,away_score')
              .eq('season_id', team.seasonId);
            const finalSeasonGameIds = (seasonGameRows || [])
              .filter((row: any) =>
                isFinalGame({
                  status: row.status,
                  homeScore: row.home_score,
                  awayScore: row.away_score,
                })
              )
              .map((row: any) => row.id)
              .filter(Boolean);
            if (finalSeasonGameIds.length) {
              const { data: seasonStatRows, error: seasonStatErr } = await supabase
                .from('game_stats')
                .select(
                  'game_id, team_id, points, rebounds, offensive_rebounds, defensive_rebounds, turnovers, ftm, fta, fgm, fga, tpm, tpa, assists, blocks, steals'
                )
                .in('game_id', finalSeasonGameIds);
              if (seasonStatErr) throw seasonStatErr;
              if (seasonStatRows && seasonStatRows.length > 0) {
                leagueStatRows = seasonStatRows;
              }
            }
          } catch (seasonStatsErr) {
            console.warn('Season-wide league stat load failed, using team game sample.', seasonStatsErr);
          }
        }

        const toNum = (value: any) => Number(value) || 0;
        const getReb = (row: any) => {
          const o = toNum(row.offensive_rebounds);
          const d = toNum(row.defensive_rebounds);
          const total = toNum(row.rebounds);
          return {
            o,
            d,
            total: o || d ? o + d : total,
          };
        };

        type TeamGameTotals = {
          gameId: string;
          teamId: string;
          pts: number;
          tov: number;
          ftm: number;
          fta: number;
          fgm: number;
          fga: number;
          tpm: number;
          tpa: number;
          ast: number;
          oreb: number;
          dreb: number;
          reb: number;
          blk: number;
          stl: number;
        };

        const buildTeamGameTotals = (rows: any[]) => {
          const totalsByTeamGame = new Map<string, TeamGameTotals>();
          rows.forEach((row: any) => {
            const gameId = String(row.game_id || '').trim();
            const teamId = String(row.team_id || '').trim();
            if (!gameId || !teamId) return;
            const key = `${gameId}::${teamId}`;
            const reb = getReb(row);
            const existing = totalsByTeamGame.get(key) || {
              gameId,
              teamId,
              pts: 0,
              tov: 0,
              ftm: 0,
              fta: 0,
              fgm: 0,
              fga: 0,
              tpm: 0,
              tpa: 0,
              ast: 0,
              oreb: 0,
              dreb: 0,
              reb: 0,
              blk: 0,
              stl: 0,
            };
            existing.pts += toNum(row.points);
            existing.tov += toNum(row.turnovers);
            existing.ftm += toNum(row.ftm);
            existing.fta += toNum(row.fta);
            existing.fgm += toNum(row.fgm);
            existing.fga += toNum(row.fga);
            existing.tpm += toNum(row.tpm);
            existing.tpa += toNum(row.tpa);
            existing.ast += toNum(row.assists);
            existing.oreb += reb.o;
            existing.dreb += reb.d;
            existing.reb += reb.total;
            existing.blk += toNum(row.blocks);
            existing.stl += toNum(row.steals);
            totalsByTeamGame.set(key, existing);
          });
          return Array.from(totalsByTeamGame.values());
        };

        const teamGameTotals = buildTeamGameTotals(statRows || []);
        const leagueTeamGameTotals = buildTeamGameTotals(leagueStatRows || []);
        const myTeamGameRows = teamGameTotals.filter((row) => row.teamId === team.id);
        if (!myTeamGameRows.length) {
          setAdvMetrics(null);
          setLeaguePaceAvg(null);
          setLeagueStatAvgs(null);
          setTeamStatAverages(null);
          setTeamScoringBreakdown(null);
          return;
        }

        const pairedGameRows = myTeamGameRows
          .map((teamRow) => {
            const oppRow = teamGameTotals.find(
              (candidate) => candidate.gameId === teamRow.gameId && candidate.teamId !== team.id
            );
            if (!oppRow) return null;
            return { teamRow, oppRow };
          })
          .filter((entry): entry is { teamRow: TeamGameTotals; oppRow: TeamGameTotals } => Boolean(entry));

        const hasPairedGames = pairedGameRows.length > 0;
        const teamRowsForMetrics = hasPairedGames
          ? pairedGameRows.map((entry) => entry.teamRow)
          : myTeamGameRows;
        const oppRowsForMetrics = hasPairedGames
          ? pairedGameRows.map((entry) => entry.oppRow)
          : [];

        const aggFrom = (rows: TeamGameTotals[]) =>
          rows.reduce(
            (acc, row) => {
              acc.pts += row.pts;
              acc.tov += row.tov;
              acc.ftm += row.ftm;
              acc.fta += row.fta;
              acc.fgm += row.fgm;
              acc.fga += row.fga;
              acc.tpm += row.tpm;
              acc.tpa += row.tpa;
              acc.ast += row.ast;
              acc.oreb += row.oreb;
              acc.dreb += row.dreb;
              acc.reb += row.reb;
              acc.blk += row.blk;
              acc.stl += row.stl;
              return acc;
            },
            {
              pts: 0,
              tov: 0,
              ftm: 0,
              fta: 0,
              fgm: 0,
              fga: 0,
              tpm: 0,
              tpa: 0,
              ast: 0,
              oreb: 0,
              dreb: 0,
              reb: 0,
              blk: 0,
              stl: 0,
            }
          );

        const teamAgg = aggFrom(teamRowsForMetrics);
        const oppAgg = aggFrom(oppRowsForMetrics);

        const gamesPlayed = Math.max(1, teamRowsForMetrics.length);
        const teamPoss = teamAgg.fga - teamAgg.oreb + teamAgg.tov + 0.44 * teamAgg.fta;
        const oppPoss = oppAgg.fga - oppAgg.oreb + oppAgg.tov + 0.44 * oppAgg.fta;

        const ortg = teamPoss > 0 ? (teamAgg.pts / teamPoss) * 100 : 0;
        const drtg = oppPoss > 0 ? (oppAgg.pts / oppPoss) * 100 : 0;
        const net = ortg - drtg;
        const pace = hasPairedGames ? (teamPoss + oppPoss) / 2 / gamesPlayed : teamPoss / gamesPlayed;
        const astRatio = teamAgg.fgm > 0 ? teamAgg.ast / teamAgg.fgm : 0;
        const tovRatio = teamPoss > 0 ? (teamAgg.tov / teamPoss) * 100 : 0;
        const rebPct =
          hasPairedGames && teamAgg.reb + oppAgg.reb > 0 ? teamAgg.reb / (teamAgg.reb + oppAgg.reb) : 0.5;
        const threeRate = teamAgg.fga > 0 ? teamAgg.tpa / teamAgg.fga : 0;
        const threeReliance = teamAgg.pts > 0 ? (teamAgg.tpm * 3) / teamAgg.pts : 0;
        const ftRate = teamAgg.fga > 0 ? teamAgg.fta / teamAgg.fga : 0;

        const possessionFromTotals = (row: TeamGameTotals) =>
          row.fga - row.oreb + row.tov + 0.44 * row.fta;
        const leagueRowsByGame = new Map<string, TeamGameTotals[]>();
        leagueTeamGameTotals.forEach((row) => {
          const bucket = leagueRowsByGame.get(row.gameId) || [];
          bucket.push(row);
          leagueRowsByGame.set(row.gameId, bucket);
        });
        const leagueGamePaces = Array.from(leagueRowsByGame.values())
          .map((rows) => {
            if (rows.length < 2) return null;
            const avgPoss = rows.reduce((acc, row) => acc + possessionFromTotals(row), 0) / rows.length;
            return avgPoss;
          })
          .filter((value): value is number => value != null && Number.isFinite(value));
        const totalLeaguePoss = leagueTeamGameTotals.reduce(
          (acc, row) => acc + possessionFromTotals(row),
          0
        );
        const leaguePace = leagueGamePaces.length
          ? leagueGamePaces.reduce((acc, value) => acc + value, 0) / leagueGamePaces.length
          : leagueTeamGameTotals.length
          ? totalLeaguePoss / leagueTeamGameTotals.length
          : 0;
        const leagueAvgStats = {
          rebounds: leagueTeamGameTotals.length
            ? leagueTeamGameTotals.reduce((acc, row) => acc + row.reb, 0) / leagueTeamGameTotals.length
            : 0,
          assists: leagueTeamGameTotals.length
            ? leagueTeamGameTotals.reduce((acc, row) => acc + row.ast, 0) / leagueTeamGameTotals.length
            : 0,
          blocks: leagueTeamGameTotals.length
            ? leagueTeamGameTotals.reduce((acc, row) => acc + row.blk, 0) / leagueTeamGameTotals.length
            : 0,
          steals: leagueTeamGameTotals.length
            ? leagueTeamGameTotals.reduce((acc, row) => acc + row.stl, 0) / leagueTeamGameTotals.length
            : 0,
        };
        const statGameCount = Math.max(1, teamRowsForMetrics.length);
        const teamAvgStats = {
          rpg: teamAgg.reb / statGameCount,
          apg: teamAgg.ast / statGameCount,
          bpg: teamAgg.blk / statGameCount,
          spg: teamAgg.stl / statGameCount,
        };
        const twoPointMakes = Math.max(0, teamAgg.fgm - teamAgg.tpm);
        const scoringBreakdown = {
          ppg2: (twoPointMakes * 2) / statGameCount,
          ppg3: (teamAgg.tpm * 3) / statGameCount,
          ppgFT: teamAgg.ftm / statGameCount,
        };

        setAdvMetrics({
          poss: teamPoss / gamesPlayed,
          oppPoss: oppPoss / gamesPlayed,
          ortg,
          drtg,
          net,
          pace,
          astRatio,
          tovRatio,
          rebPct,
          threeRate,
          threeReliance,
          ftRate,
        });
        setLeaguePaceAvg(leaguePace);
        setLeagueStatAvgs(leagueAvgStats);
        setTeamStatAverages(teamAvgStats);
        setTeamScoringBreakdown(scoringBreakdown);
      } catch (err) {
        console.error('Advanced metrics load error', err);
        setAdvMetrics(null);
        setLeaguePaceAvg(null);
        setLeagueStatAvgs(null);
        setTeamStatAverages(null);
        setTeamScoringBreakdown(null);
      }
    };

    computeAdvanced();
  }, [team?.id, games]);

  useEffect(() => {
    setTeamStatsTab('active');
  }, [team?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadTeamSeasonStats = async () => {
      if (!team?.id || !team?.name) {
        if (!cancelled) {
          setTeamSeasonStatsRows([]);
          setTeamSeasonStatsLoading(false);
        }
        return;
      }

      setTeamSeasonStatsLoading(true);

      const fallbackRow: TeamSeasonStatRow = {
        key: `${team.id}:${team.seasonId || 'active'}`,
        seasonId: team.seasonId || null,
        seasonLabel: 'Active Season',
        seasonYear: 0,
        teamId: team.id,
        teamName: team.name,
        teamLogoUrl: team.logoUrl || '',
        division: team.division || 'Division',
        gp: 0,
        ppg: 0,
        rpg: 0,
        apg: 0,
        spg: 0,
        bpg: 0,
        tov: 0,
        fgPct: 0,
        threePct: 0,
        ftPct: 0,
        totals: emptyTotals(),
        createdAtMs: 0,
      };

      try {
        const extractYear = (label: string) => {
          const match = label.match(/(20\d{2})/);
          if (!match) return 0;
          const value = Number(match[1]);
          return Number.isFinite(value) ? value : 0;
        };

        const toNum = (value: any) => Number(value) || 0;
        const getReb = (row: any) => {
          const offensive = toNum(row.offensive_rebounds);
          const defensive = toNum(row.defensive_rebounds);
          const total = toNum(row.rebounds);
          return offensive || defensive ? offensive + defensive : total;
        };

        const signLogo = async (path?: string | null) => {
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
        const baseTeamRow = {
          id: team.id,
          name: team.name,
          division: team.division || '',
          logo_url: team.logoUrl || '',
          season_id: team.seasonId || null,
          created_at: null,
        };
        const linkedTeamIds = connectedTeamIds.filter(Boolean);
        const linkedNames = Array.from(
          new Set(
            linkedTeamIds
              .flatMap((id) => {
                const entry = teamMergeMetaById[id];
                return entry ? entry.previousNames || [] : [];
              })
              .map((name) => String(name || '').trim())
              .filter(Boolean)
          )
        );
        const nameCandidates = Array.from(
          new Set([team.name, ...linkedNames].map((name) => String(name || '').trim()).filter(Boolean))
        );

        const candidateRowsById = new Map<string, any>();
        const addCandidateRows = (rows: any[]) => {
          (rows || []).forEach((row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            candidateRowsById.set(id, row);
          });
        };

        if (linkedTeamIds.length) {
          try {
            const { data, error } = await supabase
              .from('teams')
              .select('id,name,division,logo_url,season_id,created_at')
              .in('id', linkedTeamIds);
            if (error) throw error;
            addCandidateRows(data || []);
          } catch (linkedErr) {
            console.warn('linked team lookup failed', linkedErr);
          }
        }

        try {
          const { data, error } = await supabase
            .from('teams')
            .select('id,name,division,logo_url,season_id,created_at')
            .in('name', nameCandidates)
            .limit(250);
          if (error) throw error;
          addCandidateRows(data || []);
        } catch {
          const primaryName = nameCandidates[0] || team.name;
          const { data } = await supabase
            .from('teams')
            .select('id,name,division,logo_url,season_id,created_at')
            .ilike('name', primaryName)
            .limit(250);
          addCandidateRows(data || []);
        }

        const candidateRows = Array.from(candidateRowsById.values());

        const byId = new Map<string, any>();
        [baseTeamRow, ...(candidateRows || [])].forEach((row: any) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          byId.set(id, row);
        });

        const linkedIdSet = new Set(linkedTeamIds);
        const candidateNameSet = new Set(nameCandidates.map((name) => name.toLowerCase()));
        const sameNameRows = Array.from(byId.values()).filter((row: any) =>
          candidateNameSet.has(String(row?.name || '').trim().toLowerCase())
        );
        const connectedRows = Array.from(byId.values()).filter((row: any) =>
          linkedIdSet.has(String(row?.id || '').trim())
        );
        const unionRowsById = new Map<string, any>();
        [...connectedRows, ...sameNameRows].forEach((row: any) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          unionRowsById.set(id, row);
        });
        const teamRows = unionRowsById.size
          ? Array.from(unionRowsById.values())
          : Array.from(byId.values());
        const teamLogoPairs = await Promise.all(
          teamRows.map(async (row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return null;
            const logo = await signLogo(row?.logo_url);
            return [id, logo] as const;
          })
        );
        const teamLogoMap = new Map<string, string>(
          teamLogoPairs.filter((pair): pair is readonly [string, string] => !!pair)
        );
        const teamIds = teamRows
          .map((row: any) => String(row?.id || '').trim())
          .filter(Boolean);

        if (!teamIds.length) {
          if (!cancelled) setTeamSeasonStatsRows([fallbackRow]);
          return;
        }

        const seasonIds = Array.from(
          new Set(
            teamRows
              .map((row: any) => String(row?.season_id || '').trim())
              .filter(Boolean)
          )
        );

        const seasonMap = new Map<string, { name: string; year: number }>();
        if (seasonIds.length) {
          const { data: seasonRows } = await supabase
            .from('seasons')
            .select('id,name,year')
            .in('id', seasonIds);
          (seasonRows || []).forEach((row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            seasonMap.set(id, {
              name: String(row?.name || 'Season'),
              year: Number(row?.year) || 0,
            });
          });
        }

        const { data: statRows, error: statErr } = await supabase
          .from('game_stats')
          .select(
            'game_id,team_id,points,rebounds,offensive_rebounds,defensive_rebounds,assists,steals,blocks,turnovers,fgm,fga,tpm,tpa,ftm,fta'
          )
          .in('team_id', teamIds);
        if (statErr) throw statErr;

        const gameIds = Array.from(
          new Set((statRows || []).map((row: any) => String(row?.game_id || '').trim()).filter(Boolean))
        );

        const gameMap = new Map<
          string,
          { id: string; season_id: string | null; status: string | null; home_score: number | null; away_score: number | null }
        >();
        if (gameIds.length) {
          const { data: gameRows, error: gameErr } = await supabase
            .from('games')
            .select('id,season_id,status,home_score,away_score')
            .in('id', gameIds);
          if (gameErr) throw gameErr;
          (gameRows || []).forEach((row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            gameMap.set(id, {
              id,
              season_id: row?.season_id ? String(row.season_id) : null,
              status: row?.status || null,
              home_score: row?.home_score ?? null,
              away_score: row?.away_score ?? null,
            });
          });
        }

        const teamGameTotals = new Map<
          string,
          {
            teamId: string;
            seasonId: string | null;
            gameId: string;
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
          }
        >();

        (statRows || []).forEach((row: any) => {
          const gameId = String(row?.game_id || '').trim();
          const teamId = String(row?.team_id || '').trim();
          if (!gameId || !teamId) return;
          const game = gameMap.get(gameId);
          if (!game) return;
          if (
            !isFinalGame({
              status: game.status,
              homeScore: game.home_score,
              awayScore: game.away_score,
            })
          ) {
            return;
          }

          const fallbackSeasonId =
            teamRows.find((candidate: any) => String(candidate?.id || '').trim() === teamId)?.season_id || null;
          const seasonId = game.season_id || (fallbackSeasonId ? String(fallbackSeasonId) : null);
          const key = `${teamId}::${seasonId || ''}::${gameId}`;
          const existing = teamGameTotals.get(key) || {
            teamId,
            seasonId,
            gameId,
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
          };
          existing.pts += toNum(row?.points);
          existing.reb += getReb(row);
          existing.ast += toNum(row?.assists);
          existing.stl += toNum(row?.steals);
          existing.blk += toNum(row?.blocks);
          existing.tov += toNum(row?.turnovers);
          existing.fgm += toNum(row?.fgm);
          existing.fga += toNum(row?.fga);
          existing.tpm += toNum(row?.tpm);
          existing.tpa += toNum(row?.tpa);
          existing.ftm += toNum(row?.ftm);
          existing.fta += toNum(row?.fta);
          teamGameTotals.set(key, existing);
        });

        const seasonTotalsByTeam = new Map<
          string,
          {
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
          }
        >();

        Array.from(teamGameTotals.values()).forEach((entry) => {
          const key = `${entry.teamId}::${entry.seasonId || ''}`;
          const existing = seasonTotalsByTeam.get(key) || {
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
          };
          existing.gp += 1;
          existing.pts += entry.pts;
          existing.reb += entry.reb;
          existing.ast += entry.ast;
          existing.stl += entry.stl;
          existing.blk += entry.blk;
          existing.tov += entry.tov;
          existing.fgm += entry.fgm;
          existing.fga += entry.fga;
          existing.tpm += entry.tpm;
          existing.tpa += entry.tpa;
          existing.ftm += entry.ftm;
          existing.fta += entry.fta;
          seasonTotalsByTeam.set(key, existing);
        });

        const rows: TeamSeasonStatRow[] = teamRows
          .map((row: any) => {
            const teamId = String(row?.id || '').trim();
            if (!teamId) return null;
            const seasonId = row?.season_id ? String(row.season_id) : null;
            const seasonKey = `${teamId}::${seasonId || ''}`;
            const totals = seasonTotalsByTeam.get(seasonKey) || {
              gp: 0,
              ...emptyTotals(),
            };
            const gp = totals.gp || 0;
            const seasonInfo = seasonId ? seasonMap.get(seasonId) : null;
            const seasonLabel =
              seasonInfo?.name ||
              (seasonId === team.seasonId ? 'Active Season' : 'Season');
            const seasonYear = seasonInfo?.year || extractYear(seasonLabel);
            const createdAtMs = (() => {
              const parsed = new Date(row?.created_at || '').getTime();
              return Number.isFinite(parsed) ? parsed : 0;
            })();

            return {
              key: `${teamId}:${seasonId || ''}`,
              seasonId,
              seasonLabel,
              seasonYear,
              teamId,
              teamName: String(row?.name || team.name || 'Team'),
              teamLogoUrl: teamLogoMap.get(teamId) || team.logoUrl || '',
              division: String(row?.division || team.division || 'Division'),
              gp,
              ppg: gp > 0 ? totals.pts / gp : 0,
              rpg: gp > 0 ? totals.reb / gp : 0,
              apg: gp > 0 ? totals.ast / gp : 0,
              spg: gp > 0 ? totals.stl / gp : 0,
              bpg: gp > 0 ? totals.blk / gp : 0,
              tov: gp > 0 ? totals.tov / gp : 0,
              fgPct: totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0,
              threePct: totals.tpa > 0 ? (totals.tpm / totals.tpa) * 100 : 0,
              ftPct: totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0,
              totals: {
                pts: totals.pts,
                reb: totals.reb,
                ast: totals.ast,
                stl: totals.stl,
                blk: totals.blk,
                tov: totals.tov,
                fgm: totals.fgm,
                fga: totals.fga,
                tpm: totals.tpm,
                tpa: totals.tpa,
                ftm: totals.ftm,
                fta: totals.fta,
              },
              createdAtMs,
            } as TeamSeasonStatRow;
          })
          .filter((row): row is TeamSeasonStatRow => !!row)
          .sort((a, b) => {
            if (a.seasonYear !== b.seasonYear) return b.seasonYear - a.seasonYear;
            if (a.createdAtMs !== b.createdAtMs) return b.createdAtMs - a.createdAtMs;
            return a.teamName.localeCompare(b.teamName);
          });

        const finalRows = rows.length ? rows : [fallbackRow];
        if (!cancelled) {
          setTeamSeasonStatsRows(finalRows);
        }
      } catch (err) {
        console.warn('team season stats load failed', err);
        if (!cancelled) {
          setTeamSeasonStatsRows([fallbackRow]);
        }
      } finally {
        if (!cancelled) {
          setTeamSeasonStatsLoading(false);
        }
      }
    };

    loadTeamSeasonStats();
    return () => {
      cancelled = true;
    };
  }, [team?.id, team?.name, team?.seasonId, team?.division, connectedTeamIds, teamMergeMetaById]);

  useEffect(() => {
    setSelectedAnalyticsKey('current');
  }, [team?.id]);

  useEffect(() => {
    if (!analyticsSnapshots.length) return;
    if (!analyticsSnapshots.some((snapshot) => snapshot.key === selectedAnalyticsKey)) {
      setSelectedAnalyticsKey(analyticsSnapshots[0].key);
    }
  }, [analyticsSnapshots, selectedAnalyticsKey]);

  useEffect(() => {
    let cancelled = false;

    const loadAnalyticsSnapshots = async () => {
      if (!team?.id) {
        if (!cancelled) {
          setAnalyticsSnapshots([]);
          setAnalyticsSnapshotsLoading(false);
        }
        return;
      }

      const seasonRows = teamSeasonStatsRows.filter((row) => {
        const teamId = String(row.teamId || '').trim();
        const seasonId = String(row.seasonId || '').trim();
        return !!teamId && (!!seasonId || row.gp > 0);
      });
      if (!seasonRows.length) {
        if (!cancelled) {
          setAnalyticsSnapshots([]);
          setAnalyticsSnapshotsLoading(false);
        }
        return;
      }

      setAnalyticsSnapshotsLoading(true);

      try {
        type TeamGameTotals = {
          gameId: string;
          seasonId: string | null;
          teamId: string;
          pts: number;
          tov: number;
          ftm: number;
          fta: number;
          fgm: number;
          fga: number;
          tpm: number;
          tpa: number;
          ast: number;
          oreb: number;
          dreb: number;
          reb: number;
          blk: number;
          stl: number;
        };

        type ScoreSummary = {
          pf: number;
          pa: number;
          gp: number;
        };

        type RecordSummary = {
          wins: number;
          losses: number;
          ties: number;
        };

        const toNum = (value: any) => Number(value) || 0;
        const seasonIds = Array.from(
          new Set(
            seasonRows
              .map((row) => String(row.seasonId || '').trim())
              .filter(Boolean)
          )
        );
        const fallbackTotalsForRows = (rows: TeamSeasonStatRow[]) =>
          rows.reduce(
            (acc, row) => {
              acc.gp += row.gp;
              acc.pts += row.totals.pts;
              acc.reb += row.totals.reb;
              acc.ast += row.totals.ast;
              acc.stl += row.totals.stl;
              acc.blk += row.totals.blk;
              acc.tov += row.totals.tov;
              acc.fgm += row.totals.fgm;
              acc.fga += row.totals.fga;
              acc.tpm += row.totals.tpm;
              acc.tpa += row.totals.tpa;
              acc.ftm += row.totals.ftm;
              acc.fta += row.totals.fta;
              return acc;
            },
            {
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
            }
          );

        const createFallbackSnapshot = (
          key: string,
          label: string,
          seasonId: string | null,
          seasonYear: number,
          rows: TeamSeasonStatRow[]
        ): TeamAnalyticsSnapshot => {
          const totals = fallbackTotalsForRows(rows);
          const gp = totals.gp || 0;
          const ppg = gp > 0 ? totals.pts / gp : 0;
          const papg = 0;
          const teamStatFallback =
            gp > 0
              ? {
                  rpg: totals.reb / gp,
                  apg: totals.ast / gp,
                  bpg: totals.blk / gp,
                  spg: totals.stl / gp,
                }
              : null;
          const scoringFallback =
            gp > 0
              ? {
                  ppg2: Math.max(0, totals.fgm - totals.tpm) * 2 / gp,
                  ppg3: totals.tpm * 3 / gp,
                  ppgFT: totals.ftm / gp,
                }
              : null;

          return {
            key,
            label,
            seasonId,
            seasonYear,
            wins: 0,
            losses: 0,
            ties: 0,
            gp,
            ppg,
            papg,
            leagueOffAvg: null,
            leagueDefAvg: null,
            leaguePaceAvg: null,
            leagueStatAvgs: null,
            teamStatAverages: teamStatFallback,
            teamScoringBreakdown: scoringFallback,
            advMetrics: null,
          };
        };

        if (!seasonIds.length) {
          if (!cancelled) {
            setAnalyticsSnapshots(
              seasonRows.map((row) =>
                createFallbackSnapshot(row.key, row.seasonLabel, row.seasonId, row.seasonYear, [row])
              )
            );
          }
          return;
        }

        const { data: gameRows, error: gameErr } = await supabase
          .from('games')
          .select('id,season_id,status,home_score,away_score,home_team_id,away_team_id')
          .in('season_id', seasonIds);
        if (gameErr) throw gameErr;

        const finalGames = (gameRows || []).filter((game: any) =>
          isFinalGame({
            status: game?.status,
            homeScore: game?.home_score,
            awayScore: game?.away_score,
          })
        );
        const finalGameIds = finalGames
          .map((game: any) => String(game?.id || '').trim())
          .filter(Boolean);
        const gameById = new Map<
          string,
          {
            id: string;
            seasonId: string | null;
            homeTeamId: string | null;
            awayTeamId: string | null;
            homeScore: number;
            awayScore: number;
          }
        >();
        finalGames.forEach((game: any) => {
          const id = String(game?.id || '').trim();
          if (!id) return;
          gameById.set(id, {
            id,
            seasonId: game?.season_id ? String(game.season_id).trim() : null,
            homeTeamId: game?.home_team_id ? String(game.home_team_id).trim() : null,
            awayTeamId: game?.away_team_id ? String(game.away_team_id).trim() : null,
            homeScore: toNum(game?.home_score),
            awayScore: toNum(game?.away_score),
          });
        });

        let statRows: any[] = [];
        if (finalGameIds.length) {
          const { data, error: statErr } = await supabase
            .from('game_stats')
            .select(
              'game_id,team_id,points,rebounds,offensive_rebounds,defensive_rebounds,turnovers,ftm,fta,fgm,fga,tpm,tpa,assists,blocks,steals'
            )
            .in('game_id', finalGameIds);
          if (statErr) throw statErr;
          statRows = data || [];
        }

        const getReb = (row: any) => {
          const offensive = toNum(row?.offensive_rebounds);
          const defensive = toNum(row?.defensive_rebounds);
          const total = toNum(row?.rebounds);
          return {
            offensive,
            defensive,
            total: offensive || defensive ? offensive + defensive : total,
          };
        };

        const buildTeamGameTotals = (rows: any[]) => {
          const totalsByKey = new Map<string, TeamGameTotals>();
          rows.forEach((row: any) => {
            const gameId = String(row?.game_id || '').trim();
            const teamId = String(row?.team_id || '').trim();
            if (!gameId || !teamId) return;
            const game = gameById.get(gameId);
            if (!game) return;
            const key = `${gameId}::${teamId}`;
            const reb = getReb(row);
            const existing = totalsByKey.get(key) || {
              gameId,
              seasonId: game.seasonId,
              teamId,
              pts: 0,
              tov: 0,
              ftm: 0,
              fta: 0,
              fgm: 0,
              fga: 0,
              tpm: 0,
              tpa: 0,
              ast: 0,
              oreb: 0,
              dreb: 0,
              reb: 0,
              blk: 0,
              stl: 0,
            };
            existing.pts += toNum(row?.points);
            existing.tov += toNum(row?.turnovers);
            existing.ftm += toNum(row?.ftm);
            existing.fta += toNum(row?.fta);
            existing.fgm += toNum(row?.fgm);
            existing.fga += toNum(row?.fga);
            existing.tpm += toNum(row?.tpm);
            existing.tpa += toNum(row?.tpa);
            existing.ast += toNum(row?.assists);
            existing.oreb += reb.offensive;
            existing.dreb += reb.defensive;
            existing.reb += reb.total;
            existing.blk += toNum(row?.blocks);
            existing.stl += toNum(row?.steals);
            totalsByKey.set(key, existing);
          });
          return Array.from(totalsByKey.values());
        };

        const allTeamGameTotals = buildTeamGameTotals(statRows);
        const rowsByGameId = new Map<string, TeamGameTotals[]>();
        allTeamGameTotals.forEach((row) => {
          const bucket = rowsByGameId.get(row.gameId) || [];
          bucket.push(row);
          rowsByGameId.set(row.gameId, bucket);
        });

        const seasonLeagueRows = new Map<string, TeamGameTotals[]>();
        allTeamGameTotals.forEach((row) => {
          const seasonKey = String(row.seasonId || '').trim();
          if (!seasonKey) return;
          const bucket = seasonLeagueRows.get(seasonKey) || [];
          bucket.push(row);
          seasonLeagueRows.set(seasonKey, bucket);
        });

        const scoreSummaryBySeasonTeamKey = new Map<string, ScoreSummary>();
        const recordSummaryBySeasonTeamKey = new Map<string, RecordSummary>();
        const leagueScoreSummariesBySeason = new Map<string, Map<string, ScoreSummary>>();
        finalGames.forEach((game: any) => {
          const seasonId = String(game?.season_id || '').trim();
          const homeTeamId = String(game?.home_team_id || '').trim();
          const awayTeamId = String(game?.away_team_id || '').trim();
          const homeScore = toNum(game?.home_score);
          const awayScore = toNum(game?.away_score);
          if (!seasonId || !homeTeamId || !awayTeamId) return;

          const applySeasonTeamScore = (teamId: string, pf: number, pa: number) => {
            const seasonTeamKey = `${teamId}::${seasonId}`;
            const existing = scoreSummaryBySeasonTeamKey.get(seasonTeamKey) || {
              pf: 0,
              pa: 0,
              gp: 0,
            };
            existing.pf += pf;
            existing.pa += pa;
            existing.gp += 1;
            scoreSummaryBySeasonTeamKey.set(seasonTeamKey, existing);

            const recordExisting = recordSummaryBySeasonTeamKey.get(seasonTeamKey) || {
              wins: 0,
              losses: 0,
              ties: 0,
            };
            if (pf > pa) recordExisting.wins += 1;
            else if (pf < pa) recordExisting.losses += 1;
            else recordExisting.ties += 1;
            recordSummaryBySeasonTeamKey.set(seasonTeamKey, recordExisting);

            const seasonSummary = leagueScoreSummariesBySeason.get(seasonId) || new Map<string, ScoreSummary>();
            const leagueExisting = seasonSummary.get(teamId) || { pf: 0, pa: 0, gp: 0 };
            leagueExisting.pf += pf;
            leagueExisting.pa += pa;
            leagueExisting.gp += 1;
            seasonSummary.set(teamId, leagueExisting);
            leagueScoreSummariesBySeason.set(seasonId, seasonSummary);
          };

          applySeasonTeamScore(homeTeamId, homeScore, awayScore);
          applySeasonTeamScore(awayTeamId, awayScore, homeScore);
        });

        const getLeagueScoreAverages = (seasonId: string | null) => {
          const buckets = seasonId
            ? Array.from(leagueScoreSummariesBySeason.get(seasonId)?.values() || [])
            : Array.from(leagueScoreSummariesBySeason.values()).flatMap((seasonMap) =>
                Array.from(seasonMap.values())
              );
          if (!buckets.length) {
            return { leagueOffAvg: null, leagueDefAvg: null };
          }
          return {
            leagueOffAvg: buckets.reduce((acc, item) => acc + item.pf / Math.max(1, item.gp), 0) / buckets.length,
            leagueDefAvg: buckets.reduce((acc, item) => acc + item.pa / Math.max(1, item.gp), 0) / buckets.length,
          };
        };

        const aggregateSnapshot = (
          key: string,
          label: string,
          seasonId: string | null,
          seasonYear: number,
          rows: TeamSeasonStatRow[]
        ): TeamAnalyticsSnapshot => {
          const seasonKeys = new Set(rows.map((row) => `${row.teamId}::${row.seasonId || ''}`));
          const relevantTeamRows = allTeamGameTotals.filter((row) =>
            seasonKeys.has(`${row.teamId}::${row.seasonId || ''}`)
          );
          const pairedGameRows = relevantTeamRows
            .map((teamRow) => {
              const opponentRow = (rowsByGameId.get(teamRow.gameId) || []).find(
                (candidate) => candidate.teamId !== teamRow.teamId
              );
              if (!opponentRow) return null;
              return { teamRow, opponentRow };
            })
            .filter(
              (entry): entry is { teamRow: TeamGameTotals; opponentRow: TeamGameTotals } => Boolean(entry)
            );
          const hasPairedGames = pairedGameRows.length > 0;
          const teamRowsForMetrics = hasPairedGames
            ? pairedGameRows.map((entry) => entry.teamRow)
            : relevantTeamRows;
          const oppRowsForMetrics = hasPairedGames
            ? pairedGameRows.map((entry) => entry.opponentRow)
            : [];
          const fallbackTotals = fallbackTotalsForRows(rows);
          const fallbackGp = fallbackTotals.gp || 0;
          const fallbackPpg = fallbackGp > 0 ? fallbackTotals.pts / fallbackGp : 0;
          const fallbackPapgSummary = rows.reduce(
            (acc, row) => {
              const summary = scoreSummaryBySeasonTeamKey.get(`${row.teamId}::${row.seasonId || ''}`);
              if (!summary) return acc;
              acc.pf += summary.pf;
              acc.pa += summary.pa;
              acc.gp += summary.gp;
              return acc;
            },
            { pf: 0, pa: 0, gp: 0 }
          );
          const recordSummary = rows.reduce(
            (acc, row) => {
              const summary = recordSummaryBySeasonTeamKey.get(`${row.teamId}::${row.seasonId || ''}`);
              if (!summary) return acc;
              acc.wins += summary.wins;
              acc.losses += summary.losses;
              acc.ties += summary.ties;
              return acc;
            },
            { wins: 0, losses: 0, ties: 0 }
          );
          const scoreSummary = fallbackPapgSummary.gp > 0
            ? fallbackPapgSummary
            : { pf: fallbackTotals.pts, pa: 0, gp: fallbackGp };
          const {
            leagueOffAvg: snapshotLeagueOffAvg,
            leagueDefAvg: snapshotLeagueDefAvg,
          } = getLeagueScoreAverages(seasonId);
          const leagueRows = seasonId
            ? seasonLeagueRows.get(seasonId) || []
            : Array.from(seasonLeagueRows.values()).flat();

          const aggFrom = (statRowsForAgg: TeamGameTotals[]) =>
            statRowsForAgg.reduce(
              (acc, row) => {
                acc.pts += row.pts;
                acc.tov += row.tov;
                acc.ftm += row.ftm;
                acc.fta += row.fta;
                acc.fgm += row.fgm;
                acc.fga += row.fga;
                acc.tpm += row.tpm;
                acc.tpa += row.tpa;
                acc.ast += row.ast;
                acc.oreb += row.oreb;
                acc.dreb += row.dreb;
                acc.reb += row.reb;
                acc.blk += row.blk;
                acc.stl += row.stl;
                return acc;
              },
              {
                pts: 0,
                tov: 0,
                ftm: 0,
                fta: 0,
                fgm: 0,
                fga: 0,
                tpm: 0,
                tpa: 0,
                ast: 0,
                oreb: 0,
                dreb: 0,
                reb: 0,
                blk: 0,
                stl: 0,
              }
            );

          const leagueStatSnapshot =
            leagueRows.length > 0
              ? {
                  rebounds: leagueRows.reduce((acc, row) => acc + row.reb, 0) / leagueRows.length,
                  assists: leagueRows.reduce((acc, row) => acc + row.ast, 0) / leagueRows.length,
                  blocks: leagueRows.reduce((acc, row) => acc + row.blk, 0) / leagueRows.length,
                  steals: leagueRows.reduce((acc, row) => acc + row.stl, 0) / leagueRows.length,
                }
              : null;

          if (!teamRowsForMetrics.length) {
            return {
              ...createFallbackSnapshot(key, label, seasonId, seasonYear, rows),
              leagueOffAvg: snapshotLeagueOffAvg,
              leagueDefAvg: snapshotLeagueDefAvg,
              leagueStatAvgs: leagueStatSnapshot,
            };
          }

          const teamAgg = aggFrom(teamRowsForMetrics);
          const oppAgg = aggFrom(oppRowsForMetrics);
          const gamesPlayed = Math.max(1, teamRowsForMetrics.length);
          const teamPoss = teamAgg.fga - teamAgg.oreb + teamAgg.tov + 0.44 * teamAgg.fta;
          const oppPoss = oppAgg.fga - oppAgg.oreb + oppAgg.tov + 0.44 * oppAgg.fta;
          const teamStatSnapshot = {
            rpg: teamAgg.reb / gamesPlayed,
            apg: teamAgg.ast / gamesPlayed,
            bpg: teamAgg.blk / gamesPlayed,
            spg: teamAgg.stl / gamesPlayed,
          };
          const scoringSnapshot = {
            ppg2: Math.max(0, teamAgg.fgm - teamAgg.tpm) * 2 / gamesPlayed,
            ppg3: teamAgg.tpm * 3 / gamesPlayed,
            ppgFT: teamAgg.ftm / gamesPlayed,
          };

          const possessionFromTotals = (row: TeamGameTotals) =>
            row.fga - row.oreb + row.tov + 0.44 * row.fta;
          const leagueRowsByGame = new Map<string, TeamGameTotals[]>();
          leagueRows.forEach((row) => {
            const bucket = leagueRowsByGame.get(row.gameId) || [];
            bucket.push(row);
            leagueRowsByGame.set(row.gameId, bucket);
          });
          const leagueGamePaces = Array.from(leagueRowsByGame.values())
            .map((rowsForGame) => {
              if (rowsForGame.length < 2) return null;
              return (
                rowsForGame.reduce((acc, row) => acc + possessionFromTotals(row), 0) / rowsForGame.length
              );
            })
            .filter((value): value is number => value != null && Number.isFinite(value));
          const totalLeaguePoss = leagueRows.reduce(
            (acc, row) => acc + possessionFromTotals(row),
            0
          );
          const leaguePaceSnapshot = leagueGamePaces.length
            ? leagueGamePaces.reduce((acc, value) => acc + value, 0) / leagueGamePaces.length
            : leagueRows.length
              ? totalLeaguePoss / leagueRows.length
              : null;

          return {
            key,
            label,
            seasonId,
            seasonYear,
            wins: recordSummary.wins,
            losses: recordSummary.losses,
            ties: recordSummary.ties,
            gp: scoreSummary.gp || fallbackGp || gamesPlayed,
            ppg: scoreSummary.gp > 0 ? scoreSummary.pf / scoreSummary.gp : fallbackPpg,
            papg:
              scoreSummary.gp > 0
                ? scoreSummary.pa / scoreSummary.gp
                : oppRowsForMetrics.length
                  ? oppAgg.pts / gamesPlayed
                  : 0,
            leagueOffAvg: snapshotLeagueOffAvg,
            leagueDefAvg: snapshotLeagueDefAvg,
            leaguePaceAvg: leaguePaceSnapshot,
            leagueStatAvgs: leagueStatSnapshot,
            teamStatAverages: teamStatSnapshot,
            teamScoringBreakdown: scoringSnapshot,
            advMetrics: {
              poss: teamPoss / gamesPlayed,
              oppPoss: oppPoss / gamesPlayed,
              ortg: teamPoss > 0 ? (teamAgg.pts / teamPoss) * 100 : 0,
              drtg: oppPoss > 0 ? (oppAgg.pts / oppPoss) * 100 : 0,
              net:
                (teamPoss > 0 ? (teamAgg.pts / teamPoss) * 100 : 0) -
                (oppPoss > 0 ? (oppAgg.pts / oppPoss) * 100 : 0),
              pace: hasPairedGames ? (teamPoss + oppPoss) / 2 / gamesPlayed : teamPoss / gamesPlayed,
              astRatio: teamAgg.fgm > 0 ? teamAgg.ast / teamAgg.fgm : 0,
              tovRatio: teamPoss > 0 ? (teamAgg.tov / teamPoss) * 100 : 0,
              rebPct:
                hasPairedGames && teamAgg.reb + oppAgg.reb > 0
                  ? teamAgg.reb / (teamAgg.reb + oppAgg.reb)
                  : 0.5,
              threeRate: teamAgg.fga > 0 ? teamAgg.tpa / teamAgg.fga : 0,
              threeReliance: teamAgg.pts > 0 ? (teamAgg.tpm * 3) / teamAgg.pts : 0,
              ftRate: teamAgg.fga > 0 ? teamAgg.fta / teamAgg.fga : 0,
            },
          };
        };

        const seasonSnapshots = seasonRows.map((row) =>
          aggregateSnapshot(row.key, row.seasonLabel, row.seasonId, row.seasonYear, [row])
        );
        const includeAllTime = seasonSnapshots.length > 1;
        const finalSnapshots = includeAllTime
          ? [
              ...seasonSnapshots,
              aggregateSnapshot(
                'all-time',
                'All-Time Average',
                null,
                Math.max(...seasonRows.map((row) => row.seasonYear || 0), 0),
                seasonRows
              ),
            ]
          : seasonSnapshots;

        if (!cancelled) {
          setAnalyticsSnapshots(finalSnapshots);
        }
      } catch (err) {
        console.warn('analytics snapshot load failed', err);
        if (!cancelled) {
          const fallbackSnapshots = teamSeasonStatsRows
            .filter((row) => {
              const teamId = String(row.teamId || '').trim();
              const seasonId = String(row.seasonId || '').trim();
              return !!teamId && (!!seasonId || row.gp > 0);
            })
            .map((row) =>
              createFallbackSnapshot(row.key, row.seasonLabel, row.seasonId, row.seasonYear, [row])
            );
          setAnalyticsSnapshots(fallbackSnapshots);
        }
      } finally {
        if (!cancelled) {
          setAnalyticsSnapshotsLoading(false);
        }
      }
    };

    loadAnalyticsSnapshots();
    return () => {
      cancelled = true;
    };
  }, [team?.id, teamSeasonStatsRows]);

  useEffect(() => {
    let cancelled = false;

    const loadActivePlayerStats = async () => {
      if (!team?.id) {
        if (!cancelled) {
          setActivePlayerStatsRows([]);
          setActivePlayerStatsSummary(null);
          setActivePlayerStatsLoading(false);
        }
        return;
      }

      setActivePlayerStatsLoading(true);

      const toNum = (value: any) => Number(value) || 0;
      const getReb = (row: any) => {
        const offensive = toNum(row?.offensive_rebounds);
        const defensive = toNum(row?.defensive_rebounds);
        const total = toNum(row?.rebounds);
        return offensive || defensive ? offensive + defensive : total;
      };

      const buildSummary = (
        totals: ReturnType<typeof emptyTotals>,
        gp: number
      ): TeamStatsSummary | null => {
        if (gp <= 0) return null;
        return {
          gp,
          ppg: totals.pts / gp,
          rpg: totals.reb / gp,
          apg: totals.ast / gp,
          fgPct: totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0,
          threePct: totals.tpa > 0 ? (totals.tpm / totals.tpa) * 100 : 0,
          ftPct: totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0,
        };
      };

      const rosterMetaMap = new Map<
        string,
        { playerName: string; jerseyNumber: string; position: string | null }
      >();
      (roster || []).forEach((player) => {
        const id = String(player?.id || '').trim();
        if (!id) return;
        rosterMetaMap.set(id, {
          playerName: String(player?.name || 'Player').trim() || 'Player',
          jerseyNumber:
            player?.number != null && String(player.number).trim()
              ? String(player.number).trim()
              : '-',
          position: player?.position || null,
        });
      });

      const seasonFinalGameIds = (games || [])
        .filter((game) => {
          if (team.seasonId && game?.seasonId && game.seasonId !== team.seasonId) return false;
          return isFinalGame(game);
        })
        .map((game) => String(game.id || '').trim())
        .filter(Boolean);

      const rosterOnlyRows: TeamPlayerSeasonStatRow[] = Array.from(
        rosterMetaMap.entries()
      ).map(([playerId, meta]) => ({
        key: `player:${playerId}`,
        playerId,
        playerName: meta.playerName,
        jerseyNumber: meta.jerseyNumber,
        position: meta.position,
        gp: 0,
        ppg: 0,
        rpg: 0,
        apg: 0,
        spg: 0,
        bpg: 0,
        tov: 0,
        fgPct: 0,
        threePct: 0,
        ftPct: 0,
        totals: emptyTotals(),
      }));

      try {
        if (!seasonFinalGameIds.length) {
          if (!cancelled) {
            setActivePlayerStatsRows(
              rosterOnlyRows.sort((a, b) => a.playerName.localeCompare(b.playerName))
            );
            setActivePlayerStatsSummary(null);
          }
          return;
        }

        const { data: statRows, error: statError } = await supabase
          .from('game_stats')
          .select(
            'player_id,game_id,points,rebounds,offensive_rebounds,defensive_rebounds,assists,steals,blocks,turnovers,fgm,fga,tpm,tpa,ftm,fta'
          )
          .eq('team_id', team.id)
          .in('game_id', seasonFinalGameIds);
        if (statError) throw statError;

        const totalsAcrossTeam = emptyTotals();
        const groupedByPlayer = new Map<
          string,
          { gameIds: Set<string>; totals: ReturnType<typeof emptyTotals> }
        >();

        (statRows || []).forEach((row: any) => {
          const playerId = String(row?.player_id || '').trim();
          const gameId = String(row?.game_id || '').trim();
          if (!playerId || !gameId) return;

          const current = groupedByPlayer.get(playerId) || {
            gameIds: new Set<string>(),
            totals: emptyTotals(),
          };
          current.gameIds.add(gameId);
          current.totals.pts += toNum(row?.points);
          current.totals.reb += getReb(row);
          current.totals.ast += toNum(row?.assists);
          current.totals.stl += toNum(row?.steals);
          current.totals.blk += toNum(row?.blocks);
          current.totals.tov += toNum(row?.turnovers);
          current.totals.fgm += toNum(row?.fgm);
          current.totals.fga += toNum(row?.fga);
          current.totals.tpm += toNum(row?.tpm);
          current.totals.tpa += toNum(row?.tpa);
          current.totals.ftm += toNum(row?.ftm);
          current.totals.fta += toNum(row?.fta);
          groupedByPlayer.set(playerId, current);

          totalsAcrossTeam.pts += toNum(row?.points);
          totalsAcrossTeam.reb += getReb(row);
          totalsAcrossTeam.ast += toNum(row?.assists);
          totalsAcrossTeam.stl += toNum(row?.steals);
          totalsAcrossTeam.blk += toNum(row?.blocks);
          totalsAcrossTeam.tov += toNum(row?.turnovers);
          totalsAcrossTeam.fgm += toNum(row?.fgm);
          totalsAcrossTeam.fga += toNum(row?.fga);
          totalsAcrossTeam.tpm += toNum(row?.tpm);
          totalsAcrossTeam.tpa += toNum(row?.tpa);
          totalsAcrossTeam.ftm += toNum(row?.ftm);
          totalsAcrossTeam.fta += toNum(row?.fta);
        });

        const missingPlayerIds = Array.from(groupedByPlayer.keys()).filter(
          (id) => !rosterMetaMap.has(id)
        );
        const fetchedPlayerMeta = new Map<
          string,
          { playerName: string; jerseyNumber: string; position: string | null }
        >();
        if (missingPlayerIds.length) {
          try {
            const { data: missingPlayers } = await supabase
              .from('players')
              .select('id,first_name,last_name,jersey_number,position,is_guest')
              .in('id', missingPlayerIds);
            (missingPlayers || []).forEach((player: any) => {
              const id = String(player?.id || '').trim();
              if (!id) return;
              const fullName =
                `${String(player?.first_name || '').trim()} ${String(player?.last_name || '').trim()}`.trim() ||
                'Player';
              const isGuest = !!player?.is_guest || isGuestLikeName(fullName);
              if (isGuest) return;
              fetchedPlayerMeta.set(id, {
                playerName: fullName,
                jerseyNumber:
                  player?.jersey_number != null && String(player.jersey_number).trim()
                    ? String(player.jersey_number).trim()
                    : '-',
                position: player?.position || null,
              });
            });
          } catch (missingErr) {
            console.warn('active player meta load failed', missingErr);
          }
        }

        const combinedPlayerIds = Array.from(
          new Set(
            [...Array.from(rosterMetaMap.keys()), ...Array.from(groupedByPlayer.keys())].filter(
              (id) => rosterMetaMap.has(id) || fetchedPlayerMeta.has(id)
            )
          )
        );
        const rows: TeamPlayerSeasonStatRow[] = combinedPlayerIds.map((playerId) => {
          const meta =
            rosterMetaMap.get(playerId) ||
            fetchedPlayerMeta.get(playerId) || {
              playerName: 'Player',
              jerseyNumber: '-',
              position: null,
            };
          const statBucket = groupedByPlayer.get(playerId);
          const totals = statBucket?.totals || emptyTotals();
          const gp = statBucket?.gameIds.size || 0;

          return {
            key: `player:${playerId}`,
            playerId,
            playerName: meta.playerName,
            jerseyNumber: meta.jerseyNumber,
            position: meta.position,
            gp,
            ppg: gp > 0 ? totals.pts / gp : 0,
            rpg: gp > 0 ? totals.reb / gp : 0,
            apg: gp > 0 ? totals.ast / gp : 0,
            spg: gp > 0 ? totals.stl / gp : 0,
            bpg: gp > 0 ? totals.blk / gp : 0,
            tov: gp > 0 ? totals.tov / gp : 0,
            fgPct: totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0,
            threePct: totals.tpa > 0 ? (totals.tpm / totals.tpa) * 100 : 0,
            ftPct: totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0,
            totals,
          };
        });

        rows.sort((a, b) => {
          const hasGpDiff = Number(b.gp > 0) - Number(a.gp > 0);
          if (hasGpDiff !== 0) return hasGpDiff;
          if (b.ppg !== a.ppg) return b.ppg - a.ppg;
          if (b.gp !== a.gp) return b.gp - a.gp;
          return a.playerName.localeCompare(b.playerName);
        });

        const summary = buildSummary(totalsAcrossTeam, seasonFinalGameIds.length);
        if (!cancelled) {
          setActivePlayerStatsRows(rows);
          setActivePlayerStatsSummary(summary);
        }
      } catch (err) {
        console.warn('active player stats load failed', err);
        if (!cancelled) {
          setActivePlayerStatsRows(
            rosterOnlyRows.sort((a, b) => a.playerName.localeCompare(b.playerName))
          );
          setActivePlayerStatsSummary(null);
        }
      } finally {
        if (!cancelled) {
          setActivePlayerStatsLoading(false);
        }
      }
    };

    loadActivePlayerStats();
    return () => {
      cancelled = true;
    };
  }, [team?.id, team?.seasonId, roster, games]);

  useEffect(() => {
    let cancelled = false;

    const loadCareerPlayerStats = async () => {
      if (!team?.id || !team?.name) {
        if (!cancelled) {
          setCareerPlayerStatsRows([]);
          setCareerPlayerStatsSummary(null);
          setCareerPlayerStatsLoading(false);
        }
        return;
      }

      setCareerPlayerStatsLoading(true);

      const toNum = (value: any) => Number(value) || 0;
      const currentRosterPlayerIds = new Set(
        (roster || [])
          .map((player) => String(player?.id || '').trim())
          .filter(Boolean)
      );
      const extractYear = (label: string) => {
        const match = label.match(/(20\d{2})/);
        if (!match) return 0;
        const value = Number(match[1]);
        return Number.isFinite(value) ? value : 0;
      };
      const buildSeasonLabel = (season?: { name?: string | null; year?: number | string | null }) => {
        const name = String(season?.name || 'Season');
        const yearNum = Number(season?.year) || 0;
        const yearText = yearNum ? String(yearNum) : '';
        if (yearText && name.includes(yearText)) return { label: name, year: yearNum || extractYear(name) };
        const label = `${name}${yearText ? ` ${yearText}` : ''}`.trim();
        return { label, year: yearNum || extractYear(label) };
      };
      const getReb = (row: any) => {
        const offensive = toNum(row?.offensive_rebounds);
        const defensive = toNum(row?.defensive_rebounds);
        const total = toNum(row?.rebounds);
        return offensive || defensive ? offensive + defensive : total;
      };

      const buildSummary = (
        totals: ReturnType<typeof emptyTotals>,
        gp: number
      ): TeamStatsSummary | null => {
        if (gp <= 0) return null;
        return {
          gp,
          ppg: totals.pts / gp,
          rpg: totals.reb / gp,
          apg: totals.ast / gp,
          fgPct: totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0,
          threePct: totals.tpa > 0 ? (totals.tpm / totals.tpa) * 100 : 0,
          ftPct: totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0,
        };
      };

      try {
        const baseTeamRow = { id: team.id, name: team.name };
        const linkedTeamIds = connectedTeamIds.filter(Boolean);
        const linkedNames = Array.from(
          new Set(
            linkedTeamIds
              .flatMap((id) => {
                const entry = teamMergeMetaById[id];
                return entry ? entry.previousNames || [] : [];
              })
              .map((name) => String(name || '').trim())
              .filter(Boolean)
          )
        );
        const nameCandidates = Array.from(
          new Set([team.name, ...linkedNames].map((name) => String(name || '').trim()).filter(Boolean))
        );
        const candidateRowsById = new Map<string, any>();
        const addCandidateRows = (rows: any[]) => {
          (rows || []).forEach((row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            candidateRowsById.set(id, row);
          });
        };
        if (linkedTeamIds.length) {
          try {
            const { data, error } = await supabase
              .from('teams')
              .select('id,name,division,season_id')
              .in('id', linkedTeamIds);
            if (error) throw error;
            addCandidateRows(data || []);
          } catch (linkedErr) {
            console.warn('career linked team lookup failed', linkedErr);
          }
        }
        try {
          const { data, error } = await supabase
            .from('teams')
            .select('id,name,division,season_id')
            .in('name', nameCandidates)
            .limit(250);
          if (error) throw error;
          addCandidateRows(data || []);
        } catch {
          const primaryName = nameCandidates[0] || team.name;
          const { data } = await supabase
            .from('teams')
            .select('id,name,division,season_id')
            .ilike('name', primaryName)
            .limit(250);
          addCandidateRows(data || []);
        }

        const candidateRows = Array.from(candidateRowsById.values());

        const byId = new Map<string, any>();
        [baseTeamRow, ...(candidateRows || [])].forEach((row: any) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          byId.set(id, row);
        });
        const linkedIdSet = new Set(linkedTeamIds);
        const candidateNameSet = new Set(nameCandidates.map((name) => name.toLowerCase()));
        const sameNameRows = Array.from(byId.values()).filter((row: any) =>
          candidateNameSet.has(String(row?.name || '').trim().toLowerCase())
        );
        const connectedRows = Array.from(byId.values()).filter((row: any) =>
          linkedIdSet.has(String(row?.id || '').trim())
        );
        const teamRows = connectedRows.length
          ? connectedRows
          : sameNameRows.length
          ? sameNameRows
          : Array.from(byId.values());
        const teamIds = teamRows
          .map((row: any) => String(row?.id || '').trim())
          .filter(Boolean);

        const seasonIds = Array.from(
          new Set(
            teamRows
              .map((row: any) => String(row?.season_id || '').trim())
              .filter(Boolean)
          )
        );
        const seasonMap = new Map<string, { label: string; year: number }>();
        if (seasonIds.length) {
          const { data: seasonRows } = await supabase
            .from('seasons')
            .select('id,name,year')
            .in('id', seasonIds);
          (seasonRows || []).forEach((row: any) => {
            const id = String(row?.id || '').trim();
            if (!id) return;
            seasonMap.set(id, buildSeasonLabel({ name: row?.name, year: row?.year }));
          });
        }

        const teamMetaById = new Map<
          string,
          { seasonId: string | null; seasonLabel: string; seasonYear: number; divisionLabel: string }
        >();
        teamRows.forEach((row: any) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          const seasonId = row?.season_id ? String(row.season_id) : '';
          const seasonMeta = seasonId ? seasonMap.get(seasonId) : null;
          const seasonLabel = seasonMeta?.label || 'Season';
          const seasonYear = seasonMeta?.year || extractYear(seasonLabel);
          const divisionLabel = String(row?.division || team.division || 'Division');
          teamMetaById.set(id, {
            seasonId: seasonId || null,
            seasonLabel,
            seasonYear,
            divisionLabel,
          });
        });

        const membershipIdentityEntries = new Map<
          string,
          {
            identityKey: string;
            playerId: string | null;
            userId: string | null;
            playerName: string;
            normalizedPlayerName: string;
            playerIds: Set<string>;
            jerseyNumber: string;
            position: string | null;
            seasonKeys: Set<string>;
          }
        >();
        try {
          const { data: membershipRows } = await supabase
            .from('players')
            .select('id,user_id,team_id,season_id,first_name,last_name,jersey_number,position,is_guest')
            .in('team_id', teamIds);
          (membershipRows || []).forEach((player: any) => {
            const fullName =
              `${String(player?.first_name || '').trim()} ${String(player?.last_name || '').trim()}`.trim() ||
              'Player';
            if (!!player?.is_guest || isGuestLikeName(fullName)) return;

            const playerId = String(player?.id || '').trim() || null;
            const userId = String(player?.user_id || '').trim() || null;
            const teamId = String(player?.team_id || '').trim();
            const teamMeta = teamMetaById.get(teamId) || null;
            const normalizedPlayerName = normalizePlayerIdentityName(fullName);
            const identityKey = userId
              ? `user:${userId}`
              : normalizedPlayerName
                ? `name:${normalizedPlayerName}`
                : playerId
                  ? `player:${playerId}`
                  : '';
            if (!identityKey) return;

            const seasonKey =
              String(player?.season_id || '').trim() ||
              teamMeta?.seasonId ||
              teamMeta?.seasonLabel ||
              teamId;
            const existing = membershipIdentityEntries.get(identityKey) || {
              identityKey,
              playerId,
              userId,
              playerName: fullName,
              normalizedPlayerName,
              playerIds: new Set<string>(playerId ? [playerId] : []),
              jerseyNumber:
                player?.jersey_number != null && String(player.jersey_number).trim()
                  ? String(player.jersey_number).trim()
                  : '-',
              position: player?.position || null,
              seasonKeys: new Set<string>(),
            };

            if (!existing.playerId && playerId) existing.playerId = playerId;
            if (!existing.userId && userId) existing.userId = userId;
            if (playerId) existing.playerIds.add(playerId);
            if (existing.playerName === 'Player' && fullName !== 'Player') existing.playerName = fullName;
            if (!existing.normalizedPlayerName && normalizedPlayerName) {
              existing.normalizedPlayerName = normalizedPlayerName;
            }
            if (
              (!existing.jerseyNumber || existing.jerseyNumber === '-') &&
              player?.jersey_number != null &&
              String(player.jersey_number).trim()
            ) {
              existing.jerseyNumber = String(player.jersey_number).trim();
            }
            if ((!existing.position || existing.position === '-') && player?.position) {
              existing.position = player.position;
            }
            if (seasonKey) {
              existing.seasonKeys.add(seasonKey);
            }
            membershipIdentityEntries.set(identityKey, existing);
          });
        } catch (membershipErr) {
          console.warn('career membership load failed', membershipErr);
        }

        if (!teamIds.length) {
          if (!cancelled) {
            setCareerPlayerStatsRows([]);
            setCareerPlayerStatsSummary(null);
          }
          return;
        }

        const { data: statRows, error: statError } = await supabase
          .from('game_stats')
          .select(
            'player_id,game_id,team_id,points,rebounds,offensive_rebounds,defensive_rebounds,assists,steals,blocks,turnovers,fgm,fga,tpm,tpa,ftm,fta'
          )
          .in('team_id', teamIds);
        if (statError) throw statError;

        const gameIds = Array.from(
          new Set((statRows || []).map((row: any) => String(row?.game_id || '').trim()).filter(Boolean))
        );
        if (!gameIds.length) {
          if (!cancelled) {
            setCareerPlayerStatsRows([]);
            setCareerPlayerStatsSummary(null);
          }
          return;
        }

        const { data: gameRows, error: gameErr } = await supabase
          .from('games')
          .select('id,season_id,status,home_score,away_score')
          .in('id', gameIds);
        if (gameErr) throw gameErr;

        const gameMap = new Map<
          string,
          {
            season_id: string | null;
            status: string | null;
            home_score: number | null;
            away_score: number | null;
          }
        >();
        (gameRows || []).forEach((game: any) => {
          const id = String(game?.id || '').trim();
          if (!id) return;
          gameMap.set(id, {
            season_id: game?.season_id ? String(game.season_id).trim() : null,
            status: game?.status || null,
            home_score: game?.home_score ?? null,
            away_score: game?.away_score ?? null,
          });
        });

        const totalsAcrossTeam = emptyTotals();
        const groupedByPlayer = new Map<
          string,
          {
            playerId: string;
            gameKeys: Set<string>;
            seasonKeys: Set<string>;
            seasonTeamKeys: Set<string>;
            legacyGp: number;
            fallbackName: string;
            fallbackJerseyNumber: string;
            fallbackPosition: string | null;
            totals: ReturnType<typeof emptyTotals>;
          }
        >();
        const finalTeamGameKeys = new Set<string>();
        let legacyGpTotal = 0;

        (statRows || []).forEach((row: any) => {
          const playerId = String(row?.player_id || '').trim();
          const gameId = String(row?.game_id || '').trim();
          const statTeamId = String(row?.team_id || '').trim();
          if (!playerId || !gameId || !statTeamId) return;

          const game = gameMap.get(gameId);
          if (!game) return;
          if (
            !isFinalGame({
              status: game.status,
              homeScore: game.home_score,
              awayScore: game.away_score,
            })
          ) {
            return;
          }

          const groupKey = playerId;
          const teamMeta = teamMetaById.get(statTeamId) || null;
          const playerBucket = groupedByPlayer.get(groupKey) || {
            playerId,
            gameKeys: new Set<string>(),
            seasonKeys: new Set<string>(),
            seasonTeamKeys: new Set<string>(),
            legacyGp: 0,
            fallbackName: '',
            fallbackJerseyNumber: '-',
            fallbackPosition: null,
            totals: emptyTotals(),
          };
          const teamGameKey = `${statTeamId}::${gameId}`;
          playerBucket.gameKeys.add(teamGameKey);
          const resolvedSeasonKey =
            game.season_id ||
            teamMeta?.seasonId ||
            teamMeta?.seasonLabel ||
            statTeamId;
          const seasonTeamKey = `${statTeamId}::${resolvedSeasonKey || 'no-season'}`;
          if (resolvedSeasonKey) {
            playerBucket.seasonKeys.add(resolvedSeasonKey);
          }
          playerBucket.seasonTeamKeys.add(seasonTeamKey);
          playerBucket.totals.pts += toNum(row?.points);
          playerBucket.totals.reb += getReb(row);
          playerBucket.totals.ast += toNum(row?.assists);
          playerBucket.totals.stl += toNum(row?.steals);
          playerBucket.totals.blk += toNum(row?.blocks);
          playerBucket.totals.tov += toNum(row?.turnovers);
          playerBucket.totals.fgm += toNum(row?.fgm);
          playerBucket.totals.fga += toNum(row?.fga);
          playerBucket.totals.tpm += toNum(row?.tpm);
          playerBucket.totals.tpa += toNum(row?.tpa);
          playerBucket.totals.ftm += toNum(row?.ftm);
          playerBucket.totals.fta += toNum(row?.fta);
          groupedByPlayer.set(groupKey, playerBucket);

          finalTeamGameKeys.add(teamGameKey);
          totalsAcrossTeam.pts += toNum(row?.points);
          totalsAcrossTeam.reb += getReb(row);
          totalsAcrossTeam.ast += toNum(row?.assists);
          totalsAcrossTeam.stl += toNum(row?.steals);
          totalsAcrossTeam.blk += toNum(row?.blocks);
          totalsAcrossTeam.tov += toNum(row?.turnovers);
          totalsAcrossTeam.fgm += toNum(row?.fgm);
          totalsAcrossTeam.fga += toNum(row?.fga);
          totalsAcrossTeam.tpm += toNum(row?.tpm);
          totalsAcrossTeam.tpa += toNum(row?.tpa);
          totalsAcrossTeam.ftm += toNum(row?.ftm);
          totalsAcrossTeam.fta += toNum(row?.fta);
        });

        const getLegacyNumber = (row: any, keys: string[]) => {
          for (const key of keys) {
            if (row?.[key] != null && row[key] !== '') return toNum(row[key]);
          }
          return 0;
        };

        try {
          const fetchLegacy = async (columns: string) =>
            supabase
              .from('player_season_stats')
              .select(columns)
              .in('team_id', teamIds);
          let legacyResult = await fetchLegacy(
            'player_id,team_id,season_id,pts,reb,ast,stl,blk,tov,fgm,fga,tpm,tpa,ftm,fta,gp,points,rebounds,assists,steals,blocks,turnovers'
          );
          if (legacyResult.error) {
            const message = legacyResult.error.message?.toLowerCase?.() || '';
            const missingColumn = legacyResult.error.code === '42703' || message.includes('column');
            if (missingColumn) {
              legacyResult = await fetchLegacy('*');
            }
          }
          if (
            !legacyResult.error &&
            Array.isArray(legacyResult.data) &&
            legacyResult.data.length
          ) {
            legacyResult.data.forEach((row: any) => {
              const playerId = String(row?.player_id || '').trim();
              const statTeamId = String(row?.team_id || '').trim();
              const firstName = String(row?.first_name || '').trim();
              const lastName = String(row?.last_name || '').trim();
              const directName = String(row?.player_name || row?.name || '').trim();
              const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim() || directName || 'Player';
              const normalizedFallbackName = normalizePlayerIdentityName(fallbackName);
              if (!statTeamId || (!playerId && !normalizedFallbackName)) return;

              const teamMeta = teamMetaById.get(statTeamId) || null;
              const resolvedSeasonKey =
                String(row?.season_id || '').trim() ||
                teamMeta?.seasonId ||
                teamMeta?.seasonLabel ||
                statTeamId;
              const seasonTeamKey = `${statTeamId}::${resolvedSeasonKey || 'no-season'}`;

              const groupKey = playerId || `legacy:${normalizedFallbackName}`;
              const existing = groupedByPlayer.get(groupKey);
              if (existing?.seasonTeamKeys.has(seasonTeamKey)) {
                return;
              }

              const playerBucket = existing || {
                playerId: playerId || groupKey,
                gameKeys: new Set<string>(),
                seasonKeys: new Set<string>(),
                seasonTeamKeys: new Set<string>(),
                legacyGp: 0,
                fallbackName,
                fallbackJerseyNumber:
                  String(row?.jersey_number || '').trim() || '-',
                fallbackPosition: String(row?.position || '').trim() || null,
                totals: emptyTotals(),
              };
              if (!playerBucket.fallbackName && fallbackName) {
                playerBucket.fallbackName = fallbackName;
              }
              if (
                (!playerBucket.fallbackJerseyNumber || playerBucket.fallbackJerseyNumber === '-') &&
                String(row?.jersey_number || '').trim()
              ) {
                playerBucket.fallbackJerseyNumber = String(row.jersey_number).trim();
              }
              if (!playerBucket.fallbackPosition && String(row?.position || '').trim()) {
                playerBucket.fallbackPosition = String(row.position).trim();
              }

              const gp = getLegacyNumber(row, ['gp', 'games', 'games_played']);
              playerBucket.legacyGp += gp;
              if (resolvedSeasonKey) {
                playerBucket.seasonKeys.add(resolvedSeasonKey);
              }
              playerBucket.seasonTeamKeys.add(seasonTeamKey);
              playerBucket.totals.pts += getLegacyNumber(row, ['pts', 'points']);
              playerBucket.totals.reb += getLegacyNumber(row, ['reb', 'rebounds']);
              playerBucket.totals.ast += getLegacyNumber(row, ['ast', 'assists']);
              playerBucket.totals.stl += getLegacyNumber(row, ['stl', 'steals']);
              playerBucket.totals.blk += getLegacyNumber(row, ['blk', 'blocks']);
              playerBucket.totals.tov += getLegacyNumber(row, ['tov', 'turnovers']);
              playerBucket.totals.fgm += getLegacyNumber(row, ['fgm']);
              playerBucket.totals.fga += getLegacyNumber(row, ['fga']);
              playerBucket.totals.tpm += getLegacyNumber(row, ['tpm']);
              playerBucket.totals.tpa += getLegacyNumber(row, ['tpa']);
              playerBucket.totals.ftm += getLegacyNumber(row, ['ftm']);
              playerBucket.totals.fta += getLegacyNumber(row, ['fta']);
              groupedByPlayer.set(groupKey, playerBucket);

              legacyGpTotal += gp;
              totalsAcrossTeam.pts += getLegacyNumber(row, ['pts', 'points']);
              totalsAcrossTeam.reb += getLegacyNumber(row, ['reb', 'rebounds']);
              totalsAcrossTeam.ast += getLegacyNumber(row, ['ast', 'assists']);
              totalsAcrossTeam.stl += getLegacyNumber(row, ['stl', 'steals']);
              totalsAcrossTeam.blk += getLegacyNumber(row, ['blk', 'blocks']);
              totalsAcrossTeam.tov += getLegacyNumber(row, ['tov', 'turnovers']);
              totalsAcrossTeam.fgm += getLegacyNumber(row, ['fgm']);
              totalsAcrossTeam.fga += getLegacyNumber(row, ['fga']);
              totalsAcrossTeam.tpm += getLegacyNumber(row, ['tpm']);
              totalsAcrossTeam.tpa += getLegacyNumber(row, ['tpa']);
              totalsAcrossTeam.ftm += getLegacyNumber(row, ['ftm']);
              totalsAcrossTeam.fta += getLegacyNumber(row, ['fta']);
            });
          }
        } catch (legacyErr) {
          console.warn('career legacy player stats load failed', legacyErr);
        }

        const groupedEntries = Array.from(groupedByPlayer.values());
        const playerIds = Array.from(
          new Set(
            groupedEntries
              .map((entry) => entry.playerId)
              .filter((id) => id && !String(id).startsWith('legacy:'))
          )
        );
        if (!playerIds.length) {
          if (!cancelled) {
            setCareerPlayerStatsRows([]);
            setCareerPlayerStatsSummary(null);
          }
          return;
        }

        const playerMeta = new Map<
          string,
          { playerId: string; userId: string | null; playerName: string; jerseyNumber: string; position: string | null }
        >();
        const guestPlayerIds = new Set<string>();
        try {
          const { data: players } = await supabase
            .from('players')
            .select('id,user_id,first_name,last_name,jersey_number,position,is_guest')
            .in('id', playerIds);
          (players || []).forEach((player: any) => {
            const id = String(player?.id || '').trim();
            if (!id) return;
            const fullName =
              `${String(player?.first_name || '').trim()} ${String(player?.last_name || '').trim()}`.trim() ||
              'Player';
            const isGuest = !!player?.is_guest || isGuestLikeName(fullName);
            if (isGuest) {
              guestPlayerIds.add(id);
              return;
            }
            playerMeta.set(id, {
              playerId: id,
              userId: player?.user_id ? String(player.user_id).trim() : null,
              playerName: fullName,
              jerseyNumber:
                player?.jersey_number != null && String(player.jersey_number).trim()
                  ? String(player.jersey_number).trim()
                  : '-',
              position: player?.position || null,
            });
          });
        } catch (metaErr) {
          console.warn('career player meta load failed', metaErr);
        }

        const groupedByIdentity = new Map<
          string,
          {
            playerId: string | null;
            userId: string | null;
            playerName: string;
            normalizedPlayerName: string;
            playerIds: Set<string>;
            jerseyNumber: string;
            position: string | null;
            gameKeys: Set<string>;
            seasonKeys: Set<string>;
            legacyGp: number;
            totals: ReturnType<typeof emptyTotals>;
          }
        >();

        membershipIdentityEntries.forEach((entry, identityKey) => {
          groupedByIdentity.set(identityKey, {
            playerId: entry.playerId,
            userId: entry.userId,
            playerName: entry.playerName,
            normalizedPlayerName: entry.normalizedPlayerName,
            playerIds: new Set(entry.playerIds),
            jerseyNumber: entry.jerseyNumber,
            position: entry.position,
            gameKeys: new Set<string>(),
            seasonKeys: new Set(entry.seasonKeys),
            legacyGp: 0,
            totals: emptyTotals(),
          });
        });

        groupedEntries
          .filter((entry) => !guestPlayerIds.has(entry.playerId))
          .forEach((entry) => {
            const meta = playerMeta.get(entry.playerId) || {
              playerId: entry.playerId.startsWith('legacy:') ? null : entry.playerId,
              userId: null,
              playerName: entry.fallbackName || 'Player',
              jerseyNumber: entry.fallbackJerseyNumber || '-',
              position: entry.fallbackPosition || null,
            };
            if (isGuestLikeName(meta.playerName)) return;

            const normalizedPlayerName = normalizePlayerIdentityName(meta.playerName);
            const identityKey = meta.userId
              ? `user:${meta.userId}`
              : normalizedPlayerName
                ? `name:${normalizedPlayerName}`
                : `player:${entry.playerId}`;
            const identityBucket = groupedByIdentity.get(identityKey) || {
              playerId: meta.playerId,
              userId: meta.userId,
              playerName: meta.playerName,
              normalizedPlayerName,
              playerIds: new Set(meta.playerId ? [meta.playerId] : []),
              jerseyNumber: meta.jerseyNumber,
              position: meta.position,
              gameKeys: new Set<string>(),
              seasonKeys: new Set<string>(),
              legacyGp: 0,
              totals: emptyTotals(),
            };

            if (!identityBucket.playerId && meta.playerId) {
              identityBucket.playerId = meta.playerId;
            }
            if (!identityBucket.userId && meta.userId) {
              identityBucket.userId = meta.userId;
            }
            if (meta.playerId) {
              identityBucket.playerIds.add(meta.playerId);
            }
            if (identityBucket.playerName === 'Player' && meta.playerName !== 'Player') {
              identityBucket.playerName = meta.playerName;
            }
            if (!identityBucket.normalizedPlayerName && normalizedPlayerName) {
              identityBucket.normalizedPlayerName = normalizedPlayerName;
            }
            if ((!identityBucket.position || identityBucket.position === '-') && meta.position) {
              identityBucket.position = meta.position;
            }
            if ((!identityBucket.jerseyNumber || identityBucket.jerseyNumber === '-') && meta.jerseyNumber && meta.jerseyNumber !== '-') {
              identityBucket.jerseyNumber = meta.jerseyNumber;
            }

            entry.gameKeys.forEach((key) => identityBucket.gameKeys.add(key));
            entry.seasonKeys.forEach((key) => identityBucket.seasonKeys.add(key));
            identityBucket.legacyGp += entry.legacyGp || 0;
            identityBucket.totals.pts += entry.totals.pts;
            identityBucket.totals.reb += entry.totals.reb;
            identityBucket.totals.ast += entry.totals.ast;
            identityBucket.totals.stl += entry.totals.stl;
            identityBucket.totals.blk += entry.totals.blk;
            identityBucket.totals.tov += entry.totals.tov;
            identityBucket.totals.fgm += entry.totals.fgm;
            identityBucket.totals.fga += entry.totals.fga;
            identityBucket.totals.tpm += entry.totals.tpm;
            identityBucket.totals.tpa += entry.totals.tpa;
            identityBucket.totals.ftm += entry.totals.ftm;
            identityBucket.totals.fta += entry.totals.fta;
            groupedByIdentity.set(identityKey, identityBucket);
          });

        const mergedByNormalizedName = new Map<
          string,
          {
            identityKey: string;
            playerId: string | null;
            userId: string | null;
            playerName: string;
            normalizedPlayerName: string;
            playerIds: Set<string>;
            jerseyNumber: string;
            position: string | null;
            gameKeys: Set<string>;
            seasonKeys: Set<string>;
            legacyGp: number;
            totals: ReturnType<typeof emptyTotals>;
          }
        >();

        const findCompatibleMergedKey = (
          entry: {
            userId: string | null;
            playerIds: Set<string>;
            normalizedPlayerName: string;
            gameKeys: Set<string>;
          }
        ) => {
          for (const [existingKey, existingEntry] of mergedByNormalizedName.entries()) {
            if (
              entry.userId &&
              existingEntry.userId &&
              entry.userId === existingEntry.userId
            ) {
              return existingKey;
            }

            const sharesPlayerId = Array.from(entry.playerIds).some((playerId) =>
              existingEntry.playerIds.has(playerId)
            );
            if (sharesPlayerId) {
              return existingKey;
            }

            const entryName = entry.normalizedPlayerName;
            const existingName = existingEntry.normalizedPlayerName;
            if (!entryName || !existingName) continue;

            const shorterLength = Math.min(entryName.length, existingName.length);
            const isPrefixMatch =
              shorterLength >= 5 &&
              (entryName.startsWith(existingName) || existingName.startsWith(entryName));
            const hasMembershipOnlySide =
              entry.gameKeys.size === 0 || existingEntry.gameKeys.size === 0;
            const entryRosterIds = Array.from(entry.playerIds).filter((playerId) =>
              currentRosterPlayerIds.has(playerId)
            );
            const existingRosterIds = Array.from(existingEntry.playerIds).filter((playerId) =>
              currentRosterPlayerIds.has(playerId)
            );
            const representsDifferentCurrentRosterPlayers =
              entryRosterIds.length > 0 &&
              existingRosterIds.length > 0 &&
              !entryRosterIds.some((playerId) => existingRosterIds.includes(playerId));
            if (isPrefixMatch && hasMembershipOnlySide) {
              // Do not collapse two distinct active-roster players just because one name is a prefix.
              if (representsDifferentCurrentRosterPlayers) continue;
              return existingKey;
            }
          }
          return null;
        };

        Array.from(groupedByIdentity.entries()).forEach(([identityKey, entry]) => {
          const exactMergeKey = entry.normalizedPlayerName || identityKey;
          const compatibleMergeKey = findCompatibleMergedKey(entry);
          const mergeKey = compatibleMergeKey || exactMergeKey;
          const mergedEntry = mergedByNormalizedName.get(mergeKey) || {
            identityKey,
            playerId: entry.playerId,
            userId: entry.userId,
            playerName: entry.playerName,
            normalizedPlayerName: entry.normalizedPlayerName,
            playerIds: new Set(entry.playerIds),
            jerseyNumber: entry.jerseyNumber,
            position: entry.position,
            gameKeys: new Set<string>(),
            seasonKeys: new Set<string>(),
            legacyGp: 0,
            totals: emptyTotals(),
          };

          if (!mergedEntry.playerId && entry.playerId) {
            mergedEntry.playerId = entry.playerId;
          }
          if (!mergedEntry.userId && entry.userId) {
            mergedEntry.userId = entry.userId;
            mergedEntry.identityKey = `user:${entry.userId}`;
          }
          entry.playerIds.forEach((playerId) => mergedEntry.playerIds.add(playerId));
          const mergedHasGames = mergedEntry.gameKeys.size > 0;
          const entryHasGames = entry.gameKeys.size > 0;
          if (!mergedHasGames && entryHasGames && entry.playerName !== 'Player') {
            mergedEntry.playerName = entry.playerName;
          } else if (
            !entryHasGames &&
            mergedHasGames
          ) {
            // Keep the stat-bearing display name when the incoming row is membership-only.
          } else if (
            mergedEntry.playerName === 'Player' &&
            entry.playerName !== 'Player'
          ) {
            mergedEntry.playerName = entry.playerName;
          } else if (
            entry.playerName !== 'Player' &&
            mergedEntry.playerName !== 'Player' &&
            entry.playerName.length < mergedEntry.playerName.length &&
            normalizePlayerIdentityName(mergedEntry.playerName).startsWith(
              normalizePlayerIdentityName(entry.playerName)
            )
          ) {
            mergedEntry.playerName = entry.playerName;
          }
          if ((!mergedEntry.position || mergedEntry.position === '-') && entry.position) {
            mergedEntry.position = entry.position;
          }
          if (
            (!mergedEntry.jerseyNumber || mergedEntry.jerseyNumber === '-') &&
            entry.jerseyNumber &&
            entry.jerseyNumber !== '-'
          ) {
            mergedEntry.jerseyNumber = entry.jerseyNumber;
          }
          entry.gameKeys.forEach((key) => mergedEntry.gameKeys.add(key));
          entry.seasonKeys.forEach((key) => mergedEntry.seasonKeys.add(key));
          mergedEntry.legacyGp += entry.legacyGp || 0;
          mergedEntry.totals.pts += entry.totals.pts;
          mergedEntry.totals.reb += entry.totals.reb;
          mergedEntry.totals.ast += entry.totals.ast;
          mergedEntry.totals.stl += entry.totals.stl;
          mergedEntry.totals.blk += entry.totals.blk;
          mergedEntry.totals.tov += entry.totals.tov;
          mergedEntry.totals.fgm += entry.totals.fgm;
          mergedEntry.totals.fga += entry.totals.fga;
          mergedEntry.totals.tpm += entry.totals.tpm;
          mergedEntry.totals.tpa += entry.totals.tpa;
          mergedEntry.totals.ftm += entry.totals.ftm;
          mergedEntry.totals.fta += entry.totals.fta;
          mergedByNormalizedName.set(mergeKey, mergedEntry);
        });

        const rows: TeamPlayerSeasonStatRow[] = Array.from(mergedByNormalizedName.values()).map((entry) => {
          const totals = entry.totals || emptyTotals();
          const gp = (entry.gameKeys.size || 0) + (entry.legacyGp || 0);
          return {
            key: `career-player:${entry.identityKey}`,
            playerId: entry.playerId,
            mergedPlayerIds: Array.from(entry.playerIds).filter(Boolean),
            playerName: entry.playerName,
            jerseyNumber: entry.jerseyNumber,
            position: entry.position,
            seasonsPlayed: entry.seasonKeys.size || 0,
            gp,
            ppg: gp > 0 ? totals.pts / gp : 0,
            rpg: gp > 0 ? totals.reb / gp : 0,
            apg: gp > 0 ? totals.ast / gp : 0,
            spg: gp > 0 ? totals.stl / gp : 0,
            bpg: gp > 0 ? totals.blk / gp : 0,
            tov: gp > 0 ? totals.tov / gp : 0,
            fgPct: totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0,
            threePct: totals.tpa > 0 ? (totals.tpm / totals.tpa) * 100 : 0,
            ftPct: totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0,
            totals,
          };
        });

        rows.sort((a, b) => {
          if (b.ppg !== a.ppg) return b.ppg - a.ppg;
          if ((b.seasonsPlayed || 0) !== (a.seasonsPlayed || 0)) {
            return (b.seasonsPlayed || 0) - (a.seasonsPlayed || 0);
          }
          if (b.gp !== a.gp) return b.gp - a.gp;
          return a.playerName.localeCompare(b.playerName);
        });

        const summary = buildSummary(totalsAcrossTeam, finalTeamGameKeys.size + legacyGpTotal);
        if (!cancelled) {
          setCareerPlayerStatsRows(rows);
          setCareerPlayerStatsSummary(summary);
        }
      } catch (err) {
        console.warn('career player stats load failed', err);
        if (!cancelled) {
          setCareerPlayerStatsRows([]);
          setCareerPlayerStatsSummary(null);
        }
      } finally {
        if (!cancelled) {
          setCareerPlayerStatsLoading(false);
        }
      }
    };

    loadCareerPlayerStats();
    return () => {
      cancelled = true;
    };
  }, [team?.id, team?.name, team?.division, connectedTeamIds, teamMergeMetaById, roster]);

const completedGames = games
  .filter((g) => isFinalGame(g))
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
const selectedAnalyticsSnapshot = useMemo(() => {
  if (!analyticsSnapshots.length) return null;
  return (
    analyticsSnapshots.find((snapshot) => snapshot.key === selectedAnalyticsKey) ||
    analyticsSnapshots[0] ||
    null
  );
}, [analyticsSnapshots, selectedAnalyticsKey]);

// --- ADVANCED STATS CALCULATION ---
const totalGames = completedGames.length;
const fallbackGpForRate = teamGp || totalGames || 1;
const selectedLeagueOffAvg = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.leagueOffAvg
  : leagueOffAvg;
const selectedLeagueDefAvg = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.leagueDefAvg
  : leagueDefAvg;
const selectedLeaguePaceAvg = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.leaguePaceAvg
  : leaguePaceAvg;
const selectedLeagueStatAvgs = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.leagueStatAvgs
  : leagueStatAvgs;
const selectedTeamStatAverages = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.teamStatAverages
  : teamStatAverages;
const selectedTeamScoringBreakdown = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.teamScoringBreakdown
  : teamScoringBreakdown;
const selectedAdvMetrics = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.advMetrics
  : advMetrics;
const selectedRecordWins = selectedAnalyticsSnapshot?.wins ?? team?.wins ?? 0;
const selectedRecordLosses = selectedAnalyticsSnapshot?.losses ?? team?.losses ?? 0;
const selectedRecordTies = selectedAnalyticsSnapshot?.ties ?? team?.ties ?? 0;
const selectedRecordText =
  selectedRecordTies > 0
    ? `${selectedRecordWins}-${selectedRecordLosses}-${selectedRecordTies}`
    : `${selectedRecordWins}-${selectedRecordLosses}`;
const selectedGp = selectedAnalyticsSnapshot?.gp ?? teamGp ?? totalGames ?? 0;
const gpForRate = selectedGp || fallbackGpForRate;
const ppgVal = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.ppg
  : team && gpForRate
    ? team.pointsFor / gpForRate
    : 0;
const papgVal = selectedAnalyticsSnapshot
  ? selectedAnalyticsSnapshot.papg
  : team && gpForRate
    ? team.pointsAgainst / gpForRate
    : 0;

const advancedDescriptions: Record<string, string> = {
  Possessions: 'Estimated possessions per game using pace formula.',
  'Opponent Poss.': 'Opponent possessions per game (same estimator).',
  ORtg: 'Points scored per 100 possessions (pace-normalized).',
  DRtg: 'Points allowed per 100 possessions (lower is better).',
  'Net Rating': 'ORtg minus DRtg: net margin per 100 possessions.',
  Pace: 'Estimated possessions per game (tempo of the team).',
  'Assist Ratio': 'Percent of possessions ending in assisted field goals.',
  'TOV Ratio': 'Turnovers per 100 possessions (lower is better).',
  'REB%': 'Percentage of available rebounds grabbed while on court.',
  '3PA Rate': 'Share of field goal attempts that are 3-pointers.',
  '3P Reliance': 'Percent of team points coming from 3-pointers.',
  'FT Rate': 'Free throw attempts per field goal attempt.',
};

const advancedItems = selectedAdvMetrics
  ? [
      { label: 'Possessions', value: selectedAdvMetrics.poss, suffix: '', description: advancedDescriptions.Possessions },
      { label: 'Opponent Poss.', value: selectedAdvMetrics.oppPoss, suffix: '', description: advancedDescriptions['Opponent Poss.'] },
      { label: 'ORtg', value: selectedAdvMetrics.ortg, suffix: '', description: advancedDescriptions.ORtg },
      { label: 'DRtg', value: selectedAdvMetrics.drtg, suffix: '', description: advancedDescriptions.DRtg },
      { label: 'Net Rating', value: selectedAdvMetrics.net, suffix: '', description: advancedDescriptions['Net Rating'] },
      { label: 'Pace', value: selectedAdvMetrics.pace, suffix: '', description: advancedDescriptions.Pace },
      { label: 'Assist Ratio', value: selectedAdvMetrics.astRatio, suffix: '', description: advancedDescriptions['Assist Ratio'] },
      { label: 'TOV Ratio', value: selectedAdvMetrics.tovRatio, suffix: '%', description: advancedDescriptions['TOV Ratio'] },
      { label: 'REB%', value: selectedAdvMetrics.rebPct * 100, suffix: '%', description: advancedDescriptions['REB%'] },
      { label: '3PA Rate', value: selectedAdvMetrics.threeRate * 100, suffix: '%', description: advancedDescriptions['3PA Rate'] },
      { label: '3P Reliance', value: selectedAdvMetrics.threeReliance * 100, suffix: '%', description: advancedDescriptions['3P Reliance'] },
      { label: 'FT Rate', value: selectedAdvMetrics.ftRate * 100, suffix: '%', description: advancedDescriptions['FT Rate'] },
    ]
  : [];
const hasBoxScoreStats = selectedAnalyticsSnapshot ? true : advMetrics != null || totalGames > 0;
const paceVal = selectedAdvMetrics?.pace;
const hasPaceValue = typeof paceVal === 'number' && Number.isFinite(paceVal);
const paceMin = 0;
const paceMax = 120;
const pacePct = hasPaceValue ? Math.max(0, Math.min(1, (paceVal! - paceMin) / (paceMax - paceMin))) : 0;
const paceFill = hasPaceValue ? Math.max(0.08, pacePct) : 0;
const hasLeaguePace = selectedLeaguePaceAvg != null && Number.isFinite(selectedLeaguePaceAvg);
const canComparePace = hasPaceValue && hasLeaguePace;
const paceDiffValue = canComparePace ? paceVal! - selectedLeaguePaceAvg! : 0;
const paceDiffLabel = canComparePace
  ? `${paceDiffValue >= 0 ? '+' : ''}${paceDiffValue.toFixed(2)} ${paceDiffValue >= 0 ? 'faster' : 'slower'} than league`
  : null;
const paceCardCopy = hasLeaguePace
  ? `League avg ${selectedLeaguePaceAvg!.toFixed(2)}${paceDiffLabel ? ` | ${paceDiffLabel}` : ''}`
  : 'Tempo derived from box score pace data.';
const leagueStatData = selectedLeagueStatAvgs ?? { rebounds: 0, assists: 0, blocks: 0, steals: 0 };
const teamStatData = selectedTeamStatAverages ?? { rpg: 0, apg: 0, bpg: 0, spg: 0 };
const ppg = ppgVal > 0 ? ppgVal.toFixed(1) : '-';
const scoringData = selectedTeamScoringBreakdown ?? { ppg2: 0, ppg3: 0, ppgFT: 0 };
const ppg2 = scoringData.ppg2.toFixed(1);
const ppg3 = scoringData.ppg3.toFixed(1);
const ppgFT = scoringData.ppgFT.toFixed(1);
const teamRPG = teamStatData.rpg.toFixed(1);
const teamAPG = teamStatData.apg.toFixed(1);
const teamSPG = teamStatData.spg.toFixed(1);
const teamBPG = teamStatData.bpg.toFixed(1);
const activeSeasonTeamRows = useMemo(() => {
  if (!team?.id) return [];
  const matchingRows = teamSeasonStatsRows.filter((row) => row.teamId === team.id);
  return matchingRows.length ? matchingRows : teamSeasonStatsRows.slice(0, 1);
}, [team?.id, teamSeasonStatsRows]);
const formatTeamValue = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0.0');
const formatTeamPct = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)}%` : '0%');
const buildTrendInfo = (value: number, leagueValue: number) => {
  const diff = value - leagueValue;
  const positive = diff >= 0;
  return {
    diff,
    Icon: positive ? TrendingUp : TrendingDown,
    color: positive ? 'text-brand-lime' : 'text-brand-red',
  };
};
const renderTrendIcon = (value: number, leagueValue: number) => {
  if (!selectedLeagueStatAvgs) {
    return <TrendingUp size={16} className="text-white/40" />;
  }
  const { Icon, color } = buildTrendInfo(value, leagueValue);
  return <Icon size={16} className={color} />;
};
const renderLeagueSummary = (value: number, leagueValue: number) => {
  if (!selectedLeagueStatAvgs) {
    return (
      <div className="mt-2 text-[10px] text-gray-400 uppercase font-bold tracking-wider">
        Awaiting league stats
      </div>
    );
  }
  const { diff, color } = buildTrendInfo(value, leagueValue);
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase text-gray-400 font-bold tracking-wider">
      <span>League avg {leagueValue.toFixed(1)}</span>
      <span className={color}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)} vs league</span>
    </div>
  );
};

  const clampNumber = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const refOff = selectedLeagueOffAvg ?? 70;
  const refDef = selectedLeagueDefAvg ?? 70;
  const safeRefOff = Math.max(1, refOff);
  const safeRefDef = Math.max(1, refDef);
  const sampleWins = selectedAnalyticsSnapshot?.wins ?? team?.wins ?? 0;
  const sampleLosses = selectedAnalyticsSnapshot?.losses ?? team?.losses ?? 0;
  const sampleTies = selectedAnalyticsSnapshot?.ties ?? team?.ties ?? 0;
  const sampleGames = Math.max(0, selectedAnalyticsSnapshot?.gp ?? sampleWins + sampleLosses + sampleTies);
  const hasRatingSample = sampleGames > 0;
  const noSeasonSample = !!selectedAnalyticsSnapshot && !hasRatingSample && selectedAdvMetrics == null;
  const ratingConfidence = hasRatingSample ? clampNumber(sampleGames / 8, 0.4, 1) : 0.4;
  const offenseForRating = hasRatingSample ? ppgVal : safeRefOff;
  const defenseForRating = hasRatingSample ? papgVal : safeRefDef;
  const offDeltaPct = (offenseForRating - safeRefOff) / safeRefOff;
  const defDeltaPct = (safeRefDef - defenseForRating) / safeRefDef;
  const rawOffRating = 60 + offDeltaPct * 140;
  const rawDefRating = 60 + defDeltaPct * 140;
  const baseOffRating = clampNumber(Math.round(rawOffRating), 30, 97);
  const baseDefRating = clampNumber(Math.round(rawDefRating), 30, 97);
  const stabilizedOffRating = Math.round(60 + (baseOffRating - 60) * ratingConfidence);
  const stabilizedDefRating = Math.round(60 + (baseDefRating - 60) * ratingConfidence);
  const winPct = hasRatingSample ? sampleWins / Math.max(1, sampleGames) : 0.5;
  const recordRating = clampNumber(Math.round(35 + winPct * 60), 30, 95);
  const netPpg = hasRatingSample ? ppgVal - papgVal : 0;
  const netRating = clampNumber(Math.round(60 + netPpg * 3.5), 25, 96);
  const offContextRating = clampNumber(Math.round(60 + (ppgVal - refOff) * 3.2), 25, 96);
  const defContextRating = clampNumber(Math.round(60 + (refDef - papgVal) * 3.2), 25, 96);
  const computedOffRating = clampNumber(
    Math.round(
      stabilizedOffRating * 0.62 +
      offContextRating * 0.18 +
      recordRating * 0.12 +
      netRating * 0.08
    ),
    25,
    98
  );
  const computedDefRating = clampNumber(
    Math.round(
      stabilizedDefRating * 0.62 +
      defContextRating * 0.18 +
      recordRating * 0.12 +
      netRating * 0.08
    ),
    25,
    98
  );
  const computedOvrRating = clampNumber(
    Math.round(
      stabilizedOffRating * 0.28 +
      stabilizedDefRating * 0.28 +
      recordRating * 0.28 +
      netRating * 0.16
    ),
    25,
    99
  );
  const offRating = noSeasonSample ? 0 : computedOffRating;
  const defRating = noSeasonSample ? 0 : computedDefRating;
  const ovrRating = noSeasonSample ? 0 : computedOvrRating;
  const offDiff = noSeasonSample ? 0 : ppgVal - refOff;
  const defDiff = noSeasonSample ? 0 : refDef - papgVal;
  const offDiffColor = noSeasonSample ? 'text-gray-500' : offDiff >= 0 ? 'text-brand-lime' : 'text-brand-red';
  const defDiffColor = noSeasonSample ? 'text-gray-500' : defDiff >= 0 ? 'text-brand-lime' : 'text-brand-red';
  const offDiffLabel = noSeasonSample ? 'No sample yet' : `${offDiff >= 0 ? '+' : ''}${offDiff.toFixed(1)} vs league`;
  const defDiffLabel = noSeasonSample ? 'No sample yet' : `${Math.abs(defDiff).toFixed(1)} ${defDiff >= 0 ? 'better' : 'worse'}`;

  const eliteMin = teamRatingThresholds.elite;
  const outstandingMin = teamRatingThresholds.outstanding;
  const aboveAverageMin = teamRatingThresholds.aboveAverage;
  const averageMin = teamRatingThresholds.average;

  const getRatingInfo = (rating: number) => {
    if (noSeasonSample) {
      return {
        label: 'No Sample',
        color: 'text-gray-500',
        bar: 'bg-gray-600',
        ringBorder: 'border-gray-500/35',
        glowShadow: 'rgba(156, 163, 175, 0.18)',
        glowOverlay: 'rgba(156, 163, 175, 0.06)',
      };
    }
    if (rating >= eliteMin) {
      return {
        label: 'Elite',
        color: 'text-yellow-400',
        bar: 'bg-yellow-400',
        ringBorder: 'border-yellow-400/45',
        glowShadow: 'rgba(250, 204, 21, 0.28)',
        glowOverlay: 'rgba(250, 204, 21, 0.1)',
      };
    }
    if (rating >= outstandingMin) {
      return {
        label: 'Outstanding',
        color: 'text-brand-lime',
        bar: 'bg-brand-lime',
        ringBorder: 'border-brand-lime/40',
        glowShadow: 'rgba(225, 255, 43, 0.24)',
        glowOverlay: 'rgba(225, 255, 43, 0.08)',
      };
    }
    if (rating >= aboveAverageMin) {
      return {
        label: 'Above Average',
        color: 'text-blue-400',
        bar: 'bg-blue-400',
        ringBorder: 'border-blue-400/40',
        glowShadow: 'rgba(96, 165, 250, 0.24)',
        glowOverlay: 'rgba(96, 165, 250, 0.1)',
      };
    }
    if (rating >= averageMin) {
      return {
        label: 'Average',
        color: 'text-gray-400',
        bar: 'bg-gray-400',
        ringBorder: 'border-gray-400/35',
        glowShadow: 'rgba(156, 163, 175, 0.2)',
        glowOverlay: 'rgba(156, 163, 175, 0.08)',
      };
    }
    return {
      label: 'Developing',
      color: 'text-brand-red',
      bar: 'bg-brand-red',
      ringBorder: 'border-brand-red/45',
      glowShadow: 'rgba(239, 68, 68, 0.28)',
      glowOverlay: 'rgba(239, 68, 68, 0.1)',
    };
  };

  const ovrInfo = getRatingInfo(ovrRating);
  const offInfo = getRatingInfo(offRating);
  const defInfo = getRatingInfo(defRating);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
        <LoadingOverlay message="Loading..." />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
        <div className="text-white text-xl font-sports">{error || 'Team not found for your account.'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 overflow-x-hidden">
      <div className="max-w-6xl mx-auto overflow-x-hidden">
        {teamId && (
          <Link
            to="/stats"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft size={20} /> Back to League Center
          </Link>
        )}

        {/* TEAM HEADER */}
        <div className="relative min-h-[360px] md:min-h-[440px] rounded-2xl overflow-hidden border border-white/10 mb-12 group shadow-2xl flex items-end">
          <img
            src={team.bannerUrl || defaultBanner}
            alt="Team Banner"
            className="absolute inset-0 z-0 w-full h-full object-cover object-[center_20%] opacity-50 group-hover:opacity-60 transition-all duration-700 scale-105 group-hover:scale-100"
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              if (target.dataset.fallback === 'true') return;
              target.dataset.fallback = 'true';
              target.src = defaultBanner;
            }}
          />
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-brand-black via-brand-black/50 to-transparent"></div>

          <div className="relative z-20 p-6 md:p-10 w-full">
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4 sm:gap-6 w-full">
                <div className="w-24 h-24 md:w-32 md:h-32 shrink-0 rounded-full bg-brand-dark border-4 border-brand-lime overflow-hidden shadow-2xl relative z-10 mx-auto sm:mx-0">
                  <img
                    src={
                      team.logoUrl ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(team.name)}&background=111827&color=10b981`
                    }
                    alt={team.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        team.name
                      )}&background=111827&color=10b981`;
                    }}
                  />
                </div>
                <div className="w-full flex-1 min-w-0 text-center sm:text-left">
                  <div className="flex justify-center sm:justify-start">
                    <span className="bg-brand-red text-white text-xs font-bold px-2 py-1 rounded uppercase tracking-wider mb-2 inline-block">
                      {team.division}
                    </span>
                  </div>
                  <h1 className="font-sports text-4xl sm:text-5xl md:text-7xl font-bold text-white uppercase leading-none shadow-black drop-shadow-lg">
                    {team.name}
                  </h1>
                  {currentTeamPreviousNames.length > 0 && (
                    <div className="mt-2 text-[11px] sm:text-xs uppercase tracking-[0.18em] text-gray-300">
                      Previously named: {currentTeamPreviousNames.join(' / ')}
                    </div>
                  )}
                  {teamBadges.length > 0 && (
                    <>
                      <div className="mt-3 sm:hidden w-full max-w-full overflow-hidden">
                        <BadgeCylinderCarousel
                          items={teamBadges.map((badge) => ({
                            key: badge.key,
                            label: badge.label,
                            url: badge.url,
                          }))}
                        />
                      </div>

                      <div className="mt-3 hidden sm:flex sm:flex-wrap sm:justify-start sm:gap-3 w-full">
                        {teamBadges.map((badge) => (
                          <div key={badge.key} className="h-20 w-20 shrink-0 overflow-hidden md:h-24 md:w-24">
                            <img
                              src={badge.url}
                              alt={`${badge.label} badge`}
                              className="h-full w-full object-contain scale-[1.25] bg-transparent border-0 shadow-none outline-none ring-0"
                              loading="lazy"
                            />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex w-full items-center justify-center gap-8 md:w-auto md:justify-start md:pr-8 pb-2">
                <div className="text-center">
                  <div className="text-brand-grey text-xs uppercase font-bold mb-1">Record</div>
                  <div className="font-sports text-3xl font-bold text-white">
                    {selectedRecordText}
                  </div>
                </div>
                {/* <div className="w-px h-10 bg-white/20"></div>
                <div className="text-center">
                  <div className="text-brand-grey text-xs uppercase font-bold mb-1">Points</div>
                  <div className="font-sports text-3xl font-bold text-brand-lime">{team.pointsFor}</div>
                </div> */}
              </div>
            </div>
          </div>
        </div>

        {/* ANALYTICS */}
        <div className="relative mb-12 animate-fadeIn">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
            <h2 className="font-sports text-3xl text-white uppercase flex items-center gap-3">
              <Activity className="text-brand-lime" size={28} /> Team Analytics
            </h2>

            <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
              {(analyticsSnapshotsLoading || analyticsSnapshots.length > 0) && (
                <div className="flex items-center gap-3 self-stretch md:self-auto">
                  <span className="text-[10px] uppercase font-bold tracking-[0.3em] text-gray-500 whitespace-nowrap">
                    Season View
                  </span>
                  <div className="relative min-w-[220px] flex-1 md:flex-none">
                    <select
                      value={selectedAnalyticsSnapshot?.key || selectedAnalyticsKey}
                      onChange={(event) => setSelectedAnalyticsKey(event.target.value)}
                      className="w-full appearance-none rounded-lg border border-white/10 bg-brand-dark px-4 py-2 pr-11 text-sm font-semibold text-white outline-none transition focus:border-brand-lime/60"
                      disabled={analyticsSnapshotsLoading || !analyticsSnapshots.length}
                    >
                      {analyticsSnapshots.map((snapshot) => (
                        <option key={snapshot.key} value={snapshot.key}>
                          {snapshot.label}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500">
                      {analyticsSnapshotsLoading ? (
                        <span className="text-xs font-bold">...</span>
                      ) : (
                        <ChevronDown size={15} />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasBoxScoreStats && (
                <div className="flex flex-wrap gap-4 text-[10px] uppercase font-bold text-gray-500 bg-brand-dark/50 p-2 rounded border border-white/5">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-400"></span> Elite ({eliteMin}-100)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-brand-lime"></span> Outstanding ({outstandingMin}-{Math.max(eliteMin - 1, outstandingMin)})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-400"></span> Above Avg ({aboveAverageMin}-{Math.max(outstandingMin - 1, aboveAverageMin)})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-400"></span> Average ({averageMin}-{Math.max(aboveAverageMin - 1, averageMin)})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-brand-red"></span> Developing (0-{Math.max(averageMin - 1, 0)})
                  </span>
                </div>
              )}
            </div>
          </div>

          {hasBoxScoreStats ? (
            <>
              <div className="grid grid-cols-1 gap-6 mb-8">
                {/* New hero-like summary card */}
                <div className="bg-gradient-to-r from-brand-dark via-black to-brand-dark border border-white/10 rounded-2xl p-6 lg:p-8 shadow-2xl relative overflow-hidden">
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `radial-gradient(circle at 20% 20%, ${ovrInfo.glowOverlay}, transparent 45%), radial-gradient(circle at 80% 0%, rgba(96,165,250,0.08), transparent 40%)`,
                    }}
                  />
                  <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.04),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0)_50%,rgba(255,255,255,0.02)_100%)]" />
                  <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_0,rgba(255,255,255,0)_40%,rgba(255,255,255,0.06)_80%)] opacity-20" />
                  <div className="relative z-10 grid gap-6 lg:grid-cols-[1.4fr_1fr] items-center">
                    <div className="flex flex-col items-start sm:flex-row sm:items-center gap-4 sm:gap-6">
                      <div
                        className={`w-14 h-14 sm:w-20 sm:h-20 shrink-0 rounded-full bg-black/40 border ${ovrInfo.ringBorder} flex items-center justify-center`}
                        style={{ boxShadow: `0 0 30px ${ovrInfo.glowShadow}` }}
                      >
                        <Target className={`${ovrInfo.color} w-7 h-7 sm:w-11 sm:h-11`} />
                      </div>
                      <div>
                        <div className="text-sm uppercase text-gray-400 font-bold flex items-center gap-2">
                          Overall Rating <InfoTip text="Blend of offense and defense efficiency vs league average." />
                        </div>
                         <div className="flex items-baseline gap-3">
                           <span className={`text-6xl font-sports font-bold ${ovrInfo.color}`}>{ovrRating}</span>
                           <span className={`text-sm font-bold uppercase tracking-widest ${ovrInfo.color}`}>{ovrInfo.label}</span>
                         </div>
                         {/* <div className="mt-3 text-xs text-gray-400 flex flex-wrap gap-3">
                           <span className="flex items-center gap-1">
                             <span className="w-2 h-2 rounded-full bg-brand-lime" /> Drives pace above league
                           </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-blue-400" /> Holds opponents under avg
                          </span>
                        </div> */}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 lg:min-w-[380px] bg-black/30 border border-white/5 rounded-xl p-4">
                      <div className="bg-black/50 border border-white/10 rounded-xl p-4 shadow-inner">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Offense vs League</span>
                          <span>{refOff.toFixed(1)} avg</span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`${offInfo.bar} h-full`}
                            style={{ width: `${Math.min(100, Math.max(5, offRating))}%` }}
                          />
                        </div>
                        <div className="mt-2 text-sm text-white font-bold">
                          {ppgVal.toFixed(1)} PPG <span className={`${offDiffColor} text-xs font-semibold`}>{offDiffLabel}</span>
                        </div>
                        <div className="mt-2 text-[11px] text-gray-400">
                          <div className="h-1.5 w-1/2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-lime" style={{ width: `${Math.min(100, Math.max(5, offRating))}%` }} />
                          </div>
                        </div>
                      </div>

                      <div className="bg-black/50 border border-white/10 rounded-xl p-4 shadow-inner">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Defense vs League</span>
                          <span>{refDef.toFixed(1)} avg</span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`${defInfo.bar} h-full`}
                            style={{ width: `${Math.min(100, Math.max(5, defRating))}%` }}
                          />
                        </div>
                        <div className="mt-2 text-sm text-white font-bold">
                          {Number.isFinite(papgVal) ? papgVal.toFixed(1) : '-'} PA <span className={`${defDiffColor} text-xs font-semibold`}>{defDiffLabel}</span>
                        </div>
                        <div className="mt-2 text-[11px] text-gray-400">
                          <div className="h-1.5 w-1/2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400" style={{ width: `${Math.min(100, Math.max(5, defRating))}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-white font-sports uppercase text-lg">
                      Offensive Rating <InfoTip text="Weighted by scoring vs league, game sample confidence, and team results context." />
                    </div>
                    <Zap size={20} className="text-brand-lime" />
                  </div>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-4xl font-sports font-bold text-white">{ppgVal.toFixed(1)}</span>
                    <span className="text-sm text-gray-400">PPG</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-[11px] uppercase text-gray-500 font-bold mb-1">
                        <span>Efficiency score</span>
                        <span className="text-white font-semibold">{offRating}%</span>
                      </div>
                      <div className="w-full bg-black rounded-full h-2 border border-white/5 overflow-hidden">
                        <div className={`${offInfo.bar} h-full`} style={{ width: `${offRating}%` }} />
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">
                      League avg {refOff.toFixed(1)} | Your output <span className={`font-bold ${offDiffColor}`}>{offDiff >= 0 ? '+' : ''}{offDiff.toFixed(1)}</span> vs league
                    </div>
                  </div>
                </div>

                <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-white font-sports uppercase text-lg">
                      Defensive Rating <InfoTip text="Weighted by points allowed vs league, game sample confidence, and team results context (lower PA is better)." />
                    </div>
                    <Shield size={20} className="text-blue-400" />
                  </div>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-4xl font-sports font-bold text-white">{Number.isFinite(papgVal) ? papgVal.toFixed(1) : "-"}</span>
                    <span className="text-sm text-gray-400">PA</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-[11px] uppercase text-gray-500 font-bold mb-1">
                        <span>Efficiency score</span>
                        <span className="text-white font-semibold">{defRating}%</span>
                      </div>
                      <div className="w-full bg-black rounded-full h-2 border border-white/5 overflow-hidden">
                        <div className={`${defInfo.bar} h-full`} style={{ width: `${defRating}%` }} />
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">
                      League avg {refDef.toFixed(1)} | You allow <span className={`font-bold ${defDiffColor}`}>{Math.abs(defDiff).toFixed(1)}</span> {defDiff >= 0 ? 'fewer' : 'more'} vs league
                    </div>
                  </div>
                </div>
              </div>

              {hasPaceValue && (
                <div className="mt-10 bg-black/30 border border-white/10 rounded-2xl p-6">
                  <div className="mb-8 bg-black/30 border border-white/10 rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-6">
                    <div className="w-16 h-16 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-brand-lime shadow-lg">
                      <Gauge className="text-brand-lime" size={28} />
                    </div>
                    <div className="flex-1 space-y-2 w-full">
                      <div className="flex items-center justify-between text-white font-sports text-lg">
                        <span className="flex items-center gap-2">
                          Team Pace
                          <span className="text-xs uppercase text-gray-400 font-bold">Possessions / Game</span>
                        </span>
                        <span className="text-2xl">{paceVal.toFixed(1)}</span>
                      </div>
                      <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(paceFill * 100).toFixed(0)}%`,
                            backgroundColor: '#a3e635',
                            boxShadow: '0 0 12px 4px rgba(190, 242, 100, 0.35)',
                          }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[10px] uppercase text-gray-500 font-bold">
                        <span>Deliberate</span>
                        <span>League Tempo</span>
                        <span>Fast</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {paceCardCopy}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
                    <div className="flex flex-col sm:flex-row items-center gap-8 lg:gap-16">
                      <div className="relative w-56 h-56 flex-shrink-0">
                        <div
                          className="w-full h-full rounded-full shadow-2xl"
                          style={{
                            background: `conic-gradient(#e1ff2b 0deg 198deg, #3b82f6 198deg 306deg, #ef4444 306deg 360deg)`,
                          }}
                        ></div>
                        <div className="absolute inset-4 bg-brand-dark rounded-full flex flex-col items-center justify-center border border-white/5">
                          <span className="text-5xl font-sports font-bold text-white tracking-tight">{ppg}</span>
                          <span className="text-xs text-gray-500 uppercase font-bold tracking-widest mt-1">ppg</span>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="flex items-center gap-4">
                          <div className="w-3 h-3 rounded-full bg-brand-lime"></div>
                          <div>
                            <div className="text-xs text-gray-400 uppercase font-bold">2 Point FGs</div>
                            <div className="text-2xl font-sports font-bold text-white">{ppg2}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <div>
                            <div className="text-xs text-gray-400 uppercase font-bold">3 Point FGs</div>
                            <div className="text-2xl font-sports font-bold text-white">{ppg3}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <div>
                            <div className="text-xs text-gray-400 uppercase font-bold">Free Throws</div>
                            <div className="text-2xl font-sports font-bold text-white">{ppgFT}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full lg:w-auto flex-1 grid grid-cols-2 md:grid-cols-4 gap-6 border-t lg:border-t-0 lg:border-l border-white/10 pt-8 lg:pt-0 lg:pl-12">
                    <div className="text-center p-4 bg-black/20 rounded-xl border border-white/5 hover:border-brand-lime/30 transition-colors">
                      <div className="text-4xl font-sports font-bold text-white mb-2 flex items-center justify-center gap-2">
                        {teamRPG}
                        {renderTrendIcon(teamStatData.rpg, leagueStatData.rebounds)}
                      </div>
                      <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                        Rebounds Per Game
                        <InfoTip text="Trend arrow shows if this stat is above (lime) or below (red) the league average." />
                      </div>
                      {renderLeagueSummary(teamStatData.rpg, leagueStatData.rebounds)}
                    </div>
                    <div className="text-center p-4 bg-black/20 rounded-xl border border-white/5 hover:border-brand-lime/30 transition-colors">
                      <div className="text-4xl font-sports font-bold text-white mb-2 flex items-center justify-center gap-2">
                        {teamAPG}
                        {renderTrendIcon(teamStatData.apg, leagueStatData.assists)}
                      </div>
                      <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                        Assists Per Game
                        <InfoTip text="Trend arrow shows if this stat is above (lime) or below (red) the league average." />
                      </div>
                      {renderLeagueSummary(teamStatData.apg, leagueStatData.assists)}
                    </div>
                    <div className="text-center p-4 bg-black/20 rounded-xl border border-white/5 hover:border-brand-lime/30 transition-colors">
                      <div className="text-4xl font-sports font-bold text-white mb-2 flex items-center justify-center gap-2">
                        {teamBPG}
                        {renderTrendIcon(teamStatData.bpg, leagueStatData.blocks)}
                      </div>
                      <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                        Blocks Per Game
                        <InfoTip text="Trend arrow shows if this stat is above (lime) or below (red) the league average." />
                      </div>
                      {renderLeagueSummary(teamStatData.bpg, leagueStatData.blocks)}
                    </div>
                    <div className="text-center p-4 bg-black/20 rounded-xl border border-white/5 hover:border-brand-lime/30 transition-colors">
                      <div className="text-4xl font-sports font-bold text-white mb-2 flex items-center justify-center gap-2">
                        {teamSPG}
                        {renderTrendIcon(teamStatData.spg, leagueStatData.steals)}
                      </div>
                      <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                        Steals Per Game
                        <InfoTip text="Trend arrow shows if this stat is above (lime) or below (red) the league average." />
                      </div>
                      {renderLeagueSummary(teamStatData.spg, leagueStatData.steals)}
                    </div>
                    </div>
                  </div>
                </div>
              )}

              {advancedItems.length > 0 && (
                <div className="mt-10 bg-black/30 border border-white/10 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-white font-sports uppercase text-lg">
                      Advanced Metrics <InfoTip text="Team and opponent efficiency derived from box scores." />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {advancedItems.map((item) => (
                      <div key={item.label} className="bg-black/50 border border-white/5 rounded-xl p-3">
                        <div className="text-xs uppercase text-gray-500 font-bold mb-1 flex items-center gap-1">
                          <span>{item.label}</span>
                          {item.description && <InfoTip text={item.description} />}
                        </div>
                        <div className="text-2xl font-sports text-white">
                          {Number.isFinite(item.value) ? item.value.toFixed(2) : '-'}
                          <span className="text-sm text-gray-400 ml-1">{item.suffix}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-brand-dark border border-white/10 rounded-2xl p-8 text-gray-400 text-sm">
              No box score data yet.
            </div>
          )}
        </div>

        <div className="mb-12 bg-brand-dark border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-white/10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.45em] text-brand-grey">Stats</div>
              <h2 className="font-sports text-3xl text-white uppercase">Team Overview</h2>
            </div>
            <div className="inline-flex rounded-full border border-white/15 bg-black/30 p-1 self-start lg:self-auto">
              <button
                type="button"
                onClick={() => setTeamStatsTab('active')}
                className={`px-4 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wide whitespace-nowrap rounded-full transition ${
                  teamStatsTab === 'active' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                }`}
              >
                Active Season
              </button>
              <button
                type="button"
                onClick={() => setTeamStatsTab('career')}
                className={`px-4 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wide whitespace-nowrap rounded-full transition ${
                  teamStatsTab === 'career' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                }`}
              >
                Team Career
              </button>
            </div>
          </div>

          {teamStatsTab === 'active' ? (
            activePlayerStatsLoading ? (
              <div className="px-6 py-8 text-sm text-gray-400">Loading player stats...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left">
                  <thead className="bg-neutral-900 text-brand-grey text-xs uppercase font-bold">
                    <tr>
                      <th className="p-4">Player</th>
                      <th className="p-4">Pos</th>
                      <th className="p-4">GP</th>
                      <th className="p-4">PPG</th>
                      <th className="p-4">RPG</th>
                      <th className="p-4">APG</th>
                      <th className="p-4">SPG</th>
                      <th className="p-4">BPG</th>
                      <th className="p-4">TOV</th>
                      <th className="p-4">FG%</th>
                      <th className="p-4">3PT%</th>
                      <th className="p-4">FT%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm text-white">
                    {activePlayerStatsRows.map((row) => (
                      <tr key={row.key} className="hover:bg-white/5">
                        <td className="p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/15 text-brand-lime text-xs font-bold font-mono flex items-center justify-center shrink-0">
                              {row.jerseyNumber || '-'}
                            </div>
                            {row.playerId ? (
                              <Link
                                to={`/player/${row.playerId}`}
                                state={rosterReturnState}
                                className="truncate hover:text-brand-lime transition-colors"
                              >
                                {row.playerName}
                              </Link>
                            ) : (
                              <span className="truncate">{row.playerName}</span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-gray-300">{row.position || '-'}</td>
                        <td className="p-4">{row.gp}</td>
                        <td className="p-4">{formatTeamValue(row.ppg)}</td>
                        <td className="p-4">{formatTeamValue(row.rpg)}</td>
                        <td className="p-4">{formatTeamValue(row.apg)}</td>
                        <td className="p-4">{formatTeamValue(row.spg)}</td>
                        <td className="p-4">{formatTeamValue(row.bpg)}</td>
                        <td className="p-4">{formatTeamValue(row.tov)}</td>
                        <td className="p-4">{formatTeamPct(row.fgPct)}</td>
                        <td className="p-4">{formatTeamPct(row.threePct)}</td>
                        <td className="p-4">{formatTeamPct(row.ftPct)}</td>
                      </tr>
                    ))}
                    {activePlayerStatsRows.length === 0 && (
                      <tr>
                        <td colSpan={12} className="p-6 text-center text-gray-400 text-sm">
                          No player stats available for this season.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          ) : careerPlayerStatsLoading ? (
            <div className="px-6 py-8 text-sm text-gray-400">Loading career player stats...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-neutral-900 text-brand-grey text-xs uppercase font-bold">
                  <tr>
                    <th className="p-4">Player</th>
                    <th className="p-4">Seasons</th>
                    <th className="p-4">Pos</th>
                    <th className="p-4">GP</th>
                    <th className="p-4">PPG</th>
                    <th className="p-4">RPG</th>
                    <th className="p-4">APG</th>
                    <th className="p-4">SPG</th>
                    <th className="p-4">BPG</th>
                    <th className="p-4">TOV</th>
                    <th className="p-4">FG%</th>
                    <th className="p-4">3PT%</th>
                    <th className="p-4">FT%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm text-white">
                  {careerPlayerStatsRows.map((row) => (
                    <tr key={row.key} className="hover:bg-white/5">
                      <td className="p-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/15 text-brand-lime text-xs font-bold font-mono flex items-center justify-center shrink-0">
                            {row.jerseyNumber || '-'}
                          </div>
                          {row.playerId ? (
                            <Link
                              to={`/player/${row.playerId}`}
                              state={{
                                ...rosterReturnState,
                                relatedPlayerIds: row.mergedPlayerIds || (row.playerId ? [row.playerId] : []),
                              }}
                              className="truncate hover:text-brand-lime transition-colors"
                            >
                              {row.playerName}
                            </Link>
                          ) : (
                            <span className="truncate">{row.playerName}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">{row.seasonsPlayed || 0}</td>
                      <td className="p-4 text-gray-300">{row.position || '-'}</td>
                      <td className="p-4">{row.gp}</td>
                      <td className="p-4">{formatTeamValue(row.ppg)}</td>
                      <td className="p-4">{formatTeamValue(row.rpg)}</td>
                      <td className="p-4">{formatTeamValue(row.apg)}</td>
                      <td className="p-4">{formatTeamValue(row.spg)}</td>
                      <td className="p-4">{formatTeamValue(row.bpg)}</td>
                      <td className="p-4">{formatTeamValue(row.tov)}</td>
                      <td className="p-4">{formatTeamPct(row.fgPct)}</td>
                      <td className="p-4">{formatTeamPct(row.threePct)}</td>
                      <td className="p-4">{formatTeamPct(row.ftPct)}</td>
                    </tr>
                  ))}
                  {careerPlayerStatsRows.length === 0 && (
                    <tr>
                      <td colSpan={13} className="p-6 text-center text-gray-400 text-sm">
                        No career player stats available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-6">
            <div className="bg-brand-dark border border-white/10 rounded-xl p-6">
              <h3 className="font-sports text-xl text-white uppercase mb-4 flex items-center gap-2">
                <Users size={20} className="text-brand-lime" /> Active Roster
              </h3>
              {roster.length > 0 ? (
                <ul className="space-y-0 divide-y divide-white/5">
                  {roster.map((player) => {
                    const playerLink = player.id ? `/player/${player.id}` : '';
                    return (
                      <li key={player.id} className="py-1">
                        <Link
                          to={playerLink}
                          state={playerLink ? rosterReturnState : undefined}
                          className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-white/5 transition-colors"
                          aria-label={`View ${player.name} profile`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-xs font-bold font-mono text-brand-lime border border-white/10">
                              {player.number}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-white font-medium text-sm flex items-center gap-1">
                                {player.name}
                                {player.isCaptain && <Crown size={12} className="text-yellow-400 fill-yellow-400" />}
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500">{player.position || '-'}</div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-gray-500 text-sm italic">No roster available.</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <h2 className="font-sports text-2xl text-white uppercase mb-6">Game History</h2>
            <GameList games={completedGames} teams={teamsForGames} showScores={true} variant="history" boxScoreReturnLabel="My Team" />
            {completedGames.length === 0 && (
              <div className="text-center py-12 border border-dashed border-white/10 rounded-xl text-gray-500">
                No games played this season.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default MyTeam;

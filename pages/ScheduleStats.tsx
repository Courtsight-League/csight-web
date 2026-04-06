
import React, { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SEASONS, TEAMS, GAMES } from '../constants';
import { StandingsTable, GameList, LeadersTable } from '../components/StatsComponents';
import { Filter } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { PlayerStats } from '../types';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';
import { signTeamAssetUrl } from '../services/dataCache';

type Tab = 'SCHEDULE' | 'SCORES' | 'STANDINGS' | 'TEAMS' | 'LEADERS';

const ScheduleStats: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') || 'schedule').toUpperCase() as Tab;
  const rawDivisionParam = searchParams.get('division');
  const divisionParam = rawDivisionParam ? rawDivisionParam.toUpperCase() : '';
  const teamParam = searchParams.get('team') || '';
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(
    ['SCHEDULE', 'SCORES', 'STANDINGS', 'TEAMS', 'LEADERS'].includes(tabParam)
      ? tabParam
      : 'SCHEDULE'
  );
  const [divisionFilter, setDivisionFilter] = useState<string>(divisionParam);
  const [teamFilter, setTeamFilter] = useState<string>(teamParam);

  const [seasons, setSeasons] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [seasonDivisions, setSeasonDivisions] = useState<{ name: string; seasonId: string }[]>([]);
  const [leaders, setLeaders] = useState<any[]>([]); // no mock; live only
  const [leadersData, setLeadersData] = useState<any[]>([]);
  const [importedLeadersData, setImportedLeadersData] = useState<any[]>([]);
  const [leadersGameType, setLeadersGameType] = useState<'regular' | 'playoffs' | 'exhibition'>('regular');
  const [supportsPlayoffFilter, setSupportsPlayoffFilter] = useState(true);
  const [leadersDataKey, setLeadersDataKey] = useState('');
  const [importedLeadersDataKey, setImportedLeadersDataKey] = useState('');

  // Load data from Supabase (public)
  useEffect(() => {
    const load = async () => {
      try {
        // Seasons (prefer is_current first)
        const { data: seasonRows } = await supabase
          .from('seasons')
          .select('id,name,year,is_current,start_date,is_public')
          .order('start_date', { ascending: false });
        if (seasonRows && seasonRows.length) {
          const parsePublicFlag = (value: any) => {
            if (value === true || value === 'true' || value === 'TRUE' || value === 't') return true;
            if (value === false || value === 'false' || value === 'FALSE' || value === 'f') return false;
            return true;
          };
          const mapped = seasonRows.map((s: any) => ({
            id: s.id,
            name: s.name || `Season ${s.year || ''}`.trim(),
            isActive: !!s.is_current,
            isPublic: parsePublicFlag(s.is_public),
          }));
          const visibleSeasons = mapped.filter((season) => season.isPublic);
          setSeasons(visibleSeasons);
          const qsSeason = searchParams.get('season');
          const current = (qsSeason && visibleSeasons.find((s) => s.id === qsSeason)) || visibleSeasons.find((s) => s.isActive) || visibleSeasons[0];
          if (current) setSelectedSeasonId(current.id);
        }

        // Teams
        const { data: teamRows } = await supabase.from('teams').select('*');
        const signTeamAsset = async (path?: string | null) => {
          const cleanedPath = typeof path === 'string' ? path.trim() : '';
          if (!cleanedPath) return '';
          const lower = cleanedPath.toLowerCase();
          if (lower === 'null' || lower === 'undefined') return '';
          if (/^https?:\/\//.test(cleanedPath)) return cleanedPath;
          const marker = 'team-assets/';
          const idx = cleanedPath.indexOf(marker);
          const cleanPath = idx >= 0 ? cleanedPath.slice(idx + marker.length) : cleanedPath;
          if (!cleanPath) return '';
          try {
            const { data, error } = await supabase.storage
              .from('team-assets')
              .createSignedUrl(cleanPath, 60 * 60 * 24 * 365);
            if (error) throw error;
            return data?.signedUrl || '';
          } catch {
            return '';
          }
        };
        if (teamRows && teamRows.length) {
          const mappedTeams = await Promise.all(
            teamRows.map(async (t: any) => ({
              id: t.id,
              name: t.name,
              division: t.division || 'D1',
              logoUrl: await signTeamAsset(t.logo_url),
              bannerUrl: await signTeamAsset(t.banner_url),
              seasonId: t.season_id || '',
              wins: 0,
              losses: 0,
              ties: 0,
              pointsFor: 0,
              pointsAgainst: 0,
            }))
          );
          setTeams(mappedTeams);
        }

        // Games
        const { data: gameRows } = await supabase
          .from('games')
          .select('*')
          .order('game_datetime', { ascending: true });
        if (gameRows) {
          const mappedGames = gameRows.map((g: any) => ({
            id: g.id,
            seasonId: g.season_id,
            date: g.game_datetime ? new Date(g.game_datetime).toISOString().slice(0, 10) : g.date || '',
            time: g.game_datetime ? new Date(g.game_datetime).toISOString().slice(11, 16) : g.time || '',
            location: g.location || g.court_name || '',
            homeTeamId: g.home_team_id,
            awayTeamId: g.away_team_id,
            homeScore: g.home_score ?? null,
            awayScore: g.away_score ?? null,
            status: (g.status || 'SCHEDULED').toString().toUpperCase(),
            youtubeLink: g.youtube_url || '',
            isPlayoff: !!g.is_playoff,
          }));
          setGames(mappedGames);
        }

        // Divisions (configured per season)
        try {
          const { data: divisionRows, error: divisionErr } = await supabase
            .from('divisions')
            .select('name,season_id');
          if (divisionErr) throw divisionErr;
          const mappedDivisions = (divisionRows || [])
            .map((row: any) => ({
              name: String(row.name || '').trim(),
              seasonId: String(row.season_id || ''),
            }))
            .filter((row) => row.name && row.seasonId);
          setSeasonDivisions(mappedDivisions);
        } catch (divisionLoadErr) {
          console.warn('Public divisions load error', divisionLoadErr);
          setSeasonDivisions([]);
        }

      } catch (err) {
        console.error('Public schedule load error', err);
        // fall back to constants silently
      }
    };

    load();
  }, []);

  // keep activeTab in sync if query changes externally
  useEffect(() => {
    const candidate = tabParam;
    if (['SCHEDULE', 'SCORES', 'STANDINGS', 'TEAMS', 'LEADERS'].includes(candidate) && candidate !== activeTab) {
      setActiveTab(candidate as Tab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  // Sync tab/season to URL for deep links (footer links)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab.toLowerCase());
    if (selectedSeasonId) next.set('season', selectedSeasonId);
    if (divisionFilter) {
      next.set('division', divisionFilter.toLowerCase());
    } else {
      next.delete('division');
    }
    if (teamFilter) {
      next.set('team', teamFilter);
    } else {
      next.delete('team');
    }
    setSearchParams(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedSeasonId, divisionFilter, teamFilter]);
  
  // Filter Data
  const seasonGames = useMemo(
    () => games.filter(g => !selectedSeasonId || g.seasonId === selectedSeasonId),
    [games, selectedSeasonId]
  );
  const seasonTeams = useMemo(
    () => teams.filter(t => !selectedSeasonId || t.seasonId === selectedSeasonId),
    [teams, selectedSeasonId]
  );
  const divisionOptions = useMemo(() => {
    if (!selectedSeasonId) return [];
    const teamDivisions = seasonTeams
      .map((t) => (t.division || '').toUpperCase())
      .filter(Boolean);
    const configuredDivisions = seasonDivisions
      .filter((d) => d.seasonId === selectedSeasonId)
      .map((d) => d.name.toUpperCase())
      .filter(Boolean);
    const divisions = Array.from(new Set([...configuredDivisions, ...teamDivisions])).sort();
    return divisions;
  }, [selectedSeasonId, seasonDivisions, seasonTeams]);
  const divisionTeams = useMemo(
    () =>
      divisionFilter
        ? seasonTeams.filter((t) => (t.division || '').toUpperCase() === divisionFilter)
        : seasonTeams,
    [divisionFilter, seasonTeams]
  );
  const divisionTeamIds = useMemo(() => new Set(divisionTeams.map((t) => t.id)), [divisionTeams]);
  const scheduleTeamOptions = useMemo(
    () =>
      [...divisionTeams]
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((team) => ({
          id: team.id,
          name: team.name || 'Team',
        })),
    [divisionTeams]
  );
  const toNumber = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let normalized = String(value).trim();
    if (!normalized) return null;
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');
    if (hasComma && !hasDot) {
      normalized = normalized.replace(/,/g, '.');
    } else if (hasComma && hasDot) {
      normalized = normalized.replace(/,/g, '');
    }
    normalized = normalized.replace(/[^0-9.+-]/g, '');
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  };
  const normalizePct = (value: number | null): number => {
    if (value === null || value === undefined) return 0;
    if (value <= 1 && value >= 0) return value * 100;
    return value;
  };
  const divisionGames = useMemo(
    () =>
      divisionFilter
        ? seasonGames.filter(
            (g) => divisionTeamIds.has(g.homeTeamId) || divisionTeamIds.has(g.awayTeamId)
          )
        : seasonGames,
    [divisionFilter, divisionTeamIds, seasonGames]
  );
  
  // keep division filter in sync with query changes and available divisions
  useEffect(() => {
    setDivisionFilter((current) => {
      if (!divisionOptions.length) return '';
      if (divisionParam && divisionOptions.includes(divisionParam)) return divisionParam;
      // No valid division query param means "All Divisions",
      // unless the current local value is still valid.
      return current && divisionOptions.includes(current) ? current : '';
    });
  }, [divisionParam, divisionOptions]);

  useEffect(() => {
    setTeamFilter((current) => {
      if (!scheduleTeamOptions.length) return '';
      if (teamParam && scheduleTeamOptions.some((team) => team.id === teamParam)) return teamParam;
      return current && scheduleTeamOptions.some((team) => team.id === current) ? current : '';
    });
  }, [teamParam, scheduleTeamOptions]);
  
  const scheduledGames = useMemo(() => 
    divisionGames
      .filter((g) =>
        teamFilter ? g.homeTeamId === teamFilter || g.awayTeamId === teamFilter : true
      )
      .filter(g => g.status === 'SCHEDULED')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), 
  [divisionGames, teamFilter]);

  const selectedTeamName = useMemo(
    () => scheduleTeamOptions.find((team) => team.id === teamFilter)?.name || 'Team',
    [scheduleTeamOptions, teamFilter]
  );

  const completedGames = useMemo(() => 
    divisionGames
      .filter(g => g.status === 'COMPLETED' || g.status === 'FORFEITED' || g.status === 'CANCELED')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), 
  [divisionGames]);

  // Fetch leaders per season (live, season-filtered via games join)
  useEffect(() => {
    let active = true;
    const loadLeaders = async () => {
      const currentKey = selectedSeasonId ? `${selectedSeasonId}-${leadersGameType}` : '';
      if (!selectedSeasonId) {
        if (active) {
          setLeadersData([]);
          setLeadersDataKey(currentKey);
        }
        return;
      }
      if (leadersGameType === 'exhibition') {
        if (active) {
          setLeadersData([]);
          setLeadersDataKey(currentKey);
        }
        return;
      }
      try {
          const fetchStats = async (includePlayoff: boolean) => {
            const { data, error } = await supabase
              .from('game_stats')
              .select(`
                player_id,
                team_id,
            points,
            rebounds,
            assists,
            steals,
            blocks,
                fgm,
                fga,
                game_id,
                games!inner(id, season_id${includePlayoff ? ', is_playoff' : ''}),
                players(id, first_name, last_name, team_id, photo_url)
              `)
              .eq('games.season_id', selectedSeasonId);
            return { data, error };
          };

          let statRows: any[] = [];
          let canFilterPlayoff = true;
          const primary = await fetchStats(true);
          if (primary.error) {
            const message = primary.error?.message?.toLowerCase?.() || '';
            const isPlayoffMissing =
              primary.error?.code === '42703' ||
              message.includes('is_playoff') ||
              message.includes('is playoff');
            if (isPlayoffMissing) {
              const fallback = await fetchStats(false);
              if (fallback.error) throw fallback.error;
              statRows = fallback.data || [];
              canFilterPlayoff = false;
            } else {
              throw primary.error;
            }
          } else {
            statRows = primary.data || [];
          }

          if (!active) return;
          setSupportsPlayoffFilter(canFilterPlayoff);
          if (!statRows.length) {
            setLeadersData([]);
            setLeadersDataKey(currentKey);
            return;
          }

          const resolveIsPlayoff = (row: any) => {
            const game = Array.isArray(row.games) ? row.games[0] : row.games;
            return game?.is_playoff === true;
          };
          const filteredRows = statRows.filter((row: any) => {
            if (!canFilterPlayoff) return true;
            const isPlayoff = resolveIsPlayoff(row);
            if (leadersGameType === 'playoffs') return isPlayoff;
            if (leadersGameType === 'regular') return !isPlayoff;
            return false;
          });

        if (!filteredRows.length) {
          setLeadersData([]);
          return;
        }

        const aggregate: Record<string, any> = {};
        filteredRows.forEach((row: any) => {
          const key = row.player_id;
          if (!key) return;
          const name =
            [row.players?.first_name, row.players?.last_name].filter(Boolean).join(' ').trim() ||
            `Player ${String(key).slice(0, 6)}`;
          const teamId = row.team_id || row.players?.team_id || '';
          if (!aggregate[key]) {
            aggregate[key] = {
              playerId: key,
              playerName: name,
              teamId,
              photoUrl: row.players?.photo_url || '',
              gp: 0,
              pts: 0,
              reb: 0,
              ast: 0,
              stl: 0,
              fgm: 0,
              fga: 0,
              blk: 0,
            };
          }
          if (!aggregate[key].photoUrl && row.players?.photo_url) {
            aggregate[key].photoUrl = row.players.photo_url;
          }
          aggregate[key].gp += 1;
          aggregate[key].pts += row.points || 0;
          aggregate[key].reb += row.rebounds || 0;
          aggregate[key].ast += row.assists || 0;
          aggregate[key].stl += row.steals || 0;
          aggregate[key].fgm += row.fgm || 0;
          aggregate[key].fga += row.fga || 0;
          aggregate[key].blk += row.blocks ?? row.blk ?? 0;
        });

        let mapped = await Promise.all(Object.values(aggregate).map(async (p: any) => {
          const t = seasonTeams.find((tm) => tm.id === p.teamId) || teams.find((tm) => tm.id === p.teamId);
          const fallbackName = p.playerName || (p.playerId ? `Player ${String(p.playerId).slice(0, 6)}` : 'Player');
          const avatarUrl = await signTeamAssetUrl(p.photoUrl || '');
          return {
            playerId: p.playerId,
            playerName: fallbackName,
            teamId: p.teamId,
            teamName: t?.name || '',
            avatarUrl,
            division: t?.division || '',
            gp: p.gp,
            ppg: p.gp ? +(p.pts / p.gp).toFixed(1) : 0,
            rpg: p.gp ? +(p.reb / p.gp).toFixed(1) : 0,
            apg: p.gp ? +(p.ast / p.gp).toFixed(1) : 0,
            spg: p.gp ? +(p.stl / p.gp).toFixed(1) : 0,
            fgPct: p.fga ? +((p.fgm / p.fga) * 100).toFixed(1) : 0,
            bpg: p.gp ? +(p.blk / p.gp).toFixed(1) : 0,
          };
        }));
        // Deduplicate by player + team to avoid repeats in lists
        const uniqMap = new Map<string, any>();
        mapped.forEach((m: any) => {
          const key = `${(m.playerName || '').toLowerCase()}-${(m.teamName || '').toLowerCase()}`;
          if (!uniqMap.has(key)) uniqMap.set(key, m);
        });
        mapped = Array.from(uniqMap.values());
        // If no results (season mismatch), optionally fall back to all stats so page isn't empty
        if (!mapped.length && filteredRows.length) {
          mapped = await Promise.all(Object.values(aggregate).map(async (p: any) => {
            const t = teams.find((tm) => tm.id === p.teamId);
            const fallbackName = p.playerName || (p.playerId ? `Player ${String(p.playerId).slice(0, 6)}` : 'Player');
            const avatarUrl = await signTeamAssetUrl(p.photoUrl || '');
          return {
            playerId: p.playerId,
            playerName: fallbackName,
            teamId: p.teamId,
            teamName: t?.name || '',
            avatarUrl,
            division: t?.division || '',
            gp: p.gp,
            ppg: p.gp ? +(p.pts / p.gp).toFixed(1) : 0,
            rpg: p.gp ? +(p.reb / p.gp).toFixed(1) : 0,
            apg: p.gp ? +(p.ast / p.gp).toFixed(1) : 0,
            spg: p.gp ? +(p.stl / p.gp).toFixed(1) : 0,
            fgPct: p.fga ? +((p.fgm / p.fga) * 100).toFixed(1) : 0,
            bpg: p.gp ? +(p.blk / p.gp).toFixed(1) : 0,
          };
          }));
        }
        // Sort by key metric for each leader table later; keep as-is here
        if (!active) return;
        setLeadersData(mapped as any[]);
        setLeadersDataKey(currentKey);
      } catch (err) {
        console.error('Leaders load error', err);
        if (active) {
          setLeadersData([]);
          setLeadersDataKey(currentKey);
        }
      }
    };
    loadLeaders();
    return () => {
      active = false;
    };
  }, [selectedSeasonId, teams, leadersGameType]);

  useEffect(() => {
    if (!supportsPlayoffFilter && leadersGameType === 'playoffs') {
      setLeadersGameType('regular');
    }
  }, [supportsPlayoffFilter, leadersGameType]);

  // Fetch imported leaders per season (legacy CSV)
  useEffect(() => {
    let active = true;
    const loadImportedLeaders = async () => {
      const currentKey = selectedSeasonId ? `${selectedSeasonId}-${leadersGameType}` : '';
      if (!selectedSeasonId) {
        if (active) {
          setImportedLeadersData([]);
          setImportedLeadersDataKey(currentKey);
        }
        return;
      }
      try {
        const matchesGameType = (value: any) => {
          const normalized = String(value || '').toLowerCase().trim();
          if (leadersGameType === 'regular') {
            return (
              !normalized ||
              normalized.includes('regular') ||
              normalized === 'reg' ||
              normalized === 'rs'
            );
          }
          if (leadersGameType === 'playoffs') {
            return normalized.includes('playoff') || normalized === 'po';
          }
          return (
            normalized.includes('exhibition') ||
            normalized.includes('exh') ||
            normalized.includes('preseason') ||
            normalized.includes('pre-season')
          );
        };

        const buildImportedQuery = (includeGameType: boolean) => {
          let query = supabase
            .from('season_player_stats')
            .select(
              'id,team_id,team_name,division,first_name,last_name,gp,pts,reb,ast,stl,fg_pct,fgm,fga,game_type'
            )
            .eq('season_id', selectedSeasonId);
          if (includeGameType) {
            if (leadersGameType === 'regular') {
              query = query.or('game_type.eq.regular,game_type.is.null,game_type.ilike.*regular*');
            } else if (leadersGameType === 'playoffs') {
              query = query.or('game_type.eq.playoffs,game_type.ilike.*playoff*');
            } else {
              query = query.or('game_type.eq.exhibition,game_type.ilike.*exhibition*');
            }
          }
          return query;
        };

        const pickValue = (row: Record<string, any>, keys: string[]) => {
          for (const key of keys) {
            if (row[key] !== undefined && row[key] !== null) return row[key];
          }
          return null;
        };

        const computeBlocksPerGame = (row: Record<string, any>, gpValue: number) => {
          const directBpg = toNumber(
            pickValue(row, ['bpg', 'blocks_per_game', 'blocks per game'])
          );
          if (directBpg !== null) return directBpg;
          const totalBlocks = toNumber(pickValue(row, ['blocks', 'blk', 'blocks_total']));
          if (totalBlocks !== null && gpValue && gpValue > 0) {
            return +(totalBlocks / gpValue).toFixed(1);
          }
          return 0;
        };

        const loadPlayerIdentityMap = async (rows: any[]) => {
          const playerIds = Array.from(
            new Set(
              rows
                .map((row) => row.player_id || row.playerId || row.id)
                .filter(Boolean)
            )
          );
          const playerIdentityById = new Map<string, { name: string; avatarUrl: string }>();
          if (!playerIds.length) return playerIdentityById;

          const { data: playerRows } = await supabase
            .from('players')
            .select('id,first_name,last_name,photo_url')
            .in('id', playerIds);

          const signedPlayers = await Promise.all(
            (playerRows || []).map(async (player: any) => ({
              id: player.id,
              name: [player.first_name, player.last_name].filter(Boolean).join(' ').trim(),
              avatarUrl: await signTeamAssetUrl(player.photo_url || ''),
            }))
          );

          signedPlayers.forEach((player) => {
            if (!player.id) return;
            playerIdentityById.set(player.id, {
              name: player.name,
              avatarUrl: player.avatarUrl,
            });
          });

          return playerIdentityById;
        };

        const mapSeasonRows = async (rows: any[]) => {
          const playerIdentityById = await loadPlayerIdentityMap(rows);
          return rows.map((row: any) => {
            const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
            const team = seasonTeams.find((tm) => tm.id === row.team_id) || teams.find((tm) => tm.id === row.team_id);
            const fgRaw = toNumber(row.fg_pct);
            const fgm = toNumber(row.fgm);
            const fga = toNumber(row.fga);
            const fgComputed = fgRaw != null ? fgRaw : fgm != null && fga ? fgm / fga : null;
            const gpValue = toNumber(row.gp) || 0;
            const playerId = row.player_id || row.id || `${(name || 'player').toLowerCase()}-${row.team_id || row.team_name || ''}`;
            const identity = playerId ? playerIdentityById.get(playerId) : undefined;
            return {
              playerId,
              playerName: name || identity?.name || 'Player',
              teamId: row.team_id || '',
              teamName: team?.name || row.team_name || '',
              avatarUrl: identity?.avatarUrl || '',
              division: row.division || team?.division || '',
              gp: gpValue,
              ppg: toNumber(row.pts) || 0,
              rpg: toNumber(row.reb) || 0,
              apg: toNumber(row.ast) || 0,
              spg: toNumber(row.stl) || 0,
              fgPct: normalizePct(fgComputed),
              bpg: computeBlocksPerGame(row, gpValue),
            };
          });
        };

        const mapLegacyRows = async (rows: any[]) => {
          const playerIdentityById = await loadPlayerIdentityMap(rows);

          return rows.map((row: any) => {
            const playerId = row.player_id || row.playerId || row.id || '';
            const teamId = row.team_id || row.teamId || '';
            const team = seasonTeams.find((tm) => tm.id === teamId) || teams.find((tm) => tm.id === teamId);
            const firstName = pickValue(row, ['first_name', 'firstName', 'firstname']);
            const lastName = pickValue(row, ['last_name', 'lastName', 'lastname']);
            const directName = pickValue(row, ['player_name', 'playerName', 'name']);
            const identity = playerId ? playerIdentityById.get(playerId) : undefined;
            const nameFromId = identity?.name || '';
            const name = [firstName, lastName]
              .filter(Boolean)
              .join(' ')
              .trim();
            const finalName = (name || directName || nameFromId || '').trim();
            const fgRaw = toNumber(pickValue(row, ['fg_pct', 'fgPct', 'fg_percentage']));
            const fgm = toNumber(pickValue(row, ['fgm']));
            const fga = toNumber(pickValue(row, ['fga']));
            const fgComputed = fgRaw != null ? fgRaw : fgm != null && fga ? fgm / fga : null;
            const gpValue = toNumber(pickValue(row, ['gp', 'games', 'games_played'])) || 0;
            const finalBpg = computeBlocksPerGame(row, gpValue);
            return {
              playerId: playerId || `${(finalName || 'player').toLowerCase()}-${teamId || row.team_name || ''}`,
              playerName: finalName || (playerId ? `Player ${String(playerId).slice(0, 6)}` : 'Player'),
              teamId: teamId || '',
              teamName: team?.name || row.team_name || row.teamName || '',
              avatarUrl: identity?.avatarUrl || '',
              division: row.division || team?.division || '',
              gp: gpValue,
              ppg: toNumber(pickValue(row, ['pts', 'points', 'ppg'])) || 0,
              rpg: toNumber(pickValue(row, ['reb', 'rebounds', 'rpg'])) || 0,
              apg: toNumber(pickValue(row, ['ast', 'assists', 'apg'])) || 0,
              spg: toNumber(pickValue(row, ['stl', 'steals', 'spg'])) || 0,
              fgPct: normalizePct(fgComputed),
              bpg: finalBpg,
            };
          });
        };

        let statRows: any[] | null = null;
        let statErr: any = null;
        const primary = await buildImportedQuery(true);
        statRows = primary.data;
        statErr = primary.error;
        if (statErr) {
          const message = statErr.message?.toLowerCase?.() || '';
          const missingGameType =
            statErr.code === '42703' || message.includes('game_type');
          if (missingGameType) {
            const fallback = await buildImportedQuery(false);
            statRows = fallback.data;
            statErr = fallback.error;
          }
        }
        if (!statErr && (!statRows || !statRows.length)) {
          const fallbackAll = await buildImportedQuery(false);
          if (!fallbackAll.error && fallbackAll.data?.length) {
            statRows = fallbackAll.data.filter((row: any) => matchesGameType(row.game_type));
          }
        }
        if (statErr) {
          const missingTable =
            statErr.code === 'PGRST205' ||
            statErr.message?.toLowerCase?.().includes('season_player_stats');
          if (missingTable) {
            if (active) {
              setImportedLeadersData([]);
              setImportedLeadersDataKey(currentKey);
            }
            return;
          }
          throw statErr;
        }
        let mapped: PlayerStats[] = [];
        if (!statRows || !statRows.length) {
          if (leadersGameType !== 'regular') {
            if (active) {
              setImportedLeadersData([]);
              setImportedLeadersDataKey(currentKey);
            }
            return;
          }
          const fetchLegacy = async (columns: string) =>
            supabase
              .from('player_season_stats')
              .select(columns)
              .eq('season_id', selectedSeasonId);
          let legacy = await fetchLegacy('player_id,team_id,division,gp,pts,reb,ast,stl,fg_pct,fgm,fga');
          if (legacy.error) {
            const message = legacy.error.message?.toLowerCase?.() || '';
            const missingColumn = legacy.error.code === '42703' || message.includes('column');
            if (missingColumn) {
              legacy = await fetchLegacy('*');
            }
          }
          if (legacy.error) {
            const missingTable =
              legacy.error.code === 'PGRST205' ||
              legacy.error.message?.toLowerCase?.().includes('player_season_stats');
            if (missingTable) {
              if (active) {
                setImportedLeadersData([]);
                setImportedLeadersDataKey(currentKey);
              }
              return;
            }
            throw legacy.error;
          }
          if (!legacy.data || !legacy.data.length) {
            if (active) {
              setImportedLeadersData([]);
              setImportedLeadersDataKey(currentKey);
            }
            return;
          }
          mapped = await mapLegacyRows(legacy.data);
        } else {
          mapped = await mapSeasonRows(statRows);
        }

          if (active) {
            setImportedLeadersData(mapped);
            setImportedLeadersDataKey(currentKey);
          }
        } catch (err: any) {
          console.error('Imported leaders load error', err);
          if (active) {
            setImportedLeadersData([]);
            setImportedLeadersDataKey(currentKey);
          }
        }
      };
      loadImportedLeaders();
      return () => {
        active = false;
      };
    }, [selectedSeasonId, leadersGameType, teams, seasonTeams]);

  const leadersBySource = useMemo(() => {
    const currentKey = selectedSeasonId ? `${selectedSeasonId}-${leadersGameType}` : '';
    const boxRaw = leadersDataKey === currentKey ? leadersData : [];
    const importedRaw = importedLeadersDataKey === currentKey ? importedLeadersData : [];
    const applyFilters = (source: any[]) => {
      const filtered = source.filter((p) => {
        if (!divisionFilter) return true;
        const t = seasonTeams.find((tm) => tm.id === p.teamId) || teams.find((tm) => tm.id === p.teamId);
        const divisionValue = (p.division || t?.division || '').toUpperCase();
        return divisionValue === divisionFilter;
      });
      return filtered.map((p) => {
        const t = seasonTeams.find((tm) => tm.id === p.teamId) || teams.find((tm) => tm.id === p.teamId);
        return { ...p, teamName: t?.name || p.teamName || '', division: p.division || t?.division };
      });
    };

    const normalizeKey = (player: PlayerStats) => {
      if (player.playerId) return `id:${player.playerId}`;
      const name = (player.playerName || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const team = (player.teamName || player.teamId || '').toLowerCase().replace(/\s+/g, ' ').trim();
      return `${name}-${team}`;
    };
    const preferBoxValue = (value?: number) => typeof value === 'number' && value > 0;
    const mergeAuto = (box: PlayerStats[], imported: PlayerStats[]) => {
      const merged = new Map<string, PlayerStats>();
      imported.forEach((p) => {
        merged.set(normalizeKey(p), { ...p });
      });
      box.forEach((p) => {
        const key = normalizeKey(p);
        const existing = merged.get(key) || { ...p };
        merged.set(key, {
          ...existing,
          playerId: existing.playerId || p.playerId,
          teamId: existing.teamId || p.teamId,
          teamName: existing.teamName || p.teamName,
          avatarUrl: existing.avatarUrl || p.avatarUrl,
          division: existing.division || p.division,
          gp: preferBoxValue(p.gp) ? p.gp : existing.gp,
          ppg: preferBoxValue(p.ppg) ? p.ppg : existing.ppg,
          rpg: preferBoxValue(p.rpg) ? p.rpg : existing.rpg,
          apg: preferBoxValue(p.apg) ? p.apg : existing.apg,
          spg: preferBoxValue(p.spg) ? p.spg : existing.spg,
          fgPct: preferBoxValue(p.fgPct) ? p.fgPct : existing.fgPct,
          bpg: preferBoxValue(p.bpg) ? p.bpg : existing.bpg,
        });
      });
      return Array.from(merged.values());
    };

    const box = applyFilters(boxRaw);
    const imported = applyFilters(importedRaw);
    return {
      box,
      imported,
      auto: mergeAuto(box, imported),
      fallback: applyFilters(leaders),
    };
  }, [
    divisionFilter,
    leadersData,
    importedLeadersData,
    leaders,
    seasonTeams,
    teams,
    selectedSeasonId,
    leadersGameType,
    leadersDataKey,
    importedLeadersDataKey,
  ]);

  const leadersPreferred = useMemo(() => {
    if (leadersBySource.auto.length) return leadersBySource.auto;
    if (leadersBySource.box.length) return leadersBySource.box;
    if (leadersBySource.imported.length) return leadersBySource.imported;
    return leadersBySource.fallback;
  }, [leadersBySource]);

  const hasLeaders = leadersPreferred.length > 0;

  // Compute standings from games
  const teamsWithRecords = useMemo(() => {
    const records: Record<string, { w: number; l: number; pf: number; pa: number }> = {};
    seasonGames.forEach((g) => {
      const status = (g.status || '').toUpperCase();
      if (status !== 'COMPLETED' && status !== 'FORFEITED') return;
      if (g.homeScore == null || g.awayScore == null) return;
      const homeScore = g.homeScore;
      const awayScore = g.awayScore;
      if (!records[g.homeTeamId]) records[g.homeTeamId] = { w: 0, l: 0, pf: 0, pa: 0 };
      if (!records[g.awayTeamId]) records[g.awayTeamId] = { w: 0, l: 0, pf: 0, pa: 0 };
      records[g.homeTeamId].pf += homeScore;
      records[g.homeTeamId].pa += awayScore;
      records[g.awayTeamId].pf += awayScore;
      records[g.awayTeamId].pa += homeScore;
      if (homeScore > awayScore) {
        records[g.homeTeamId].w += 1;
        records[g.awayTeamId].l += 1;
      } else if (awayScore > homeScore) {
        records[g.awayTeamId].w += 1;
        records[g.homeTeamId].l += 1;
      }
    });

    return seasonTeams.map((t) => {
      const rec = records[t.id] || { w: t.wins, l: t.losses, pf: t.pointsFor, pa: t.pointsAgainst };
      return {
        ...t,
        wins: rec.w,
        losses: rec.l,
        pointsFor: rec.pf,
        pointsAgainst: rec.pa,
      };
    });
  }, [seasonGames, seasonTeams]);
  const divisionTeamsWithRecords = useMemo(
    () =>
      divisionFilter
        ? teamsWithRecords.filter((t) => (t.division || '').toUpperCase() === divisionFilter)
        : teamsWithRecords,
    [divisionFilter, teamsWithRecords]
  );
  const divisionLabel = divisionFilter ? `${divisionFilter}` : 'Division';

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="font-sports text-4xl font-bold text-white uppercase mb-2">
              League Center
            </h1>
            <p className="text-brand-grey text-sm">
              Track the action across all divisions and seasons.
            </p>
          </div>

          <div className="flex items-center gap-4 flex-wrap justify-end">
            <div className="relative">
              <select 
                value={selectedSeasonId || ''}
                onChange={(e) => setSelectedSeasonId(e.target.value)}
                    className="appearance-none bg-brand-dark border border-white/20 text-white py-2 pl-4 pr-8 rounded font-sports uppercase tracking-wider focus:outline-none focus:border-brand-lime"
              >
                {sortSeasonsNewestFirst(seasons).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Filter className="absolute dropdown-icon-spacing right-3 top-1/2 transform -translate-y-1/2 text-brand-grey w-4 h-4 pointer-events-none" />
            </div>
            <div className="relative">
              <select 
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value.toUpperCase())}
                className="appearance-none bg-brand-dark border border-white/20 text-white py-2 pl-4 pr-8 rounded font-sports uppercase tracking-wider focus:outline-none focus:border-brand-lime disabled:opacity-50"
                disabled={!divisionOptions.length}
              >
                <option value="">All Divisions</option>
                {divisionOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <Filter className="absolute dropdown-icon-spacing right-3 top-1/2 transform -translate-y-1/2 text-brand-grey w-4 h-4 pointer-events-none" />
            </div>
            {activeTab === 'SCHEDULE' && (
              <div className="relative">
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="appearance-none bg-brand-dark border border-white/20 text-white py-2 pl-4 pr-8 rounded font-sports uppercase tracking-wider focus:outline-none focus:border-brand-lime disabled:opacity-50"
                  disabled={!scheduleTeamOptions.length}
                >
                  <option value="">All Teams</option>
                  {scheduleTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <Filter className="absolute dropdown-icon-spacing right-3 top-1/2 transform -translate-y-1/2 text-brand-grey w-4 h-4 pointer-events-none" />
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-8 bg-brand-dark/50 p-1 rounded-lg border border-white/5">
          {['SCHEDULE', 'SCORES', 'STANDINGS', 'TEAMS', 'LEADERS'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as Tab)}
              className={`px-6 py-3 rounded font-sports font-bold text-sm uppercase tracking-wider whitespace-nowrap transition-all ${
                activeTab === tab 
                  ? 'bg-brand-lime text-black shadow-lg transform scale-105' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="animate-fadeIn">
          {activeTab === 'SCHEDULE' && (
            <div>
              <h2 className="font-sports text-2xl text-white mb-6 flex items-center gap-2">
                <span className="w-2 h-2 bg-brand-lime rounded-full animate-pulse"></span>
                Upcoming Games
              </h2>
                {scheduledGames.length > 0 ? (
                   <GameList games={scheduledGames} teams={seasonTeams} showScores={false} centerVs boxScoreReturnLabel="Stats" />
               ) : (
                 <div className="text-center py-12 text-gray-500 bg-brand-dark rounded-lg border border-white/5 border-dashed">
                  No scheduled games found for this season ({teamFilter ? `${selectedTeamName} • ${divisionLabel}` : divisionLabel}).
                 </div>
               )}
             </div>
           )}

          {activeTab === 'SCORES' && (
             <div>
              <h2 className="font-sports text-2xl text-white mb-6">Recent Results</h2>
               {completedGames.length > 0 ? (
                 <GameList games={completedGames} teams={seasonTeams} showScores={true} centerVs boxScoreReturnLabel="Stats" />
              ) : (
                <div className="text-center py-12 text-gray-500 bg-brand-dark rounded-lg border border-white/5 border-dashed">
                  No scores available for this season ({divisionLabel}).
                </div>
              )}
            </div>
          )}

          {activeTab === 'STANDINGS' && (
            <div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-6">
                  <div>
                    <h2 className="font-sports text-2xl text-white">League Table</h2>
                    <p className="text-brand-grey text-xs uppercase">{divisionLabel}</p>
                  </div>
               </div>
               {divisionTeamsWithRecords.length ? (
                 <StandingsTable teams={divisionTeamsWithRecords} />
               ) : (
                 <div className="text-center py-12 text-gray-500 bg-brand-dark rounded-lg border border-white/5 border-dashed">
                   No standings available for this season ({divisionLabel}).
                 </div>
               )}
            </div>
          )}

          {activeTab === 'LEADERS' && (
            <div>
              <div className="flex flex-wrap items-end gap-4 mb-6">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase text-brand-grey tracking-wider">Game Type</span>
                  <div className="relative">
                    <select
                      value={leadersGameType}
                      onChange={(e) =>
                        setLeadersGameType(e.target.value as 'regular' | 'playoffs' | 'exhibition')
                      }
                      className="appearance-none bg-brand-dark border border-white/20 text-white py-2 pl-4 pr-10 dropdown-select-spacing rounded font-sports uppercase tracking-wider focus:outline-none focus:border-brand-lime"
                    >
                      <option value="regular">Regular Season</option>
                      <option value="playoffs" disabled={!supportsPlayoffFilter}>
                        Playoffs
                      </option>
                      <option value="exhibition">Exhibition</option>
                    </select>
                    <Filter className="absolute dropdown-icon-spacing right-3 top-1/2 transform -translate-y-1/2 text-brand-grey w-4 h-4 pointer-events-none" />
                  </div>
                </div>
              </div>
              {hasLeaders ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <LeadersTable stats={leadersPreferred} category="ppg" label="Points Per Game" />
                  <LeadersTable stats={leadersPreferred} category="rpg" label="Rebounds Per Game" />
                  <LeadersTable stats={leadersPreferred} category="apg" label="Assists Per Game" />
                  <LeadersTable stats={leadersPreferred} category="spg" label="Steals Per Game" />
                  <LeadersTable stats={leadersPreferred} category="bpg" label="Blocks Per Game" />
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500 bg-brand-dark rounded-lg border border-white/5 border-dashed">
                  No leader stats yet for this season ({divisionLabel}).
                </div>
              )}
            </div>
          )}

          {activeTab === 'TEAMS' && (
            <div>
              {divisionTeamsWithRecords.length ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {divisionTeamsWithRecords.map(team => (
                    <div 
                      key={team.id} 
                      onClick={() => navigate(`/team/${team.id}`)}
                      className="relative overflow-hidden bg-brand-dark border border-white/10 p-6 rounded-xl hover:border-brand-lime transition-colors cursor-pointer group"
                    >
                      {team.bannerUrl && (
                        <div
                          className="absolute inset-0 bg-cover bg-center opacity-30 group-hover:opacity-45 transition-opacity duration-300"
                          style={{ backgroundImage: `url(${team.bannerUrl})` }}
                        />
                      )}
                      {team.bannerUrl && (
                        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/70 to-black/90" />
                      )}
                      <div className="relative z-10 flex flex-col items-center">
                        <div className="w-24 h-24 rounded-full bg-gray-800 mb-4 overflow-hidden relative border-2 border-transparent group-hover:border-brand-lime transition-colors">
                          <img
                            src={
                              team.logoUrl ||
                              `https://ui-avatars.com/api/?background=111827&color=10b981&name=${encodeURIComponent(team.name)}`
                            }
                            alt={team.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <Link
                          to={`/team/${team.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-sports text-xl font-bold text-white mb-1 hover:text-brand-lime transition-colors"
                        >
                          {team.name}
                        </Link>
                        <span className="bg-white/10 text-white text-xs px-2 py-1 rounded mb-4 font-mono">{team.division}</span>
                        <div className="grid grid-cols-3 w-full border-t border-white/10 pt-4">
                          <div className="text-center">
                            <div className="text-brand-grey text-xs uppercase">Wins</div>
                            <div className="text-brand-lime font-bold text-lg">{team.wins}</div>
                          </div>
                          <div className="text-center border-l border-white/10">
                             <div className="text-brand-grey text-xs uppercase">Loss</div>
                             <div className="text-white font-bold text-lg">{team.losses}</div>
                          </div>
                          <div className="text-center border-l border-white/10">
                             <div className="text-brand-grey text-xs uppercase">Diff</div>
                             <div className="text-white font-bold text-lg">{team.pointsFor - team.pointsAgainst}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500 bg-brand-dark rounded-lg border border-white/5 border-dashed">
                  No teams found for this season ({divisionLabel}).
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScheduleStats;

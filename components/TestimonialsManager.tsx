import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Quote, Trash2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { signTeamAssetUrl } from '../services/dataCache';
import {
  buildTestimonialsDbRows,
  getDefaultHomeTestimonials,
  getTestimonialGlow,
  loadHomeTestimonials,
  normalizeHomeTestimonialsConfig,
  type HomeTestimonial,
} from '../services/homeTestimonials';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

const createNewTestimonial = (index: number): HomeTestimonial => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  quote: '',
  name: `Player ${index + 1}`,
  role: 'Player',
  team: 'Courtsight',
  division: 'Division',
  season: 'Winter 2026',
  accentColor: '#e1ff2b',
  avatarUrl: '',
});

type SeasonRow = {
  id: string;
  name: string;
  year?: number | null;
};

type DivisionRow = {
  id: string;
  name: string;
  season_id: string;
};

type TeamRow = {
  id: string;
  name: string;
  division: string;
  season_id: string;
};

type PlayerRow = {
  id: string;
  team_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  user_id?: string | null;
  email?: string | null;
  email_address?: string | null;
  position?: string | null;
  is_captain?: boolean | null;
  avatar_url?: string | null;
  photo_url?: string | null;
};

type ItemSelection = {
  seasonId: string;
  divisionId: string;
  teamId: string;
  playerId: string;
};

const EMPTY_SELECTION: ItemSelection = {
  seasonId: '',
  divisionId: '',
  teamId: '',
  playerId: '',
};

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const formatSeasonLabel = (season?: SeasonRow | null) => {
  if (!season) return 'Season';
  const name = (season.name || 'Season').trim();
  const year = season.year?.toString().trim() || '';
  return year && !name.toLowerCase().includes(year) ? `${name} ${year}` : name;
};

const toPlayerName = (player?: PlayerRow | null) => {
  if (!player) return '';
  const first = String(player.first_name || '').trim();
  const last = String(player.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ').trim();
};

const toPlayerRole = (player?: PlayerRow | null) => {
  if (!player) return 'Player';
  if (player.is_captain) return 'Team Captain';
  const pos = String(player.position || '').trim();
  if (pos) return pos.toUpperCase();
  return 'Player';
};

const toInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '--';

const normalizeEmail = (value?: string | null) => String(value || '').trim().toLowerCase();

const parseMissingColumn = (error: any, table: string): string | null => {
  const msg = String(error?.message || '');
  const lower = msg.toLowerCase();
  const a = lower.match(new RegExp(`column\\s+${table}\\.([a-z0-9_]+)\\s+does not exist`));
  if (a?.[1]) return a[1];
  const b = msg.match(new RegExp(`Could not find the '([a-z0-9_]+)' column of '${table}'`, 'i'));
  if (b?.[1]) return b[1].toLowerCase();
  return null;
};

const TestimonialsManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<HomeTestimonial[]>(getDefaultHomeTestimonials());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [profileAvatarByUserId, setProfileAvatarByUserId] = useState<Record<string, string>>({});
  const [profileAvatarByEmail, setProfileAvatarByEmail] = useState<Record<string, string>>({});
  const [itemSelections, setItemSelections] = useState<Record<string, ItemSelection>>({});
  const [signedAvatarByRawPath, setSignedAvatarByRawPath] = useState<Record<string, string>>({});

  const runWithFallback = useCallback(
    async <T,>(runner: (client: any) => Promise<T>): Promise<T> => {
      try {
        return await runner(supabase as any);
      } catch (err) {
        if (!supabaseAdmin) throw err;
        return await runner(supabaseAdmin as any);
      }
    },
    []
  );

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const loaded = await loadHomeTestimonials();
        setItems(loaded.items);
      } catch (err: any) {
        console.error('Load testimonials config error', err);
        const rawMessage = String(err?.message || '').toLowerCase();
        setError(
          rawMessage.includes('testimonials')
            ? 'Testimonials table not found yet. Run server/testimonials.sql in Supabase SQL editor.'
            : 'Unable to load testimonials. Using defaults.'
        );
        setItems(getDefaultHomeTestimonials());
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  useEffect(() => {
    const loadLookupData = async () => {
      setLookupLoading(true);
      try {
        const result = await runWithFallback(async (client) => {
          const [seasonResult, divisionResult, teamResult] = await Promise.all([
            client.from('seasons').select('id,name,year'),
            client.from('divisions').select('id,name,season_id'),
            client.from('teams').select('id,name,division,season_id'),
          ]);

          if (seasonResult.error) throw seasonResult.error;
          if (divisionResult.error) throw divisionResult.error;
          if (teamResult.error) throw teamResult.error;

          let playerColumns = [
            'id',
            'team_id',
            'first_name',
            'last_name',
            'user_id',
            'email',
            'email_address',
            'position',
            'is_captain',
            'avatar_url',
            'photo_url',
          ];
          let playerRows: PlayerRow[] = [];
          let attempts = 0;
          while (attempts < 10) {
            attempts += 1;
            const playerResult = await client.from('players').select(playerColumns.join(','));
            if (!playerResult.error) {
              playerRows = (playerResult.data || []) as PlayerRow[];
              break;
            }
            const missingColumn = parseMissingColumn(playerResult.error, 'players');
            if (missingColumn && playerColumns.includes(missingColumn)) {
              playerColumns = playerColumns.filter((col) => col !== missingColumn);
              continue;
            }
            throw playerResult.error;
          }

          return {
            seasons: (seasonResult.data || []) as SeasonRow[],
            divisions: (divisionResult.data || []) as DivisionRow[],
            teams: (teamResult.data || []) as TeamRow[],
            players: playerRows,
          };
        });

        const sortedSeasons = sortSeasonsNewestFirst(result.seasons);
        setSeasons(sortedSeasons);
        setDivisions(result.divisions);
        setTeams(result.teams);
        setPlayers(
          result.players
            .filter((row) => !!row.id)
            .sort((a, b) => toPlayerName(a).localeCompare(toPlayerName(b)))
        );

        const userIds = Array.from(
          new Set(
            result.players
              .map((row) => String(row.user_id || '').trim())
              .filter((value) => !!value)
          )
        );
        const playerEmails = Array.from(
          new Set(
            result.players
              .map((row) => normalizeEmail((row as any)?.email || (row as any)?.email_address))
              .filter(Boolean)
          )
        );
        if (userIds.length > 0 || playerEmails.length > 0) {
          try {
            const loadProfiles = async (client: any, ids: string[], emails: string[]) => {
              const select = 'user_id,avatar_url,email,email_address';
              const byIdsPromise = ids.length
                ? client.from('profiles').select(select).in('user_id', ids)
                : Promise.resolve({ data: [], error: null });
              const byEmailsPromise = emails.length
                ? client.from('profiles').select(select).in('email_address', emails)
                : Promise.resolve({ data: [], error: null });
              const [byIds, byEmails] = await Promise.all([byIdsPromise, byEmailsPromise]);
              if (byIds.error) throw byIds.error;
              if (byEmails.error) throw byEmails.error;
              return [...(byIds.data || []), ...(byEmails.data || [])] as any[];
            };

            let profileRows = await loadProfiles(supabase as any, userIds, playerEmails);

            if (supabaseAdmin) {
              const foundUserIds = new Set(
                profileRows.map((row: any) => String(row?.user_id || '').trim()).filter(Boolean)
              );
              const missingUserIds = userIds.filter((id) => !foundUserIds.has(id));

              const foundEmails = new Set(
                profileRows
                  .map((row: any) => normalizeEmail(row?.email_address || row?.email))
                  .filter(Boolean)
              );
              const missingEmails = playerEmails.filter((email) => !foundEmails.has(email));

              if (missingUserIds.length || missingEmails.length) {
                const adminRows = await loadProfiles(supabaseAdmin as any, missingUserIds, missingEmails);
                profileRows = [...profileRows, ...adminRows];
              }
            }

            const userIdMap: Record<string, string> = {};
            const emailMap: Record<string, string> = {};
            profileRows.forEach((row: any) => {
              const userId = String(row?.user_id || '').trim();
              const avatarUrl = String(row?.avatar_url || '').trim();
              const email = normalizeEmail(row?.email_address || row?.email);
              if (userId && avatarUrl) userIdMap[userId] = avatarUrl;
              if (email && avatarUrl) emailMap[email] = avatarUrl;
            });
            setProfileAvatarByUserId(userIdMap);
            setProfileAvatarByEmail(emailMap);
          } catch (profileErr) {
            console.warn('Load testimonial profile avatars failed', profileErr);
            setProfileAvatarByUserId({});
            setProfileAvatarByEmail({});
          }
        } else {
          setProfileAvatarByUserId({});
          setProfileAvatarByEmail({});
        }
      } catch (err) {
        console.error('Load testimonial lookup data error', err);
        setError((prev) => prev || 'Unable to load season/division/player options.');
      } finally {
        setLookupLoading(false);
      }
    };

    loadLookupData();
  }, [runWithFallback]);

  const seasonsById = useMemo(
    () =>
      Object.fromEntries(
        sortSeasonsNewestFirst(seasons).map((season) => [season.id, formatSeasonLabel(season)])
      ) as Record<string, string>,
    [seasons]
  );

  const teamById = useMemo(
    () => Object.fromEntries(teams.map((team) => [team.id, team])) as Record<string, TeamRow>,
    [teams]
  );

  const playerById = useMemo(
    () => Object.fromEntries(players.map((player) => [player.id, player])) as Record<string, PlayerRow>,
    [players]
  );

  const divisionOptionsBySeason = useMemo(() => {
    const seasonMap = new Map<string, DivisionRow[]>();
    divisions.forEach((division) => {
      const list = seasonMap.get(division.season_id) || [];
      list.push(division);
      seasonMap.set(division.season_id, list);
    });

    teams.forEach((team) => {
      const seasonId = String(team.season_id || '').trim();
      const divisionName = String(team.division || '').trim();
      if (!seasonId || !divisionName) return;
      const current = seasonMap.get(seasonId) || [];
      const exists = current.some(
        (division) => normalizeKey(division.name) === normalizeKey(divisionName)
      );
      if (!exists) {
        current.push({
          id: `derived-${seasonId}-${normalizeKey(divisionName).replace(/[^a-z0-9]+/g, '-')}`,
          name: divisionName,
          season_id: seasonId,
        });
      }
      seasonMap.set(seasonId, current);
    });

    const output: Record<string, DivisionRow[]> = {};
    seasonMap.forEach((list, seasonId) => {
      output[seasonId] = [...list].sort((a, b) => a.name.localeCompare(b.name));
    });
    return output;
  }, [divisions, teams]);

  const resolvePlayerAvatar = useCallback(
    (player?: PlayerRow | null) => {
      if (!player) return '';
      const direct = String(player.avatar_url || player.photo_url || '').trim();
      if (direct) return direct;
      const byProfile = player.user_id ? profileAvatarByUserId[String(player.user_id)] : '';
      if (byProfile) return String(byProfile).trim();
      const email = normalizeEmail((player as any)?.email || (player as any)?.email_address);
      const byEmail = email ? profileAvatarByEmail[email] : '';
      return String(byEmail || '').trim();
    },
    [profileAvatarByEmail, profileAvatarByUserId]
  );

  const getPlayersForSelection = useCallback(
    (seasonId: string, divisionId: string, teamId: string) => {
      if (!seasonId || !divisionId) return [] as PlayerRow[];
      const division = (divisionOptionsBySeason[seasonId] || []).find((row) => row.id === divisionId);
      if (!division) return [] as PlayerRow[];
      const divisionKey = normalizeKey(division.name);
      const teamsForDivision = teams.filter(
        (team) =>
          String(team.season_id || '') === seasonId &&
          normalizeKey(String(team.division || '')) === divisionKey
      );
      const teamIds = new Set(teamsForDivision.map((team) => team.id));
      if (teamId && teamIds.has(teamId)) {
        teamIds.clear();
        teamIds.add(teamId);
      }
      if (!teamIds.size) return [] as PlayerRow[];
      return players.filter((player) => player.team_id && teamIds.has(String(player.team_id)));
    },
    [divisionOptionsBySeason, players, teams]
  );

  const getTeamsForSelection = useCallback(
    (seasonId: string, divisionId: string) => {
      if (!seasonId || !divisionId) return [] as TeamRow[];
      const division = (divisionOptionsBySeason[seasonId] || []).find((row) => row.id === divisionId);
      if (!division) return [] as TeamRow[];
      const divisionKey = normalizeKey(division.name);
      return teams
        .filter(
          (team) =>
            String(team.season_id || '') === seasonId &&
            normalizeKey(String(team.division || '')) === divisionKey
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [divisionOptionsBySeason, teams]
  );

  useEffect(() => {
    if (lookupLoading) return;
    setItemSelections((prev) => {
      const next: Record<string, ItemSelection> = {};
      const seasonEntries = Object.entries(seasonsById);

      items.forEach((item) => {
        const existing = prev[item.id];
        if (existing) {
          next[item.id] = { ...EMPTY_SELECTION, ...existing };
          return;
        }

        const seasonMatch = seasonEntries.find(
          ([, label]) =>
            normalizeKey(label) === normalizeKey(item.season) ||
            normalizeKey(label).includes(normalizeKey(item.season))
        );
        const seasonId = seasonMatch?.[0] || '';
        const divisionsForSeason = seasonId ? divisionOptionsBySeason[seasonId] || [] : [];
        const divisionId =
          divisionsForSeason.find((division) => normalizeKey(division.name) === normalizeKey(item.division))
            ?.id || '';
        const teamsForDivision = getTeamsForSelection(seasonId, divisionId);
        const teamId =
          teamsForDivision.find((team) => normalizeKey(team.name) === normalizeKey(item.team))?.id || '';
        const playerId =
          getPlayersForSelection(seasonId, divisionId, teamId).find(
            (player) => normalizeKey(toPlayerName(player)) === normalizeKey(item.name)
          )?.id || '';
        const resolvedTeamId = teamId || (playerId ? String(playerById[playerId]?.team_id || '') : '');
        next[item.id] = { seasonId, divisionId, teamId: resolvedTeamId, playerId };
      });

      const changed =
        Object.keys(next).length !== Object.keys(prev).length ||
        Object.entries(next).some(
          ([id, selection]) =>
            prev[id]?.seasonId !== selection.seasonId ||
            prev[id]?.divisionId !== selection.divisionId ||
            prev[id]?.teamId !== selection.teamId ||
            prev[id]?.playerId !== selection.playerId
        );

      return changed ? next : prev;
    });
  }, [
    divisionOptionsBySeason,
    getTeamsForSelection,
    getPlayersForSelection,
    items,
    lookupLoading,
    playerById,
    seasonsById,
  ]);

  useEffect(() => {
    const uniqueRawPaths = Array.from(
      new Set(
        items
          .map((item) => String(item.avatarUrl || '').trim())
          .filter(Boolean)
      )
    );
    if (!uniqueRawPaths.length) {
      setSignedAvatarByRawPath({});
      return;
    }
    let active = true;
    (async () => {
      const entries = await Promise.all(
        uniqueRawPaths.map(async (raw) => {
          const signed = await signTeamAssetUrl(raw);
          return [raw, signed || raw] as const;
        })
      );
      if (!active) return;
      setSignedAvatarByRawPath(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
  }, [items]);

  const updateItem = (id: string, updates: Partial<HomeTestimonial>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const addItem = () => {
    const nextIndex = items.length;
    const nextItem = createNewTestimonial(nextIndex);
    const defaultSeasonId = seasons[0]?.id || '';
    const defaultDivisionId = defaultSeasonId
      ? (divisionOptionsBySeason[defaultSeasonId] || [])[0]?.id || ''
      : '';
    const seededItem: HomeTestimonial = {
      ...nextItem,
      season: seasonsById[defaultSeasonId] || nextItem.season,
      division:
        (divisionOptionsBySeason[defaultSeasonId] || []).find((row) => row.id === defaultDivisionId)?.name ||
        nextItem.division,
    };
    setItemSelections((prev) => ({
      ...prev,
      [seededItem.id]: {
        seasonId: defaultSeasonId,
        divisionId: defaultDivisionId,
        teamId: '',
        playerId: '',
      },
    }));
    setItems((prev) => [seededItem, ...prev]);
    setMessage('New testimonial added at the top. Click Save Testimonials to publish.');
    setError(null);
  };

  const confirmDelete = () => {
    if (!pendingDeleteId) return;
    setItems((prev) => prev.filter((item) => item.id !== pendingDeleteId));
    setItemSelections((prev) => {
      const next = { ...prev };
      delete next[pendingDeleteId];
      return next;
    });
    setPendingDeleteId(null);
    setMessage('Testimonial removed. Click Save Testimonials to publish.');
    setError(null);
  };

  const resetDefaults = () => {
    setItems(getDefaultHomeTestimonials());
    setMessage('Reset to default testimonials (not saved yet).');
    setError(null);
  };

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
      const normalized = normalizeHomeTestimonialsConfig({ items });
      const rows = buildTestimonialsDbRows(normalized.items);
      try {
      const saveWithClient = async (client: typeof supabase) => {
        const desiredIds = rows.map((row) => row.id);
        const upsertResult = await client
          .from('testimonials')
          .upsert(rows, { onConflict: 'id' });
        if (upsertResult.error) throw upsertResult.error;

        const existingResult = await client.from('testimonials').select('id');
        if (existingResult.error) throw existingResult.error;
        const existingIds = (existingResult.data || [])
          .map((row: any) => row?.id)
          .filter((id: string | null | undefined): id is string => Boolean(id));
        const toDelete = existingIds.filter((id) => !desiredIds.includes(id));
        if (toDelete.length > 0) {
          const deleteResult = await client.from('testimonials').delete().in('id', toDelete);
          if (deleteResult.error) throw deleteResult.error;
        }

        return { error: null as any };
      };

      let saveErr: any = null;
      try {
        const result = await saveWithClient(supabase);
        saveErr = result.error;
      } catch (err) {
        saveErr = err;
      }

      if (saveErr && supabaseAdmin) {
        const result = await saveWithClient(supabaseAdmin);
        saveErr = result.error;
      }

      if (saveErr) throw saveErr;
      setItems(normalized.items);
      setMessage('Testimonials saved and published.');
    } catch (err: any) {
      console.error('Save testimonials config error', err);
      const rawMessage = String(err?.message || '').toLowerCase();
      setError(
        rawMessage.includes('testimonials')
          ? 'Testimonials table not found yet. Run server/testimonials.sql in Supabase SQL editor.'
          : err?.message || 'Failed to save testimonials.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading testimonials settings...</div>;
  }
  if (lookupLoading) {
    return <div className="text-gray-400 text-sm">Loading season, division, and player options...</div>;
  }

  const handleSeasonChange = (itemId: string, seasonId: string) => {
    const seasonLabel = seasonsById[seasonId] || 'Season';
    const defaultDivision = (divisionOptionsBySeason[seasonId] || [])[0];
    setItemSelections((prev) => ({
      ...prev,
      [itemId]: {
        seasonId,
        divisionId: defaultDivision?.id || '',
        teamId: '',
        playerId: '',
      },
    }));
    updateItem(itemId, {
      season: seasonLabel,
      division: defaultDivision?.name || '',
      team: '',
      name: '',
      role: 'Player',
      avatarUrl: '',
    });
  };

  const handleDivisionChange = (itemId: string, divisionId: string) => {
    const selection = itemSelections[itemId] || EMPTY_SELECTION;
    const divisionName =
      (divisionOptionsBySeason[selection.seasonId] || []).find((row) => row.id === divisionId)?.name || '';
    setItemSelections((prev) => ({
      ...prev,
      [itemId]: {
        seasonId: selection.seasonId,
        divisionId,
        teamId: '',
        playerId: '',
      },
    }));
    updateItem(itemId, {
      division: divisionName,
      team: '',
      name: '',
      role: 'Player',
      avatarUrl: '',
    });
  };

  const handleTeamChange = (itemId: string, teamId: string) => {
    const selection = itemSelections[itemId] || EMPTY_SELECTION;
    const team = teamId ? teamById[teamId] : null;
    setItemSelections((prev) => ({
      ...prev,
      [itemId]: {
        seasonId: selection.seasonId,
        divisionId: selection.divisionId,
        teamId,
        playerId: '',
      },
    }));
    updateItem(itemId, {
      team: team?.name || '',
      name: '',
      role: 'Player',
      avatarUrl: '',
    });
  };

  const handlePlayerChange = (itemId: string, playerId: string) => {
    const selection = itemSelections[itemId] || EMPTY_SELECTION;
    const seasonLabel = seasonsById[selection.seasonId] || 'Season';
    const divisionLabel =
      (divisionOptionsBySeason[selection.seasonId] || []).find((row) => row.id === selection.divisionId)?.name ||
      '';

    if (!playerId) {
      setItemSelections((prev) => ({
        ...prev,
        [itemId]: { ...selection, playerId: '' },
      }));
      updateItem(itemId, {
        season: seasonLabel,
        division: divisionLabel,
        team: selection.teamId ? teamById[selection.teamId]?.name || '' : '',
        name: '',
        role: 'Player',
        avatarUrl: '',
      });
      return;
    }

    const player = playerById[playerId];
    if (!player) return;
    const team = player.team_id ? teamById[String(player.team_id)] : null;
    const avatar = resolvePlayerAvatar(player);
    setItemSelections((prev) => ({
      ...prev,
      [itemId]: { ...selection, teamId: team?.id || selection.teamId, playerId },
    }));
    updateItem(itemId, {
      season: seasonLabel,
      division: divisionLabel || (team?.division || ''),
      team: team?.name || '',
      name: toPlayerName(player),
      role: toPlayerRole(player),
      avatarUrl: avatar,
    });
  };

  return (
    <>
      <div className="animate-fadeIn space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="font-sports text-2xl text-white uppercase">Testimonials</h2>
            <p className="text-xs text-gray-400 mt-1">
              Pick a season, division, team, and player. Player photo is automatic from profile/player data.
            </p>
            {error && <div className="text-xs text-brand-red font-mono mt-2">{error}</div>}
            {message && <div className="text-xs text-brand-lime font-mono mt-2">{message}</div>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetDefaults}
              className="text-xs uppercase tracking-wider text-gray-300 border border-white/10 px-3 py-2 rounded hover:border-white/30"
            >
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="bg-brand-lime text-black px-4 py-2 rounded font-bold uppercase text-xs disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Testimonials'}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500 uppercase tracking-[0.2em]">
            {items.length} Testimonials
          </div>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-gray-200 hover:border-brand-lime/60"
          >
            <Plus size={14} />
            Add Testimonial
          </button>
        </div>

        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={item.id} className="bg-brand-dark border border-white/10 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.25em] text-gray-500">
                  Testimonial {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(item.id)}
                  className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-brand-red hover:border-brand-red/60"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>

              <label className="text-[10px] text-brand-grey uppercase block">
                Quote
                <textarea
                  value={item.quote}
                  onChange={(e) => updateItem(item.id, { quote: e.target.value })}
                  rows={3}
                  className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-[10px] text-brand-grey uppercase block">
                  Season
                  <div className="relative mt-2">
                    <select
                      value={(itemSelections[item.id] || EMPTY_SELECTION).seasonId}
                      onChange={(e) => handleSeasonChange(item.id, e.target.value)}
                      className="w-full appearance-none bg-black border border-white/20 rounded pl-3 pr-10 dropdown-select-spacing py-2.5 text-white text-sm focus:border-brand-lime outline-none"
                    >
                      <option value="">Select season</option>
                      {sortSeasonsNewestFirst(seasons).map((season) => (
                        <option key={season.id} value={season.id}>
                          {formatSeasonLabel(season)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </label>
                <label className="text-[10px] text-brand-grey uppercase block">
                  Division
                  <div className="relative mt-2">
                    <select
                      value={(itemSelections[item.id] || EMPTY_SELECTION).divisionId}
                      onChange={(e) => handleDivisionChange(item.id, e.target.value)}
                      disabled={!(itemSelections[item.id] || EMPTY_SELECTION).seasonId}
                      className="w-full appearance-none bg-black border border-white/20 rounded pl-3 pr-10 dropdown-select-spacing py-2.5 text-white text-sm focus:border-brand-lime outline-none"
                    >
                      <option value="">Select division</option>
                      {((itemSelections[item.id] || EMPTY_SELECTION).seasonId
                        ? divisionOptionsBySeason[(itemSelections[item.id] || EMPTY_SELECTION).seasonId] || []
                        : []
                      ).map((division) => (
                        <option key={division.id} value={division.id}>
                          {division.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </label>
                <label className="text-[10px] text-brand-grey uppercase block">
                  Team
                  <div className="relative mt-2">
                    <select
                      value={(itemSelections[item.id] || EMPTY_SELECTION).teamId}
                      onChange={(e) => handleTeamChange(item.id, e.target.value)}
                      disabled={
                        !(itemSelections[item.id] || EMPTY_SELECTION).seasonId ||
                        !(itemSelections[item.id] || EMPTY_SELECTION).divisionId
                      }
                      className="w-full appearance-none bg-black border border-white/20 rounded pl-3 pr-10 dropdown-select-spacing py-2.5 text-white text-sm focus:border-brand-lime outline-none"
                    >
                      <option value="">Select team</option>
                      {getTeamsForSelection(
                        (itemSelections[item.id] || EMPTY_SELECTION).seasonId,
                        (itemSelections[item.id] || EMPTY_SELECTION).divisionId
                      ).map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </label>
                <label className="text-[10px] text-brand-grey uppercase block">
                  Player
                  <div className="relative mt-2">
                    <select
                      value={(itemSelections[item.id] || EMPTY_SELECTION).playerId}
                      onChange={(e) => handlePlayerChange(item.id, e.target.value)}
                      disabled={
                        !(itemSelections[item.id] || EMPTY_SELECTION).seasonId ||
                        !(itemSelections[item.id] || EMPTY_SELECTION).divisionId ||
                        !(itemSelections[item.id] || EMPTY_SELECTION).teamId
                      }
                      className="w-full appearance-none bg-black border border-white/20 rounded pl-3 pr-10 dropdown-select-spacing py-2.5 text-white text-sm focus:border-brand-lime outline-none"
                    >
                      <option value="">Select player</option>
                      {getPlayersForSelection(
                        (itemSelections[item.id] || EMPTY_SELECTION).seasonId,
                        (itemSelections[item.id] || EMPTY_SELECTION).divisionId,
                        (itemSelections[item.id] || EMPTY_SELECTION).teamId
                      ).map((player) => (
                        <option key={player.id} value={player.id}>
                          {toPlayerName(player)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </label>
                <label className="text-[10px] text-brand-grey uppercase block">
                  Role
                  <input
                    type="text"
                    value={item.role}
                    onChange={(e) => updateItem(item.id, { role: e.target.value })}
                    className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                  />
                </label>
                <label className="text-[10px] text-brand-grey uppercase block">
                  Accent Color
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="color"
                      value={item.accentColor}
                      onChange={(e) => updateItem(item.id, { accentColor: e.target.value })}
                      className="h-10 w-12 p-1 bg-black border border-white/20 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={item.accentColor}
                      onChange={(e) => updateItem(item.id, { accentColor: e.target.value })}
                      className="flex-1 bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                    />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase text-gray-500">Name</div>
                  <div className="text-sm text-white mt-1">{item.name || '-'}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase text-gray-500">Team</div>
                  <div className="text-sm text-white mt-1">{item.team || '-'}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase text-gray-500">Division</div>
                  <div className="text-sm text-white mt-1">{item.division || '-'}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase text-gray-500">Season</div>
                  <div className="text-sm text-white mt-1">{item.season || '-'}</div>
                </div>
              </div>

              {(itemSelections[item.id] || EMPTY_SELECTION).seasonId &&
                (itemSelections[item.id] || EMPTY_SELECTION).divisionId &&
                getTeamsForSelection(
                  (itemSelections[item.id] || EMPTY_SELECTION).seasonId,
                  (itemSelections[item.id] || EMPTY_SELECTION).divisionId
                ).length === 0 && (
                  <div className="text-xs text-brand-grey">
                    No teams found for the selected season and division.
                  </div>
                )}

              {(itemSelections[item.id] || EMPTY_SELECTION).seasonId &&
                (itemSelections[item.id] || EMPTY_SELECTION).divisionId &&
                (itemSelections[item.id] || EMPTY_SELECTION).teamId &&
                getPlayersForSelection(
                  (itemSelections[item.id] || EMPTY_SELECTION).seasonId,
                  (itemSelections[item.id] || EMPTY_SELECTION).divisionId,
                  (itemSelections[item.id] || EMPTY_SELECTION).teamId
                ).length === 0 && (
                  <div className="text-xs text-brand-grey">
                    No players found for the selected season, division, and team.
                  </div>
                )}

              <div className="rounded-xl border border-white/10 p-4 bg-black/30 relative overflow-hidden">
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundImage: getTestimonialGlow(item.accentColor) }}
                />
                <div className="relative">
                  <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-brand-lime border border-brand-lime/30 bg-brand-lime/10 px-2 py-1 rounded-full mb-2">
                    <Quote size={12} />
                    Preview
                  </div>
                  <div className="mb-2 h-10 w-10 rounded-full border border-brand-lime/40 bg-black/60 text-brand-lime text-xs font-bold grid place-items-center overflow-hidden relative">
                    <span>{toInitials(item.name)}</span>
                    {item.avatarUrl ? (
                      <img
                        src={signedAvatarByRawPath[String(item.avatarUrl || '').trim()] || item.avatarUrl}
                        alt={item.name || 'Player'}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-200 line-clamp-2">{item.quote || 'Quote preview'}</p>
                  <div className="mt-2 text-xs text-gray-400">
                    {item.name || 'Player Name'} - {item.role || 'Role'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {pendingDeleteId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <button
            type="button"
            onClick={() => setPendingDeleteId(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-[1px]"
            aria-label="Close delete confirmation"
          />
          <div className="relative w-full max-w-md rounded-xl border border-white/15 bg-brand-dark p-5 shadow-2xl">
            <h3 className="font-sports text-xl text-white uppercase">Delete Testimonial?</h3>
            <p className="mt-2 text-sm text-gray-300">
              This will remove the testimonial from homepage marquee.
            </p>
            <p className="mt-1 text-xs text-gray-500">You still need to click Save Testimonials to publish this change.</p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                className="px-3 py-2 rounded border border-white/20 text-xs font-bold uppercase text-gray-200 hover:border-white/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-3 py-2 rounded border border-brand-red/60 bg-brand-red/15 text-xs font-bold uppercase text-brand-red hover:bg-brand-red/20"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TestimonialsManager;

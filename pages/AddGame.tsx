import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, ChevronDown, MapPin, Save, Users } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { getCurrentUser } from '../services/authService';
import { Role, Team } from '../types';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type SeasonOption = { id: string; name: string; isCurrent: boolean };

const AddGame: React.FC = () => {
  const navigate = useNavigate();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [existingGames, setExistingGames] = useState<
    { game_datetime: string; home_team_id: string; away_team_id: string; location: string | null }[]
  >([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingSeasons, setLoadingSeasons] = useState(true);
  const [gameFieldMap, setGameFieldMap] = useState<{ dateTimeKey: string; statusKey: string }>({
    dateTimeKey: 'game_datetime',
    statusKey: 'status',
  });
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [form, setForm] = useState({
    seasonId: '',
    date: '',
    time: '',
    location: 'Central Gym',
    homeTeamId: '',
    awayTeamId: '',
  });

  const teamsForSeason = useMemo(() => {
    if (!form.seasonId) return teams;
    return teams.filter((t) => t.seasonId === form.seasonId);
  }, [teams, form.seasonId]);

  const divisionOptions = useMemo(() => {
    const unique = new Set<string>();
    teamsForSeason.forEach((t) => {
      if (t.division) unique.add(t.division);
    });
    return Array.from(unique);
  }, [teamsForSeason]);

  const filteredTeams = useMemo(() => {
    if (!selectedDivision) return teamsForSeason;
    return teamsForSeason.filter((t) => t.division === selectedDivision);
  }, [teamsForSeason, selectedDivision]);

  const homeTeamOptions = useMemo(
    () => filteredTeams.filter((team) => team.id !== form.awayTeamId),
    [filteredTeams, form.awayTeamId]
  );

  const awayTeamOptions = useMemo(
    () => filteredTeams.filter((team) => team.id !== form.homeTeamId),
    [filteredTeams, form.homeTeamId]
  );

  useEffect(() => {
    if (!divisionOptions.length) {
      if (selectedDivision) setSelectedDivision('');
      return;
    }
    if (!selectedDivision || !divisionOptions.includes(selectedDivision)) {
      setSelectedDivision(divisionOptions[0]);
    }
  }, [divisionOptions, selectedDivision]);

  useEffect(() => {
    if (!filteredTeams.length) {
      setForm((prev) => {
        if (!prev.homeTeamId && !prev.awayTeamId) return prev;
        return { ...prev, homeTeamId: '', awayTeamId: '' };
      });
      return;
    }
    setForm((prev) => {
      const ids = filteredTeams.map((t) => t.id);
      let home = prev.homeTeamId;
      let away = prev.awayTeamId;
      if (!ids.includes(home)) home = filteredTeams[0].id;
      if (!ids.includes(away) || away === home) {
        const nextAway = filteredTeams.find((t) => t.id !== home);
        away = nextAway ? nextAway.id : '';
      }
      if (home === prev.homeTeamId && away === prev.awayTeamId) return prev;
      return { ...prev, homeTeamId: home, awayTeamId: away };
    });
  }, [filteredTeams]);

  useEffect(() => {
    const user = getCurrentUser();
    const canManage =
      user && (user.role === Role.ADMIN_FULL || user.role === Role.ADMIN_COMMISSIONER);

    if (!canManage) {
      navigate('/login');
    } else {
      setIsAuthorized(true);
    }
  }, [navigate]);

  useEffect(() => {
    const loadSeasons = async () => {
      try {
        setLoadingSeasons(true);
        const { data, error: seasonErr } = await supabase
          .from('seasons')
          .select('id,name,is_current,start_date')
          .order('start_date', { ascending: false });
        if (seasonErr) throw seasonErr;
        const mapped =
          data?.map((s: any) => ({
            id: s.id,
            name: s.name,
            isCurrent: !!s.is_current,
          })) || [];
        setSeasons(mapped);
        const active = mapped.find((s) => s.isCurrent) || mapped[0];
        if (active) {
          setForm((prev) => ({ ...prev, seasonId: active.id }));
        }
      } catch (err) {
        console.error('Load seasons error', err);
        setError('Unable to load seasons.');
      } finally {
        setLoadingSeasons(false);
      }
    };

    const loadTeams = async () => {
      try {
        setLoadingTeams(true);
        const { data, error: teamErr } = await supabase
          .from('teams')
          .select('id,name,division,logo_url,season_id');
        if (teamErr) throw teamErr;
        const mapped =
          data?.map((t: any) => ({
            id: t.id,
            name: t.name,
            logoUrl: t.logo_url || '',
            bannerUrl: '',
            division: t.division || 'D1',
            seasonId: t.season_id,
            wins: 0,
            losses: 0,
            ties: 0,
            pointsFor: 0,
            pointsAgainst: 0,
          })) || [];
        setTeams(mapped);
      } catch (err) {
        console.error('Load teams error', err);
        setError('Unable to load teams.');
      } finally {
        setLoadingTeams(false);
      }
    };

    loadSeasons();
    loadTeams();
    supabase
      .from('games')
      .select('game_datetime,home_team_id,away_team_id,location')
      .then(({ data, error }) => {
        if (error) {
          console.error('Load existing games error', error);
          return;
        }
        setExistingGames(
          (data || []).map((g: any) => ({
            game_datetime: g.game_datetime,
            home_team_id: g.home_team_id,
            away_team_id: g.away_team_id,
            location: g.location,
          }))
        );
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.seasonId) {
      setError('Season is required.');
      return;
    }
    if (!form.date || !form.time) {
      setError('Date and time are required.');
      return;
    }
    if (!form.homeTeamId || !form.awayTeamId) {
      setError('Select both teams.');
      return;
    }
    if (form.homeTeamId === form.awayTeamId) {
      setError('Home and away teams must be different.');
      return;
    }

    const normalizedLocation = (form.location || '').trim().toLowerCase();
    const newDate = form.date;
    const newTime = form.time;
    const hasDuplicate = existingGames.some((g) => {
      if (!g.game_datetime) return false;
      const dt = new Date(g.game_datetime);
      const existingDate = dt.toISOString().slice(0, 10);
      const existingTime = dt.toISOString().slice(11, 16);
      const existingLoc = (g.location || '').trim().toLowerCase();
      return (
        existingDate === newDate &&
        existingTime === newTime &&
        existingLoc === normalizedLocation &&
        g.home_team_id === form.homeTeamId &&
        g.away_team_id === form.awayTeamId
      );
    });
    if (hasDuplicate) {
      setError('A game with the same teams, date, time, and location already exists.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: Record<string, any> = {
        season_id: form.seasonId,
        location: form.location || 'TBD',
        home_team_id: form.homeTeamId,
        away_team_id: form.awayTeamId,
        home_score: 0,
        away_score: 0,
      };

      const ts = form.time ? `${form.date}T${form.time}` : form.date;
      payload[gameFieldMap.dateTimeKey] = ts;
      if (gameFieldMap.statusKey) payload[gameFieldMap.statusKey] = 'scheduled';

      const { error: insertErr } = await supabase.from('games').insert(payload);
      if (insertErr) throw insertErr;

      setSuccess('Game scheduled! Redirecting to schedule...');
      setTimeout(() => navigate('/admin?tab=schedule'), 600);
    } catch (err: any) {
      console.error('Add game error', err);
      setError(err?.message || 'Failed to schedule game.');
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthorized) return null;

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate('/admin?tab=schedule')}
          className="text-gray-400 hover:text-white flex items-center gap-2 mb-6"
        >
          <ArrowLeft size={18} /> Back to Schedule
        </button>

        <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="font-sports text-3xl text-white uppercase">Add Game</h1>
              <p className="text-gray-400 text-sm mt-1">
                Set the matchup, date, time, and location.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Season
                </label>
                <div className="relative">
                  <select
                    value={form.seasonId}
                    onChange={(e) => setForm({ ...form, seasonId: e.target.value })}
                    className="w-full appearance-none bg-black border border-white/20 rounded p-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                    disabled={loadingSeasons}
                  >
                    <option value="" disabled>
                      {loadingSeasons ? 'Loading seasons...' : 'Select season'}
                    </option>
                    {sortSeasonsNewestFirst(seasons).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.isCurrent ? '(Current)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Division
                </label>
                <div className="relative">
                  <select
                    value={selectedDivision}
                    onChange={(e) => setSelectedDivision(e.target.value)}
                    className="w-full appearance-none bg-black border border-white/20 rounded p-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                    disabled={loadingTeams || !form.seasonId}
                  >
                    {!divisionOptions.length && (
                      <option value="">No divisions available</option>
                    )}
                    {divisionOptions.map((division) => (
                      <option key={division} value={division}>
                        {division}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Location
                </label>
                <div className="relative">
                  <MapPin
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-lime"
                  />
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full bg-black border border-white/20 rounded p-3 pl-10 text-white focus:border-brand-lime focus:outline-none"
                    placeholder="Court name"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Date
                </label>
                <div className="relative">
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    onFocus={() => dateInputRef.current?.showPicker?.()}
                    onClick={() => dateInputRef.current?.showPicker?.()}
                    className="w-full bg-black border border-white/20 rounded p-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (dateInputRef.current) {
                        dateInputRef.current.showPicker?.();
                        dateInputRef.current.focus();
                      }
                    }}
                    className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    aria-label="Open calendar"
                  >
                    <Calendar size={16} />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Time
                </label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none"
                />
              </div>
            </div>

            <div className="bg-black/30 border border-white/10 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] gap-4 items-center">
                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Home Team
                  </label>
                  <div className="relative">
                    <select
                      value={form.homeTeamId}
                      onChange={(e) => setForm({ ...form, homeTeamId: e.target.value })}
                      className="w-full appearance-none bg-black border border-white/20 rounded p-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                      disabled={loadingTeams}
                    >
                      <option value="" disabled>
                        {loadingTeams ? 'Loading teams...' : 'Select team'}
                      </option>
                      {!homeTeamOptions.length && (
                        <option value="" disabled>
                          No available teams
                        </option>
                      )}
                      {homeTeamOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.division})
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </div>

                <div className="text-center text-brand-grey font-sports text-lg md:text-xl">
                  VS
                </div>

                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Away Team
                  </label>
                  <div className="relative">
                    <select
                      value={form.awayTeamId}
                      onChange={(e) => setForm({ ...form, awayTeamId: e.target.value })}
                      className="w-full appearance-none bg-black border border-white/20 rounded p-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                      disabled={loadingTeams}
                    >
                      <option value="" disabled>
                        {loadingTeams ? 'Loading teams...' : 'Select team'}
                      </option>
                      {!awayTeamOptions.length && (
                        <option value="" disabled>
                          No available teams
                        </option>
                      )}
                      {awayTeamOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.division})
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && <div className="text-xs text-brand-red font-mono">{error}</div>}
            {success && <div className="text-xs text-brand-lime font-mono">{success}</div>}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => navigate('/admin?tab=schedule')}
                className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 bg-brand-lime text-black px-5 py-2 rounded font-bold uppercase text-sm hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={saving}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Create Game'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddGame;

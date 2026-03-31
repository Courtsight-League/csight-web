import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import {
  REGISTRATION_CAPACITY_SITE_KEY,
  getDefaultRegistrationCapacitySettings,
  normalizeRegistrationCapacitySettings,
  parseRegistrationCapacityValue,
  serializeRegistrationCapacitySettings,
  type RegistrationCapacitySettings,
} from '../services/registrationCapacity';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type SeasonRow = {
  id: string;
  name?: string | null;
  year?: string | number | null;
  start_date?: string | null;
  is_current?: boolean | null;
};

type DivisionRow = {
  id: string;
  name: string;
  season_id: string;
};

const formatSeasonLabel = (season: SeasonRow) => {
  const name = (season.name || 'Season').toString().trim();
  const year = (season.year || '').toString().trim();
  if (year && !name.includes(year)) return `${name} ${year}`.trim();
  return name || 'Season';
};

const parseLimitInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return null;
  return normalized;
};

const RegistrationCapacityManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [settings, setSettings] = useState<RegistrationCapacitySettings>(
    getDefaultRegistrationCapacitySettings()
  );

  const orderedSeasons = useMemo(() => sortSeasonsNewestFirst(seasons), [seasons]);

  const divisionsBySeason = useMemo(() => {
    const grouped = new Map<string, DivisionRow[]>();
    divisions.forEach((division) => {
      const list = grouped.get(division.season_id) || [];
      list.push(division);
      grouped.set(division.season_id, list);
    });
    grouped.forEach((list, seasonId) => {
      grouped.set(
        seasonId,
        [...list].sort((a, b) => a.name.localeCompare(b.name))
      );
    });
    return grouped;
  }, [divisions]);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const fetchSetting = async (client: typeof supabase) =>
          client
            .from('site_settings')
            .select('value')
            .eq('key', REGISTRATION_CAPACITY_SITE_KEY)
            .maybeSingle();

        let settingData: any = null;
        let settingErr: any = null;
        try {
          const result = await fetchSetting(supabase);
          settingData = result.data;
          settingErr = result.error;
        } catch (err) {
          settingErr = err;
        }
        if (settingErr && supabaseAdmin) {
          const fallback = await fetchSetting(supabaseAdmin);
          settingData = fallback.data;
          settingErr = fallback.error;
        }
        if (settingErr) throw settingErr;

        const fetchSeasons = async (client: typeof supabase) =>
          client
            .from('seasons')
            .select('id,name,year,start_date,is_current')
            .order('start_date', { ascending: false });

        let seasonRows: SeasonRow[] = [];
        let seasonErr: any = null;
        try {
          const result = await fetchSeasons(supabase);
          seasonRows = (result.data || []) as SeasonRow[];
          seasonErr = result.error;
        } catch (err) {
          seasonErr = err;
        }
        if (seasonErr && supabaseAdmin) {
          const fallback = await fetchSeasons(supabaseAdmin);
          seasonRows = (fallback.data || []) as SeasonRow[];
          seasonErr = fallback.error;
        }
        if (seasonErr) throw seasonErr;

        const fetchDivisions = async (client: typeof supabase) =>
          client.from('divisions').select('id,name,season_id').order('name', { ascending: true });

        let divisionRows: DivisionRow[] = [];
        let divisionErr: any = null;
        try {
          const result = await fetchDivisions(supabase);
          divisionRows = (result.data || []) as DivisionRow[];
          divisionErr = result.error;
        } catch (err) {
          divisionErr = err;
        }
        if (divisionErr && supabaseAdmin) {
          const fallback = await fetchDivisions(supabaseAdmin);
          divisionRows = (fallback.data || []) as DivisionRow[];
          divisionErr = fallback.error;
        }
        if (divisionErr) throw divisionErr;

        setSettings(parseRegistrationCapacityValue((settingData as any)?.value));
        setSeasons(seasonRows);
        setDivisions(divisionRows);
        const sortedSeasons = [...seasonRows].sort((a, b) => {
          const aCurrent = !!a.is_current;
          const bCurrent = !!b.is_current;
          if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
          const aTime = a.start_date ? new Date(a.start_date).getTime() : 0;
          const bTime = b.start_date ? new Date(b.start_date).getTime() : 0;
          return bTime - aTime;
        });
        setSelectedSeasonId((prev) => prev || sortedSeasons[0]?.id || '');
      } catch (err: any) {
        console.error('Load registration capacity settings error', err);
        setError('Unable to load registration capacity settings.');
        setSettings(getDefaultRegistrationCapacitySettings());
        setSeasons([]);
        setDivisions([]);
        setSelectedSeasonId('');
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, []);

  useEffect(() => {
    if (!orderedSeasons.length) {
      if (selectedSeasonId) setSelectedSeasonId('');
      return;
    }
    if (!selectedSeasonId || !orderedSeasons.some((row) => row.id === selectedSeasonId)) {
      setSelectedSeasonId(orderedSeasons[0].id);
    }
  }, [orderedSeasons, selectedSeasonId]);

  const ensureSeasonConfig = (
    seasonsConfig: RegistrationCapacitySettings['seasons'],
    seasonId: string
  ) => {
    const existing = seasonsConfig.find((row) => row.seasonId === seasonId);
    if (existing) return existing;
    const created = {
      seasonId,
      teamMax: null,
      freeAgentMax: null,
      divisions: [],
    };
    seasonsConfig.push(created);
    return created;
  };

  const setSeasonLimit = (
    seasonId: string,
    field: keyof RegistrationCapacityPair,
    value: string
  ) => {
    const parsed = parseLimitInput(value);
    setSettings((prev) => {
      const nextSeasons = [...prev.seasons];
      const season = ensureSeasonConfig(nextSeasons, seasonId);
      season[field] = parsed;
      return {
        ...prev,
        seasons: nextSeasons,
      };
    });
  };

  const setDivisionLimit = (
    seasonId: string,
    divisionId: string,
    field: keyof RegistrationCapacityPair,
    value: string
  ) => {
    const parsed = parseLimitInput(value);
    setSettings((prev) => {
      const nextSeasons = [...prev.seasons];
      const season = ensureSeasonConfig(nextSeasons, seasonId);
      const nextDivisions = [...season.divisions];
      const existingDivision = nextDivisions.find((row) => row.divisionId === divisionId);
      if (existingDivision) {
        existingDivision[field] = parsed;
      } else {
        nextDivisions.push({
          divisionId,
          teamMax: field === 'teamMax' ? parsed : null,
          freeAgentMax: field === 'freeAgentMax' ? parsed : null,
        });
      }
      season.divisions = nextDivisions;
      return {
        ...prev,
        seasons: nextSeasons,
      };
    });
  };

  const getSeasonConfig = (seasonId: string) =>
    settings.seasons.find((row) => row.seasonId === seasonId) || null;

  const getDivisionConfig = (seasonId: string, divisionId: string) =>
    getSeasonConfig(seasonId)?.divisions.find((row) => row.divisionId === divisionId) || null;

  const selectedSeason =
    orderedSeasons.find((row) => row.id === selectedSeasonId) || orderedSeasons[0] || null;
  const selectedSeasonConfig = selectedSeason ? getSeasonConfig(selectedSeason.id) : null;
  const selectedSeasonDivisions = selectedSeason
    ? divisionsBySeason.get(selectedSeason.id) || []
    : [];

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const normalized = normalizeRegistrationCapacitySettings(settings);
    const payload = {
      key: REGISTRATION_CAPACITY_SITE_KEY,
      value: serializeRegistrationCapacitySettings(normalized),
      updated_at: new Date().toISOString(),
    };
    try {
      const saveWithClient = async (client: typeof supabase) =>
        client.from('site_settings').upsert(payload, { onConflict: 'key' });

      let saveErr: any = null;
      try {
        const { error } = await saveWithClient(supabase);
        saveErr = error;
      } catch (err) {
        saveErr = err;
      }

      if (saveErr && supabaseAdmin) {
        const { error } = await saveWithClient(supabaseAdmin);
        saveErr = error;
      }
      if (saveErr) throw saveErr;

      setSettings(normalized);
      setMessage('Registration capacity settings saved.');
    } catch (err: any) {
      console.error('Save registration capacity settings error', err);
      setError(err?.message || 'Failed to save registration capacity settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setSettings(getDefaultRegistrationCapacitySettings());
    setError(null);
    setMessage('Reset to defaults (not saved yet).');
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading registration capacity settings...</div>;
  }

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">Registration Capacity</h2>
          <p className="text-xs text-gray-400 mt-1">
            Set max slots by season and division for team and free-agent registration types.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Leave a field empty for no limit.
          </p>
          {error && <div className="text-xs text-brand-red font-mono mt-2">{error}</div>}
          {message && <div className="text-xs text-brand-lime font-mono mt-2">{message}</div>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={resetToDefaults}
            className="text-xs uppercase tracking-wider text-gray-300 border border-white/10 px-3 py-2 rounded hover:border-white/30"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            className="bg-brand-lime text-black px-4 py-2 rounded font-bold uppercase text-xs disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <label className="block">
          <span className="block text-xs text-brand-grey uppercase mb-3">Season</span>
          <div className="relative w-full md:w-[360px]">
            <select
              value={selectedSeason?.id || ''}
              onChange={(e) => setSelectedSeasonId(e.target.value)}
              className="w-full appearance-none bg-black border border-white/20 rounded pl-3 pr-10 dropdown-select-spacing py-2.5 text-white text-sm focus:border-brand-lime outline-none"
            >
              {!orderedSeasons.length && <option value="">No seasons found</option>}
              {orderedSeasons.map((season) => (
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
      </div>

      {selectedSeason ? (
        <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-white font-sports uppercase text-lg">{formatSeasonLabel(selectedSeason)}</h3>
              <div className="text-xs text-gray-500 mt-1">
                {selectedSeasonDivisions.length
                  ? `${selectedSeasonDivisions.length} division${selectedSeasonDivisions.length > 1 ? 's' : ''}`
                  : 'No divisions found for this season'}
              </div>
            </div>
            {selectedSeason.is_current ? (
              <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border border-brand-lime/40 text-brand-lime">
                Current
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/30 border border-white/10 rounded-xl p-4">
            <label className="text-xs text-brand-grey uppercase">
              Season team max
              <input
                type="number"
                min={1}
                value={selectedSeasonConfig?.teamMax ?? ''}
                onChange={(e) => setSeasonLimit(selectedSeason.id, 'teamMax', e.target.value)}
                className="mt-1 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                placeholder="No limit"
              />
            </label>
            <label className="text-xs text-brand-grey uppercase">
              Season free-agent max
              <input
                type="number"
                min={1}
                value={selectedSeasonConfig?.freeAgentMax ?? ''}
                onChange={(e) => setSeasonLimit(selectedSeason.id, 'freeAgentMax', e.target.value)}
                className="mt-1 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                placeholder="No limit"
              />
            </label>
          </div>

          {selectedSeasonDivisions.length > 0 ? (
            <div className="space-y-3">
              {selectedSeasonDivisions.map((division) => {
                const divisionConfig = getDivisionConfig(selectedSeason.id, division.id);
                return (
                  <div
                    key={division.id}
                    className="grid grid-cols-1 lg:grid-cols-[220px_1fr_1fr] gap-3 items-center bg-black/20 border border-white/10 rounded-lg p-3"
                  >
                    <div className="text-xs uppercase text-brand-grey">{division.name}</div>
                    <label className="text-xs text-brand-grey uppercase">
                      Team max
                      <input
                        type="number"
                        min={1}
                        value={divisionConfig?.teamMax ?? ''}
                        onChange={(e) =>
                          setDivisionLimit(selectedSeason.id, division.id, 'teamMax', e.target.value)
                        }
                        className="mt-1 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                        placeholder="Use season max"
                      />
                    </label>
                    <label className="text-xs text-brand-grey uppercase">
                      Free-agent max
                      <input
                        type="number"
                        min={1}
                        value={divisionConfig?.freeAgentMax ?? ''}
                        onChange={(e) =>
                          setDivisionLimit(selectedSeason.id, division.id, 'freeAgentMax', e.target.value)
                        }
                        className="mt-1 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                        placeholder="Use season max"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-gray-500 border border-white/10 bg-black/20 rounded-lg px-3 py-3">
              No divisions configured for this season yet.
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-500 border border-white/10 bg-black/20 rounded-lg px-3 py-3">
          No seasons found.
        </div>
      )}
    </div>
  );
};

export default RegistrationCapacityManager;

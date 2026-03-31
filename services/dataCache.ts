import { supabase } from './supabaseClient';

type TeamDirectoryEntry = {
  id: string;
  name: string;
  shortName?: string | null;
  logo?: string | null;
  division?: string | null;
  seasonId?: string | null;
  banner?: string | null;
};

type SeasonCacheEntry = {
  id: string;
  name?: string | null;
  year?: string | number | null;
  start_date?: string | null;
  registration_open?: boolean | string | number | null;
  is_public?: boolean | string | number | null;
};

let teamDirectoryPromise: Promise<TeamDirectoryEntry[]> | null = null;
let seasonListPromise: Promise<SeasonCacheEntry[]> | null = null;

const signLogo = async (path?: string | null) => {
  if (!path) return '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
  const marker = 'team-assets/';
  const publicMarker = '/storage/v1/object/public/team-assets/';
  const signedMarker = '/storage/v1/object/sign/team-assets/';
  let bucketPath = '';

  if (/^https?:\/\//i.test(trimmed)) {
    if (trimmed.includes(publicMarker)) {
      bucketPath = trimmed.split(publicMarker)[1]?.split('?')[0] || '';
    } else if (trimmed.includes(signedMarker)) {
      bucketPath = trimmed.split(signedMarker)[1]?.split('?')[0] || '';
    } else {
      return trimmed;
    }
  } else {
    const idx = trimmed.indexOf(marker);
    bucketPath = idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed;
  }

  if (!bucketPath) return trimmed;
  try {
    const { data, error } = await supabase.storage
      .from('team-assets')
      .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
    if (error) throw error;
    return data?.signedUrl || trimmed;
  } catch {
    return trimmed;
  }
};

export const signTeamAssetUrl = signLogo;

export const getTeamDirectory = () => {
  if (!teamDirectoryPromise) {
    teamDirectoryPromise = (async () => {
      const { data } = await supabase
        .from('teams')
        .select('id,name,short_name,logo_url,banner_url,division,season_id');
      if (!data) return [];
      const entries = await Promise.all(
        (data as any[]).map(async (row) => ({
          id: row.id,
          name: row.name,
          shortName: row.short_name || null,
          division: row.division || null,
          seasonId: row.season_id || null,
          logo: await signLogo(row.logo_url),
          banner: await signLogo(row.banner_url),
        }))
      );
      return entries as TeamDirectoryEntry[];
    })();
    teamDirectoryPromise.catch(() => {
      teamDirectoryPromise = null;
    });
  }
  return teamDirectoryPromise;
};

export const refreshTeamDirectory = () => {
  teamDirectoryPromise = null;
};

export const getSeasonList = () => {
  if (!seasonListPromise) {
    seasonListPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('seasons')
          .select('id,name,year,start_date,registration_open,is_public')
          .order('start_date', { ascending: false });
        if (error) throw error;
        return (data || []) as SeasonCacheEntry[];
      } catch (err: any) {
        const msg = (err?.message || '').toString().toLowerCase();
        const code = (err?.code || '').toString();
        const missingColumn =
          code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
        if (!missingColumn) throw err;

        const { data } = await supabase
          .from('seasons')
          .select('id,name,year,start_date')
          .order('start_date', { ascending: false });
        return (data || []) as SeasonCacheEntry[];
      }
    })();
    seasonListPromise.catch(() => {
      seasonListPromise = null;
    });
  }
  return seasonListPromise;
};

export const refreshSeasonList = () => {
  seasonListPromise = null;
};

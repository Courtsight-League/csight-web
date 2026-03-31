


import { supabase } from './supabaseClient';
import { signTeamAssetUrl } from './dataCache';

export type HomeTestimonial = {
  id: string;
  quote: string;
  name: string;
  role: string;
  team: string;
  division: string;
  season: string;
  accentColor: string;
  avatarUrl: string;
};

export type HomeTestimonialsConfig = {
  items: HomeTestimonial[];
};

type TestimonialRow = {
  id?: string | null;
  quote?: string | null;
  name?: string | null;
  role?: string | null;
  team?: string | null;
  division?: string | null;
  season?: string | null;
  accent_color?: string | null;
  avatar_url?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
};

const DEFAULT_HOME_TESTIMONIALS: HomeTestimonial[] = [
  {
    id: 'testimonial-ryan',
    quote:
      'CSL feels like a pro run every week. The stream quality, player tracking, and game photos made our whole team look legit.',
    name: 'Ryan Torres',
    role: 'Team Captain',
    team: 'Hoop Titans',
    division: 'D2 Saturdays',
    season: 'Winter 2026',
    accentColor: '#e1ff2b',
    avatarUrl: '',
  },
  {
    id: 'testimonial-jamal',
    quote:
      'What I like most is the balance. It is competitive but organized, and every game has clean stats right after. Super smooth experience.',
    name: 'Jamal Rivera',
    role: 'Player',
    team: 'Night Shift',
    division: 'D3 Flex',
    season: 'Winter 2026',
    accentColor: '#38bdf8',
    avatarUrl: '',
  },
  {
    id: 'testimonial-aiden',
    quote:
      'We joined as new players and the division setup was perfect. Good competition, clear schedules, and the league actually communicates fast.',
    name: 'Aiden Collins',
    role: 'Free Agent',
    team: 'Dime Buckets',
    division: 'D1 Brampton',
    season: 'Winter 2026',
    accentColor: '#fb923c',
    avatarUrl: '',
  },
  {
    id: 'testimonial-miguel',
    quote:
      'The media coverage is a game changer. Highlights, rankings, and box scores make every matchup feel bigger than just a rec game.',
    name: 'Miguel Santos',
    role: 'Team Manager',
    team: 'Spray & Pray',
    division: 'D2 Sunday',
    season: 'Winter 2026',
    accentColor: '#e879f9',
    avatarUrl: '',
  },
  {
    id: 'testimonial-luca',
    quote:
      'CSL gave us structure. We know where we play, when we play, and all our players can follow stats from one clean portal.',
    name: 'Luca Bennett',
    role: 'Coach',
    team: 'Young Bucks',
    division: 'D3 Mississauga',
    season: 'Winter 2026',
    accentColor: '#34d399',
    avatarUrl: '',
  },
];

const DEFAULT_ACCENT_PALETTE = ['#e1ff2b', '#38bdf8', '#fb923c', '#e879f9', '#34d399'];

const normalizeText = (value: any, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const normalizeId = (value: any, fallback: string) => {
  const normalized = normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

const ensureUuid = (value: string, fallbackSeed = '') => {
  const lower = (value || '').toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(lower)) {
    return lower;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const seed = normalizeId(fallbackSeed, 'testimonial').slice(0, 12).padEnd(12, '0');
  return `00000000-0000-4000-8000-${seed}`;
};

const normalizeHexColor = (value: any, fallback: string) => {
  const raw = normalizeText(value, fallback).replace(/\s+/g, '');
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const short = withHash.slice(1).toLowerCase();
    return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
  }
  return fallback;
};

const hexToRgb = (hex: string) => {
  const clean = normalizeHexColor(hex, '#e1ff2b').slice(1);
  const normalized =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  const intVal = Number.parseInt(normalized, 16);
  if (!Number.isFinite(intVal)) return { r: 225, g: 255, b: 43 };
  return {
    r: (intVal >> 16) & 255,
    g: (intVal >> 8) & 255,
    b: intVal & 255,
  };
};

export const getTestimonialGlow = (accentColor: string) => {
  const { r, g, b } = hexToRgb(accentColor);
  return `radial-gradient(circle at 10% 0%, rgba(${r},${g},${b},0.28), rgba(${r},${g},${b},0) 58%)`;
};

export const getDefaultHomeTestimonials = (): HomeTestimonial[] =>
  JSON.parse(JSON.stringify(DEFAULT_HOME_TESTIMONIALS)) as HomeTestimonial[];

export const normalizeHomeTestimonialsConfig = (input: any): HomeTestimonialsConfig => {
  const defaults = getDefaultHomeTestimonials();
  const sourceItems = Array.isArray(input) ? input : Array.isArray(input?.items) ? input.items : [];

  const items = sourceItems
    .map((raw: any, index: number) => {
      const fallback = defaults[index] || defaults[index % defaults.length];
      const quote = normalizeText(raw?.quote, fallback?.quote || '');
      const name = normalizeText(raw?.name, fallback?.name || `Player ${index + 1}`);
      const role = normalizeText(raw?.role, fallback?.role || 'Player');
      const team = normalizeText(raw?.team, fallback?.team || 'Courtsight');
      const division = normalizeText(raw?.division, fallback?.division || 'Division');
      const season = normalizeText(raw?.season, fallback?.season || 'Season');
      const avatarUrl = normalizeText(raw?.avatarUrl, fallback?.avatarUrl || '');
      const accentFallback =
        fallback?.accentColor || DEFAULT_ACCENT_PALETTE[index % DEFAULT_ACCENT_PALETTE.length];
      const accentColor = normalizeHexColor(raw?.accentColor, accentFallback);
      if (!quote || !name) return null;
      return {
        id: ensureUuid(
          normalizeText(raw?.id, ''),
          `${normalizeText(raw?.name, '')}-${index + 1}`
        ),
        quote,
        name,
        role,
        team,
        division,
        season,
        accentColor,
        avatarUrl,
      };
    })
    .filter((item): item is HomeTestimonial => !!item);

  return {
    items: items.length ? items : defaults,
  };
};

export const parseHomeTestimonialsValue = (value: string | null | undefined): HomeTestimonialsConfig => {
  if (!value || typeof value !== 'string') return { items: getDefaultHomeTestimonials() };
  try {
    return normalizeHomeTestimonialsConfig(JSON.parse(value));
  } catch {
    return { items: getDefaultHomeTestimonials() };
  }
};

export const serializeHomeTestimonials = (config: HomeTestimonialsConfig) =>
  JSON.stringify(normalizeHomeTestimonialsConfig(config));

export const loadHomeTestimonials = async (): Promise<HomeTestimonialsConfig> => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .select('id,quote,name,role,team,division,season,accent_color,avatar_url,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = (data || []) as TestimonialRow[];
    if (!rows.length) return { items: getDefaultHomeTestimonials() };

    const normalized = normalizeHomeTestimonialsConfig({
      items: rows.map((row, index) => ({
        id: row.id || '',
        quote: row.quote || '',
        name: row.name || '',
        role: row.role || '',
        team: row.team || '',
        division: row.division || '',
        season: row.season || '',
        avatarUrl: row.avatar_url || '',
        accentColor:
          row.accent_color || DEFAULT_ACCENT_PALETTE[index % DEFAULT_ACCENT_PALETTE.length],
      })),
    });

    const signedItems = await Promise.all(
      normalized.items.map(async (item) => {
        const rawAvatar = normalizeText(item.avatarUrl, '');
        if (!rawAvatar) return item;
        const signed = await signTeamAssetUrl(rawAvatar);
        return {
          ...item,
          avatarUrl: signed || rawAvatar,
        };
      })
    );
    return { items: signedItems };
  } catch (err) {
    console.warn('Home testimonials lookup failed, using defaults', err);
    return { items: getDefaultHomeTestimonials() };
  }
};

export const buildTestimonialsDbRows = (items: HomeTestimonial[]) => {
  const normalized = normalizeHomeTestimonialsConfig({ items }).items;
  return normalized.map((item, index) => ({
    id: ensureUuid(item.id, `${item.name}-${index + 1}`),
    quote: item.quote,
    name: item.name,
    role: item.role,
    team: item.team,
    division: item.division,
    season: item.season,
    avatar_url: normalizeText(item.avatarUrl, ''),
    accent_color: normalizeHexColor(
      item.accentColor,
      DEFAULT_ACCENT_PALETTE[index % DEFAULT_ACCENT_PALETTE.length]
    ),
    sort_order: index,
    is_active: true,
    updated_at: new Date().toISOString(),
  }));
};

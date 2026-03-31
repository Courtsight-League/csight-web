import { supabase } from './supabaseClient';

export const ABOUT_PAGE_CONTENT_SITE_KEY = 'about_page_content_config';

export type AboutPageSection = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
};

export type AboutPageContent = {
  headline: string;
  intro: string;
  heroImageUrl: string;
  sections: AboutPageSection[];
};

const DEFAULT_ABOUT_PAGE_CONTENT: AboutPageContent = {
  headline: "COURTSIGHT IS THE GTA'S FASTEST-GROWING COMMUNITY BASKETBALL LEAGUE.",
  intro:
    'Built by players, for players. With 20+ teams and an 80% retention rate, we make basketball more affordable, more accessible, and more fun. Every season you get pro-level competition, media coverage, and a community-first atmosphere that keeps players coming back.',
  heroImageUrl:
    'https://images.unsplash.com/photo-1684411531348-3aad121da52d?q=80&w=1470&auto=format&fit=crop',
  sections: [
    {
      id: 'where-we-play',
      title: 'Where We Play',
      body: '• Mississauga\n• Oakville / Burlington\n• North York\n• Brampton',
      imageUrl: '',
    },
    {
      id: 'league-format',
      title: 'League Format',
      body:
        '7 Regular Season Games + 1 Guaranteed Playoff Game\nGame Nights: Sundays & Wednesdays\nTeam Size: 6-12 players per roster (minimum 6 to start)\nSeason Length: ~10 weeks',
      imageUrl: '',
    },
    {
      id: 'experience',
      title: 'Your Courtsight Experience Includes',
      body:
        'Custom jerseys for every player\nProfessional game highlights & photos\nLive-streamed games on YouTube\nFull player stats & leaderboards (points, rebounds, assists & more)\nWeekly Player of the Game features & end-of-season awards\nChampionship rings + T-shirts for winners\nMixd up moments & behind-the-scenes content',
      imageUrl: '',
    },
    {
      id: 'league-details',
      title: 'League Details at a Glance',
      body:
        'Locations\nMississauga, Burlington/Oakville, Brampton, North York\n\nDivisions\nD1 - Elite: For serious hoopers chasing competition.\nD2 - Semi-Competitive: Balanced mix of competition and fun.\nD3 - Casual/Chill: For hoopers who want to enjoy the game without pressure.\n(Teams move up or down divisions each season based on their record)\n\nGame Days\nMonday to Thursday - 9-11PM\nSunday - 5-11PM\n\nSeason Duration\n10 weeks: Minimum of 8 Games + (up to 3 playoff games)\n\nGame Format\n4 x 10-minute quarters\n\nPlayoffs\nAll teams make the playoffs\n\nOfficiating\n2 experienced FIBA officials (minimum 5 years experience)\n\nMedia Coverage\nMedia day shots for the online portal\nAll games live-streamed in HD\nIn-game player photos & videos\n\nStats\nPlayer career stats are found at www.courtsightleague.com\nStats are updated 48-62 hours after games\n\nJersey\nNew Courtsight members get a custom Courtsight jersey set for $28.',
      imageUrl: '',
    },
  ],
};

const normalizeText = (value: any, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const normalizeSectionId = (value: any, fallback: string) => {
  const normalized = normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

export const getDefaultAboutPageContent = (): AboutPageContent =>
  JSON.parse(JSON.stringify(DEFAULT_ABOUT_PAGE_CONTENT)) as AboutPageContent;

export const normalizeAboutPageContent = (input: any): AboutPageContent => {
  const defaults = getDefaultAboutPageContent();
  if (!input || typeof input !== 'object') return defaults;

  const sectionsInput = Array.isArray(input.sections) ? input.sections : [];
  const sections = sectionsInput
    .map((raw: any, index: number) => {
      const fallback = defaults.sections[index] || defaults.sections[0];
      const title = normalizeText(raw?.title, fallback?.title || `Section ${index + 1}`);
      const body = normalizeText(raw?.body, fallback?.body || '');
      if (!title && !body) return null;
      return {
        id: normalizeSectionId(raw?.id, `section-${index + 1}`),
        title,
        body,
        imageUrl: normalizeText(raw?.imageUrl, ''),
      };
    })
    .filter((section): section is AboutPageSection => !!section);

  return {
    headline: normalizeText(input.headline, defaults.headline),
    intro: normalizeText(input.intro, defaults.intro),
    heroImageUrl: normalizeText(input.heroImageUrl, defaults.heroImageUrl),
    sections: sections.length ? sections : defaults.sections,
  };
};

export const parseAboutPageContentValue = (value: string | null | undefined): AboutPageContent => {
  if (!value || typeof value !== 'string') return getDefaultAboutPageContent();
  try {
    return normalizeAboutPageContent(JSON.parse(value));
  } catch {
    return getDefaultAboutPageContent();
  }
};

export const serializeAboutPageContent = (content: AboutPageContent) =>
  JSON.stringify(normalizeAboutPageContent(content));

export const loadAboutPageContent = async (): Promise<AboutPageContent> => {
  const defaults = getDefaultAboutPageContent();
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', ABOUT_PAGE_CONTENT_SITE_KEY)
      .maybeSingle();
    if (error) throw error;
    return parseAboutPageContentValue((data as any)?.value);
  } catch (err) {
    console.warn('About page content lookup failed, using defaults', err);
    return defaults;
  }
};

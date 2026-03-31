type SeasonLike = {
  name?: string | null;
  year?: string | number | null;
  start_date?: string | null;
  startDate?: string | null;
};

const SEASON_TERM_RANK: Record<string, number> = {
  preseason: 0,
  pre: 0,
  spring: 1,
  summer: 2,
  fall: 3,
  autumn: 3,
  winter: 4,
};

const getTimeValue = (value?: string | null) => {
  if (!value) return Number.NaN;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const getYearValue = (season: SeasonLike) => {
  if (season.year !== undefined && season.year !== null && String(season.year).trim()) {
    const parsed = Number(season.year);
    if (Number.isFinite(parsed)) return parsed;
  }
  const name = String(season.name || '');
  const match = name.match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : Number.NaN;
};

const getTermRank = (season: SeasonLike) => {
  const normalized = String(season.name || '').toLowerCase();
  const match = normalized.match(/\b(preseason|pre-season|spring|summer|fall|autumn|winter)\b/);
  if (!match) return -1;
  const key = match[1] === 'pre-season' ? 'preseason' : match[1];
  return SEASON_TERM_RANK[key] ?? -1;
};

export const compareSeasonsNewestFirst = <T extends SeasonLike>(a: T, b: T) => {
  const aStart = getTimeValue(a.start_date || a.startDate);
  const bStart = getTimeValue(b.start_date || b.startDate);
  if (Number.isFinite(aStart) || Number.isFinite(bStart)) {
    if (!Number.isFinite(aStart)) return 1;
    if (!Number.isFinite(bStart)) return -1;
    if (aStart !== bStart) return bStart - aStart;
  }

  const aYear = getYearValue(a);
  const bYear = getYearValue(b);
  if (Number.isFinite(aYear) || Number.isFinite(bYear)) {
    if (!Number.isFinite(aYear)) return 1;
    if (!Number.isFinite(bYear)) return -1;
    if (aYear !== bYear) return bYear - aYear;
  }

  const aTerm = getTermRank(a);
  const bTerm = getTermRank(b);
  if (aTerm !== bTerm) return bTerm - aTerm;

  return String(b.name || '').localeCompare(String(a.name || ''));
};

export const sortSeasonsNewestFirst = <T extends SeasonLike>(seasons: T[]) =>
  [...seasons].sort(compareSeasonsNewestFirst);

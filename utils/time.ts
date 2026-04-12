export const ONTARIO_TIME_ZONE = 'America/Toronto';

const DISPLAY_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const ONTARIO_DATE_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ONTARIO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ONTARIO_DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ONTARIO_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const TIME_ONLY_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?$/;
const EXPLICIT_TIME_ZONE_PATTERN = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

const pad2 = (value: number) => String(value).padStart(2, '0');

const parseClockTime = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const match = raw.match(TIME_ONLY_PATTERN);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  const meridiem = match[4]?.toUpperCase();

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'AM') {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return { hours, minutes, seconds };
};

const formatClockTime = (value?: string | null) => {
  const parsed = parseClockTime(value);
  if (!parsed) return String(value || '').trim();
  return DISPLAY_TIME_FORMATTER.format(new Date(2000, 0, 1, parsed.hours, parsed.minutes, parsed.seconds));
};

const getPartsMap = (formatter: Intl.DateTimeFormat, value: Date) =>
  formatter.formatToParts(value).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

const getTimeZoneOffsetMinutes = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = getPartsMap(formatter, value);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - value.getTime()) / 60000;
};

const getOntarioTimestampFromLocalParts = (
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
) => {
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const initialOffset = getTimeZoneOffsetMinutes(new Date(utcGuess), ONTARIO_TIME_ZONE);
  let resolved = utcGuess - initialOffset * 60_000;
  const correctedOffset = getTimeZoneOffsetMinutes(new Date(resolved), ONTARIO_TIME_ZONE);
  if (correctedOffset !== initialOffset) {
    resolved = utcGuess - correctedOffset * 60_000;
  }
  return resolved;
};

export const getScheduleDateTimeParts = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return { date: '', time: '', timestampMs: null as number | null };

  if (!EXPLICIT_TIME_ZONE_PATTERN.test(raw)) {
    const match = raw.match(NAIVE_DATE_TIME_PATTERN);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hours = Number(match[4] || 0);
      const minutes = Number(match[5] || 0);
      const seconds = Number(match[6] || 0);
      return {
        date: `${match[1]}-${match[2]}-${match[3]}`,
        time: match[4] != null ? `${pad2(hours)}:${pad2(minutes)}` : '',
        timestampMs: getOntarioTimestampFromLocalParts(year, month, day, hours, minutes, seconds),
      };
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { date: '', time: '', timestampMs: null as number | null };
  }

  const parts = getPartsMap(ONTARIO_DATE_TIME_PARTS_FORMATTER, parsed);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    timestampMs: parsed.getTime(),
  };
};

export const getScheduleTimestamp = (
  value?: string | null,
  fallbackDate?: string | null,
  fallbackTime?: string | null
) => {
  const primary = getScheduleDateTimeParts(value);
  if (primary.timestampMs != null) return primary.timestampMs;

  const dateRaw = String(fallbackDate || '').trim();
  const dateMatch = dateRaw.match(DATE_ONLY_PATTERN);
  if (!dateMatch) return null;

  const timeParts = parseClockTime(fallbackTime) || { hours: 0, minutes: 0, seconds: 0 };
  return getOntarioTimestampFromLocalParts(
    Number(dateMatch[1]),
    Number(dateMatch[2]),
    Number(dateMatch[3]),
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds
  );
};

export const buildScheduleDateTimeIso = (date?: string | null, time?: string | null) => {
  const timestampMs = getScheduleTimestamp(null, date, time);
  if (timestampMs == null) return '';
  return new Date(timestampMs).toISOString();
};

export const formatScheduleDateLabel = (
  value?: string | null,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const dateOnlyMatch = raw.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    const localDate = new Date(
      Number(dateOnlyMatch[1]),
      Number(dateOnlyMatch[2]) - 1,
      Number(dateOnlyMatch[3]),
      12,
      0,
      0
    );
    return localDate.toLocaleDateString('en-US', options);
  }

  if (!EXPLICIT_TIME_ZONE_PATTERN.test(raw)) {
    const parts = getScheduleDateTimeParts(raw);
    if (parts.date) {
      const matched = parts.date.match(DATE_ONLY_PATTERN);
      if (matched) {
        const localDate = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12, 0, 0);
        return localDate.toLocaleDateString('en-US', options);
      }
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  if (
    options.month === 'short' &&
    options.day === 'numeric' &&
    options.year === 'numeric' &&
    Object.keys(options).length === 3
  ) {
    return ONTARIO_DATE_LABEL_FORMATTER.format(parsed);
  }
  return parsed.toLocaleDateString('en-US', { ...options, timeZone: ONTARIO_TIME_ZONE });
};

export const formatDisplayTime = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const looksLikeDateTime =
    /\d{4}-\d{2}-\d{2}/.test(raw) ||
    /\d{1,2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ||
    raw.includes('T');
  if (looksLikeDateTime) {
    const parts = getScheduleDateTimeParts(raw);
    if (parts.time) {
      return formatClockTime(parts.time);
    }
  }

  return formatClockTime(raw);
};

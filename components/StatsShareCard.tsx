import React from 'react';

export type ShareCardStatRow = {
  key: string;
  label: string;
  value: string;
};

export type ShareCardData = {
  player: {
    name: string;
    teamLabel: string;
    seasonLabel?: string | null;
    jerseyNumber?: string | null;
    avatarUrl?: string | null;
  };
  lastGame: {
    result: 'W' | 'L' | 'TBD';
    myTeamLabel: string;
    myScore?: string | null;
    opponentScore?: string | null;
    opponentLabel: string;
    timeLabel?: string | null;
  };
  lastGameStats: {
    rows: ShareCardStatRow[];
    shots?: {
      fg?: string | null;
      three?: string | null;
    };
  };
  seasonSummary: {
    title: string;
    rows: ShareCardStatRow[];
    recordText: string;
  };
  footer: {
    domainText: string;
    handleText: string;
  };
};

export type StatsShareCardProps = {
  data: ShareCardData;
  background?: {
    mode?: 'metal' | 'black' | 'white' | 'custom';
    imageUrl?: string | null;
  };
  exportMode?: boolean;
};

const LIME = '#e1ff2b';
const HEAD_FONT = "'Teko', 'Saira Condensed', 'Oswald', system-ui, sans-serif";
const LABEL_FONT = "'Rajdhani', 'Inter', system-ui, sans-serif";
const STABLE_UI_FONT = "'Arial', 'Helvetica Neue', sans-serif";
const NAME_BOLD_FONT =
  "'Heading Now 11-18', 'Heading Now 11-18 Bold', 'Heading Now', 'Teko', 'Saira Condensed', 'Oswald', system-ui, sans-serif";
const NAME_ITALIC_FONT =
  "'Heading Now 11-18', 'Heading Now 11-18 Bold Italic', 'Heading Now', 'Teko', 'Saira Condensed', 'Oswald', system-ui, sans-serif";

const safeUpper = (value: string) => (value || '').trim().toUpperCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitLeadingScore = (value: string) => value.match(/^\s*(\d{1,3})\s*[-:]?\s*(.+?)\s*$/);
const splitTrailingScore = (value: string) => value.match(/^\s*(.+?)\s*[-:]?\s*(\d{1,3})\s*$/);

const parseShotLine = (line?: string | null) => {
  if (!line) return null;
  const m = line.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!m) return null;
  const made = Number(m[1]);
  const att = Number(m[2]);
  if (!Number.isFinite(made) || !Number.isFinite(att) || att <= 0) return null;
  const pct = ((made / att) * 100).toFixed(0);
  return { made, att, pct };
};

const buildShotText = (label: string, line?: string | null) => {
  const parsed = parseShotLine(line);
  if (parsed) return `${label} ${parsed.made}/${parsed.att} (${parsed.pct}%)`;
  if (line) return `${label} ${line}`;
  return '';
};

const normalizeRecordText = (value?: string | null) => {
  const raw = (value || '').trim();
  if (!raw) return '-';
  const numericParts = raw.match(/\d+/g) || [];
  if (numericParts.length >= 2) return `${numericParts[0]}-${numericParts[1]}`;
  if (numericParts.length === 1) return `${numericParts[0]}-0`;
  return '-';
};

const StatCell: React.FC<{
  label: string;
  value: string;
  showDivider?: boolean;
  valueColor: string;
  dividerColor: string;
  labelColor: string;
  compact?: boolean;
}> = ({ label, value, showDivider, valueColor, dividerColor, labelColor, compact }) => (
  <div className="relative flex-1 text-center py-2">
    {showDivider && <div className="absolute left-0 top-2 bottom-2 w-px" style={{ background: dividerColor }} />}
    <div
      className={`uppercase ${compact ? 'text-[10px] tracking-[0.24em]' : 'text-[11px] tracking-[0.34em]'}`}
      style={{ color: labelColor, fontFamily: LABEL_FONT, fontWeight: 700 }}
    >
      {safeUpper(label)}
    </div>
    <div className={`mt-[2px] leading-[0.8] ${compact ? 'text-[50px]' : 'text-[58px]'}`} style={{ fontFamily: HEAD_FONT, fontWeight: 700, color: valueColor }}>
      {value}
    </div>
  </div>
);

export const StatsShareCard: React.FC<StatsShareCardProps> = ({ data, background, exportMode = false }) => {
  const playerName = safeUpper(data.player.name || 'PLAYER');
  const playerNameParts = playerName.split(/\s+/).filter(Boolean);
  const playerFirstName = playerNameParts[0] || 'PLAYER';
  const playerSurname = playerNameParts.length > 1 ? playerNameParts.slice(1).join(' ') : '';
  const longestNamePartLength = playerNameParts.reduce((max, part) => Math.max(max, part.length), 0);
  const teamLabel = safeUpper(data.player.teamLabel || 'TEAM');
  const seasonLabel = safeUpper(data.player.seasonLabel || '');
  const jerseyNumber = data.player.jerseyNumber ? `#${data.player.jerseyNumber}` : '';
  const result = data.lastGame.result || 'W';
  const myTeam = safeUpper(data.lastGame.myTeamLabel || data.player.teamLabel || 'TEAM');
  const opp = safeUpper(data.lastGame.opponentLabel || 'OPPONENT');
  const time = safeUpper(data.lastGame.timeLabel || '');
  let myScore = (data.lastGame.myScore || '').trim();
  let opponentScore = (data.lastGame.opponentScore || '').trim();
  let gameTeamLabel = myTeam;
  let opponentLabel = opp;

  if (!opponentScore) {
    const leading = splitLeadingScore(opponentLabel);
    if (leading) {
      opponentScore = leading[1];
      opponentLabel = safeUpper(leading[2]);
    }
  }
  if (!myScore) {
    const trailing = splitTrailingScore(gameTeamLabel);
    if (trailing) {
      myScore = trailing[2];
      gameTeamLabel = safeUpper(trailing[1]);
    }
  }

  if (myScore && opponentScore) {
    const merged = `${myScore}${opponentScore}`;
    gameTeamLabel = gameTeamLabel.replace(new RegExp(`\\s*${escapeRegExp(merged)}$`), '').trim();
  }
  if (myScore) {
    gameTeamLabel = gameTeamLabel.replace(new RegExp(`\\s*${escapeRegExp(myScore)}$`), '').trim();
  }
  if (opponentScore) {
    opponentLabel = opponentLabel.replace(new RegExp(`^\\s*${escapeRegExp(opponentScore)}`), '').trim();
  }
  if (!gameTeamLabel) gameTeamLabel = myTeam;
  if (!opponentLabel) opponentLabel = opp;
  const scoreText = `${myScore || '--'} - ${opponentScore || '--'}`;

  const fgText = buildShotText('FG', data.lastGameStats.shots?.fg ?? null);
  const threeText = buildShotText('3PT', data.lastGameStats.shots?.three ?? null);
  const shotsText = [fgText, threeText].filter(Boolean).join('   ');

  const lastRows = (data.lastGameStats.rows || []).slice(0, 5);
  while (lastRows.length < 5) {
    lastRows.push({ key: `missing-${lastRows.length}`, label: '-', value: '-' });
  }

  const seasonRows = (data.seasonSummary.rows || []).slice(0, 3);
  while (seasonRows.length < 3) {
    seasonRows.push({ key: `season-missing-${seasonRows.length}`, label: '-', value: '-' });
  }

  const useStackedNameLayout = exportMode
    ? playerName.length > 16 || longestNamePartLength > 10
    : playerName.length > 18 || longestNamePartLength > 11;
  const dynamicNameSize = exportMode
    ? playerName.length > 32 || longestNamePartLength > 18
      ? 34
      : playerName.length > 28 || longestNamePartLength > 16
      ? 38
      : playerName.length > 24 || longestNamePartLength > 14
      ? 42
      : playerName.length > 20 || longestNamePartLength > 12
      ? 48
      : playerName.length > 16 || longestNamePartLength > 10
      ? 54
      : playerName.length > 12
      ? 64
      : 78
    : playerName.length > 30 || longestNamePartLength > 16
      ? 42
      : playerName.length > 26 || longestNamePartLength > 14
      ? 48
      : playerName.length > 22 || longestNamePartLength > 12
      ? 54
      : playerName.length > 18
      ? 60
      : playerName.length > 14
      ? 70
      : 78;
  const recordText = normalizeRecordText(data.seasonSummary.recordText);
  const recordLabelSize = exportMode ? 11 : 12;
  const recordValueSize = exportMode ? 23 : 27;
  const recordGap = exportMode ? 6 : 8;
  const backgroundMode = background?.mode || 'metal';
  const customImageUrl = background?.imageUrl || null;
  const isWhiteMode = backgroundMode === 'white';
  const isCustomMode = backgroundMode === 'custom' && !!customImageUrl;
  const avatarSrc = data.player.avatarUrl || '/player-placeholder.svg';

  const rootBackgroundImage = isCustomMode
    ? `url("${customImageUrl}")`
    : backgroundMode === 'black'
    ? 'linear-gradient(180deg, #0b0d12 0%, #05070b 52%, #0b0d12 100%)'
    : backgroundMode === 'white'
    ? 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 52%, #f8fafc 100%)'
    : [
        'radial-gradient(120% 80% at 50% -12%, rgba(255,255,255,0.22), rgba(255,255,255,0.05) 38%, rgba(0,0,0,0) 70%)',
        'radial-gradient(55% 30% at 18% 53%, rgba(255,118,22,0.30), rgba(255,118,22,0.08) 48%, rgba(0,0,0,0) 78%)',
        'radial-gradient(55% 30% at 82% 53%, rgba(255,118,22,0.30), rgba(255,118,22,0.08) 48%, rgba(0,0,0,0) 78%)',
        'radial-gradient(70% 50% at 50% 54%, rgba(57,75,118,0.24), rgba(0,0,0,0) 72%)',
        'linear-gradient(180deg, #1b1f2b 0%, #101522 34%, #0a0e18 58%, #0d111c 100%)',
      ].join(',');
  const rootBackgroundColor = isWhiteMode ? '#f4f6fb' : '#06080f';
  const mainTextColor = isWhiteMode ? '#0f172a' : '#ffffff';
  const mutedTextColor = isWhiteMode ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.72)';
  const softLineColor = isWhiteMode ? 'rgba(15,23,42,0.16)' : 'rgba(255,255,255,0.16)';
  const panelBackground = isWhiteMode ? 'rgba(255,255,255,0.84)' : 'rgba(0,0,0,0.34)';
  const panelBorder = isWhiteMode ? '1px solid rgba(15,23,42,0.18)' : '1px solid rgba(255,255,255,0.12)';
  const panelShadow = isWhiteMode ? '0 10px 26px rgba(15,23,42,0.14)' : '0 16px 40px rgba(0,0,0,0.5)';
  const verticalDivider = isWhiteMode ? 'rgba(15,23,42,0.2)' : 'rgba(255,255,255,0.2)';
  const customOverlayOpacity = isCustomMode ? 0.52 : isWhiteMode ? 0.12 : 0.4;
  const accentFrameColor = isWhiteMode ? '#b7cf11' : LIME;
  const accentTextColor = isWhiteMode ? '#6f8600' : LIME;
  const accentTextShadow = isWhiteMode ? '0 1px 1px rgba(0,0,0,0.24)' : undefined;

  return (
    <div
      className="relative w-[540px] h-[960px] overflow-hidden bg-black"
      style={{
        borderRadius: 22,
        border: `2px solid ${accentFrameColor}`,
        backgroundColor: rootBackgroundColor,
        backgroundImage: rootBackgroundImage,
        backgroundSize: isCustomMode ? 'cover' : undefined,
        backgroundPosition: isCustomMode ? 'center' : undefined,
        boxShadow: '0 26px 80px rgba(0,0,0,0.8)',
      }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            opacity: customOverlayOpacity,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='.52'/%3E%3C/svg%3E\")",
            mixBlendMode: isWhiteMode ? 'multiply' : 'soft-light',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            opacity: isWhiteMode ? 0.08 : 0.22,
            backgroundImage:
              isWhiteMode
                ? 'repeating-linear-gradient(0deg, rgba(15,23,42,0.06) 0px, rgba(15,23,42,0.06) 1px, transparent 1px, transparent 4px)'
                : 'repeating-linear-gradient(0deg, rgba(255,255,255,0.065) 0px, rgba(255,255,255,0.065) 1px, transparent 1px, transparent 4px)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            opacity: isWhiteMode ? 0.1 : 0.26,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='280' viewBox='0 0 280 280'%3E%3Cg fill='none'%3E%3Ccircle cx='18' cy='42' r='1.2' fill='%23ff8f2d' fill-opacity='.85'/%3E%3Ccircle cx='36' cy='92' r='1.05' fill='%23ffcb78' fill-opacity='.72'/%3E%3Ccircle cx='58' cy='116' r='1.15' fill='%23ff8a1f' fill-opacity='.78'/%3E%3Ccircle cx='248' cy='36' r='1.2' fill='%23ff8f2d' fill-opacity='.85'/%3E%3Ccircle cx='228' cy='76' r='1.05' fill='%23ffcb78' fill-opacity='.72'/%3E%3Ccircle cx='210' cy='122' r='1.15' fill='%23ff8a1f' fill-opacity='.78'/%3E%3C/g%3E%3C/svg%3E\")",
            mixBlendMode: 'screen',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            opacity: isWhiteMode ? 0.08 : 0.56,
            background: isWhiteMode
              ? 'radial-gradient(closest-side at 50% 46%, rgba(255,255,255,0) 0%, rgba(15,23,42,0.24) 100%)'
              : 'radial-gradient(closest-side at 50% 46%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.9) 100%)',
          }}
        />
      </div>

      <div className="absolute inset-[16px] pointer-events-none" style={{ border: `2px solid ${accentFrameColor}`, opacity: 0.56 }} />
      <div className="absolute left-4 top-4 w-14 h-14 border-l-2 border-t-2" style={{ borderColor: accentFrameColor }} />
      <div className="absolute right-4 top-4 w-14 h-14 border-r-2 border-t-2" style={{ borderColor: accentFrameColor }} />
      <div className="absolute left-4 bottom-20 w-16 h-16 border-l-2 border-b-2" style={{ borderColor: accentFrameColor }} />
      <div className="absolute right-4 bottom-20 w-16 h-16 border-r-2 border-b-2" style={{ borderColor: accentFrameColor }} />
      <div className="absolute left-4 right-4 bottom-[16px] h-[2px]" style={{ background: isWhiteMode ? 'rgba(15,23,42,0.22)' : 'rgba(255,255,255,0.22)' }} />
      <div className="absolute left-4 right-4 bottom-[10px] h-[2px]" style={{ background: isWhiteMode ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.14)' }} />
      <div className="absolute left-4 right-4 bottom-[4px] h-[2px]" style={{ background: isWhiteMode ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)' }} />

      <div className="absolute top-5 left-0 right-0 flex justify-center">
        <img
          src="/logo.png"
          alt="CSIGHT"
          className="h-11 w-auto"
          style={{
            filter: isWhiteMode ? 'brightness(0) saturate(100%)' : 'none',
            opacity: isWhiteMode ? 0.82 : 1,
          }}
        />
      </div>

      <div className="absolute top-[86px] left-0 right-0 text-center">
        <div className="text-[9px] uppercase tracking-[0.52em]" style={{ fontFamily: LABEL_FONT, fontWeight: 600, color: mutedTextColor }}>
          {seasonLabel || ' '}
        </div>
        <div
          className="mt-3 text-[18px] uppercase tracking-[0.38em]"
          style={{ color: accentTextColor, textShadow: accentTextShadow, fontFamily: LABEL_FONT, fontWeight: 700 }}
        >
          LAST GAME STATS
        </div>
        <div
          className="mt-2 uppercase block px-6 overflow-hidden"
          style={{
            fontFamily: NAME_BOLD_FONT,
            fontWeight: 700,
            fontSize: dynamicNameSize,
            color: mainTextColor,
            lineHeight: useStackedNameLayout ? (exportMode ? 0.88 : 0.9) : 0.82,
            whiteSpace: useStackedNameLayout ? 'normal' : 'nowrap',
          }}
        >
          <span
            style={{
              display: useStackedNameLayout ? 'block' : 'inline',
            }}
          >
            {playerFirstName}
          </span>
          {playerSurname ? (
            <span
              style={{
                fontFamily: NAME_ITALIC_FONT,
                fontStyle: 'italic',
                display: useStackedNameLayout ? 'block' : 'inline',
                marginLeft: useStackedNameLayout ? 0 : 10,
                marginTop: useStackedNameLayout ? 2 : 0,
              }}
            >
              {playerSurname}
            </span>
          ) : null}
        </div>
        <div
          className="mt-1 text-[18px] uppercase tracking-[0.28em]"
          style={{ color: accentTextColor, textShadow: accentTextShadow, fontFamily: LABEL_FONT, fontWeight: 700 }}
        >
          {teamLabel}
        </div>
      </div>

      <div className="absolute top-[262px] left-7 right-7 h-px" style={{ background: softLineColor }} />
      <div className="absolute top-[270px] left-7 right-7 h-[34px] flex items-center justify-center gap-2">
        <div
          className="w-8 h-8 rounded-[4px] flex items-center justify-center shrink-0"
          style={{ background: accentFrameColor, color: '#111', fontFamily: HEAD_FONT, fontWeight: 700, fontSize: 21 }}
        >
          {result}
        </div>
        <div
          className="text-[13px] uppercase tracking-[0.01em] leading-none max-w-[390px] overflow-hidden text-ellipsis whitespace-nowrap text-center"
          style={{ fontFamily: STABLE_UI_FONT, fontWeight: 700, color: isWhiteMode ? '#111827' : 'rgba(255,255,255,0.9)' }}
        >
          <span>{gameTeamLabel}</span>
          <span
            className="mx-2 inline-block rounded-md px-2 py-[2px] align-middle"
            style={{
              background: isWhiteMode ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.12)',
              border: isWhiteMode ? '1px solid rgba(15,23,42,0.16)' : '1px solid rgba(255,255,255,0.16)',
              color: isWhiteMode ? '#111827' : '#ffffff',
              fontWeight: 800,
              letterSpacing: '0.04em',
            }}
          >
            {scoreText}
          </span>
          <span style={{ color: isWhiteMode ? 'rgba(17,24,39,0.72)' : 'rgba(255,255,255,0.7)' }}>{opponentLabel}</span>
          {time ? <span style={{ color: isWhiteMode ? 'rgba(17,24,39,0.86)' : 'rgba(255,255,255,0.86)' }}>{` ${time}`}</span> : null}
        </div>
        {jerseyNumber ? (
          <div className="text-[9px] uppercase tracking-[0.2em] shrink-0" style={{ fontFamily: STABLE_UI_FONT, color: isWhiteMode ? 'rgba(17,24,39,0.46)' : 'rgba(255,255,255,0.46)' }}>
            {jerseyNumber}
          </div>
        ) : null}
      </div>
      <div className="absolute top-[312px] left-7 right-7 h-px" style={{ background: softLineColor }} />

      <div className="absolute left-0 right-0 top-[326px] flex justify-center">
        <div className="relative">
          <div
            className="absolute inset-[-10px] rounded-full"
            style={{
              border: `3px solid ${accentFrameColor}`,
              boxShadow: isWhiteMode
                ? '0 0 0 2px rgba(255,255,255,0.68), 0 0 24px rgba(183,207,17,0.24)'
                : '0 0 0 2px rgba(0,0,0,0.6), 0 0 24px rgba(225,255,43,0.24)',
            }}
          />
          {exportMode ? (
            <div className="w-[250px] h-[250px]" data-share-avatar-shell="true">
              <img
                src={avatarSrc}
                alt="Player"
                data-share-avatar="true"
                className="block w-full h-full object-cover"
                style={{ background: 'transparent' }}
              />
            </div>
          ) : (
            <div
              className="w-[250px] h-[250px] rounded-full overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.42)' }}
            >
              <img
                src={avatarSrc}
                alt="Player"
                data-share-avatar="true"
                crossOrigin="anonymous"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = '/player-placeholder.svg';
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div
        className="absolute left-7 right-7 top-[592px] rounded-[14px] overflow-hidden"
        style={{
          background: panelBackground,
          border: panelBorder,
          boxShadow: panelShadow,
        }}
      >
        <div className="flex items-stretch">
          {lastRows.map((row, idx) => (
            <StatCell
              key={row.key}
              label={row.label}
              value={row.value}
              showDivider={idx > 0}
              valueColor={mainTextColor}
              dividerColor={verticalDivider}
              labelColor={accentTextColor}
              compact={lastRows.length > 4}
            />
          ))}
        </div>
      </div>

      <div className="absolute top-[688px] left-7 right-7 flex justify-center gap-2">
        {fgText ? (
          <div
            className="px-3 py-[3px] rounded-md text-[12px] tracking-[0.06em] uppercase whitespace-nowrap leading-none shrink-0"
            style={{ fontFamily: STABLE_UI_FONT, color: mainTextColor, background: isWhiteMode ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)', border: isWhiteMode ? '1px solid rgba(15,23,42,0.12)' : '1px solid rgba(255,255,255,0.14)' }}
          >
            {fgText}
          </div>
        ) : null}
        {threeText ? (
          <div
            className="px-3 py-[3px] rounded-md text-[12px] tracking-[0.06em] uppercase whitespace-nowrap leading-none shrink-0"
            style={{ fontFamily: STABLE_UI_FONT, color: mainTextColor, background: isWhiteMode ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)', border: isWhiteMode ? '1px solid rgba(15,23,42,0.12)' : '1px solid rgba(255,255,255,0.14)' }}
          >
            {threeText}
          </div>
        ) : null}
        {!fgText && !threeText ? (
          <div className="text-[12px]" style={{ fontFamily: LABEL_FONT, color: mutedTextColor }}>
            {shotsText || ' '}
          </div>
        ) : null}
      </div>

      <div className="absolute top-[720px] left-7 right-7 flex justify-center">
        <div
          className="relative min-w-[280px] text-center px-8 py-[5px] text-[13px] uppercase tracking-[0.2em]"
          style={{
            fontFamily: LABEL_FONT,
            fontWeight: 700,
            color: '#121212',
            background: 'linear-gradient(180deg, rgba(214,214,214,0.96), rgba(121,121,121,0.92))',
            border: '1px solid rgba(255,255,255,0.22)',
            clipPath: 'polygon(3% 0, 97% 0, 100% 50%, 97% 100%, 3% 100%, 0 50%)',
          }}
        >
          {safeUpper(data.seasonSummary.title || 'SEASON SUMMARY')}
        </div>
      </div>

      <div
        className="absolute left-7 right-7 top-[768px] rounded-[14px] overflow-hidden"
        style={{
          background: isWhiteMode ? 'rgba(255,255,255,0.84)' : 'rgba(0,0,0,0.35)',
          border: isWhiteMode ? '1px solid rgba(15,23,42,0.18)' : '1px solid rgba(255,255,255,0.12)',
          boxShadow: isWhiteMode ? '0 10px 24px rgba(15,23,42,0.14)' : '0 12px 34px rgba(0,0,0,0.44)',
        }}
      >
        <div className="flex items-stretch">
          {seasonRows.map((row, idx) => (
            <div key={row.key} className="relative flex-1 text-center py-[5px]">
              {idx > 0 && <div className="absolute left-0 top-[7px] bottom-[7px] w-px" style={{ background: isWhiteMode ? 'rgba(15,23,42,0.24)' : 'rgba(255,255,255,0.24)' }} />}
              <div className="text-[44px] leading-[0.86]" style={{ fontFamily: HEAD_FONT, fontWeight: 700, color: mainTextColor }}>
                {row.value}
              </div>
              <div
                className="mt-[2px] text-[11px] uppercase tracking-[0.24em]"
                style={{ fontFamily: LABEL_FONT, fontWeight: 700, color: mutedTextColor }}
              >
                {safeUpper(row.label)}
              </div>
              </div>
          ))}
        </div>
        <div className="px-4 pt-[9px] pb-[9px] border-t text-center" style={{ borderColor: isWhiteMode ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.1)' }}>
          <div className="inline-flex items-end justify-center whitespace-nowrap leading-none" style={{ gap: recordGap }}>
            <span
              className="uppercase tracking-[0.2em]"
              style={{
                display: 'inline-block',
                fontSize: recordLabelSize,
                fontFamily: LABEL_FONT,
                fontWeight: 700,
                lineHeight: 1.15,
                color: isWhiteMode ? 'rgba(15,23,42,0.56)' : 'rgba(255,255,255,0.56)',
              }}
            >
              RECORD
            </span>
            <span
              className="whitespace-nowrap"
              style={{
                display: 'inline-block',
                fontSize: recordValueSize,
                lineHeight: 1,
                fontFamily: HEAD_FONT,
                fontWeight: 700,
                color: mainTextColor,
              }}
            >
              {recordText}
            </span>
          </div>
        </div>
      </div>

      <div className="absolute left-7 right-7 top-[900px] h-px" style={{ background: softLineColor }} />
      <div className="absolute left-0 right-0 top-[906px] flex justify-center">
        <img
          src="/logo.png"
          alt="Courtsight"
          className="h-9 w-auto"
          style={{
            filter: isWhiteMode ? 'brightness(0) saturate(100%)' : 'none',
            opacity: isWhiteMode ? 0.8 : 0.94,
          }}
        />
      </div>
    </div>
  );
};

export default StatsShareCard;

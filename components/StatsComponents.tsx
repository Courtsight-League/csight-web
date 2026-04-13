import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Team, Game, PlayerStats } from '../types';
import { Crown, PlayCircle } from 'lucide-react';
import { formatDisplayTime, formatScheduleDateLabel } from '../utils/time';

const fallbackLogo = (name: string) =>
  `https://ui-avatars.com/api/?background=111827&color=10b981&name=${encodeURIComponent(name || 'Team')}`;

const playerInitials = (name?: string | null) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'P';

const teamPath = (teamId?: string | null) => (teamId ? `/team/${teamId}` : '#');

const deriveNavigationLabel = (path: string) => {
  if (path.includes('/stats')) return 'Stats';
  if (path.includes('/team')) return 'Team';
  if (path.includes('/my-team')) return 'My Team';
  if (path.includes('/admin')) return 'Admin';
  return 'Back';
};

const normalizeGameStatus = (status?: string | null) => {
  const normalized = (status || 'SCHEDULED').toString().trim().toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'FINAL') return 'COMPLETED';
  if (normalized === 'CANCELLED') return 'CANCELED';
  return normalized || 'SCHEDULED';
};

const getScoreStatusMeta = (status?: string | null): { label: string; className: string } => {
  const normalized = normalizeGameStatus(status);
  if (normalized === 'FORFEITED') {
    return { label: 'FORFEITED', className: 'bg-amber-500/20 text-amber-300' };
  }
  if (normalized === 'CANCELED') {
    return { label: 'CANCELED', className: 'bg-gray-600/30 text-gray-300' };
  }
  return { label: 'FINAL', className: 'bg-white/10 text-white' };
};

// --- STANDINGS TABLE ---
export const StandingsTable: React.FC<{ teams: Team[] }> = ({ teams }) => {
  // Sort by points (Win=2, Loss=0 just for mock logic, actual request said Win=3, Tie=1)
  // Let's implement specific sorting: Wins desc, then Point Diff
  const sortedTeams = [...teams].sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    return (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
  });

  return (
    <div className="overflow-x-auto bg-brand-dark rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-900 text-brand-grey font-sports uppercase tracking-wider">
          <tr>
            <th className="p-4">Team</th>
            <th className="p-4 text-center">GP</th>
            <th className="p-4 text-center">W</th>
            <th className="p-4 text-center">L</th>
            <th className="p-4 text-center">T</th>
            <th className="p-4 text-center">PF</th>
            <th className="p-4 text-center">PA</th>
            <th className="p-4 text-center">DIFF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-white">
          {sortedTeams.map((team) => (
            <tr key={team.id} className="hover:bg-white/5 transition-colors">
              <td className="p-4 font-medium flex items-center gap-3">
                <img src={team.logoUrl || fallbackLogo(team.name)} alt={team.name} className="w-8 h-8 rounded-full bg-gray-800" />
                <Link to={`/team/${team.id}`} className="hover:text-brand-lime transition-colors">
                  {team.name}
                </Link>
              </td>
              <td className="p-4 text-center">{team.wins + team.losses + team.ties}</td>
              <td className="p-4 text-center text-brand-lime font-bold">{team.wins}</td>
              <td className="p-4 text-center">{team.losses}</td>
              <td className="p-4 text-center">{team.ties}</td>
              <td className="p-4 text-center">{team.pointsFor}</td>
              <td className="p-4 text-center">{team.pointsAgainst}</td>
              <td className={`p-4 text-center font-bold ${team.pointsFor - team.pointsAgainst > 0 ? 'text-green-500' : 'text-red-500'}`}>
                {team.pointsFor - team.pointsAgainst > 0 ? '+' : ''}{team.pointsFor - team.pointsAgainst}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// --- SCHEDULE / SCORES LIST ---
type GameListVariant = 'default' | 'history';
type GameListProps = {
  games: Game[];
  teams: Team[];
  showScores: boolean;
  variant?: GameListVariant;
  centerVs?: boolean;
  boxScoreReturnLabel?: string;
};

export const GameList: React.FC<GameListProps> = ({
  games,
  teams,
  showScores,
  variant = 'default',
  centerVs = false,
  boxScoreReturnLabel,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const getTeam = (id: string) => teams.find(t => t.id === id);

  const formatDate = (dateStr: string) => {
    return (
      formatScheduleDateLabel(dateStr, { month: 'short', day: 'numeric', weekday: 'short' }) ||
      dateStr ||
      ''
    );
  };
  const historyMode = variant === 'history';

  const returnPath = `${location.pathname}${location.search}`;
  const returnLabel = boxScoreReturnLabel || deriveNavigationLabel(returnPath);
  const getBoxScoreState = () => ({
    returnPath,
    returnLabel,
  });

  const goToBoxScore = (gameId: string) =>
    navigate(`/boxscore/${gameId}`, { state: getBoxScoreState() });

  const TeamBlock: React.FC<{
    team: Team;
    score?: number;
    showScore?: boolean;
    isWinner?: boolean;
  }> = ({ team, score, showScore = false, isWinner = false }) => (
    <div className="flex flex-col items-center gap-2">
      <Link
        to={teamPath(team.id)}
        onClick={(e) => {
          e.stopPropagation();
        }}
        className="group outline-none focus-visible:ring-2 focus-visible:ring-brand-lime rounded-full"
        aria-label={`View ${team.name} profile`}
      >
        <img
          src={team.logoUrl || fallbackLogo(team.name)}
          alt={team.name}
          className="w-14 h-14 rounded-full mb-1 bg-gray-900 border border-white/10 shadow-inner transition duration-200 ease-out group-hover:-translate-y-1 group-hover:scale-105"
        />
      </Link>
      <Link
        to={teamPath(team.id)}
        onClick={(e) => e.stopPropagation()}
        className="text-center font-sports text-base md:text-lg leading-tight hover:text-brand-lime transition-colors flex items-center gap-1"
      >
        {isWinner ? <Crown size={12} className="text-amber-300" /> : null}
        {team.name}
      </Link>
      {isWinner ? <span className="text-[10px] uppercase tracking-[0.2em] text-amber-300">Winner</span> : null}
      {showScore && score !== undefined && (
        <span className="text-2xl font-bold mt-2">{score}</span>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      {games.map((game) => {
        const home = getTeam(game.homeTeamId);
        const away = getTeam(game.awayTeamId);
        if (!home || !away) return null;
        const scoreStatusMeta = getScoreStatusMeta(game.status);
        const normalizedStatus = normalizeGameStatus(game.status);
        const isForfeited = normalizedStatus === 'FORFEITED';
        const showNumericScores = showScores && normalizedStatus === 'COMPLETED';
        const winnerTeamId = isForfeited
          ? game.homeScore != null && game.awayScore != null
            ? game.homeScore > game.awayScore
              ? game.homeTeamId
              : game.awayScore > game.homeScore
                ? game.awayTeamId
                : null
            : null
          : null;

        return (
          <div
            key={game.id}
            onClick={() => showScores && goToBoxScore(game.id)}
            className={`bg-brand-dark border border-white/10 rounded-xl p-4 gap-4 hover:border-brand-lime/50 transition-colors ${
              showScores ? 'cursor-pointer' : ''
            } ${historyMode ? 'grid md:grid-cols-[220px_1fr_180px]' : 'flex flex-col md:flex-row md:items-center'}`}
          >
            {/* Date & Location */}
            <div
              className={`flex flex-col text-xs font-mono gap-1 ${
                historyMode ? 'text-brand-grey md:text-sm md:pr-6' : 'w-full md:w-32 text-brand-grey md:text-sm'
              }`}
            >
              <span className="text-white font-semibold">{formatDate(game.date)}</span>
              <span className="font-semibold text-white text-[13px]">{formatDisplayTime(game.time)}</span>
              <span className="text-[11px] text-brand-grey">{game.location}</span>
            </div>

            {historyMode ? (
              <>
                <div className="flex flex-row items-center justify-between w-full gap-6">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <TeamBlock
                      team={home}
                      score={game.homeScore}
                      showScore={showNumericScores}
                      isWinner={winnerTeamId === game.homeTeamId}
                    />
                  </div>
                  <div className="flex flex-col items-center gap-2 text-center text-brand-grey font-sports italic">
                    {showScores ? (
                      <span className={`px-3 py-1 rounded text-[11px] not-italic font-bold ${scoreStatusMeta.className}`}>
                        {scoreStatusMeta.label}
                      </span>
                    ) : (
                      <span className="tracking-[0.3em] text-2xl">VS</span>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-3 text-center">
                    <TeamBlock
                      team={away}
                      score={game.awayScore}
                      showScore={showNumericScores}
                      isWinner={winnerTeamId === game.awayTeamId}
                    />
                  </div>
                </div>
                {showScores && (
                  <div className="flex items-center justify-center mt-4">
                    <div className="flex flex-col items-center gap-3">
                      <button
                      onClick={(e) => {
                        e.stopPropagation();
                        goToBoxScore(game.id);
                      }}
                        className="text-sm uppercase tracking-wider border border-white/20 hover:border-brand-lime hover:text-brand-lime px-4 py-2 rounded font-bold"
                      >
                        Box Score
                      </button>
                      {game.youtubeLink && (
                        <a
                          href={game.youtubeLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm uppercase tracking-wider border border-brand-red/30 hover:border-brand-red hover:text-brand-red px-4 py-2 rounded font-bold"
                        >
                          Watch
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col md:flex-row items-center gap-4 w-full">
                  <div
                    className={`flex-1 ${centerVs ? 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center' : 'flex flex-row items-center justify-between gap-6'} border border-white/10 rounded-2xl bg-black/40 px-6 py-4 w-full`}
                  >
                    {centerVs ? (
                      <>
                        <div className="flex items-center justify-center">
                          <TeamBlock
                            team={home}
                            score={game.homeScore}
                            showScore={showNumericScores}
                            isWinner={winnerTeamId === game.homeTeamId}
                          />
                        </div>
                        <div className="flex items-center justify-center">
                          {showScores ? (
                            <span className={`px-3 py-1 rounded text-[11px] not-italic font-bold ${scoreStatusMeta.className}`}>
                              {scoreStatusMeta.label}
                            </span>
                          ) : (
                            <span className="text-brand-grey text-3xl font-sports italic">VS</span>
                          )}
                        </div>
                        <div className="flex items-center justify-center">
                          <TeamBlock
                            team={away}
                            score={game.awayScore}
                            showScore={showNumericScores}
                            isWinner={winnerTeamId === game.awayTeamId}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <TeamBlock
                          team={home}
                          score={game.homeScore}
                          showScore={showNumericScores}
                          isWinner={winnerTeamId === game.homeTeamId}
                        />
                        {showScores ? (
                          <span className={`px-3 py-1 rounded text-[11px] not-italic font-bold ${scoreStatusMeta.className}`}>
                            {scoreStatusMeta.label}
                          </span>
                        ) : (
                          <span className="text-brand-grey text-3xl font-sports italic">VS</span>
                        )}
                        <TeamBlock
                          team={away}
                          score={game.awayScore}
                          showScore={showNumericScores}
                          isWinner={winnerTeamId === game.awayTeamId}
                        />
                      </>
                    )}
                  </div>
                  {showScores && (
                    <div className="flex w-full md:w-auto flex-row md:flex-col items-center gap-3 justify-center">
                      <button
                      onClick={(e) => {
                        e.stopPropagation();
                        goToBoxScore(game.id);
                      }}
                        className="text-sm uppercase tracking-wider border border-white/20 hover:border-brand-lime hover:text-brand-lime px-4 py-2 rounded font-bold"
                      >
                        Box Score
                      </button>
                      {game.youtubeLink && (
                        <a
                          href={game.youtubeLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm uppercase tracking-wider border border-brand-red/30 hover:border-brand-red hover:text-brand-red px-4 py-2 rounded font-bold"
                        >
                          Watch
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

// --- LEADERS TABLE ---
export const LeadersTable: React.FC<{ stats: PlayerStats[], category: keyof PlayerStats, label: string }> = ({ stats, category, label }) => {
  const sorted = [...stats].sort((a, b) => (b[category] as number) - (a[category] as number));
  // Keep only the top 5 unique players by name+team to avoid duplicates
  const unique: PlayerStats[] = [];
  const seen = new Set<string>();
  for (const p of sorted) {
    const id = `${(p.playerName || '').toLowerCase()}-${(p.teamName || '').toLowerCase()}`;
    if (!seen.has(id)) {
      seen.add(id);
      unique.push({
        ...p,
        playerName: p.playerName || `Player ${id?.slice(0, 6)}`,
      });
    }
    if (unique.length >= 5) break;
  }

  const colors = ['bg-gradient-to-r from-brand-lime/20 to-transparent', 'bg-white/5', 'bg-white/5', 'bg-white/5', 'bg-white/5'];
  const location = useLocation();
  const playerReturnPath = `${location.pathname}${location.search}`;
  const playerReturnLabel = deriveNavigationLabel(playerReturnPath);
  const playerLinkState = {
    returnPath: playerReturnPath,
    returnLabel: playerReturnLabel,
  };

  return (
    <div className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-lg">
      <div className="bg-gradient-to-r from-white/10 to-transparent p-4 border-b border-white/5 flex items-center justify-between">
        <h3 className="font-sports text-white uppercase tracking-wide flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime"></span>
          {label}
        </h3>
        <span className="text-[11px] uppercase text-brand-grey">Top 5</span>
      </div>
      <div className="divide-y divide-white/5">
        {unique.map((player, idx) => (
          <div
            key={player.playerId}
            className={`flex items-center justify-between px-4 py-3 ${colors[idx]}`}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                {player.avatarUrl ? (
                  <img
                    src={player.avatarUrl}
                    alt={player.playerName}
                    className={`w-9 h-9 rounded-full border object-cover ${idx === 0 ? 'border-brand-lime/60' : 'border-white/10'}`}
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                      const fallback = event.currentTarget.nextElementSibling as HTMLDivElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className={`w-9 h-9 rounded-full border items-center justify-center text-[11px] font-bold uppercase ${idx === 0 ? 'border-brand-lime/60 bg-brand-lime/10 text-brand-lime' : 'border-white/10 bg-black/30 text-gray-200'} ${player.avatarUrl ? 'hidden' : 'flex'}`}
                >
                  {playerInitials(player.playerName)}
                </div>
                <div className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-brand-dark text-[10px] font-bold ${idx === 0 ? 'bg-brand-lime text-black' : 'bg-black/80 text-gray-300'}`}>
                  {idx + 1}
                </div>
              </div>
              <div>
                {player.playerId ? (
                  <Link
                    to={`/player/${player.playerId}`}
                    state={playerLinkState}
                    className="block text-white font-semibold leading-tight hover:text-brand-lime transition-colors"
                  >
                    {player.playerName}
                  </Link>
                ) : (
                  <div className="block text-white font-semibold leading-tight">{player.playerName}</div>
                )}
                {player.teamId ? (
                  <Link
                    to={teamPath(player.teamId)}
                    className="mt-0.5 block text-[11px] text-brand-grey hover:text-brand-lime transition-colors"
                  >
                    {player.teamName}
                  </Link>
                ) : (
                  <div className="mt-0.5 block text-[11px] text-brand-grey">{player.teamName}</div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-sports font-bold text-white">{player[category].toFixed ? (player[category] as number).toFixed(1) : player[category]}</div>
              <div className="text-[10px] text-brand-grey uppercase tracking-wide">{label.split(' ')[0]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

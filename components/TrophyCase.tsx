import React from 'react';
import { Award, Trophy, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PlayerTrophyCategoryKey, TrophyTierName } from '../types';

const formatDateLabel = (value?: string) => {
  if (!value) return 'Date TBD';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date TBD';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Date TBD';
  }
};

export type PlayerTrophyTierStatus = {
  tier: TrophyTierName;
  threshold: number;
  unlocked: boolean;
  unlockedAt?: string;
};

export type PlayerTrophyCategoryView = {
  category: PlayerTrophyCategoryKey;
  label: string;
  total: number;
  tiers: PlayerTrophyTierStatus[];
  highestUnlocked?: PlayerTrophyTierStatus;
  nextTier?: {
    tier: TrophyTierName;
    threshold: number;
    remaining: number;
    progress: number;
  };
};

export type PlayerAwardView = {
  trophy: string;
  playerName: string;
  playerId?: string;
  teamId?: string;
  teamName?: string;
  assignedAt?: string;
  note?: string;
};

export type TeamTrophyDetail = {
  trophyName: string;
  teamName: string;
  teamId?: string;
  statLabel?: string;
  statValue?: string;
  date?: string;
  assignedByAdmin?: boolean;
  note?: string;
};

export type TeamTrophySlots = {
  champion?: TeamTrophyDetail;
  bestOffense?: TeamTrophyDetail;
  bestDefense?: TeamTrophyDetail;
  niceGuys?: TeamTrophyDetail;
};

type PlayerTrophyBoardProps = {
  categories: PlayerTrophyCategoryView[];
  awards: PlayerAwardView[];
  loading?: boolean;
};

export const PlayerTrophyBoard: React.FC<PlayerTrophyBoardProps> = ({ categories, awards, loading }) => (
  <div className="bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
    <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-brand-grey">Player</p>
        <h3 className="text-xl font-sports font-bold text-white">Career Trophies</h3>
      </div>
      <Award className="text-brand-lime h-7 w-7" />
    </div>
    <div className="p-6 space-y-6">
      {loading ? (
        <div className="text-sm text-brand-grey">Fetching trophy history…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categories.map((category) => (
            <div
              key={category.category}
              className="bg-black/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 shadow-inner"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-brand-grey">{category.label}</p>
                  <p className="text-3xl font-sports font-bold text-white">{category.total}</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-brand-lime">
                  {category.highestUnlocked?.tier || 'Locked'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {category.tiers.map((tier) => (
                  <div
                    key={`${category.category}-${tier.tier}`}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full border text-[10px] uppercase tracking-[0.3em] font-semibold ${
                      tier.unlocked
                        ? 'border-brand-lime bg-brand-lime/10 text-white'
                        : 'border-white/10 text-brand-grey'
                    }`}
                  >
                    <span>{tier.tier}</span>
                    {tier.unlocked && (
                      <span className="text-[8px] text-brand-lime/80">{formatDateLabel(tier.unlockedAt)}</span>
                    )}
                  </div>
                ))}
              </div>
              {category.nextTier && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] uppercase text-brand-grey">
                    <span>
                      Next milestone: {category.nextTier.tier} ({category.nextTier.threshold})
                    </span>
                    <span>{Math.round(category.nextTier.progress * 100)}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-lime to-brand-lime/80"
                      style={{ width: `${Math.min(category.nextTier.progress * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {category.nextTier.remaining > 0
                      ? `${category.nextTier.remaining} more to unlock`
                      : 'Ready to unlock this tier'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-brand-grey">
          <Sparkles className="w-4 h-4" />
          <span>Assigned awards</span>
        </div>
        {awards.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {awards.map((award) => (
              <div
                key={`${award.playerName}-${award.trophy}`}
                className="rounded-2xl border border-white/5 bg-black/30 p-3 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <Award className="text-brand-lime w-5 h-5" />
                  <div>
                    <p className="text-sm font-sports font-bold uppercase tracking-[0.25em] text-white">
                      {award.trophy}
                    </p>
                    <p className="text-[11px] text-brand-grey">
                      {award.playerId ? (
                        <Link to={`/player/${award.playerId}`} className="hover:text-brand-lime transition-colors">
                          {award.playerName}
                        </Link>
                      ) : (
                        award.playerName
                      )}
                      {award.teamName ? ' · ' : ''}
                      {award.teamName ? (
                        award.teamId ? (
                          <Link to={`/team/${award.teamId}`} className="hover:text-brand-lime transition-colors">
                            {award.teamName}
                          </Link>
                        ) : (
                          award.teamName
                        )
                      ) : null}
                    </p>
                  </div>
                </div>
                {award.assignedAt && (
                  <p className="text-[10px] uppercase tracking-[0.25em] text-brand-lime/80">
                    {formatDateLabel(award.assignedAt)}
                  </p>
                )}
                {award.note && <p className="text-[11px] text-gray-400">{award.note}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No awards assigned for this season yet.</p>
        )}
      </div>
    </div>
  </div>
);

type TeamTrophyBoardProps = {
  slots: TeamTrophySlots;
  loading?: boolean;
};

const slotLabels: Record<keyof TeamTrophySlots, string> = {
  champion: 'Champion Trophy',
  bestOffense: 'Offensive Team of the Year',
  bestDefense: 'Defensive Team of the Year',
  niceGuys: 'The Nice Guys',
};

export const TeamTrophyBoard: React.FC<TeamTrophyBoardProps> = ({ slots, loading }) => {
  const slotOrder: Array<keyof TeamTrophySlots> = ['champion', 'bestOffense', 'bestDefense', 'niceGuys'];
  return (
    <div className="bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-brand-grey">Team</p>
          <h3 className="text-xl font-sports font-bold text-white">Achievement Trophies</h3>
        </div>
        <Trophy className="text-brand-lime h-7 w-7" />
      </div>
      <div className="p-6 space-y-4">
        {loading ? (
          <p className="text-sm text-brand-grey">Gathering team standings…</p>
        ) : (
          slotOrder.map((slotKey) => {
            const detail = slots[slotKey];
            return (
              <div
                key={slotKey}
                className={`rounded-2xl border border-white/10 p-4 ${
                  detail ? 'bg-black/40 shadow-inner' : 'bg-white/5 text-gray-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-brand-grey">{slotLabels[slotKey]}</p>
                  {detail?.assignedByAdmin && (
                    <span className="text-[10px] uppercase tracking-[0.2em] text-brand-lime/90">
                      Admin override
                    </span>
                  )}
                </div>
                {detail ? (
                  <div className="mt-2 space-y-1">
                    {detail.teamId ? (
                      <Link
                        to={`/team/${detail.teamId}`}
                        className="text-lg font-sports font-bold text-white hover:text-brand-lime transition-colors"
                      >
                        {detail.teamName}
                      </Link>
                    ) : (
                      <p className="text-lg font-sports font-bold text-white">{detail.teamName}</p>
                    )}
                    {detail.statLabel && detail.statValue && (
                      <p className="text-[11px] text-brand-grey">
                        {detail.statLabel} · {detail.statValue}
                      </p>
                    )}
                    {detail.note && <p className="text-[11px] text-gray-400">{detail.note}</p>}
                    {detail.date && (
                      <p className="text-[10px] uppercase tracking-[0.3em] text-white/70">
                        {formatDateLabel(detail.date)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-2">No selection made yet for this season.</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

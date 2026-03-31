import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Flame, Heart, MessageCircle, Smile, Trash2 } from 'lucide-react';
import type { User } from '../types';
import type { GameSocialComment, ReactionType } from '../types';
import {
  deleteGameComment,
  fetchGameComments,
  fetchGameReactions,
  hideGameComment,
  postGameComment,
  setGameReaction,
} from '../services/gameSocialService';

type ReactionOption = {
  type: ReactionType;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: string;
};

const REACTION_OPTIONS: ReactionOption[] = [
  { type: 'like', label: 'Like', icon: Heart, accent: 'text-brand-lime' },
  { type: 'fire', label: 'Fire', icon: Flame, accent: 'text-red-500' },
  { type: 'laugh', label: 'Haha', icon: Smile, accent: 'text-yellow-400' },
];

const COOLDOWN_MS = 8500;

const formatTimeAgo = (value: string): string => {
  if (!value) return 'Just now';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Just now';
  const diff = Date.now() - parsed.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) {
    return `${Math.max(1, Math.round(diff / minute))}m ago`;
  }
  if (diff < day) {
    return `${Math.max(1, Math.round(diff / hour))}h ago`;
  }
  return `${Math.max(1, Math.round(diff / day))}d ago`;
};

const getAvatarInitial = (name?: string) => {
  if (!name) return '🤝';
  return name
    .split(' ')
    .map((segment) => segment[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

const emptyCounts: Record<ReactionType, number> = {
  like: 0,
  fire: 0,
  laugh: 0,
};

type GameSocialFeedProps = {
  gameId: string;
  currentUser: User | null;
  isAdmin: boolean;
};

const GameSocialFeed: React.FC<GameSocialFeedProps> = ({ gameId, currentUser, isAdmin }) => {
  const [comments, setComments] = useState<GameSocialComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [lastPostAt, setLastPostAt] = useState(0);
  const [spamWarning, setSpamWarning] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [reactionCounts, setReactionCounts] = useState<Record<ReactionType, number>>(emptyCounts);
  const [userReaction, setUserReaction] = useState<ReactionType | null>(null);

  const visibleComments = useMemo(
    () => comments.filter((comment) => !comment.isHidden || isAdmin),
    [comments, isAdmin]
  );

  const reloadComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const data = await fetchGameComments(gameId);
      setComments(data);
    } catch (err) {
      console.error('Failed to load comments', err);
      setStatusMessage('Unable to load comments.');
    } finally {
      setLoadingComments(false);
    }
  }, [gameId]);

  const reloadReactions = useCallback(async () => {
    try {
      const data = await fetchGameReactions(gameId);
      const counts = { ...emptyCounts };
      let ownReaction: ReactionType | null = null;
      data.forEach((entry) => {
        counts[entry.reaction] = (counts[entry.reaction] ?? 0) + 1;
        if (currentUser && entry.userId === currentUser.id) {
          ownReaction = entry.reaction;
        }
      });
      setReactionCounts(counts);
      setUserReaction(ownReaction);
    } catch (err) {
      console.error('Failed to load reactions', err);
      setStatusMessage('Unable to load reactions.');
    }
  }, [currentUser, gameId]);

  useEffect(() => {
    reloadComments();
    reloadReactions();
  }, [reloadComments, reloadReactions]);

  const handleReact = useCallback(
    async (type: ReactionType) => {
      if (!currentUser) {
        setStatusMessage('Sign in to react.');
        return;
      }

      const nextReaction = userReaction === type ? null : type;
      const prevReaction = userReaction;
      const updatedCounts = { ...reactionCounts };

      if (prevReaction) {
        updatedCounts[prevReaction] = Math.max(0, (updatedCounts[prevReaction] ?? 1) - 1);
      }
      if (nextReaction) {
        updatedCounts[nextReaction] = (updatedCounts[nextReaction] ?? 0) + 1;
      }

      setReactionCounts(updatedCounts);
      setUserReaction(nextReaction);

      try {
        await setGameReaction({ gameId, userId: currentUser.id, reaction: nextReaction });
      } catch (err) {
        console.error('Unable to persist reaction', err);
        setStatusMessage('Unable to save reaction.');
        reloadReactions();
      }
    },
    [currentUser, gameId, reactionCounts, reloadReactions, userReaction]
  );

  const handlePostComment = useCallback(async () => {
    if (!currentUser) {
      setStatusMessage('Sign in to leave a comment.');
      return;
    }
    const now = Date.now();
    if (now < lastPostAt + COOLDOWN_MS) {
      setSpamWarning(`Hold up, try again in ${Math.ceil((lastPostAt + COOLDOWN_MS - now) / 1000)}s.`);
      return;
    }

    setPosting(true);
    setStatusMessage('');
    try {
      const newComment = await postGameComment({
        gameId,
        userId: currentUser.id,
        userName: currentUser.name,
        avatarUrl: currentUser.avatarUrl,
        content: commentDraft,
      });
      setComments((prev) => [newComment, ...prev]);
      setCommentDraft('');
      setLastPostAt(now);
      setSpamWarning('');
      setStatusMessage('Comment posted!');
    } catch (err: any) {
      console.error('Unable to post comment', err);
      setStatusMessage(err?.message || 'Unable to post right now.');
    } finally {
      setPosting(false);
    }
  }, [commentDraft, currentUser, gameId, lastPostAt]);

  const handleHideToggle = useCallback(
    async (comment: GameSocialComment) => {
      try {
        await hideGameComment(comment.id, !comment.isHidden);
        setComments((prev) =>
          prev.map((candidate) =>
            candidate.id === comment.id ? { ...candidate, isHidden: !comment.isHidden } : candidate
          )
        );
      } catch (err) {
        console.error('Unable to update comment visibility', err);
        setStatusMessage('Unable to update that comment.');
      }
    },
    []
  );

  const handleDelete = useCallback(async (comment: GameSocialComment) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await deleteGameComment(comment.id);
      setComments((prev) => prev.filter((candidate) => candidate.id !== comment.id));
    } catch (err) {
      console.error('Unable to delete comment', err);
      setStatusMessage('Unable to delete that comment.');
    }
  }, []);

  const totalReactions = useMemo(
    () => Object.values(reactionCounts).reduce((sum, value) => sum + (value || 0), 0),
    [reactionCounts]
  );

  const cooldownRemaining = Math.max(0, lastPostAt + COOLDOWN_MS - Date.now());

  return (
    <div className="bg-brand-dark border border-white/10 rounded-2xl shadow-2xl p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-brand-grey">Game feed</p>
          <h3 className="text-2xl font-sports text-white flex items-center gap-2">
            <MessageCircle size={20} />
            Live reactions
          </h3>
        </div>
        <div className="text-xs uppercase tracking-[0.4em] text-gray-400">
          {visibleComments.length} comments • {totalReactions} reactions
        </div>
      </div>

      {statusMessage && (
        <div className="text-xs text-white/80 bg-white/5 rounded-full px-3 py-1 inline-flex items-center gap-2">
          {statusMessage}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {REACTION_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = userReaction === option.type;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => handleReact(option.type)}
              disabled={!currentUser}
              aria-pressed={isActive}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] border border-white/10 transition-colors ${
                isActive
                  ? `bg-white/10 border-white/30 ${option.accent} text-white shadow-2xl`
                  : 'text-gray-400 hover:text-white hover:border-brand-lime'
              } ${!currentUser ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Icon className="w-4 h-4" />
              <span>{option.label}</span>
              <span className="text-[10px] text-white/70">{reactionCounts[option.type] || 0}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {loadingComments ? (
          <div className="text-sm text-gray-400">Loading comments...</div>
        ) : visibleComments.length === 0 ? (
          <div className="text-gray-500 text-sm italic">Be the first to drop a note.</div>
        ) : (
          <div className="space-y-3">
            {visibleComments.map((comment) => (
              <div
                key={comment.id}
                className={`rounded-2xl border border-white/5 bg-black/40 p-4 space-y-2 ${
                  comment.isHidden ? 'opacity-70' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full border border-white/10 bg-gray-900 flex items-center justify-center text-xs font-bold text-white">
                    {comment.avatarUrl ? (
                      <img src={comment.avatarUrl} alt={comment.userName} className="w-full h-full object-cover rounded-full" />
                    ) : (
                      getAvatarInitial(comment.userName)
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-white font-semibold text-sm">{comment.userName}</p>
                        <p className="text-[11px] text-gray-500">{formatTimeAgo(comment.createdAt)}</p>
                      </div>
                      {comment.isHidden && (
                        <span className="text-[11px] uppercase tracking-[0.3em] text-yellow-400">Hidden</span>
                      )}
                    </div>
                    <p className="text-white/80 text-sm leading-relaxed mt-2">{comment.content}</p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3 text-[11px] text-gray-400">
                    <button
                      type="button"
                      onClick={() => handleHideToggle(comment)}
                      className="flex items-center gap-1 uppercase tracking-[0.4em] text-white/70 hover:text-white"
                    >
                      {comment.isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                      {comment.isHidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(comment)}
                      className="flex items-center gap-1 uppercase tracking-[0.4em] text-red-500 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-white/10 bg-gray-900 flex items-center justify-center text-xs font-bold text-white">
            {getAvatarInitial(currentUser?.name)}
          </div>
          <div className="flex-1">
            <input
              type="text"
              value={commentDraft}
              onChange={(event) => {
                if (spamWarning) setSpamWarning('');
                setCommentDraft(event.target.value);
              }}
              placeholder={currentUser ? 'Share your take about the game…' : 'Sign in to join the conversation'}
              disabled={!currentUser}
              className="w-full bg-black/20 border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-brand-lime"
            />
          </div>
          <button
            type="button"
            onClick={handlePostComment}
            disabled={!currentUser || posting || !commentDraft.trim()}
            className="rounded-full bg-brand-lime px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Post
          </button>
        </div>
        {spamWarning && (
          <p className="text-[11px] text-yellow-400">{spamWarning}</p>
        )}
        {cooldownRemaining > 0 && currentUser && (
          <p className="text-[11px] text-gray-400">
            Wait {Math.ceil(cooldownRemaining / 1000)}s before posting another comment.
          </p>
        )}
        {!currentUser && (
          <p className="text-[11px] text-gray-500">Members only: sign in to comment or react.</p>
        )}
      </div>
    </div>
  );
};

export default GameSocialFeed;

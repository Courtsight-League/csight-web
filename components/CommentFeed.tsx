import React, { useMemo } from 'react';
import { Heart, Smile } from 'lucide-react';

export type CommentFeedComment = {
  id: string;
  playerName: string;
  avatarUrl?: string;
  text: string;
  createdAt: string;
  likes: number;
  likedByUser?: boolean;
};

type CommentFeedProps = {
  comments: CommentFeedComment[];
  loading?: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onPost: () => void;
  onToggleLike: (commentId: string) => void;
  isMember: boolean;
  currentUserName?: string;
};

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
  if (!name) return '🗨️';
  return name
    .split(' ')
    .map((segment) => segment[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

const CommentFeed: React.FC<CommentFeedProps> = ({
  comments,
  loading,
  inputValue,
  onInputChange,
  onPost,
  onToggleLike,
  isMember,
  currentUserName,
}) => {
  const totalLikes = useMemo(() => comments.reduce((sum, comment) => sum + (comment.likes || 0), 0), [comments]);
  const totalComments = comments.length;

  return (
    <div className={`bg-brand-dark border border-white/10 rounded-2xl shadow-lg ${!isMember ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-brand-grey">Reactions</p>
          <h3 className="text-xl font-sports font-bold text-white tracking-tight">Comment Feed</h3>
        </div>
        <div className="text-[10px] uppercase tracking-[0.4em] text-gray-400">{totalComments} comments</div>
      </div>
      <div className="px-6 py-4 space-y-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.4em] uppercase text-brand-grey">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-lime/20 text-brand-lime font-bold tracking-[0.2em]">
              ❤️ LIKE
            </span>
            <span className="text-white/60">{totalLikes}</span>
          </div>
          {/* <div className="flex items-center gap-1 text-xs font-semibold tracking-[0.4em] text-gray-400">
            <Smile className="w-4 h-4" />
            React
          </div> */}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading comments...</div>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-2xl border border-white/10 bg-black/40 p-4 flex flex-col gap-2 text-white"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full border border-white/10 bg-gray-900 flex items-center justify-center text-xs font-bold text-white">
                    {comment.avatarUrl ? (
                      <img
                        src={comment.avatarUrl}
                        alt={comment.playerName}
                        className="w-full h-full object-cover rounded-full"
                      />
                    ) : (
                      getAvatarInitial(comment.playerName)
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{comment.playerName}</div>
                    <div className="text-[11px] text-gray-400">{formatTimeAgo(comment.createdAt)}</div>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-white/80">{comment.text}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
                      comment.likedByUser ? 'text-brand-lime' : 'text-gray-400'
                    }`}
                    aria-pressed={Boolean(comment.likedByUser)}
                    onClick={() => onToggleLike(comment.id)}
                    disabled={!isMember}
                  >
                    <Heart className={`w-4 h-4 ${comment.likedByUser ? 'text-brand-lime' : 'text-gray-400'}`} />
                    <span>{comment.likes}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-white/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full border border-white/10 bg-gray-900 text-center text-xs font-semibold text-white flex items-center justify-center">
            {getAvatarInitial(currentUserName)}
          </div>
          <div className="flex-1">
            <input
              type="text"
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder={isMember ? 'Write a comment…' : 'Sign in to leave a comment'}
              disabled={!isMember}
              className="w-full bg-black/20 border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-brand-lime"
            />
          </div>
          <button
            type="button"
            onClick={onPost}
            disabled={!isMember || !inputValue.trim()}
            className="rounded-full bg-brand-lime px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Post
          </button>
        </div>
        {!isMember && (
          <p className="mt-2 text-[11px] text-gray-500">Members only: sign in to comment or react.</p>
        )}
      </div>
    </div>
  );
};

export default CommentFeed;

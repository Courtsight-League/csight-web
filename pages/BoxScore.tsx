import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Flame, Laugh, ThumbsUp, Trash2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { createNotifications } from '../services/notificationService';
import { getStoredUser } from '../services/authService';
import LoadingOverlay from '../components/LoadingOverlay';
import { Role, User } from '../types';

type TeamLite = {
  id: string;
  name: string;
  logoUrl?: string;
};

type StatRow = {
  id: string;
  playerId: string;
  teamId: string;
  playerName: string;
  jerseyNumber?: string | number | null;
  isGuest?: boolean;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  turnovers: number;
};

type CommentRow = {
  id: string;
  body: string;
  gameId: string;
  userId: string | null;
  displayName: string;
  avatarUrl?: string | null;
  role?: string | null;
  likes: number;
  isHidden?: boolean;
  createdAt: string;
};

const TEAM_ASSET_BUCKET = 'team-assets';
const COMMENT_REACTIONS_TABLE = 'box_score_comment_reactions';

const COMMENT_REACTION_OPTIONS = [
  {
    type: 'like',
    label: 'Like',
    icon: ThumbsUp,
    selectedClass:
      'border-brand-lime bg-gradient-to-br from-brand-lime/70 to-brand-lime/90 text-black shadow-[0_0_12px_rgba(212,255,0,0.8)]',
  },
  {
    type: 'fire',
    label: 'Fire',
    icon: Flame,
    selectedClass:
      'border-orange-400 bg-gradient-to-br from-orange-300/80 to-orange-500/90 text-black shadow-[0_0_12px_rgba(251,146,60,0.75)]',
  },
  {
    type: 'laugh',
    label: 'Laugh',
    icon: Laugh,
    selectedClass:
      'border-sky-400 bg-gradient-to-br from-sky-300/80 to-cyan-500/85 text-black shadow-[0_0_12px_rgba(56,189,248,0.75)]',
  },
] as const;

type CommentReactionType = (typeof COMMENT_REACTION_OPTIONS)[number]['type'];
type ReactionCountMap = Record<CommentReactionType, number>;

const EMPTY_REACTION_COUNTS: ReactionCountMap = {
  like: 0,
  fire: 0,
  laugh: 0,
};

const isCommentReactionType = (value: string): value is CommentReactionType =>
  COMMENT_REACTION_OPTIONS.some((option) => option.type === value);

const mapAdminRoleToEnum = (role?: string | null): Role | null => {
  if (!role) return null;
  const normalized = String(role).toLowerCase();
  if (normalized.includes('full')) return Role.ADMIN_FULL;
  if (normalized.includes('commission')) return Role.ADMIN_COMMISSIONER;
  if (normalized.includes('score')) return Role.ADMIN_SCOREKEEPER;
  if (normalized.includes('media')) return Role.ADMIN_MEDIA;
  if (normalized.includes('member')) return Role.MEMBER;
  return null;
};

const resolveRole = (role?: string | null): Role => mapAdminRoleToEnum(role) || Role.MEMBER;

const parseNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatPercent = (made: number, att: number) => {
  if (!att) return '0%';
  return `${((made / att) * 100).toFixed(1)}%`;
};

const sortByJersey = (list: StatRow[]) =>
  [...list].sort((a, b) => {
    const numA = parseInt(String(a.jerseyNumber || '').replace(/\D/g, ''), 10);
    const numB = parseInt(String(b.jerseyNumber || '').replace(/\D/g, ''), 10);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
    if (!Number.isNaN(numA)) return -1;
    if (!Number.isNaN(numB)) return 1;
    return a.playerName.localeCompare(b.playerName);
  });

const teamPath = (teamId?: string | null) => (teamId ? `/team/${teamId}` : '#');

const normalizeGameStatus = (status?: string | null) => {
  const normalized = (status || 'SCHEDULED').toString().trim().toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'FINAL') return 'COMPLETED';
  if (normalized === 'CANCELLED') return 'CANCELED';
  return normalized || 'SCHEDULED';
};

type ReturnNavigationState = {
  returnPath?: string;
  returnLabel?: string;
};

const BoxScore: React.FC = () => {
  const { gameId } = useParams();
  const location = useLocation();
  const boxScoreReturnState = (location.state as ReturnNavigationState) || null;
  const backPath = boxScoreReturnState?.returnPath || '/stats?tab=scores';
  const backLabel = boxScoreReturnState?.returnLabel || 'Scores';
  const playerLinkState = boxScoreReturnState || undefined;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<any | null>(null);
  const [teams, setTeams] = useState<Record<string, TeamLite>>({});
  const [stats, setStats] = useState<StatRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isCommentSending, setIsCommentSending] = useState(false);
  const [lastCommentAt, setLastCommentAt] = useState(0);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [supportsCommentReactions, setSupportsCommentReactions] = useState(true);
  const [reactionCountsByComment, setReactionCountsByComment] = useState<
    Record<string, ReactionCountMap>
  >({});
  const [userReactionByComment, setUserReactionByComment] = useState<
    Record<string, CommentReactionType | null>
  >({});
  const [supportsCommentHide, setSupportsCommentHide] = useState(true);
  const [pendingDeleteComment, setPendingDeleteComment] = useState<CommentRow | null>(null);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);

  const RATE_LIMIT_MS = 7000;

  const isFullAdmin = currentUser?.role === Role.ADMIN_FULL;

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!gameId) {
        setError('Missing game.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data: gameRow, error: gameErr } = await supabase
          .from('games')
          .select('*')
          .eq('id', gameId)
          .maybeSingle();
        if (gameErr) throw gameErr;
        if (!gameRow) {
          throw new Error('Game not found.');
        }

        const signLogo = async (path?: string | null) => {
          if (!path) return '';
          if (path.startsWith('http')) return path;
          const marker = 'team-assets/';
          const idx = path.indexOf(marker);
          const bucketPath = idx >= 0 ? path.slice(idx + marker.length) : path;
          try {
            const { data, error } = await supabase.storage
              .from('team-assets')
              .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
            if (error) throw error;
            return data?.signedUrl || path;
          } catch {
            return path;
          }
        };

        const teamIds = [gameRow.home_team_id, gameRow.away_team_id].filter(Boolean);
        const { data: teamRows } = await supabase
          .from('teams')
          .select('id,name,logo_url')
          .in('id', teamIds);
        const teamMap: Record<string, TeamLite> = {};
        if (teamRows) {
          for (const t of teamRows as any[]) {
            teamMap[t.id] = {
              id: t.id,
              name: t.name,
              logoUrl: await signLogo(t.logo_url),
            };
          }
        }

        const { data: statRows, error: statErr } = await supabase
          .from('game_stats')
          .select('*')
          .eq('game_id', gameId);
        if (statErr) throw statErr;
        const { data: guestRows } = await supabase
          .from('game_guest_players')
          .select('id,name,jersey_number,team_id')
          .eq('game_id', gameId);
        const guestMap = new Map(
          (guestRows || []).map((g: any) => [
            g.id,
            {
              name: String(g.name || '').trim() || 'Guest Player',
              jersey: g.jersey_number ?? null,
              teamId: g.team_id ?? null,
            },
          ])
        );

        const playerIds = Array.from(
          new Set((statRows || []).map((row: any) => row.player_id).filter(Boolean))
        );
        const { data: playerRows } = await supabase
          .from('players')
          .select('id,first_name,last_name,jersey_number,team_id')
          .in('id', playerIds);
        const playerMap = new Map(
          (playerRows || []).map((p: any) => [
            p.id,
            {
              name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Player',
              jersey: p.jersey_number ?? null,
              teamId: p.team_id ?? null,
            },
          ])
        );

        const mappedStats: StatRow[] = (statRows || []).map((row: any) => {
          const guest = guestMap.get(row.player_id);
          const player = playerMap.get(row.player_id);
          const orebRaw =
            row.offensive_rebounds ?? row.oreb ?? row.off_rebounds ?? null;
          const drebRaw =
            row.defensive_rebounds ?? row.dreb ?? row.def_rebounds ?? null;
          const hasSplit =
            orebRaw !== null || drebRaw !== null;
          const baseReb = row.rebounds ?? row.reb ?? 0;
          const reb = hasSplit ? parseNumber(orebRaw) + parseNumber(drebRaw) : parseNumber(baseReb);
          return {
            id: row.id?.toString() || `${row.game_id}-${row.player_id}`,
            playerId: row.player_id,
            teamId: row.team_id || guest?.teamId || player?.teamId || '',
            playerName: guest?.name || player?.name || 'Player',
            jerseyNumber: guest?.jersey ?? player?.jersey ?? null,
            isGuest: !!guest,
            pts: parseNumber(row.points),
            reb,
            ast: parseNumber(row.assists),
            stl: parseNumber(row.steals),
            blk: parseNumber(row.blocks),
            fgm: parseNumber(row.fgm),
            fga: parseNumber(row.fga),
            tpm: parseNumber(row.tpm),
            tpa: parseNumber(row.tpa),
            ftm: parseNumber(row.ftm),
            fta: parseNumber(row.fta),
            turnovers: parseNumber(row.turnovers),
          };
        });

        if (active) {
          setGame(gameRow);
          setTeams(teamMap);
          setStats(mappedStats);
        }
      } catch (err: any) {
        console.error('Box score load error', err);
        if (active) setError(err?.message || 'Unable to load box score.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [gameId]);

  const loadUserLikes = useCallback(
    async (commentIds: string[]) => {
      if (!currentUser || !commentIds.length) {
        const empty = new Set<string>();
        setUserLikes(empty);
        return empty;
      }
      try {
        const { data, error } = await supabase
          .from('box_score_comment_likes')
          .select('comment_id')
          .eq('user_id', currentUser.id)
          .in('comment_id', commentIds);
        if (error) throw error;
        const likedSet = new Set((data || []).map((row: any) => row.comment_id));
        setUserLikes(likedSet);
        return likedSet;
      } catch (err) {
        console.error('Like lookup failed', err);
        const empty = new Set<string>();
        setUserLikes(empty);
        return empty;
      }
    },
    [currentUser]
  );

  const loadCommentReactions = useCallback(
    async (commentRows: CommentRow[], likedCommentIds: Set<string>) => {
      const commentIds = commentRows.map((comment) => comment.id);
      if (!commentIds.length) {
        setReactionCountsByComment({});
        setUserReactionByComment({});
        return;
      }

      const applyLegacyLikeFallback = () => {
        const fallbackCounts: Record<string, ReactionCountMap> = {};
        const fallbackUserReactions: Record<string, CommentReactionType | null> = {};
        commentRows.forEach((comment) => {
          fallbackCounts[comment.id] = {
            ...EMPTY_REACTION_COUNTS,
            like: comment.likes || 0,
          };
          fallbackUserReactions[comment.id] = likedCommentIds.has(comment.id) ? 'like' : null;
        });
        setReactionCountsByComment(fallbackCounts);
        setUserReactionByComment(fallbackUserReactions);
      };

      try {
        const { data, error } = await supabase
          .from(COMMENT_REACTIONS_TABLE)
          .select('comment_id,user_id,reaction')
          .in('comment_id', commentIds);
        if (error) throw error;

        const countsByComment: Record<string, ReactionCountMap> = {};
        const userReactions: Record<string, CommentReactionType | null> = {};

        commentIds.forEach((commentId) => {
          countsByComment[commentId] = { ...EMPTY_REACTION_COUNTS };
          userReactions[commentId] = null;
        });

        (data || []).forEach((row: any) => {
          if (!isCommentReactionType(row.reaction)) return;
          const commentId = row.comment_id as string;
          if (!countsByComment[commentId]) {
            countsByComment[commentId] = { ...EMPTY_REACTION_COUNTS };
          }
          countsByComment[commentId][row.reaction] =
            (countsByComment[commentId][row.reaction] || 0) + 1;
          if (currentUser && row.user_id === currentUser.id) {
            userReactions[commentId] = row.reaction;
          }
        });

        setSupportsCommentReactions(true);
        setReactionCountsByComment(countsByComment);
        setUserReactionByComment(userReactions);
      } catch (err: any) {
        const message = String(err?.message || '');
        const code = String(err?.code || '');
        const missingTable =
          code === 'PGRST205' ||
          code === '42P01' ||
          /does not exist/i.test(message) ||
          /could not find the table/i.test(message);

        if (missingTable) {
          setSupportsCommentReactions(false);
          applyLegacyLikeFallback();
          return;
        }

        console.error('Comment reaction load failed', err);
        applyLegacyLikeFallback();
      }
    },
    [currentUser]
  );

  const loadSocialData = useCallback(async () => {
    if (!gameId) return;
    try {
      const { data: commentRows, error: commentError } = await supabase
        .from('box_score_comments')
        .select('*')
        .eq('game_id', gameId)
        .order('created_at', { ascending: true });
      if (commentError) throw commentError;
      const commentsList: CommentRow[] = (commentRows || []).map((row: any) => ({
        id: row.id,
        body: row.body,
        gameId: row.game_id,
        userId: row.user_id ?? null,
        displayName: row.display_name || 'Player',
        likes: row.likes ?? 0,
        isHidden: !!row.is_hidden,
        createdAt: row.created_at,
      }));
      const userIds = Array.from(new Set(commentsList.map((c) => c.userId).filter(Boolean)));
      const profileMap: Record<
        string,
        { display_name?: string | null; email?: string | null; avatar_url?: string | null }
      > = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id,display_name,email,avatar_url')
          .in('user_id', userIds);
        for (const profile of profiles || []) {
          profileMap[profile.user_id] = profile;
        }
      }

      const stripQuery = (value: string) => value.split('?')[0];
      const resolveBucketPath = (path: string) => {
        const clean = stripQuery(path);
        const marker = `${TEAM_ASSET_BUCKET}/`;
        const idx = clean.indexOf(marker);
        return idx >= 0 ? clean.slice(idx + marker.length) : clean;
      };
      const avatarPathSet = new Set<string>();
      Object.values(profileMap).forEach((profile) => {
        const raw = (profile?.avatar_url || '').trim();
        if (!raw) return;
        // If it's a public URL not in our bucket, just use it as-is.
        if (raw.startsWith('http') && !raw.includes(TEAM_ASSET_BUCKET)) return;
        avatarPathSet.add(resolveBucketPath(raw));
      });
      const signedAvatarMap: Record<string, string> = {};
      await Promise.all(
        Array.from(avatarPathSet).map(async (bucketPath) => {
          if (!bucketPath) return;
          try {
            const { data, error } = await supabase.storage
              .from(TEAM_ASSET_BUCKET)
              .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
            if (!error && data?.signedUrl) {
              signedAvatarMap[bucketPath] = data.signedUrl;
            }
          } catch {
            // ignore
          }
        })
      );

      const emailList = Array.from(
        new Set(Object.values(profileMap).map((p) => p.email).filter(Boolean))
      ) as string[];
      const adminMap: Record<string, string> = {};
      if (emailList.length) {
        const { data: adminRows } = await supabase
          .from('admin_users')
          .select('email,role')
          .in('email', emailList);
        for (const admin of adminRows || []) {
          if (admin.email) {
            adminMap[admin.email.toLowerCase()] = admin.role || 'ADMIN';
          }
        }
      }
      const enrichedComments = commentsList.map((comment) => {
        const profile = profileMap[comment.userId || ''];
        const email = (profile?.email || '').toLowerCase();
        const rawAvatar = (profile?.avatar_url || '').trim();
        let avatarUrl: string | null = null;
        if (rawAvatar) {
          if (rawAvatar.startsWith('http') && !rawAvatar.includes(TEAM_ASSET_BUCKET)) {
            avatarUrl = rawAvatar;
          } else if (rawAvatar.startsWith('http') && rawAvatar.includes(TEAM_ASSET_BUCKET)) {
            // If a full storage URL is already provided, just use it.
            avatarUrl = rawAvatar;
          } else {
            const bucketPath = resolveBucketPath(rawAvatar);
            avatarUrl = signedAvatarMap[bucketPath] || null;
          }
        }
        return {
          ...comment,
          displayName:
            profile?.display_name || comment.displayName || 'Player',
          avatarUrl,
          role: adminMap[email] || null,
        };
      });
      setComments(enrichedComments);
      const likedCommentIds = await loadUserLikes(enrichedComments.map((c) => c.id));
      await loadCommentReactions(enrichedComments, likedCommentIds);
    } catch (err: any) {
      console.error('Comments load failed', err);
    }
  }, [gameId, loadCommentReactions, loadUserLikes]);

  useEffect(() => {
    loadSocialData();
  }, [loadSocialData]);

  useEffect(() => {
    const initUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          let resolvedRole = resolveRole((data.user.user_metadata?.role as string | undefined) || null);
          const cachedUser = getStoredUser();
          if (cachedUser?.id === data.user.id && cachedUser.role) {
            resolvedRole = cachedUser.role;
          }
          const email = data.user.email || '';
          if (email) {
            try {
              const { data: adminRow } = await supabase
                .from('admin_users')
                .select('role')
                .ilike('email', email)
                .limit(1);
              const adminRole = mapAdminRoleToEnum((adminRow && adminRow[0]?.role) || null);
              if (adminRole) resolvedRole = adminRole;
            } catch (roleErr) {
              console.warn('BoxScore admin role lookup failed', roleErr);
            }
          }
          setCurrentUser({
            id: data.user.id,
            name:
              data.user.user_metadata?.full_name ||
              data.user.email?.split('@')[0] ||
              'Player',
            email,
            role: resolvedRole,
          });
        }
      } catch (err) {
        console.warn('User lookup failed', err);
      }
    };
    initUser();
  }, []);

  useEffect(() => {
    if (!gameId) return;
    const interval = window.setInterval(() => {
      void loadSocialData();
    }, 5000);

    const handleFocus = () => {
      void loadSocialData();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [gameId, loadSocialData]);

  const formatTimeAgo = (value?: string | null) => {
    if (!value) return '';
    const diff = Date.now() - new Date(value).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const ROLE_BADGE_CONFIG: Record<
    string,
    { label: string; border: string; badge: string }
  > = {
    ADMIN_FULL: {
      label: 'SUPER ADMIN',
      border: 'border-red-500',
      badge: 'bg-red-500/15 text-red-200 border border-red-500/60',
    },
    ADMIN_COMMISSIONER: {
      label: 'COMMISSIONER',
      border: 'border-amber-500',
      badge: 'bg-amber-500/15 text-amber-200 border border-amber-500/60',
    },
    ADMIN_SCOREKEEPER: {
      label: 'SCOREKEEPER',
      border: 'border-emerald-500',
      badge: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/60',
    },
    ADMIN_MEDIA: {
      label: 'MEDIA',
      border: 'border-sky-500',
      badge: 'bg-sky-500/15 text-sky-200 border border-sky-500/60',
    },
  };

  const getRoleMeta = (role?: string | null) => {
    if (!role) return null;
    const normalized = role.toUpperCase().replace(/\s+/g, '_');
    return ROLE_BADGE_CONFIG[normalized] || null;
  };

  const getRoleLabel = (role?: string | null) => {
    if (!role) return null;
    const normalized = role.toUpperCase().replace(/\s+/g, '_');
    return ROLE_BADGE_CONFIG[normalized]?.label || role.replace(/_/g, ' ');
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setCommentError('Log in to post comments.');
      return;
    }
    if (!newComment.trim()) {
      setCommentError('Add something before commenting.');
      return;
    }
    if (Date.now() - lastCommentAt < RATE_LIMIT_MS) {
      setCommentError('Slow down—comments are limited to one per 7 seconds.');
      return;
    }
    setIsCommentSending(true);
    try {
      const { data: priorCommentRows } = await supabase
        .from('box_score_comments')
        .select('user_id')
        .eq('game_id', gameId)
        .not('user_id', 'is', null);

      const { error } = await supabase.from('box_score_comments').insert({
        game_id: gameId,
        user_id: currentUser.id,
        body: newComment.trim(),
        display_name: currentUser.name,
      });
      if (error) throw error;

      const priorCommenterIds = Array.from(
        new Set(
          (priorCommentRows || [])
            .map((row: any) => row.user_id as string | null)
            .filter((id): id is string => Boolean(id) && id !== currentUser.id)
        )
      );

      if (priorCommenterIds.length) {
        const homeName = homeTeam?.name || 'Home';
        const awayName = awayTeam?.name || 'Away';
        const commenterName = currentUser.name || 'Someone';
        const boxScoreLink = `/boxscore/${gameId}`;
        const summary = `${homeName} vs ${awayName}`;
        const title = 'New Box Score Comment';
        const body = `${commenterName} commented on ${summary}, a game you also commented on.`;
        createNotifications(
          priorCommenterIds.map((userId) => ({
            userId,
            type: 'box_score_comment',
            title,
            body,
            link: boxScoreLink,
            metadata: {
              gameId,
              source: 'box_score_comment',
            },
          }))
        ).catch((err) => console.warn('box score comment notification failed', err));
      }

      setNewComment('');
      setLastCommentAt(Date.now());
      setCommentError(null);
      await loadSocialData();
    } catch (err: any) {
      setCommentError(err.message || 'Unable to post comment right now.');
    } finally {
      setIsCommentSending(false);
    }
  };

  const toggleLegacyLike = async (comment: CommentRow) => {
    if (!currentUser) {
      setCommentError('Log in to react.');
      return;
    }
    const liked = userLikes.has(comment.id);
    try {
      if (liked) {
        await supabase
          .from('box_score_comment_likes')
          .delete()
          .eq('comment_id', comment.id)
          .eq('user_id', currentUser.id);
        await supabase
          .from('box_score_comments')
          .update({ likes: Math.max((comment.likes || 1) - 1, 0) })
          .eq('id', comment.id);
      } else {
        await supabase.from('box_score_comment_likes').insert({
          comment_id: comment.id,
          user_id: currentUser.id,
        });
        await supabase
          .from('box_score_comments')
          .update({ likes: (comment.likes || 0) + 1 })
          .eq('id', comment.id);
      }
      await loadSocialData();
    } catch (err: any) {
      console.error('Like failed', err);
    }
  };

  const handleCommentReaction = async (comment: CommentRow, reaction: CommentReactionType) => {
    if (!currentUser) {
      setCommentError('Log in to react.');
      return;
    }

    if (!supportsCommentReactions) {
      if (reaction !== 'like') {
        setCommentError('Only Like is available until comment reaction table is enabled.');
        return;
      }
      await toggleLegacyLike(comment);
      return;
    }

    const currentReaction = userReactionByComment[comment.id] || null;
    const nextReaction = currentReaction === reaction ? null : reaction;

    try {
      const { error: deleteError } = await supabase
        .from(COMMENT_REACTIONS_TABLE)
        .delete()
        .eq('comment_id', comment.id)
        .eq('user_id', currentUser.id);
      if (deleteError) throw deleteError;

      if (nextReaction) {
        const { error: insertError } = await supabase.from(COMMENT_REACTIONS_TABLE).insert({
          comment_id: comment.id,
          user_id: currentUser.id,
          reaction: nextReaction,
        });
        if (insertError) throw insertError;
      }

      setCommentError(null);
      await loadSocialData();
    } catch (err: any) {
      const message = String(err?.message || '');
      const code = String(err?.code || '');
      const missingTable =
        code === 'PGRST205' ||
        code === '42P01' ||
        /does not exist/i.test(message) ||
        /could not find the table/i.test(message);

      if (missingTable) {
        setSupportsCommentReactions(false);
        if (reaction === 'like') {
          await toggleLegacyLike(comment);
          return;
        }
        setCommentError('Only Like is available until comment reaction table is enabled.');
        return;
      }
      console.error('Reaction save failed', err);
      setCommentError('Unable to save reaction right now.');
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!isFullAdmin) return;
    try {
      setIsDeleteProcessing(true);
      await supabase.from('box_score_comments').delete().eq('id', commentId);
      setPendingDeleteComment(null);
      await loadSocialData();
    } catch (err: any) {
      console.error('Delete failed', err);
      setCommentError('Unable to delete comment right now.');
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const toggleCommentHidden = async (comment: CommentRow) => {
    if (!isFullAdmin || !supportsCommentHide) return;
    try {
      const { error } = await supabase
        .from('box_score_comments')
        .update({ is_hidden: !comment.isHidden })
        .eq('id', comment.id);
      if (error) {
        const message = String(error?.message || '');
        const missingColumn =
          /column.*is_hidden.*does not exist/i.test(message) ||
          /schema cache/i.test(message);
        if (missingColumn) {
          setSupportsCommentHide(false);
          setCommentError('Hide/Unhide needs DB column `is_hidden` on box_score_comments.');
          return;
        }
        throw error;
      }
      setCommentError(null);
      await loadSocialData();
    } catch (err) {
      console.error('Hide toggle failed', err);
      setCommentError('Unable to update comment visibility right now.');
    }
  };

  const visibleComments = useMemo(
    () => (isFullAdmin ? comments : comments.filter((comment) => !comment.isHidden)),
    [comments, isFullAdmin]
  );

  const homeTeam = game?.home_team_id ? teams[game.home_team_id] : null;
  const awayTeam = game?.away_team_id ? teams[game.away_team_id] : null;
  const gameStatus = normalizeGameStatus(game?.status);
  const isForfeitedGame = gameStatus === 'FORFEITED';
  const isCanceledGame = gameStatus === 'CANCELED';
  const forfeitWinner =
    isForfeitedGame && homeTeam && awayTeam
      ? Number(game?.home_score ?? 0) > Number(game?.away_score ?? 0)
        ? homeTeam
        : Number(game?.away_score ?? 0) > Number(game?.home_score ?? 0)
          ? awayTeam
          : null
      : null;
  const scoreDisplay = isForfeitedGame
    ? 'FORFEITED'
    : isCanceledGame
      ? 'CANCELED'
      : `${game?.home_score ?? '-'} : ${game?.away_score ?? '-'}`;

  const homeStats = useMemo(
    () => sortByJersey(stats.filter((s) => s.teamId === game?.home_team_id)),
    [stats, game?.home_team_id]
  );
  const awayStats = useMemo(
    () => sortByJersey(stats.filter((s) => s.teamId === game?.away_team_id)),
    [stats, game?.away_team_id]
  );

  const formatDate = () => {
    if (!game) return '';
    const raw = game.game_datetime || game.date;
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = () => {
    if (!game) return '';
    if (game.game_datetime) {
      const parsed = new Date(game.game_datetime);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      }
    }
    return game.time || '';
  };

  const renderTeamTable = (team: TeamLite | null, teamStats: StatRow[]) => {
    if (!team) return null;
    if (!teamStats.length) {
      return (
        <div className="bg-brand-dark border border-white/10 rounded-xl p-6 text-gray-400">
          No box score entries for{' '}
          <Link to={teamPath(team.id)} className="text-white hover:text-brand-lime transition-colors">
            {team.name}
          </Link>{' '}
          yet.
        </div>
      );
    }

    const totals = teamStats.reduce(
    (acc, row) => ({
      pts: acc.pts + row.pts,
      reb: acc.reb + row.reb,
      ast: acc.ast + row.ast,
      stl: acc.stl + row.stl,
      blk: acc.blk + row.blk,
      fgm: acc.fgm + row.fgm,
      fga: acc.fga + row.fga,
      tpm: acc.tpm + row.tpm,
      tpa: acc.tpa + row.tpa,
      ftm: acc.ftm + row.ftm,
      fta: acc.fta + row.fta,
      turnovers: acc.turnovers + row.turnovers,
    }),
    { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, turnovers: 0 }
);

    return (
      <div className="bg-brand-dark border border-white/10 rounded-xl p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2 sm:gap-3">
          <div className="h-9 w-9 rounded-full overflow-hidden bg-black border border-white/10 sm:h-10 sm:w-10">
            {team.logoUrl ? (
              <img src={team.logoUrl} alt={team.name} className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div>
            <Link
              to={teamPath(team.id)}
              className="text-sm sm:text-base text-white font-bold uppercase hover:text-brand-lime transition-colors"
            >
              {team.name}
            </Link>
            <div className="text-xs text-gray-400">Team Box Score</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] sm:text-xs md:text-sm">
            <thead className="text-gray-400 uppercase text-[11px] border-b border-white/10">
              <tr>
                <th className="py-2 pr-2 sm:pr-3">Player</th>
                <th className="px-1 py-2 text-center sm:px-0">PTS</th>
                <th className="px-1 py-2 text-center sm:px-0">REB</th>
                <th className="px-1 py-2 text-center sm:px-0">AST</th>
                <th className="px-1 py-2 text-center sm:px-0">STL</th>
                <th className="px-1 py-2 text-center sm:px-0">BLK</th>
                <th className="px-1 py-2 text-center sm:px-0">TOV</th>
                <th className="px-1 py-2 text-center sm:px-0">FG</th>
                <th className="px-1 py-2 text-center sm:px-0">FG%</th>
                <th className="px-1 py-2 text-center sm:px-0">3PT</th>
                <th className="px-1 py-2 text-center sm:px-0">3PT%</th>
                <th className="px-1 py-2 text-center sm:px-0">FT</th>
                <th className="px-1 py-2 text-center sm:px-0">FT%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white">
              {teamStats.map((row) => (
                <tr key={row.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-2 pr-2 sm:pr-3">
                    <span className="text-gray-400 mr-2">#{row.jerseyNumber ?? '-'}</span>
                    {row.playerId && !row.isGuest ? (
                      <Link
                        to={`/player/${row.playerId}`}
                        state={playerLinkState}
                        className="text-white font-semibold hover:text-brand-lime transition-colors"
                      >
                        {row.playerName}
                      </Link>
                    ) : (
                      <span className="text-white font-semibold">{row.playerName}</span>
                    )}
                    {row.isGuest && (
                      <span className="ml-2 inline-flex rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                        Guest
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-2 text-center font-bold text-brand-lime sm:px-0">{row.pts}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.reb}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.ast}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.stl}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.blk}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.turnovers}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.fgm}-{row.fga}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{formatPercent(row.fgm, row.fga)}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.tpm}-{row.tpa}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{formatPercent(row.tpm, row.tpa)}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{row.ftm}-{row.fta}</td>
                  <td className="px-1 py-2 text-center sm:px-0">{formatPercent(row.ftm, row.fta)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-gray-300 border-t border-white/10">
              <tr>
                <td className="py-2 pr-2 font-bold sm:pr-3">Totals</td>
                <td className="px-1 py-2 text-center font-bold text-brand-lime sm:px-0">{totals.pts}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.reb}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.ast}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.stl}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.blk}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.turnovers}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.fgm}-{totals.fga}</td>
                <td className="px-1 py-2 text-center sm:px-0">{formatPercent(totals.fgm, totals.fga)}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.tpm}-{totals.tpa}</td>
                <td className="px-1 py-2 text-center sm:px-0">{formatPercent(totals.tpm, totals.tpa)}</td>
                <td className="px-1 py-2 text-center sm:px-0">{totals.ftm}-{totals.fta}</td>
                <td className="px-1 py-2 text-center sm:px-0">{formatPercent(totals.ftm, totals.fta)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-2 sm:px-4">
        <LoadingOverlay message="Loading box score..." />
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-2 sm:px-4 flex items-center justify-center">
        <div className="text-gray-400 text-sm">{error || 'Box score not found.'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-2 sm:px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <Link to={backPath} className="text-gray-400 hover:text-white flex items-center gap-2">
          <ArrowLeft size={18} /> Back to {backLabel}
        </Link>

        <div className="bg-brand-dark border border-white/10 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden bg-black border border-white/10">
                {homeTeam?.logoUrl ? (
                  <img src={homeTeam.logoUrl} alt={homeTeam.name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div>
                {homeTeam?.id ? (
                  <Link
                    to={teamPath(homeTeam.id)}
                    className="text-white font-bold text-base sm:text-lg hover:text-brand-lime transition-colors"
                  >
                    {homeTeam.name}
                  </Link>
                ) : (
                  <div className="text-white font-bold text-base sm:text-lg">{homeTeam?.name || 'Home'}</div>
                )}
                <div className="text-xs text-gray-400">Home</div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-sports text-white font-bold">{scoreDisplay}</div>
              {!isForfeitedGame && !isCanceledGame && (
                <div className="mt-1">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-[0.18em] ${
                      gameStatus === 'COMPLETED'
                        ? 'bg-brand-lime/20 text-brand-lime'
                        : 'bg-white/10 text-gray-200'
                    }`}
                  >
                    {gameStatus}
                  </span>
                </div>
              )}
              {isForfeitedGame && (
                <div className="text-[11px] uppercase tracking-[0.2em] text-amber-300 mt-1">
                  Winner: {forfeitWinner?.name || 'TBD'}
                </div>
              )}
              <div className="text-xs text-gray-400">{formatDate()} {formatTime() ? `@ ${formatTime()}` : ''}</div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wide">
                {game.location || game.court_name || 'Location TBD'}
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden bg-black border border-white/10">
                {awayTeam?.logoUrl ? (
                  <img src={awayTeam.logoUrl} alt={awayTeam.name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div>
                {awayTeam?.id ? (
                  <Link
                    to={teamPath(awayTeam.id)}
                    className="text-white font-bold text-base sm:text-lg hover:text-brand-lime transition-colors"
                  >
                    {awayTeam.name}
                  </Link>
                ) : (
                  <div className="text-white font-bold text-base sm:text-lg">{awayTeam?.name || 'Away'}</div>
                )}
                <div className="text-xs text-gray-400">Away</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {renderTeamTable(homeTeam, homeStats)}
          {renderTeamTable(awayTeam, awayStats)}
        </div>
        <div className="bg-black border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-1">Social</p>
              <h3 className="text-2xl font-sports text-white">Game Comments & Reactions</h3>
            </div>
            <span className="text-xs text-gray-400">Bring the Courtsight crew together.</span>
          </div>
          <form onSubmit={handlePostComment} className="space-y-3">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              placeholder="Share your thoughts on the game..."
              className="w-full bg-white/5 border border-white/10 focus:border-brand-lime focus:ring-brand-lime/40 focus:outline-none rounded-xl p-4 text-sm text-white placeholder-gray-500 transition"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {commentError || 'One comment every 7 seconds to prevent spam.'}
              </p>
              <button
                type="submit"
                disabled={isCommentSending}
                className="inline-flex items-center gap-2 px-5 py-2 bg-brand-lime text-black text-xs uppercase tracking-widest font-bold rounded-full disabled:opacity-50"
              >
                {isCommentSending ? 'Posting...' : 'Post comment'}
              </button>
            </div>
          </form>
        <div className="space-y-4">
          {visibleComments.length === 0 && (
            <div className="text-center text-gray-500 text-sm">No comments yet. Be the first.</div>
          )}
          {visibleComments.map((comment) => (
            <div
              key={comment.id}
              className={`rounded-2xl border p-4 space-y-3 transition ${
                getRoleMeta(comment.role)?.border ?? 'border-white/10'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-black border border-white/10">
                  <img
                    src={
                      comment.avatarUrl ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.displayName)}`
                    }
                    alt={comment.displayName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement;
                      el.onerror = null;
                      el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.displayName)}`;
                    }}
                  />
                </div>
                <div className="flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{comment.displayName}</span>
                      {comment.role && (
                        <span
                          className={`text-[10px] font-bold uppercase tracking-[0.4em] rounded-full px-2 py-0.5 ${
                            getRoleMeta(comment.role)?.badge ?? 'text-white/70 border border-white/20 bg-black/20'
                          }`}
                        >
                          {getRoleLabel(comment.role) || 'STAFF'}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400">{formatTimeAgo(comment.createdAt)}</span>
                    </div>
                </div>
                {isFullAdmin && (
                  <div className="flex items-center gap-2">
                    {supportsCommentHide && (
                      <button
                        type="button"
                        onClick={() => toggleCommentHidden(comment)}
                        title={comment.isHidden ? 'Unhide comment' : 'Hide comment'}
                        aria-label={comment.isHidden ? 'Unhide comment' : 'Hide comment'}
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition ${
                          comment.isHidden
                            ? 'border-yellow-500/50 text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20'
                            : 'border-white/15 text-gray-300 bg-white/5 hover:border-brand-lime hover:text-brand-lime'
                        }`}
                      >
                        {comment.isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDeleteComment(comment)}
                      title="Delete comment"
                      aria-label="Delete comment"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-red-500/40 text-red-300 bg-red-500/10 hover:bg-red-500/20 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              {comment.isHidden && isFullAdmin && (
                <div className="inline-flex items-center rounded-full border border-yellow-400/50 bg-yellow-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-yellow-300">
                  Hidden
                </div>
              )}
              <p className="text-sm text-white leading-relaxed">{comment.body}</p>
              <div className="flex flex-wrap items-center gap-3">
                {(supportsCommentReactions
                  ? COMMENT_REACTION_OPTIONS
                  : COMMENT_REACTION_OPTIONS.filter((option) => option.type === 'like')
                ).map((option) => {
                  const Icon = option.icon;
                  const selected = (userReactionByComment[comment.id] || null) === option.type;
                  const count =
                    reactionCountsByComment[comment.id]?.[option.type] ??
                    (option.type === 'like' ? comment.likes : 0);
                  return (
                    <button
                      key={`${comment.id}-${option.type}`}
                      type="button"
                      onClick={() => handleCommentReaction(comment, option.type)}
                      className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs uppercase tracking-widest transition border ${
                        selected
                          ? option.selectedClass
                          : 'border-white/10 bg-white/5 text-gray-300 hover:border-brand-lime hover:text-white'
                      }`}
                      aria-pressed={selected}
                    >
                      <Icon size={14} />
                      <span>{count || 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>
      {pendingDeleteComment && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            aria-label="Close delete dialog"
            onClick={() => {
              if (isDeleteProcessing) return;
              setPendingDeleteComment(null);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-brand-black p-5 shadow-2xl">
            <h4 className="font-sports text-xl uppercase text-white">Delete Comment?</h4>
            <p className="mt-2 text-sm text-gray-300">
              This will permanently remove this comment.
            </p>
            <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white">
              {pendingDeleteComment.body}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeleteProcessing}
                onClick={() => setPendingDeleteComment(null)}
                className="px-4 py-2 rounded-lg border border-white/15 text-gray-200 hover:text-white hover:border-white/30 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleteProcessing}
                onClick={() => deleteComment(pendingDeleteComment.id)}
                className="px-4 py-2 rounded-lg border border-red-500/40 bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-60"
              >
                {isDeleteProcessing ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BoxScore;

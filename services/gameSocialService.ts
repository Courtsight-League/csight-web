import { supabase } from './supabaseClient';
import type { GameReaction, GameSocialComment, ReactionType } from '../types';

const COMMENTS_TABLE = 'game_comments';
const REACTIONS_TABLE = 'game_reactions';

const mapCommentRow = (row: any): GameSocialComment => ({
  id: row.id,
  gameId: row.game_id,
  userId: row.user_id,
  userName: row.user_name ?? 'Fan',
  avatarUrl: row.avatar_url ?? null,
  content: row.content ?? '',
  createdAt: row.created_at ?? new Date().toISOString(),
  isHidden: row.is_hidden ?? false,
});

const mapReactionRow = (row: any): GameReaction => ({
  id: row.id,
  gameId: row.game_id,
  userId: row.user_id,
  reaction: row.reaction as ReactionType,
  createdAt: row.created_at ?? new Date().toISOString(),
});

export async function fetchGameComments(gameId: string): Promise<GameSocialComment[]> {
  if (!gameId) return [];
  const { data, error } = await supabase
    .from(COMMENTS_TABLE)
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map(mapCommentRow);
}

export async function postGameComment({
  gameId,
  userId,
  userName,
  avatarUrl,
  content,
}: {
  gameId: string;
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  content: string;
}): Promise<GameSocialComment> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Comment cannot be blank.');
  }

  const { data, error } = await supabase
    .from(COMMENTS_TABLE)
    .insert({
      game_id: gameId,
      user_id: userId,
      user_name: userName,
      avatar_url: avatarUrl,
      content: trimmed,
      is_hidden: false,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Unable to post comment.');
  }

  return mapCommentRow(data);
}

export async function hideGameComment(commentId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.from(COMMENTS_TABLE).update({ is_hidden: hidden }).eq('id', commentId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteGameComment(commentId: string): Promise<void> {
  const { error } = await supabase.from(COMMENTS_TABLE).delete().eq('id', commentId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchGameReactions(gameId: string): Promise<GameReaction[]> {
  if (!gameId) return [];
  const { data, error } = await supabase.from(REACTIONS_TABLE).select('*').eq('game_id', gameId);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map(mapReactionRow);
}

export async function setGameReaction({
  gameId,
  userId,
  reaction,
}: {
  gameId: string;
  userId: string;
  reaction: ReactionType | null;
}): Promise<void> {
  if (!userId) return;
  await supabase.from(REACTIONS_TABLE).delete().eq('game_id', gameId).eq('user_id', userId);
  if (!reaction) return;

  const { error } = await supabase
    .from(REACTIONS_TABLE)
    .insert({
      game_id: gameId,
      user_id: userId,
      reaction,
    });

  if (error) {
    throw new Error(error.message);
  }
}

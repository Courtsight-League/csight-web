import { supabase } from './supabaseClient';
import { Notification } from '../types';

const LOCAL_KEY = 'courtsight_notifications';
let disableRemoteNotifications = false; // flip to true after first schema/permission failure

const LINK_TOKEN = '\n[[link:';
const META_TOKEN = '\n[[meta:';

const readLocal = (userId: string, role: string | null): Notification[] => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Notification[];
    return parsed.filter(
      (n) =>
        (n.userId && n.userId === userId) ||
        (role && n.role && n.role === role)
    );
  } catch {
    return [];
  }
};

const writeLocal = (items: Notification[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
};

const appendLocal = (items: Notification[]) => {
  if (!items.length) return;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const existing: Notification[] = raw ? JSON.parse(raw) : [];
    writeLocal([...items, ...existing]);
  } catch {
    // ignore
  }
};

const encodeMessage = (body: string, link?: string | null, metadata?: Record<string, any> | null) => {
  let message = body || '';
  if (link) {
    message += `${LINK_TOKEN}${encodeURIComponent(link)}]]`;
  }
  if (metadata && Object.keys(metadata).length) {
    try {
      message += `${META_TOKEN}${encodeURIComponent(JSON.stringify(metadata))}]]`;
    } catch {
      // ignore metadata serialization failure
    }
  }
  return message;
};

const decodeMessage = (raw: string) => {
  const text = raw || '';
  const linkMatch = text.match(/\n\[\[link:(.*?)\]\]/);
  const metaMatch = text.match(/\n\[\[meta:(.*?)\]\]/);
  const body = text
    .replace(/\n\[\[link:.*?\]\]/g, '')
    .replace(/\n\[\[meta:.*?\]\]/g, '')
    .trim();

  let link: string | null = null;
  if (linkMatch?.[1]) {
    try {
      link = decodeURIComponent(linkMatch[1]);
    } catch {
      link = null;
    }
  }

  let metadata: Record<string, any> | null = null;
  if (metaMatch?.[1]) {
    try {
      metadata = JSON.parse(decodeURIComponent(metaMatch[1]));
    } catch {
      metadata = null;
    }
  }

  return { body, link, metadata };
};

export type NotificationInsert = {
  userId?: string | null;
  role?: string | null;
  teamId?: string | null;
  type?: string | null;
  title: string;
  body: string;
  link?: string | null;
  metadata?: Record<string, any> | null;
};

export const createNotifications = async (items: NotificationInsert[]) => {
  if (!items.length) return;
  // Build local fallback payload (used only when remote insert is unavailable/failed).
  const now = new Date().toISOString();
  const localFallbackItems: Notification[] = items
    .filter((n) => n.userId || n.role)
    .map((n, idx) => ({
      id: `local-${Date.now()}-${idx}`,
      userId: n.userId ?? null,
      role: n.role ?? null,
      teamId: n.teamId ?? null,
      type: n.type ?? 'registration',
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      metadata: n.metadata ?? null,
      readAt: null,
      createdAt: now,
    }));
  if (disableRemoteNotifications) {
    appendLocal(localFallbackItems);
    return;
  }

  try {
    const remoteItems = items.filter((n) => Boolean(n.userId));
    const localOnlyItems = localFallbackItems.filter((n) => !n.userId && !!n.role);
    if (!remoteItems.length) {
      // Role-targeted/local-only notifications still need a fallback write.
      appendLocal(localOnlyItems);
      return;
    }

    const modernPayload = remoteItems.map((n) => ({
      user_id: n.userId ?? null,
      team_id: n.teamId ?? null,
      title: n.title,
      message: encodeMessage(n.body, n.link, n.metadata),
      read: false,
    }));
    let { error } = await supabase.from('notifications').insert(modernPayload);

    // Backward-compatible fallback for databases that still use legacy notification columns.
    if (error && /column notifications\.message does not exist|column notifications\.read does not exist/i.test(error.message || '')) {
      const legacyPayload = remoteItems.map((n) => ({
        user_id: n.userId ?? null,
        team_id: n.teamId ?? null,
        role: n.role ?? null,
        type: n.type ?? 'registration',
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        metadata: n.metadata ?? null,
      }));
      const legacyResult = await supabase.from('notifications').insert(legacyPayload);
      error = legacyResult.error;
    }

    if (error) {
      console.warn('notifications insert failed', error.message);
      disableRemoteNotifications = true;
      appendLocal(localFallbackItems);
      return;
    }
    // Remote insert succeeded. Do not append local duplicates.
    if (localOnlyItems.length) appendLocal(localOnlyItems);
  } catch (err) {
    console.warn('notifications insert error', err);
    disableRemoteNotifications = true;
    appendLocal(localFallbackItems);
  }
};

const dedupeNotifications = (items: Notification[]): Notification[] => {
  const seenByKey = new Map<string, number>();
  const result: Notification[] = [];
  const DUPLICATE_WINDOW_MS = 8000;

  for (const item of items) {
    const meta = (item.metadata || {}) as Record<string, any>;
    const key = [
      item.userId || '',
      item.role || '',
      item.type || '',
      item.title || '',
      item.body || '',
      item.link || '',
      String(meta.source || ''),
      String(meta.gameId || ''),
    ].join('::');

    const createdAtMs = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    const lastMs = seenByKey.get(key);
    if (lastMs && createdAtMs && Math.abs(lastMs - createdAtMs) <= DUPLICATE_WINDOW_MS) {
      continue;
    }
    if (createdAtMs) seenByKey.set(key, createdAtMs);
    result.push(item);
  }

  return result;
};

const fetchModernNotifications = async (userId: string, limit: number) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,user_id,team_id,title,message,read,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false, nulls: 'last' })
    .limit(limit);
  if (error) throw error;
  const rows = data || [];
  return rows.map((row: any) => {
    const decoded = decodeMessage(row.message || '');
    return {
      id: row.id,
      userId: row.user_id ?? null,
      role: null,
      teamId: row.team_id ?? null,
      type: 'registration',
      title: row.title,
      body: decoded.body || '',
      link: decoded.link,
      metadata: decoded.metadata,
      readAt: row.read ? row.created_at || new Date().toISOString() : null,
      createdAt: row.created_at ?? null,
    } as Notification;
  });
};

const fetchLegacyNotifications = async (userId: string, role: string | null, limit: number) => {
  const filters = [`user_id.eq.${userId}`];
  if (role) filters.push(`role.eq.${role}`);
  const { data, error } = await supabase
    .from('notifications')
    .select('id,user_id,team_id,type,title,body,link,metadata,created_at,read_at,role')
    .or(filters.join(','))
    .order('created_at', { ascending: false, nulls: 'last' })
    .limit(limit);
  if (error) throw error;
  const rows = data || [];
  return rows.map((row: any) => ({
    id: row.id,
    userId: row.user_id ?? null,
    role: row.role ?? null,
    teamId: row.team_id ?? null,
    type: row.type ?? null,
    title: row.title,
    body: row.body || '',
    link: row.link ?? null,
    metadata: row.metadata ?? null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at ?? null,
  })) as Notification[];
};

export const fetchRecentNotifications = async (
  userId: string,
  role: string | null,
  limit = 10
): Promise<Notification[]> => {
  if (disableRemoteNotifications) {
    return readLocal(userId, role);
  }
  try {
    let remote: Notification[] = [];
    try {
      remote = await fetchModernNotifications(userId, limit);
    } catch (modernErr: any) {
      if (/column notifications\.message does not exist|column notifications\.read does not exist/i.test(modernErr?.message || '')) {
        remote = await fetchLegacyNotifications(userId, role, limit);
      } else {
        throw modernErr;
      }
    }

    const merged = [...remote, ...readLocal(userId, role)];
    merged.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tB - tA;
    });
    return dedupeNotifications(merged).slice(0, limit);
  } catch (err: any) {
    console.warn('notifications fetch failed', err?.message || err);
    disableRemoteNotifications = true;
    return dedupeNotifications(readLocal(userId, role)).slice(0, limit);
  }
};

export const markNotificationRead = async (id: string) => {
  if (!disableRemoteNotifications) {
    try {
      let { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id);
      if (error && /column notifications\.read does not exist/i.test(error.message || '')) {
        const legacyResult = await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', id);
        error = legacyResult.error;
      }
      if (error) {
        console.warn('notifications mark read failed', error.message);
        disableRemoteNotifications = true;
      }
    } catch (err) {
      console.warn('notifications mark read error', err);
      disableRemoteNotifications = true;
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const list: Notification[] = JSON.parse(raw);
      const updated = list.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
      writeLocal(updated);
    }
  } catch {
    // ignore
  }
};

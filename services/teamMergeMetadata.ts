import { supabase } from './supabaseClient';
import { supabaseAdmin } from './supabaseAdminClient';

export const TEAM_MERGE_METADATA_SITE_KEY = 'team_merge_profile_metadata';

export type TeamMergeMode = 'profile_sync' | 'consolidate' | null;

export type TeamMergeMetadataEntry = {
  previousNames: string[];
  mergedFromTeamIds: string[];
  parentTeamId: string | null;
  mergedAt: string | null;
  mode: TeamMergeMode;
};

export type TeamMergeMetadataMap = Record<string, TeamMergeMetadataEntry>;

const uniqueNonEmpty = (values: string[]) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const normalizeEntry = (value: any): TeamMergeMetadataEntry => {
  const modeValue = String(value?.mode || '').trim();
  const mode: TeamMergeMode =
    modeValue === 'profile_sync' || modeValue === 'consolidate' ? modeValue : null;
  return {
    previousNames: uniqueNonEmpty(Array.isArray(value?.previousNames) ? value.previousNames : []),
    mergedFromTeamIds: uniqueNonEmpty(
      Array.isArray(value?.mergedFromTeamIds) ? value.mergedFromTeamIds : []
    ),
    parentTeamId: value?.parentTeamId ? String(value.parentTeamId).trim() : null,
    mergedAt: value?.mergedAt ? String(value.mergedAt) : null,
    mode,
  };
};

export const normalizeTeamMergeMetadataMap = (value: any): TeamMergeMetadataMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const map: TeamMergeMetadataMap = {};
  Object.entries(value).forEach(([teamId, entry]) => {
    const cleanedTeamId = String(teamId || '').trim();
    if (!cleanedTeamId) return;
    map[cleanedTeamId] = normalizeEntry(entry);
  });
  return map;
};

export const parseTeamMergeMetadataValue = (value: any): TeamMergeMetadataMap =>
  (() => {
    if (value == null) return {};
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === '[object Object]') return {};
      try {
        return normalizeTeamMergeMetadataMap(JSON.parse(trimmed));
      } catch {
        return {};
      }
    }
    return normalizeTeamMergeMetadataMap(value);
  })();

export const serializeTeamMergeMetadataMap = (value: TeamMergeMetadataMap) =>
  JSON.stringify(normalizeTeamMergeMetadataMap(value));

export const computeTeamMergeChildIds = (value: TeamMergeMetadataMap): string[] => {
  const normalizedMergeMeta = normalizeTeamMergeMetadataMap(value);
  const childTeamIds = new Set<string>();
  const normalizedEntries = new Map<
    string,
    {
      mode: string;
      parentTeamId: string;
      mergedFromTeamIds: string[];
      previousNames: string[];
    }
  >();
  const parentRefCountByTeam: Record<string, number> = {};

  Object.entries(normalizedMergeMeta).forEach(([teamId, entry]) => {
    const id = String(teamId || '').trim();
    if (!id) return;
    const mode = String(entry?.mode || '').trim();
    const parentTeamId = String(entry?.parentTeamId || '').trim();
    const mergedFromTeamIds = Array.isArray(entry?.mergedFromTeamIds)
      ? entry.mergedFromTeamIds.map((row: any) => String(row || '').trim()).filter(Boolean)
      : [];
    const previousNames = Array.isArray(entry?.previousNames)
      ? entry.previousNames.map((row: any) => String(row || '').trim()).filter(Boolean)
      : [];

    normalizedEntries.set(id, {
      mode,
      parentTeamId,
      mergedFromTeamIds,
      previousNames,
    });

    if (parentTeamId) {
      childTeamIds.add(id);
      parentRefCountByTeam[parentTeamId] = (parentRefCountByTeam[parentTeamId] || 0) + 1;
    }
  });

  normalizedEntries.forEach((entry, id) => {
    if (childTeamIds.has(id)) return;
    if (entry.mode !== 'profile_sync') return;
    if (entry.parentTeamId) return;
    if (entry.mergedFromTeamIds.length !== 1) return;
    const candidateParent = entry.mergedFromTeamIds[0];
    const reverse = normalizedEntries.get(candidateParent);
    const reverseHasBackLink = !!reverse?.mergedFromTeamIds.includes(id);
    if (!reverseHasBackLink) {
      childTeamIds.add(id);
    }
  });

  const processedPairs = new Set<string>();
  normalizedEntries.forEach((entry, id) => {
    if (childTeamIds.has(id)) return;
    if (entry.mode !== 'profile_sync') return;
    if (entry.parentTeamId) return;
    if (entry.mergedFromTeamIds.length !== 1) return;

    const linkedId = entry.mergedFromTeamIds[0];
    const reverse = normalizedEntries.get(linkedId);
    if (!reverse || reverse.mode !== 'profile_sync' || reverse.parentTeamId) return;
    if (!reverse.mergedFromTeamIds.includes(id)) return;

    const pairKey = [id, linkedId].sort().join('::');
    if (processedPairs.has(pairKey)) return;
    processedPairs.add(pairKey);

    const idPrev = entry.previousNames.length;
    const linkedPrev = reverse.previousNames.length;
    const idParentRefs = parentRefCountByTeam[id] || 0;
    const linkedParentRefs = parentRefCountByTeam[linkedId] || 0;

    if (idPrev === 0 && linkedPrev > 0) {
      childTeamIds.add(linkedId);
      return;
    }
    if (linkedPrev === 0 && idPrev > 0) {
      childTeamIds.add(id);
      return;
    }

    if (idParentRefs !== linkedParentRefs) {
      childTeamIds.add(idParentRefs < linkedParentRefs ? id : linkedId);
      return;
    }

    const idMergedCount = entry.mergedFromTeamIds.length;
    const linkedMergedCount = reverse.mergedFromTeamIds.length;
    if (idMergedCount !== linkedMergedCount) {
      childTeamIds.add(idMergedCount < linkedMergedCount ? id : linkedId);
    }
  });

  return Array.from(childTeamIds);
};

export const resolveConnectedTeamIds = (
  value: TeamMergeMetadataMap,
  teamId: string | null | undefined
): string[] => {
  const startId = String(teamId || '').trim();
  if (!startId) return [];

  const normalizedMergeMeta = normalizeTeamMergeMetadataMap(value);
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set<string>());
    if (!adjacency.has(b)) adjacency.set(b, new Set<string>());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  Object.entries(normalizedMergeMeta).forEach(([rawTeamId, entry]) => {
    const id = String(rawTeamId || '').trim();
    if (!id) return;
    const parentTeamId = String(entry?.parentTeamId || '').trim();
    if (parentTeamId) {
      link(id, parentTeamId);
    }
    const mergedFromTeamIds = Array.isArray(entry?.mergedFromTeamIds)
      ? entry.mergedFromTeamIds.map((row: any) => String(row || '').trim()).filter(Boolean)
      : [];
    mergedFromTeamIds.forEach((linkedId) => {
      link(id, linkedId);
    });
  });

  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    neighbors.forEach((neighbor) => {
      if (visited.has(neighbor)) return;
      visited.add(neighbor);
      queue.push(neighbor);
    });
  }

  return Array.from(visited);
};

export const resolveTeamMergeRootId = (
  value: TeamMergeMetadataMap,
  teamId: string | null | undefined
): string | null => {
  let currentId = String(teamId || '').trim();
  if (!currentId) return null;

  const normalizedMergeMeta = normalizeTeamMergeMetadataMap(value);
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const entry = normalizedMergeMeta[currentId];
    const parentTeamId = String(entry?.parentTeamId || '').trim();
    if (!parentTeamId) {
      return currentId;
    }
    currentId = parentTeamId;
  }

  return currentId || null;
};

export const loadTeamMergeMetadata = async (preferAdmin = false): Promise<TeamMergeMetadataMap> => {
  const fetchWithClient = async (client: any) =>
    client
      .from('site_settings')
      .select('value')
      .eq('key', TEAM_MERGE_METADATA_SITE_KEY)
      .maybeSingle();

  const primaryClient = preferAdmin && supabaseAdmin ? supabaseAdmin : supabase;
  const fallbackClient = primaryClient === supabase ? supabaseAdmin : supabase;

  let data: any = null;
  let loadErr: any = null;
  try {
    const result = await fetchWithClient(primaryClient);
    data = result.data;
    loadErr = result.error;
  } catch (err) {
    loadErr = err;
  }

  if (loadErr && fallbackClient) {
    try {
      const result = await fetchWithClient(fallbackClient);
      data = result.data;
      loadErr = result.error;
    } catch (err) {
      loadErr = err;
    }
  }

  if (loadErr) throw loadErr;
  return parseTeamMergeMetadataValue((data as any)?.value);
};

export const saveTeamMergeMetadata = async (
  value: TeamMergeMetadataMap,
  preferAdmin = false
): Promise<void> => {
  const payload = {
    key: TEAM_MERGE_METADATA_SITE_KEY,
    value: serializeTeamMergeMetadataMap(value),
    updated_at: new Date().toISOString(),
  };

  const saveWithClient = async (client: any) =>
    client.from('site_settings').upsert(payload, { onConflict: 'key' });

  const primaryClient = preferAdmin && supabaseAdmin ? supabaseAdmin : supabase;
  const fallbackClient = primaryClient === supabase ? supabaseAdmin : supabase;

  let saveErr: any = null;
  try {
    const result = await saveWithClient(primaryClient);
    saveErr = result.error;
  } catch (err) {
    saveErr = err;
  }

  if (saveErr && fallbackClient) {
    try {
      const result = await saveWithClient(fallbackClient);
      saveErr = result.error;
    } catch (err) {
      saveErr = err;
    }
  }

  if (saveErr) throw saveErr;
};

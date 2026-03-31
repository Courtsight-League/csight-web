import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { getStoredUser } from '../services/authService';
import { Team, Role } from '../types';
import LoadingOverlay from '../components/LoadingOverlay';
import { Upload, UploadCloud, Shield, ShieldCheck, AlertTriangle, Save, X } from 'lucide-react';
import { normalizeJerseyNumberInput } from '../utils/jerseyNumber';
import { sendPlayerClaimEmail } from '../services/playerClaimEmailService';
import { createNotifications } from '../services/notificationService';
import {
  loadJerseyManagementSettings,
  saveJerseyManagementSettings,
  upsertTeamJerseyWorkflow,
} from '../services/jerseyManagement';
import Cropper, { type Area } from 'react-easy-crop';


type PaymentStatus = 'paid' | 'pending' | 'pending-stripe' | 'unknown';

const createImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = src;
  });

const getCroppedImageBlob = async (src: string, area: Area): Promise<Blob> => {
  const image = await createImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.round(area.width), 1);
  canvas.height = Math.max(Math.round(area.height), 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to access canvas context.');
  }
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to produce cropped image.'));
    }, 'image/png');
  });
};

const emptyJerseyDesignSlots = () => [null, null, null] as Array<string | null>;
const getAssetName = (value?: string | null) => String(value || '').split('/').pop() || 'uploaded-file';

type ImageCropState = {
  file: File;
  src: string;
  field: 'logoUrl' | 'bannerUrl';
  aspect: number;
};

type ExistingManageTeamPlayerSuggestion = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  position: string;
  jerseyName: string;
  jerseyNumber: string;
  jerseySize: string;
  shortsSize: string;
  seasonLabel: string;
};

const isGuestLikeName = (value: string | null | undefined) => /^guest\b/i.test(String(value || '').trim());

const isOfficialRosterPlayer = (player: any) => {
  const fullName = `${String(player?.first_name || '').trim()} ${String(player?.last_name || '').trim()}`.trim();
  return !(
    !!player?.is_guest ||
    isGuestLikeName(player?.first_name) ||
    isGuestLikeName(player?.last_name) ||
    isGuestLikeName(fullName)
  );
};

const ManageTeam: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [emailBlastLoading, setEmailBlastLoading] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [codeCopySuccess, setCodeCopySuccess] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [bannerPreview, setBannerPreview] = useState<string>('');
  const [croppingState, setCroppingState] = useState<ImageCropState | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [loadingField, setLoadingField] = useState<'logoUrl' | 'bannerUrl' | null>(null);
  const isCropLoading = loadingField !== null;
  const isLogoLoading = loadingField === 'logoUrl';
  const isBannerLoading = loadingField === 'bannerUrl';
  const isLogoCrop = croppingState?.field === 'logoUrl';
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('pending');
  const [captainTeamIds, setCaptainTeamIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    name: '',
    shortName: '',
    division: '',
    bannerUrl: '',
    logoUrl: '',
  });
  const [roster, setRoster] = useState<any[]>([]);
  const [playerForm, setPlayerForm] = useState<{
    id: string | null;
    firstName: string;
    lastName: string;
    jerseyName: string;
    jerseyNumber: string;
    jerseySize: string;
    shortsSize: string;
    position: string;
    phone: string;
    email: string;
  }>({
    id: null,
    firstName: '',
    lastName: '',
    jerseyName: '',
    jerseyNumber: '',
    jerseySize: 'L',
    shortsSize: 'L',
    position: '',
    phone: '',
    email: '',
  });
  const [pendingRemove, setPendingRemove] = useState<any | null>(null);
  const [playerColumns, setPlayerColumns] = useState<Set<string>>(new Set());
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [jerseyDesignSlots, setJerseyDesignSlots] = useState<Array<string | null>>(emptyJerseyDesignSlots());
  const [playerSuggestions, setPlayerSuggestions] = useState<ExistingManageTeamPlayerSuggestion[]>([]);
  const [showPlayerSuggestions, setShowPlayerSuggestions] = useState(false);
  const playerSuggestionTimerRef = useRef<number | null>(null);

  const user = useMemo(() => getStoredUser(), []);
  const location = useLocation();
  const requestedTeamId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('team');
    return raw ? raw.trim() : '';
  }, [location.search]);
  const isAdmin = user && (
    user.role === Role.ADMIN_FULL ||
    user.role === Role.ADMIN_MEDIA ||
    user.role === Role.ADMIN_SCOREKEEPER ||
    user.role === Role.ADMIN_COMMISSIONER
  );

  useEffect(() => {
    if (!user?.id) {
      setCaptainTeamIds([]);
      return;
    }
    let cancelled = false;
    const loadCaptainTeams = async () => {
      try {
        const { data } = await supabase
          .from('players')
          .select('team_id')
          .eq('user_id', user.id)
          .eq('is_captain', true);
        if (cancelled) return;
        const ids = Array.from(new Set((data || []).map((row: any) => row.team_id).filter(Boolean)));
        setCaptainTeamIds(ids);
      } catch (err) {
        if (!cancelled) {
          console.warn('captain team lookup failed', err);
          setCaptainTeamIds([]);
        }
      }
    };
    loadCaptainTeams();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value.trim());

  const clearPlayerSuggestions = useCallback(() => {
    setPlayerSuggestions([]);
    setShowPlayerSuggestions(false);
  }, []);

  const applyPlayerSuggestion = useCallback(
    (suggestion: ExistingManageTeamPlayerSuggestion) => {
      const nameParts = suggestion.fullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ');
      setPlayerForm((prev) => ({
        ...prev,
        firstName,
        lastName,
        jerseyName: suggestion.jerseyName || prev.jerseyName,
        jerseyNumber: suggestion.jerseyNumber || prev.jerseyNumber,
        jerseySize: suggestion.jerseySize || prev.jerseySize,
        shortsSize: suggestion.shortsSize || prev.shortsSize,
        position: suggestion.position || prev.position,
        phone: suggestion.phone || prev.phone,
        email: suggestion.email || prev.email,
      }));
      clearPlayerSuggestions();
    },
    [clearPlayerSuggestions]
  );

  const queuePlayerSuggestionSearch = useCallback(
    (rawTerm: string) => {
      const term = rawTerm.trim();
      if (playerSuggestionTimerRef.current) {
        window.clearTimeout(playerSuggestionTimerRef.current);
        playerSuggestionTimerRef.current = null;
      }

      if (term.length < 2) {
        clearPlayerSuggestions();
        return;
      }

      playerSuggestionTimerRef.current = window.setTimeout(async () => {
        const tokens = term
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean)
          .slice(0, 2);
        if (!tokens.length) {
          clearPlayerSuggestions();
          return;
        }

        const patternTokens = tokens.map((token) => `*${token.replace(/[,*]/g, '')}*`);
        const selectVariants = [
          'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,phone,email,email_address,created_at',
          'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,phone,email,created_at',
          'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,phone,email_address,created_at',
          'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,phone,created_at',
        ];
        const isMissingColumn = (error: any) => {
          const code = String(error?.code || '');
          const msg = String(error?.message || '').toLowerCase();
          return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
        };

        let rows: any[] = [];
        for (const select of selectVariants) {
          const filters = [
            ...patternTokens.map((pattern) => `first_name.ilike.${pattern}`),
            ...patternTokens.map((pattern) => `last_name.ilike.${pattern}`),
          ];
          const { data, error } = await supabase
            .from('players')
            .select(select)
            .or(filters.join(','))
            .order('created_at', { ascending: false })
            .limit(8);
          if (!error) {
            rows = data || [];
            break;
          }
          if (!isMissingColumn(error)) {
            console.warn('manage team player suggestion lookup failed', error);
            clearPlayerSuggestions();
            return;
          }
        }

        const seasonLabelById = new Map(
          teams.map((team) => [String((team as any).seasonId || '').trim(), String((team as any).seasonName || '').trim()])
        );
        const normalizedTerm = term.toLowerCase();
        const suggestionsByIdentity = new Map<string, ExistingManageTeamPlayerSuggestion>();

        for (const row of rows) {
          const id = String(row?.id || '').trim();
          if (!id) continue;

          const firstName = String(row?.first_name || '').trim();
          const lastName = String(row?.last_name || '').trim();
          const fullName = `${firstName} ${lastName}`.trim() || 'Player';
          const email = normalizeEmail(String(row?.email || row?.email_address || ''));
          const seasonId = String(row?.season_id || '').trim();
          const seasonLabel = seasonLabelById.get(seasonId) || 'Existing Player';

          if (!fullName.toLowerCase().includes(normalizedTerm) && !email.includes(normalizedTerm)) {
            continue;
          }

          const identityKey = email || `${fullName.toLowerCase()}::${seasonId || seasonLabel.toLowerCase()}`;
          if (suggestionsByIdentity.has(identityKey)) {
            continue;
          }

          suggestionsByIdentity.set(identityKey, {
            id,
            fullName,
            email,
            phone: String(row?.phone || '').trim(),
            position: String(row?.position || '').trim(),
            jerseyName: String(row?.jersey_name || '').trim(),
            jerseyNumber: row?.jersey_number != null ? String(row.jersey_number).trim() : '',
            jerseySize: String(row?.jersey_size || '').trim(),
            shortsSize: String(row?.shorts_size || '').trim(),
            seasonLabel,
          });
        }

        const suggestions = Array.from(suggestionsByIdentity.values()).slice(0, 5);

        setPlayerSuggestions(suggestions);
        setShowPlayerSuggestions(suggestions.length > 0);
      }, 220);
    },
    [clearPlayerSuggestions, teams]
  );

  const buildTeamJoinUrl = (
    id: string,
    opts?: { invite?: boolean; code?: string; email?: string | null }
  ) => {
    if (typeof window === 'undefined') return '';
    const configured = (import.meta.env.VITE_PUBLIC_SITE_URL || '').trim();
    const base = (configured || window.location.origin).replace(/\/+$/, '');
    const url = new URL(`${base}/portal/register`);
    url.searchParams.set('type', 'join');
    url.searchParams.set('team', id);
    const code = (opts?.code || '').trim();
    if (code) {
      url.searchParams.set('code', code);
    }
    if (opts?.invite) {
      url.searchParams.set('invite', '1');
    }
    const emailParam = (opts?.email || '').trim();
    if (emailParam) {
      url.searchParams.set('email', emailParam);
    }
    return url.toString();
  };

  const buildInviteRedirectUrl = (id: string, code?: string) => {
    if (typeof window === 'undefined') return '';
    const configured = (import.meta.env.VITE_PUBLIC_SITE_URL || '').trim();
    const base = (configured || window.location.origin).replace(/\/+$/, '');
    const joinUrl = buildTeamJoinUrl(id, { invite: true, code });
    if (!joinUrl) return '';
    const url = new URL(`${base}/auth/callback`);
    url.searchParams.set('next', joinUrl);
    return url.toString();
  };

  const selectedTeam = useMemo(() => {
    if (!teamId) return null;
    return teams.find((team) => team.id === teamId) || null;
  }, [teamId, teams]);

  const joinCode = useMemo(() => {
    const candidate =
      (selectedTeam as any)?.shortName ||
      form.shortName ||
      '';
    return candidate.toString().trim().toUpperCase();
  }, [selectedTeam, form.shortName]);

  const joinLink = useMemo(() => {
    if (!teamId) return '';
    return buildTeamJoinUrl(teamId, { code: joinCode });
  }, [teamId, joinCode]);

  const selectedTeamSeasonId = useMemo(
    () => String((selectedTeam as any)?.seasonId || '').trim(),
    [selectedTeam]
  );

  const findUserIdByEmail = async (email: string): Promise<string | null> => {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id')
        .or(`email.eq.${normalized},email_address.eq.${normalized}`)
        .limit(1);
      if (!error && data?.[0]?.user_id) return data[0].user_id;
    } catch (err) {
      console.warn('profiles email lookup failed', err);
    }

    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .select('user_id')
          .or(`email.eq.${normalized},email_address.eq.${normalized}`)
          .limit(1);
        if (!error && data?.[0]?.user_id) return data[0].user_id;
      } catch (err) {
        console.warn('profiles email lookup (admin) failed', err);
      }

      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(normalized);
        if (!error && data?.user?.id) return data.user.id;
      } catch (err) {
        console.warn('auth email lookup failed', err);
      }
    }

    return null;
  };

  const inviteUserByEmail = async (
    email: string
  ): Promise<{ userId: string | null; error?: string }> => {
    const normalized = normalizeEmail(email);
    if (!normalized) return { userId: null, error: 'Missing email.' };
    if (!supabaseAdmin) {
      return { userId: null, error: 'Missing admin service key for invites.' };
    }
    try {
      const redirectTo = teamId
        ? buildInviteRedirectUrl(teamId, joinCode)
        : joinLink || window.location.origin;
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalized, {
        redirectTo,
      });
      if (error) return { userId: null, error: error.message };
      return { userId: data?.user?.id ?? null };
    } catch (err: any) {
      return { userId: null, error: err?.message || 'Invite failed.' };
    }
  };

  const loadPlayerColumns = async () => {
    if (playerColumns.size) return playerColumns;
    if (!supabaseAdmin) return playerColumns;
    try {
      const { data, error } = await supabaseAdmin.from('players').select('*').limit(1);
      if (!error && data?.[0]) {
        const columns = new Set(Object.keys(data[0]));
        setPlayerColumns(columns);
        return columns;
      }
    } catch (err) {
      console.warn('player columns lookup failed', err);
    }
    return playerColumns;
  };

  const handleCopyJoinLink = async () => {
    if (!joinLink) return;
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1800);
    } catch (err) {
      console.warn('copy join link failed', err);
    }
  };

  const handleCopyJoinCode = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCodeCopySuccess(true);
      setTimeout(() => setCodeCopySuccess(false), 1800);
    } catch (err) {
      console.warn('copy join code failed', err);
    }
  };

  const loadPaymentStatus = async (uid: string) => {
    const asPay = (val: any): PaymentStatus | null =>
      val === 'paid' || val === 'pending' || val === 'pending-stripe' || val === 'unknown' ? val : null;
    try {
      const { data } = await supabase.from('profiles').select('payment_status').eq('user_id', uid).maybeSingle();
      const pay = asPay(data?.payment_status) || 'pending';
      setPaymentStatus(pay);
      try {
        localStorage.setItem(`courtsight_payment_status_${uid}`, pay);
      } catch {}
    } catch {
      const cached = asPay(localStorage.getItem(`courtsight_payment_status_${uid}`));
      setPaymentStatus(cached || 'pending');
    }
  };

  const signPublicUrl = async (path?: string | null) => {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    try {
      const marker = 'team-assets/';
      const idx = path.indexOf(marker);
      const cleanPath = idx >= 0 ? path.slice(idx + marker.length) : path;
      const { data, error } = await supabase.storage.from('team-assets').createSignedUrl(cleanPath, 60 * 60 * 24 * 365);
      if (error) throw error;
      return data?.signedUrl || path;
    } catch {
      return path;
    }
  };

  const uploadFile = async (file: File) => {
    const ext = file.name.split('.').pop() || 'bin';
    const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('team-assets').upload(key, file, { upsert: true });
    if (error) throw error;
    return key;
  };

  const persistJerseyDesignSlot = async (index: number, file: File | null) => {
    if (!teamId || !selectedTeamSeasonId) {
      throw new Error('Select a team with an assigned season before uploading jersey inspirations.');
    }
    const settings = await loadJerseyManagementSettings();
    const current =
      settings.teams.find((row) => row.teamId === teamId && row.seasonId === selectedTeamSeasonId) || null;
    const nextPaths = [...(current?.uploadedDesignPaths || emptyJerseyDesignSlots())];
    while (nextPaths.length < 3) nextPaths.push(null as any);
    if (file) {
      const uploadedPath = await uploadFile(file);
      nextPaths[index] = uploadedPath;
    } else {
      nextPaths[index] = null as any;
    }
    const normalizedPaths = nextPaths.filter(Boolean) as string[];
    const next = upsertTeamJerseyWorkflow(settings, {
      teamId,
      seasonId: selectedTeamSeasonId,
      status: current?.status || 'pending_review',
      uploadedDesignPaths: normalizedPaths,
      approvedDesignPath: current?.approvedDesignPath || null,
      finalMockupPath: current?.finalMockupPath || null,
    });
    await saveJerseyManagementSettings(next);
    const nextSlots = emptyJerseyDesignSlots();
    normalizedPaths.slice(0, 3).forEach((path, slotIndex) => {
      nextSlots[slotIndex] = path;
    });
    setJerseyDesignSlots(nextSlots);
  };

  const loadProfilesByUserIds = async (userIds: string[]) => {
    if (!userIds.length) return [] as any[];
    const run = async (client: typeof supabase) => {
      const { data, error } = await client
        .from('profiles')
        .select('user_id,email,email_address,phone')
        .in('user_id', userIds);
      if (error) throw error;
      return data || [];
    };
    try {
      return await run(supabase);
    } catch {
      if (!supabaseAdmin) return [];
      try {
        return await run(supabaseAdmin as any);
      } catch {
        return [];
      }
    }
  };

  const loadRecentPlayerDetailsByUserIds = async (userIds: string[]) => {
    if (!userIds.length) return [] as any[];
    const variants = [
      'id,user_id,jersey_number,position,phone,email,email_address,created_at',
      'id,user_id,jersey_number,position,phone,email,created_at',
      'id,user_id,jersey_number,position,phone,email_address,created_at',
      'id,user_id,jersey_number,position,phone,created_at',
      'id,user_id,jersey_number,position,created_at',
      'id,user_id,jersey_number,created_at',
      'id,user_id,position,created_at',
      'id,user_id,created_at',
    ];
    const isMissingColumn = (error: any) => {
      const code = (error?.code || '').toString();
      const msg = (error?.message || '').toString().toLowerCase();
      return code === '42703' || msg.includes('column') || msg.includes('does not exist');
    };
    const run = async (client: typeof supabase) => {
      let lastErr: any = null;
      for (const selectQuery of variants) {
        const { data, error } = await client
          .from('players')
          .select(selectQuery)
          .in('user_id', userIds)
          .order('created_at', { ascending: false });
        if (!error) return data || [];
        lastErr = error;
        if (!isMissingColumn(error)) break;
      }
      throw lastErr;
    };
    try {
      return await run(supabase);
    } catch {
      if (!supabaseAdmin) return [];
      try {
        return await run(supabaseAdmin as any);
      } catch {
        return [];
      }
    }
  };

  const enrichRosterRows = async (rows: any[]) => {
    const userIds = Array.from(new Set((rows || []).map((row) => row?.user_id).filter(Boolean)));
    if (!userIds.length) return rows || [];

    const [profiles, recentPlayers] = await Promise.all([
      loadProfilesByUserIds(userIds),
      loadRecentPlayerDetailsByUserIds(userIds),
    ]);

    const profileMap = new Map<string, any>();
    (profiles || []).forEach((profile: any) => {
      if (profile?.user_id) profileMap.set(profile.user_id, profile);
    });

    const fallbackMap = new Map<string, any>();
    (recentPlayers || []).forEach((player: any) => {
      const uid = player?.user_id;
      if (!uid) return;
      const existing = fallbackMap.get(uid) || {};
      fallbackMap.set(uid, {
        user_id: uid,
        jersey_number:
          existing.jersey_number !== undefined && existing.jersey_number !== null
            ? existing.jersey_number
            : player?.jersey_number ?? null,
        position: existing.position || player?.position || null,
        phone: existing.phone || player?.phone || null,
        email: existing.email || player?.email || null,
        email_address: existing.email_address || player?.email_address || null,
      });
    });

    return (rows || []).map((row) => {
      const uid = row?.user_id || null;
      if (!uid) return row;
      const profile = profileMap.get(uid) || null;
      const fallback = fallbackMap.get(uid) || null;

      const resolvedJersey =
        row?.jersey_number !== undefined && row?.jersey_number !== null
          ? row.jersey_number
          : fallback?.jersey_number ?? null;
      const resolvedPosition = row?.position || fallback?.position || null;
      const resolvedPhone = row?.phone || profile?.phone || fallback?.phone || null;
      const resolvedEmail =
        row?.email ||
        row?.email_address ||
        profile?.email ||
        profile?.email_address ||
        fallback?.email ||
        fallback?.email_address ||
        null;

      return {
        ...row,
        jersey_number: resolvedJersey,
        position: resolvedPosition,
        phone: resolvedPhone,
        email: resolvedEmail,
        email_address: row?.email_address || profile?.email_address || fallback?.email_address || null,
      };
    });
  };

  const fetchRoster = async (tId: string) => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('team_id', tId);
      if (error) throw error;
      const enriched = (await enrichRosterRows(data || [])).filter(isOfficialRosterPlayer);
      setRoster(enriched);
      setPlayerColumns(new Set(Object.keys((enriched || [])[0] || {})));
      return;
    } catch (err) {
      console.warn('roster load failed', err);
    }
    // fallback to admin client if available
    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('players')
          .select('*')
          .eq('team_id', tId);
        if (error) throw error;
        const enriched = (await enrichRosterRows(data || [])).filter(isOfficialRosterPlayer);
        setRoster(enriched);
        setPlayerColumns(new Set(Object.keys((enriched || [])[0] || {})));
      } catch (err) {
        console.warn('roster admin load failed', err);
        setRoster([]);
      }
    } else {
      setRoster([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setError('You must be logged in to manage a team.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      await loadPaymentStatus(user.id);
      try {
        if (isAdmin) {
          const { data } = await supabase.from('teams').select('id,name,division,logo_url,banner_url,short_name,season_id');
          const mapped = (data || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            division: (t as any).division || '',
            logoUrl: t.logo_url || '',
            bannerUrl: t.banner_url || '',
            shortName: (t as any).short_name || '',
            seasonId: t.season_id,
            wins: 0,
            losses: 0,
            ties: 0,
            pointsFor: 0,
            pointsAgainst: 0,
          })) as Team[];
          const filteredTeams =
            isAdmin && captainTeamIds.length
              ? mapped.filter((team) => captainTeamIds.includes(team.id))
              : mapped;
          setTeams(filteredTeams);
          const resolveCaptainTeamId = async (): Promise<string | null> => {
            try {
              const { data: current } = await supabase
                .from('seasons')
                .select('id')
                .eq('is_current', true)
                .maybeSingle();
              if (current?.id) {
                const { data: captain } = await supabase
                  .from('players')
                  .select('team_id,created_at')
                  .eq('user_id', user.id)
                  .eq('is_captain', true)
                  .eq('season_id', current.id)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (captain?.team_id) return captain.team_id;
              }
            } catch {}
            try {
              const { data: captain } = await supabase
                .from('players')
                .select('team_id,created_at')
                .eq('user_id', user.id)
                .eq('is_captain', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              return captain?.team_id || null;
            } catch {
              return null;
            }
          };

          let preferredTeamId: string | null = null;
          if (user) {
            preferredTeamId = await resolveCaptainTeamId();
          }

          const defaultTeam =
            (requestedTeamId && filteredTeams.find((t) => t.id === requestedTeamId)) ||
            (preferredTeamId && filteredTeams.find((t) => t.id === preferredTeamId)) ||
            filteredTeams[0] ||
            null;
          if (defaultTeam) {
            setTeamId(defaultTeam.id);
            setForm({
              name: defaultTeam.name || '',
              shortName: (defaultTeam as any).shortName || '',
              division: defaultTeam.division || '',
              bannerUrl: defaultTeam.bannerUrl || '',
              logoUrl: defaultTeam.logoUrl || '',
            });
            setLogoPreview(await signPublicUrl(defaultTeam.logoUrl || ''));
            setBannerPreview(await signPublicUrl(defaultTeam.bannerUrl || ''));
            await fetchRoster(defaultTeam.id);
          } else {
            setTeamId('');
            setForm({
              name: '',
              shortName: '',
              division: '',
              bannerUrl: '',
              logoUrl: '',
            });
            setRoster([]);
            setLogoPreview('');
            setBannerPreview('');
          }
        } else {
          // captain: load all captain teams and default to current season (or latest)
          const { data: currentSeason } = await supabase
            .from('seasons')
            .select('id')
            .eq('is_current', true)
            .maybeSingle();

          const { data: captainRows, error: captainErr } = await supabase
            .from('players')
            .select('team_id,season_id,created_at')
            .eq('user_id', user.id)
            .eq('is_captain', true)
            .order('created_at', { ascending: false });
          if (captainErr) throw captainErr;

          const orderedCaptainTeamIds = Array.from(
            new Set((captainRows || []).map((row: any) => row?.team_id).filter(Boolean))
          ) as string[];

          if (!orderedCaptainTeamIds.length) {
            setError('No team found for your account.');
            setLoading(false);
            return;
          }

          const { data: teamRows, error: teamErr } = await supabase
            .from('teams')
            .select('id,name,division,logo_url,banner_url,short_name,season_id')
            .in('id', orderedCaptainTeamIds);
          if (teamErr) throw teamErr;

          const byId = new Map(
            (teamRows || []).map((row: any) => [
              row.id,
              {
                id: row.id,
                name: row.name,
                division: row.division || '',
                logoUrl: row.logo_url || '',
                bannerUrl: row.banner_url || '',
                shortName: row.short_name || '',
                seasonId: row.season_id,
                wins: 0,
                losses: 0,
                ties: 0,
                pointsFor: 0,
                pointsAgainst: 0,
              } as Team,
            ])
          );
          const captainTeams = orderedCaptainTeamIds
            .map((id) => byId.get(id))
            .filter(Boolean) as Team[];

          if (!captainTeams.length) {
            setError('No active team records found for your captain profile.');
            setLoading(false);
            return;
          }

          setTeams(captainTeams);
          const preferredCurrentSeasonTeamId =
            currentSeason?.id
              ? (captainRows || []).find(
                  (row: any) => row?.season_id === currentSeason.id && row?.team_id && byId.has(row.team_id)
                )?.team_id || null
              : null;
          const defaultCaptainTeamId =
            (requestedTeamId && captainTeams.find((team) => team.id === requestedTeamId)?.id) ||
            preferredCurrentSeasonTeamId ||
            orderedCaptainTeamIds.find((id) => byId.has(id)) ||
            null;
          const defaultCaptainTeam =
            (defaultCaptainTeamId && captainTeams.find((team) => team.id === defaultCaptainTeamId)) ||
            captainTeams[0];

          if (defaultCaptainTeam) {
            setTeamId(defaultCaptainTeam.id);
            setForm({
              name: defaultCaptainTeam.name || '',
              shortName: (defaultCaptainTeam as any).shortName || '',
              division: (defaultCaptainTeam as any).division || '',
              bannerUrl: defaultCaptainTeam.bannerUrl || '',
              logoUrl: defaultCaptainTeam.logoUrl || '',
            });
            setLogoPreview(await signPublicUrl(defaultCaptainTeam.logoUrl || ''));
            setBannerPreview(await signPublicUrl(defaultCaptainTeam.bannerUrl || ''));
            await fetchRoster(defaultCaptainTeam.id);
          }
        }
      } catch (err: any) {
        console.error('manage team load error', err);
        setError('Unable to load team.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, isAdmin, captainTeamIds, requestedTeamId]);

  const resetCropControls = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }, []);

  const handleCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleCropperMediaLoaded = useCallback(() => {
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
  }, []);

  const handleCropCancel = useCallback(() => {
    setCroppingState(null);
    resetCropControls();
  }, [resetCropControls]);

  useEffect(() => {
    if (!croppingState) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCropCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [croppingState, handleCropCancel]);

  useEffect(() => {
    return () => {
      if (croppingState?.src) {
        URL.revokeObjectURL(croppingState.src);
      }
    };
  }, [croppingState]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'bannerUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const aspect = field === 'logoUrl' ? 1 : 4;
    const preview = URL.createObjectURL(file);
    setMessage(null);
    setError(null);
    setCroppingState({
      file,
      src: preview,
      field,
      aspect,
    });
    resetCropControls();
    e.target.value = '';
  };

  const openCropFromExisting = useCallback(
    async (field: 'logoUrl' | 'bannerUrl') => {
      const existingKey = form[field];
      if (!existingKey) {
        setError('No image available to adjust. Upload one first.');
        return;
      }
      try {
        setLoadingField(field);
        setMessage(null);
        setError(null);
        const signed = await signPublicUrl(existingKey);
        const response = await fetch(signed);
        if (!response.ok) {
          throw new Error('Unable to load the current image.');
        }
        const blob = await response.blob();
        const fileName = existingKey.split('/').pop() || `${field}.png`;
        const file = new File([blob], fileName, { type: blob.type || 'image/png' });
        const preview = URL.createObjectURL(file);
        setCroppingState({
          file,
          src: preview,
          field,
          aspect: field === 'logoUrl' ? 1 : 4,
        });
        resetCropControls();
      } catch (err: any) {
        console.error('reopen crop failed', err);
        setError(err?.message || 'Unable to load image for cropping.');
      } finally {
        setLoadingField(null);
      }
    },
    [form, resetCropControls]
  );

  const persistFileForField = async (file: File, field: 'logoUrl' | 'bannerUrl') => {
    const key = await uploadFile(file);
    const signed = await signPublicUrl(key);
    setForm((prev) => ({ ...prev, [field]: key }));
    if (field === 'logoUrl') {
      setLogoPreview(signed);
    } else {
      setBannerPreview(signed);
    }
  };

  const handleCropSave = async () => {
    if (!croppingState || !croppedAreaPixels) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const croppedBlob = await getCroppedImageBlob(croppingState.src, croppedAreaPixels);
      const baseName = croppingState.file.name.replace(/\.[^.]+$/, '') || 'cropped';
      const croppedFile = new File([croppedBlob], `${baseName}.png`, { type: 'image/png' });
      await persistFileForField(croppedFile, croppingState.field);
      handleCropCancel();
    } catch (err: any) {
      setError(err?.message || 'Upload failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleUseOriginal = async () => {
    if (!croppingState) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await persistFileForField(croppingState.file, croppingState.field);
      handleCropCancel();
    } catch (err: any) {
      setError(err?.message || 'Upload failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveAudit = async (team: string, changes: Record<string, any>) => {
    try {
      const payload = {
        team_id: team,
        actor_id: user?.id || null,
        actor_role: user?.role || null,
        changes,
      };
      if (supabaseAdmin) {
        await supabaseAdmin.from('team_audit_logs').insert(payload);
      } else {
        await supabase.from('team_audit_logs').insert(payload);
      }
    } catch (err) {
      console.warn('audit log insert failed (non-blocking)', err);
    }
  };

  const handleSave = async () => {
    if (!teamId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalizedShortName = (form.shortName || '').trim().toUpperCase();
      if (normalizedShortName) {
        const { data: dupRows, error: dupErr } = await supabase
          .from('teams')
          .select('id')
          .ilike('short_name', normalizedShortName)
          .neq('id', teamId)
          .limit(1);
        if (dupErr) {
          const msg = (dupErr.message || '').toString().toLowerCase();
          const code = (dupErr.code || '').toString();
          const missingShortName = code === '42703' || (msg.includes('short_name') && msg.includes('column'));
          if (!missingShortName) throw dupErr;
        } else if ((dupRows || []).length) {
          setError(`Team code "${normalizedShortName}" is already in use. Use a unique team code.`);
          setSaving(false);
          return;
        }
      }

      const payload: any = {
        name: form.name.trim(),
        division: form.division || null,
        short_name: normalizedShortName || null,
      };
      if (form.logoUrl) payload.logo_url = form.logoUrl;
      if (form.bannerUrl) payload.banner_url = form.bannerUrl;
      const { error: updErr } = await supabase.from('teams').update(payload).eq('id', teamId);
      if (updErr) throw updErr;
      await saveAudit(teamId, payload);
      setMessage('Team updated successfully.');
    } catch (err: any) {
      console.error('manage team save error', err);
      setError(err?.message || 'Failed to update team.');
    } finally {
      setSaving(false);
    }
  };


  const resetPlayerForm = () =>
    setPlayerForm({
      id: null,
      firstName: '',
      lastName: '',
      jerseyName: '',
      jerseyNumber: '',
      jerseySize: 'L',
      shortsSize: 'L',
      position: '',
      phone: '',
      email: '',
    });

  const openAddPlayerModal = () => {
    resetPlayerForm();
    clearPlayerSuggestions();
    setRosterModalOpen(true);
  };

  const handleSavePlayer = async () => {
    if (!teamId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const teamRow = teams.find((t) => t.id === teamId);
      const existingPlayer = playerForm.id ? roster.find((row) => row?.id === playerForm.id) || null : null;
      const normalizedEmail = normalizeEmail(playerForm.email || '');
      const existingEmail = normalizeEmail(
        String(existingPlayer?.email || existingPlayer?.email_address || '').trim()
      );
      const hasLinkedUser = Boolean(existingPlayer?.user_id);
      const shouldSendClaimInvite =
        Boolean(normalizedEmail) &&
        !hasLinkedUser &&
        (!playerForm.id || normalizedEmail !== existingEmail);
      if (playerForm.email && !isValidEmail(normalizedEmail)) {
        setError('Enter a valid email address for the player.');
        setSaving(false);
        return;
      }
      const columnSet = await loadPlayerColumns();
      const jerseyNumberDigits = normalizeJerseyNumberInput(playerForm.jerseyNumber);
      if (!jerseyNumberDigits) {
        setError('Jersey number is required.');
        setSaving(false);
        return;
      }

      const payload: any = {
        team_id: teamId,
        season_id: (teamRow as any)?.seasonId || null,
        first_name: playerForm.firstName.trim() || 'Player',
        last_name: playerForm.lastName.trim() || '',
        jersey_number: jerseyNumberDigits,
        position: playerForm.position || null,
        phone: playerForm.phone || null,
      };
      if (columnSet.has('jersey_name')) {
        payload.jersey_name = playerForm.jerseyName.trim() || null;
      }
      if (columnSet.has('jersey_size')) {
        payload.jersey_size = playerForm.jerseySize || null;
      }
      if (columnSet.has('shorts_size')) {
        payload.shorts_size = playerForm.shortsSize || null;
      }
      if (normalizedEmail) {
        if (columnSet.has('email_address')) {
          payload.email_address = normalizedEmail;
        } else if (columnSet.has('email')) {
          payload.email = normalizedEmail;
        }
      }
      const savedMessage = playerForm.id ? 'Player updated.' : 'Player saved.';
      const playerName = `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || 'Player';
      let savedPlayerId: string | null = playerForm.id || null;
      if (playerForm.id) {
        const { error: updErr } = await supabase.from('players').update(payload).eq('id', playerForm.id);
        if (updErr) throw updErr;
        await saveAudit(teamId, { player_id: playerForm.id, action: 'update-player', payload });
        await notifyFullAdminsOfRosterChange('update-player', playerName);
      } else {
        const { data: insRow, error: insErr } = await supabase
          .from('players')
          .insert(payload)
          .select('id')
          .single();
        if (insErr) throw insErr;
        savedPlayerId = insRow?.id || null;
        await saveAudit(teamId, { action: 'insert-player', payload });
        await notifyFullAdminsOfRosterChange('add-player', playerName);
      }
      await fetchRoster(teamId);
      resetPlayerForm();
      clearPlayerSuggestions();
      setRosterModalOpen(false);
      if (shouldSendClaimInvite) {
        const teamName = teamRow?.name || 'your team';
        const seasonLabel = (teamRow as any)?.seasonName || 'current season';
        const inviteLink = buildTeamJoinUrl(teamId, {
          invite: true,
          code: joinCode,
          email: normalizedEmail,
        });
        try {
          await sendPlayerClaimEmail({
            playerId: savedPlayerId,
            email: normalizedEmail,
            playerName,
            teamName,
            teamId,
            teamCode: joinCode || null,
            seasonName: seasonLabel,
            inviteLink,
            deliveryMode: 'portal_registration',
          });
          setMessage(`${savedMessage} Invite email sent.`);
        } catch (emailErr: any) {
          console.warn('player claim email failed', emailErr);
          const reason = String(emailErr?.message || '').trim();
          setError(reason ? `Invite email failed: ${reason}` : 'Invite email failed.');
          setMessage(savedMessage);
        }
      } else {
        setMessage(savedMessage);
      }
    } catch (err: any) {
      console.error('player save error', err);
      setError(err?.message || 'Failed to save player.');
    } finally {
      setSaving(false);
    }
  };

  async function notifyFullAdminsOfRosterChange(
    action: 'add-player' | 'update-player' | 'remove-player',
    playerName: string
  ) {
    try {
      const loadAdmins = async (client: typeof supabase) => {
        const { data, error } = await client.from('admin_users').select('user_id,role');
        if (error) throw error;
        return data || [];
      };

      let adminRows: any[] = [];
      try {
        adminRows = await loadAdmins(supabase);
      } catch {
        if (supabaseAdmin) {
          adminRows = await loadAdmins(supabaseAdmin as any);
        }
      }

      const fullAdminIds = Array.from(
        new Set(
          adminRows
            .filter((row: any) => String(row?.role || '').trim().toUpperCase() === Role.ADMIN_FULL)
            .map((row: any) => String(row?.user_id || '').trim())
            .filter(Boolean)
        )
      );
      if (!fullAdminIds.length) return;

      const teamName = selectedTeam?.name || form.name || 'a team';
      const actorName = user?.name || user?.email || 'A team captain';
      const actionLabel =
        action === 'add-player' ? 'added' : action === 'remove-player' ? 'removed' : 'updated';

      await createNotifications(
        fullAdminIds.map((userId) => ({
          userId,
          role: null,
          teamId,
          type: 'team_update',
          title: 'Roster Change Submitted',
          body: `${actorName} ${actionLabel} ${playerName} on ${teamName}.`,
          link: teamId ? `/manage-team?team=${encodeURIComponent(teamId)}` : '/manage-team',
          metadata: {
            source: 'manage-team-roster',
            action,
            teamId,
            teamName,
            playerName,
            actorId: user?.id || null,
            actorRole: user?.role || null,
          },
        }))
      );
    } catch (err) {
      console.warn('full admin roster notification failed', err);
    }
  }

  const handleEmailNonUsers = async () => {
    if (emailBlastLoading) return;
    if (!supabaseAdmin) {
      setError('Admin service credentials are required to email unlinked players.');
      return;
    }
    if (!teamId) {
      setMessage('Select a team before emailing non-user players.');
      return;
    }
    setError(null);
    setMessage(null);
    setEmailBlastLoading(true);
    try {
      const columnSet = await loadPlayerColumns();
      const emailColumns: string[] = [];
      if (columnSet.has('email')) emailColumns.push('email');
      if (columnSet.has('email_address')) emailColumns.push('email_address');
      if (!emailColumns.length) {
        setMessage('Players table has no email/email_address column yet. Run server/players_contact_columns.sql first.');
        return;
      }
      const selectFields = ['id', 'first_name', 'last_name', 'team_id', ...emailColumns].join(',');
      const { data, error } = await supabaseAdmin
        .from('players')
        .select(selectFields)
        .is('user_id', null)
        .eq('team_id', teamId);
      if (error) throw error;
      const teamMap = new Map(teams.map((t) => [t.id, t]));
      const inviteTargets = (data || [])
        .map((row: any) => {
          const email = normalizeEmail((row.email || row.email_address || '').trim());
          if (!email) return null;
          return {
            playerId: row.id || null,
            teamId: row.team_id || null,
            email,
            playerName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Player',
          };
        })
        .filter(Boolean) as Array<{
        playerId: string | null;
        teamId: string | null;
        email: string;
        playerName: string;
      }>;
      if (!inviteTargets.length) {
        setMessage('No unlinked players with an email address were found.');
        return;
      }
      let sentCount = 0;
      let failureCount = 0;
      let firstFailureReason = '';
      for (const target of inviteTargets) {
        const resolvedTeamId = target.teamId || teamId || null;
        const teamRecord = resolvedTeamId ? teamMap.get(resolvedTeamId) : null;
        const teamName = teamRecord?.name || 'your team';
        const seasonLabel = (teamRecord as any)?.seasonName || 'current season';
        const teamCode =
          String((teamRecord as any)?.shortName || '').trim().toUpperCase() ||
          String(joinCode || '').trim().toUpperCase() ||
          null;
        const inviteLink = buildTeamJoinUrl(resolvedTeamId || teamId, {
          invite: true,
          code: teamCode || undefined,
          email: target.email,
        });
        try {
          await sendPlayerClaimEmail({
            playerId: target.playerId,
            email: target.email,
            playerName: target.playerName,
            teamName,
            teamId: resolvedTeamId,
            teamCode,
            seasonName: seasonLabel,
            inviteLink,
            deliveryMode: 'portal_registration',
          });
          sentCount += 1;
        } catch (sendErr: any) {
          console.warn('email blast failed for', target.email, sendErr);
          failureCount += 1;
          if (!firstFailureReason) {
            firstFailureReason = String(sendErr?.message || '').trim();
          }
        }
      }
      if (sentCount) {
        setMessage(`Invite emails queued for ${sentCount} unlinked player${sentCount === 1 ? '' : 's'}.`);
      }
      if (!sentCount) {
        setMessage('No unlinked players with an email address were found.');
      }
      if (failureCount) {
        const summary = `${failureCount} invitation email${failureCount === 1 ? '' : 's'} failed to send.`;
        setError(firstFailureReason ? `${summary} First error: ${firstFailureReason}` : summary);
      }
    } catch (err: any) {
      console.error('email blast error', err);
      setError(err?.message || 'Failed to send invite emails to unlinked players.');
    } finally {
      setEmailBlastLoading(false);
    }
  };

  const handleRemovePlayer = async (pid: string) => {
    if (!teamId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const removedPlayer = roster.find((row) => row?.id === pid) || null;
      const { error } = await supabase.from('players').update({ team_id: null }).eq('id', pid);
      if (error) throw error;
      await saveAudit(teamId, { action: 'detach-player', player_id: pid });
      await notifyFullAdminsOfRosterChange(
        'remove-player',
        `${removedPlayer?.first_name || ''} ${removedPlayer?.last_name || ''}`.trim() || 'Player'
      );
      await fetchRoster(teamId);
    } catch (err: any) {
      console.error('remove player error', err);
      setError(err?.message || 'Failed to remove player.');
    } finally {
      setSaving(false);
    }
  };

  const handleJerseyDesignFileChange = async (
    index: number,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file for jersey inspiration.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await persistJerseyDesignSlot(index, file);
      setMessage(`Jersey inspiration ${index + 1} uploaded.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to upload jersey inspiration.');
    } finally {
      setSaving(false);
    }
  };

  const clearJerseyDesignSlot = async (index: number) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await persistJerseyDesignSlot(index, null);
      setMessage(`Jersey inspiration ${index + 1} removed.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to remove jersey inspiration.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadJerseySlots = async () => {
      if (!teamId || !selectedTeamSeasonId) {
        setJerseyDesignSlots(emptyJerseyDesignSlots());
        return;
      }
      try {
        const settings = await loadJerseyManagementSettings();
        if (cancelled) return;
        const current =
          settings.teams.find((row) => row.teamId === teamId && row.seasonId === selectedTeamSeasonId) || null;
        const nextSlots = emptyJerseyDesignSlots();
        (current?.uploadedDesignPaths || []).slice(0, 3).forEach((path, index) => {
          nextSlots[index] = path;
        });
        setJerseyDesignSlots(nextSlots);
      } catch (err) {
        if (!cancelled) {
          console.warn('manage team jersey workflow load failed', err);
          setJerseyDesignSlots(emptyJerseyDesignSlots());
        }
      }
    };
    loadJerseySlots();
    return () => {
      cancelled = true;
    };
  }, [teamId, selectedTeamSeasonId]);

  useEffect(() => {
    return () => {
      if (playerSuggestionTimerRef.current) {
        window.clearTimeout(playerSuggestionTimerRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
        <LoadingOverlay message="Loading..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
        <div className="text-white text-xl font-sports">{error}</div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-brand-grey font-bold">Team Management</p>
            <h1 className="text-3xl font-sports text-white uppercase">Edit Team</h1>
          </div>
          {/*
            Payment-based status badge temporarily disabled.
            Keep this block commented so it can be restored if needed.
          */}
          {/*
          <div className={`px-3 py-1 rounded-full text-xs uppercase font-bold ${paymentStatus === 'paid' ? 'bg-green-500/10 text-green-300 border border-green-400/50' : 'bg-yellow-500/10 text-yellow-200 border border-yellow-400/50'}`}>
            {paymentStatus === 'paid' ? 'Verified' : 'Payment Pending'}
          </div>
          */}
        </div>

        {joinLink && (
          <div className="bg-brand-dark border border-white/10 rounded-xl p-4">
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-brand-grey font-bold">Shareable Join Link</p>
                  <p className="text-sm text-gray-400">Send this link so players can join your team directly.</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <input
                    readOnly
                    value={joinLink}
                    className="flex-1 bg-black border border-white/20 rounded px-3 py-2 text-xs text-white focus:outline-none"
                  />
                  <button
                    onClick={handleCopyJoinLink}
                    className="px-3 py-2 rounded bg-white/10 text-white text-xs font-bold uppercase hover:bg-white/20"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {joinCode && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-white/10 pt-3">
                  <div>
                    <p className="text-xs uppercase text-brand-grey font-bold">Team Join Code</p>
                    <p className="text-sm text-gray-400">Players can enter this code on the Stats Portal registration page.</p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      readOnly
                      value={joinCode}
                      className="flex-1 bg-black border border-white/20 rounded px-3 py-2 text-xs text-white focus:outline-none"
                    />
                    <button
                      onClick={handleCopyJoinCode}
                      className="px-3 py-2 rounded bg-white/10 text-white text-xs font-bold uppercase hover:bg-white/20"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {!joinCode && (
                <div className="text-xs text-gray-500 border-t border-white/10 pt-3">
                  Add a value in <span className="text-white">Short Name</span> to generate a reusable team code.
                </div>
              )}
            </div>

            {copySuccess && (
              <div className="text-xs text-brand-lime mt-2">Invite link copied.</div>
            )}
            {codeCopySuccess && (
              <div className="text-xs text-brand-lime mt-1">Team code copied.</div>
            )}
          </div>
        )}

        {(teams.length > 1 || isAdmin) && (
          <div>
            <label className="block text-xs uppercase text-brand-grey font-bold mb-2">Select Team</label>
            <select
              value={teamId}
              onChange={(e) => {
                const t = teams.find((tm) => tm.id === e.target.value);
                setTeamId(e.target.value);
                if (t) {
                  setForm({
                    name: t.name || '',
                    shortName: (t as any).shortName || '',
                    division: t.division || '',
                    bannerUrl: t.bannerUrl || '',
                    logoUrl: t.logoUrl || '',
                  });
                  fetchRoster(t.id);
                  signPublicUrl(t.logoUrl || '').then(setLogoPreview);
                  signPublicUrl(t.bannerUrl || '').then(setBannerPreview);
                } else {
                  setForm({
                    name: '',
                    shortName: '',
                    division: '',
                    bannerUrl: '',
                    logoUrl: '',
                  });
                  setRoster([]);
                  setLogoPreview('');
                  setBannerPreview('');
                }
              }}
              className="w-full appearance-none bg-black border border-white/20 rounded pl-4 pr-12 py-3 text-white focus:border-brand-lime"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '12px 8px',
              }}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase text-brand-grey font-bold mb-2">Team Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-brand-grey font-bold mb-2">Team Code (Short Name)</label>
            <input
              value={form.shortName}
              onChange={(e) => setForm((p) => ({ ...p, shortName: e.target.value }))}
              className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              This is the shareable code players can enter in Stats Portal registration.
            </p>
          </div>
          <div>
            <label className="block text-xs uppercase text-brand-grey font-bold mb-2">Division</label>
            <input
              value={form.division}
              onChange={(e) => setForm((p) => ({ ...p, division: e.target.value }))}
              className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="block text-xs uppercase text-brand-grey font-bold">Logo</label>
            {logoPreview ? (
              <div className={`relative inline-flex w-20 h-20 rounded-full overflow-hidden border border-white/10 ${isLogoLoading ? 'pointer-events-none' : ''}`}>
                <img
                  src={logoPreview}
                  alt="Logo"
                  className={`w-full h-full object-cover cursor-pointer transition duration-200 ${isLogoLoading ? 'opacity-70' : 'hover:border-brand-lime'}`}
                  role="button"
                  tabIndex={isLogoLoading ? -1 : 0}
                  aria-disabled={isLogoLoading}
                  title="Edit current logo"
                  onClick={() => {
                    if (!isLogoLoading) openCropFromExisting('logoUrl');
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === 'Enter' || event.key === ' ') && !isLogoLoading) {
                      event.preventDefault();
                      openCropFromExisting('logoUrl');
                    }
                  }}
                />
                {isLogoLoading && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="logo-loading-ring" />
                  </div>
                )}
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full border border-dashed border-white/20 flex items-center justify-center text-gray-500 text-xs">
                No Logo
              </div>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
              <UploadCloud size={16} />
              <span>Upload Logo</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e, 'logoUrl')} />
            </label>
          </div>
          <div className="md:col-span-2 flex flex-col gap-2">
            <label className="block text-xs uppercase text-brand-grey font-bold">Banner</label>
            {bannerPreview ? (
              <div className={`relative w-full h-40 rounded-xl overflow-hidden border border-white/10 ${isBannerLoading ? 'pointer-events-none' : ''}`}>
                <img
                  src={bannerPreview}
                  alt="Banner"
                  className="w-full h-full object-cover cursor-pointer transition duration-200"
                  role="button"
                  tabIndex={isBannerLoading ? -1 : 0}
                  aria-disabled={isBannerLoading}
                  title="Reopen banner crop"
                  onClick={() => {
                    if (!isBannerLoading) openCropFromExisting('bannerUrl');
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === 'Enter' || event.key === ' ') && !isBannerLoading) {
                      event.preventDefault();
                      openCropFromExisting('bannerUrl');
                    }
                  }}
                />
                {isBannerLoading && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="banner-loading-outline">
                      <span className="banner-loading-edge horizontal top" />
                      <span className="banner-loading-edge horizontal bottom" />
                      <span className="banner-loading-edge vertical left" />
                      <span className="banner-loading-edge vertical right" />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-40 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-gray-500 text-sm">
                No Banner
              </div>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
              <UploadCloud size={16} />
              <span>Upload Banner</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e, 'bannerUrl')} />
            </label>
          </div>
        </div>

        {message && <div className="text-sm text-green-300 bg-green-500/10 border border-green-400/40 rounded px-3 py-2">{message}</div>}
        {error && <div className="text-sm text-brand-red bg-brand-red/10 border border-brand-red/40 rounded px-3 py-2">{error}</div>}

        <div className="flex items-start gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-brand-lime text-black font-sports font-bold uppercase tracking-wide px-3 py-2 text-sm sm:px-5 sm:py-3 sm:text-base rounded shadow-lg hover:scale-[1.01] transition-transform disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Changes'}
            <Save size={14} className="sm:h-4 sm:w-4" />
          </button>
          <div className="flex items-center gap-2 pt-1 text-xs text-gray-500">
            {/*
              Payment-based status icon temporarily disabled.
              Keep this logic commented so it can be restored if needed.
            */}
            {/*
            {paymentStatus === 'paid' ? <ShieldCheck size={14} className="text-green-400" /> : <Shield size={14} className="text-yellow-400" />}
            */}
            <span>Only admins and team captains can edit. Changes are audit-logged.</span>
          </div>
        </div>

        {/* Roster Manager */}
        <div className="mt-10 bg-brand-dark border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs uppercase text-brand-grey font-bold">Roster</p>
            <h2 className="text-2xl font-sports text-white uppercase">Manage Players</h2>
          </div>
          {isAdmin && (
            <button
              onClick={handleEmailNonUsers}
              disabled={emailBlastLoading || saving}
              className="px-3 py-2 rounded bg-white/10 text-white text-xs font-bold uppercase tracking-wide hover:bg-white/20 disabled:opacity-50"
            >
              {emailBlastLoading ? 'Sending to non-user players...' : 'Email non-user players'}
            </button>
          )}
        </div>
          <div className="mb-6 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-[#111111]/90 p-4 md:p-5">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-brand-lime" />
                <h3 className="font-sports text-xl uppercase text-brand-lime">Jersey Design Upload</h3>
              </div>
              <label className="mt-6 block text-xs font-bold uppercase text-brand-grey">
                Upload up to 3 jersey design inspirations (any image format, max 5MB each)
              </label>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                {jerseyDesignSlots.map((path, index) => (
                  <div key={`manage-team-jersey-slot-${index}`}>
                    <div className="rounded-lg border-2 border-dashed border-white/20 bg-black/30 p-4 text-center transition-colors hover:border-brand-lime/50">
                      <input
                        type="file"
                        id={`manage-team-jersey-upload-${index}`}
                        accept="image/*"
                        onChange={(e) => handleJerseyDesignFileChange(index, e)}
                        className="hidden"
                      />
                      <label
                        htmlFor={`manage-team-jersey-upload-${index}`}
                        className="flex cursor-pointer flex-col items-center justify-center"
                      >
                        <Upload className="mb-2 h-7 w-7 text-brand-grey" />
                        <span className="text-sm text-gray-400">
                          {path ? `Replace inspiration ${index + 1}` : `Click to upload inspiration ${index + 1}`}
                        </span>
                      </label>
                    </div>
                    {path && (
                      <div className="mt-3 flex items-center gap-2 rounded-full border border-brand-lime/20 bg-brand-lime/10 px-3 py-2 text-xs text-brand-lime">
                        <span className="truncate max-w-[180px]">{getAssetName(path)}</span>
                        <button type="button" onClick={() => clearJerseyDesignSlot(index)} className="hover:text-white">
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Uploaded: {jerseyDesignSlots.filter(Boolean).length}/3 files optional
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#111111]/90 p-4 md:p-5">
              <div className="flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm font-bold uppercase tracking-wide text-gray-200">Roster Intake</div>
                  <div className="mt-1 text-xs text-gray-400">
                    Add players here. Removing a player from the table below only detaches them from this team.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openAddPlayerModal}
                  disabled={!teamId}
                  className="self-start rounded-lg border border-white/20 bg-white/[0.02] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-white/40 hover:bg-white/[0.05] disabled:opacity-60"
                >
                  Add Player
                </button>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-gray-500">
                Use <span className="font-semibold text-white">Add Player</span> to open the player form. The roster list below stays as your main team list.
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {roster.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {p.id ? (
                      <Link
                        to={`/player/${p.id}`}
                        state={{ returnPath: `${location.pathname}${location.search}`, returnLabel: 'Manage Team' }}
                        className="font-semibold text-white hover:text-brand-lime transition-colors break-words"
                      >
                        {`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player'}
                      </Link>
                    ) : (
                      <span className="font-semibold text-white break-words">
                        {`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player'}
                      </span>
                    )}
                    <div className="mt-2 space-y-1 text-xs text-gray-400">
                      <div>#{p.jersey_number !== null && p.jersey_number !== undefined && String(p.jersey_number).trim() ? p.jersey_number : '-'}</div>
                      <div>Position: {p.position || '-'}</div>
                      <div className="break-words">Jersey name: {p.jersey_name || 'No jersey name set'}</div>
                      <div>Jersey size: {p.jersey_size || '-'}</div>
                      <div>Shorts size: {p.shorts_size || '-'}</div>
                      <div className="break-words">Phone: {p.phone || '-'}</div>
                      <div className="break-all">Email: {p.email || p.email_address || '-'}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2">
                    <button
                      onClick={() =>
                        (() => {
                          setPlayerForm({
                            id: p.id,
                            firstName: p.first_name || '',
                            lastName: p.last_name || '',
                            jerseyName: p.jersey_name || '',
                            jerseyNumber:
                              p.jersey_number !== null && p.jersey_number !== undefined && String(p.jersey_number).trim()
                                ? String(p.jersey_number)
                                : '',
                            jerseySize: p.jersey_size || 'L',
                            shortsSize: p.shorts_size || 'L',
                            position: p.position || '',
                            phone: p.phone || '',
                            email: p.email || p.email_address || '',
                          });
                          setRosterModalOpen(true);
                        })()
                      }
                      className="text-xs px-3 py-1.5 rounded border border-white/20 text-gray-200 hover:border-brand-lime hover:text-brand-lime"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setPendingRemove(p)}
                      className="text-xs px-3 py-1.5 rounded border border-brand-red/40 text-brand-red hover:bg-brand-red/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {roster.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-5 text-center text-gray-500">
                No players on this team yet.
              </div>
            )}
          </div>

          <div className="hidden rounded-xl border border-white/10 overflow-hidden md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-white/5 text-gray-400 uppercase text-xs font-bold">
                <tr>
                  <th className="px-4 py-3 w-[36%]">Player</th>
                  <th className="px-4 py-3 w-[8%]">#</th>
                  <th className="px-4 py-3 w-[10%]">Position</th>
                  <th className="px-4 py-3 w-[28%]">Contact</th>
                  <th className="px-4 py-3 text-right w-[160px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white">
                {roster.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <div>
                          {p.id ? (
                            <Link
                              to={`/player/${p.id}`}
                              state={{ returnPath: `${location.pathname}${location.search}`, returnLabel: 'Manage Team' }}
                              className="font-semibold hover:text-brand-lime transition-colors"
                            >
                              {`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player'}
                            </Link>
                          ) : (
                            <span className="font-semibold">
                              {`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player'}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 text-xs text-gray-400">
                          <div>{p.jersey_name ? `Jersey name: ${p.jersey_name}` : 'No jersey name set'}</div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <span>Jersey size: {p.jersey_size || '-'}</span>
                            <span>Shorts size: {p.shorts_size || '-'}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {p.jersey_number !== null && p.jersey_number !== undefined && String(p.jersey_number).trim()
                        ? p.jersey_number
                        : '-'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{p.position || '-'}</td>
                    <td className="px-4 py-4">
                      <div className="space-y-1 text-gray-400 break-words">
                        <div>{p.phone || '-'}</div>
                        <div>{p.email || p.email_address || '-'}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
                        <button
                          onClick={() =>
                            (() => {
                              setPlayerForm({
                                id: p.id,
                                firstName: p.first_name || '',
                                lastName: p.last_name || '',
                                jerseyName: p.jersey_name || '',
                                jerseyNumber:
                                  p.jersey_number !== null && p.jersey_number !== undefined && String(p.jersey_number).trim()
                                    ? String(p.jersey_number)
                                    : '',
                                jerseySize: p.jersey_size || 'L',
                                shortsSize: p.shorts_size || 'L',
                                position: p.position || '',
                                phone: p.phone || '',
                                email: p.email || p.email_address || '',
                              });
                              setRosterModalOpen(true);
                            })()
                          }
                          className="text-xs px-3 py-1 rounded border border-white/20 text-gray-200 hover:border-brand-lime hover:text-brand-lime"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setPendingRemove(p)}
                          className="text-xs px-3 py-1 rounded border border-brand-red/40 text-brand-red hover:bg-brand-red/10"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {roster.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-center text-gray-500">
                      No players on this team yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    {rosterModalOpen &&
      typeof document !== 'undefined' &&
      createPortal(
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
          <div
            className="absolute inset-0 bg-black/75"
            onClick={() => {
              setRosterModalOpen(false);
              clearPlayerSuggestions();
              resetPlayerForm();
            }}
          />
          <div className="relative z-[91] flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121212] shadow-2xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 pb-4 pt-4 sm:px-5">
              <div>
                <h3 className="font-sports text-2xl uppercase text-white">
                  {playerForm.id ? 'Edit Player' : 'Add Player'}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  Add players here and they will appear in the roster list below.
                </p>
                <p className="mt-2 text-xs text-brand-lime">
                  Players with an email address can receive an email invite to join this team.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRosterModalOpen(false);
                  resetPlayerForm();
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:border-white/30 hover:text-white"
                aria-label="Close player modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="relative">
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  First Name
                </label>
                <input
                  value={playerForm.firstName}
                  onChange={(e) => {
                    setPlayerForm((p) => ({ ...p, firstName: e.target.value }));
                    setShowPlayerSuggestions(true);
                    queuePlayerSuggestionSearch(`${e.target.value} ${playerForm.lastName}`.trim());
                  }}
                  onFocus={() => {
                    setShowPlayerSuggestions(true);
                    queuePlayerSuggestionSearch(`${playerForm.firstName} ${playerForm.lastName}`.trim());
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setShowPlayerSuggestions(false);
                    }, 140);
                  }}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                />
                {showPlayerSuggestions && playerSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-white/10 bg-[#151515] shadow-2xl">
                    {playerSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyPlayerSuggestion(suggestion)}
                        className="flex w-full flex-col gap-0.5 border-b border-white/5 px-3 py-2.5 text-left hover:bg-white/[0.05] last:border-b-0"
                      >
                        <span className="text-sm text-white">{suggestion.fullName}</span>
                        <span className="text-[11px] text-gray-400">
                          {suggestion.email || 'No email'} · {suggestion.seasonLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Last Name
                </label>
                <input
                  value={playerForm.lastName}
                  onChange={(e) => {
                    setPlayerForm((p) => ({ ...p, lastName: e.target.value }));
                    setShowPlayerSuggestions(true);
                    queuePlayerSuggestionSearch(`${playerForm.firstName} ${e.target.value}`.trim());
                  }}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Player Position
                </label>
                <input
                  value={playerForm.position}
                  onChange={(e) => setPlayerForm((p) => ({ ...p, position: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                  placeholder="e.g. PG"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Jersey Name
                </label>
                <input
                  value={playerForm.jerseyName}
                  onChange={(e) => setPlayerForm((p) => ({ ...p, jerseyName: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                  placeholder="Name on jersey"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Jersey Number
                </label>
                <input
                  value={playerForm.jerseyNumber}
                  onChange={(e) =>
                    setPlayerForm((p) => ({
                      ...p,
                      jerseyNumber: normalizeJerseyNumberInput(e.target.value),
                    }))
                  }
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                  placeholder="000"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Jersey Size
                </label>
                <select
                  value={playerForm.jerseySize}
                  onChange={(e) => setPlayerForm((p) => ({ ...p, jerseySize: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white appearance-none focus:border-brand-lime focus:outline-none"
                >
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Shorts Size
                </label>
                <select
                  value={playerForm.shortsSize}
                  onChange={(e) => setPlayerForm((p) => ({ ...p, shortsSize: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white appearance-none focus:border-brand-lime focus:outline-none"
                >
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Phone
                </label>
                <input
                  value={playerForm.phone}
                  onChange={(e) => setPlayerForm((p) => ({ ...p, phone: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                  placeholder="+1 (416) 555-1234"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Email
                </label>
                <input
                  type="email"
                  value={playerForm.email}
                  onChange={(e) => setPlayerForm((p) => ({ ...p, email: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white focus:border-brand-lime focus:outline-none"
                  placeholder="player@email.com"
                />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-4 sm:px-5">
              <button
                type="button"
                onClick={() => {
                  setRosterModalOpen(false);
                  clearPlayerSuggestions();
                  resetPlayerForm();
                }}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-white/35"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePlayer}
                disabled={saving || !teamId}
                className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-bold uppercase tracking-wide text-black hover:brightness-95 disabled:opacity-60"
              >
                {saving ? 'Saving...' : playerForm.id ? 'Update Player' : 'Add Player'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    {croppingState && (
      <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 px-4 py-6">
        <div
          role="dialog"
          aria-label="Crop uploaded image"
          className="relative w-full max-w-3xl bg-brand-dark border border-white/10 rounded-2xl p-4 sm:p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-white uppercase text-sm font-bold">
              {croppingState.field === 'logoUrl' ? 'Crop Team Logo' : 'Crop Team Banner'}
            </h4>
            <button
              type="button"
              onClick={handleCropCancel}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
            <div className="relative h-72 sm:h-80 rounded-lg overflow-hidden bg-black/30">
              <Cropper
                image={croppingState.src}
                crop={crop}
                zoom={zoom}
                aspect={croppingState.aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
                onMediaLoaded={handleCropperMediaLoaded}
                objectFit="contain"
                minZoom={0.1}
                restrictPosition
                cropShape={isLogoCrop ? 'round' : 'rect'}
                classes={{
                  cropAreaClassName: isLogoCrop ? 'logo-crop-area' : undefined,
                }}
                style={
                  isLogoCrop
                    ? {
                        cropAreaStyle: {
                          borderRadius: '9999px',
                          clipPath: 'circle(50% at 50% 50%)',
                        },
                      }
                    : undefined
                }
              />
              {isLogoCrop && (
                <div className="logo-crop-overlay">
                  <div className="logo-crop-circle" />
                </div>
              )}
            </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-300">
            <span className="uppercase tracking-widest">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="flex-1 h-1 accent-white"
            />
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={handleCropCancel}
              disabled={saving}
              className="px-4 py-2 rounded border border-white/15 text-[11px] uppercase tracking-wide text-gray-300 hover:border-white/40 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUseOriginal}
              disabled={saving}
              className="px-4 py-2 rounded border border-white/15 text-[11px] uppercase tracking-wide text-white hover:border-white/40 disabled:opacity-50"
            >
              Use Original
            </button>
            <button
              type="button"
              onClick={handleCropSave}
              disabled={!croppedAreaPixels || saving}
              className="px-4 py-2 rounded bg-brand-lime text-black text-[11px] uppercase tracking-wide font-bold disabled:opacity-60"
            >
              {saving ? 'Uploading...' : 'Apply Crop & Upload'}
            </button>
          </div>
        </div>
      </div>
    )}
    {pendingRemove && (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="text-white font-sports text-xl uppercase">Remove Player</h4>
                <p className="text-gray-400 text-sm mt-1">This detaches the player from your team but does not delete their account.</p>
              </div>
              <button onClick={() => setPendingRemove(null)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300 space-y-2">
              <div className="text-white font-bold">
                {`${pendingRemove.first_name || ''} ${pendingRemove.last_name || ''}`.trim() || 'Player'}
              </div>
              <div className="text-gray-400">
                Jersey: {pendingRemove.jersey_number ?? '-'} / Position: {pendingRemove.position || '-'}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setPendingRemove(null)}
                className="px-4 py-2 rounded border border-white/20 text-gray-200 hover:border-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = pendingRemove.id;
                  setPendingRemove(null);
                  handleRemovePlayer(id);
                }}
                className="px-4 py-2 rounded bg-brand-red text-white font-bold uppercase shadow hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
      </div>
    )}
    </>
  );
};

export default ManageTeam;















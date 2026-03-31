import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { createNotifications } from '../services/notificationService';
import { Team, Season } from '../types';
import LoadingOverlay from '../components/LoadingOverlay';
import ImageCropper, { CROP_SPECS } from '../components/ImageCropper';
import { Crown, Calendar } from 'lucide-react';
import { normalizeJerseyNumberInput } from '../utils/jerseyNumber';
import { DEFAULT_PLAYER_AVATAR } from '../constants';
import { sendPlayerClaimEmail } from '../services/playerClaimEmailService';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type PlayerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | null;
  position: string | null;
  season_id: string | null;
  team_id: string | null;
  user_id: string | null;
  photo_url: string | null;
  is_captain?: boolean | null;
  birth_date?: string | null;
  phone?: string | null;
  jersey_size?: string | null;
  shorts_size?: string | null;
  jersey_name?: string | null;
  referral_source?: string | null;
  nba_comparison?: string | null;
  instagram?: string | null;
  email?: string | null;
  email_address?: string | null;
  payment_status?: string | null;
};

type LinkedPlayerProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | null;
  position: string | null;
  season_id: string | null;
  team_id: string | null;
  created_at: string | null;
};

type LinkedPlayerProfileView = LinkedPlayerProfileRow & {
  teamName: string | null;
  seasonName: string | null;
};

const AdminPlayer: React.FC = () => {
  const { playerId } = useParams<{ playerId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const fromTeamId = (location.state as any)?.teamId || null;

  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoOpening, setPhotoOpening] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [temporaryCropUrl, setTemporaryCropUrl] = useState<string | null>(null);
  const isCaptain = !!player?.is_captain;
  const [playerColumns, setPlayerColumns] = useState<Set<string>>(new Set());
  const [initialTeamId, setInitialTeamId] = useState<string | null>(null);
  const [initialSeasonId, setInitialSeasonId] = useState<string | null>(null);
  const [initialUserId, setInitialUserId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'pending' | 'pending-stripe' | 'unknown'>('unknown');
  const birthdateRef = useRef<HTMLInputElement | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState<string>('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [sendingClaimInvite, setSendingClaimInvite] = useState(false);
  const [linkedProfiles, setLinkedProfiles] = useState<LinkedPlayerProfileView[]>([]);
  const [linkedProfilesLoading, setLinkedProfilesLoading] = useState(false);
  const [detachIds, setDetachIds] = useState<Set<string>>(new Set());
  const [detaching, setDetaching] = useState(false);
  const [detachAcknowledge, setDetachAcknowledge] = useState(false);

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value.trim());

  const clearTemporaryCropUrl = useCallback(() => {
    setTemporaryCropUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      clearTemporaryCropUrl();
    };
  }, [clearTemporaryCropUrl]);

  const handleCropClose = useCallback(() => {
    clearTemporaryCropUrl();
    setCropSource('');
    setCropFile(null);
    setCropOpen(false);
  }, [clearTemporaryCropUrl]);

  const handleCropFileSelected = useCallback(
    (file: File) => {
      const objectUrl = URL.createObjectURL(file);
      clearTemporaryCropUrl();
      setTemporaryCropUrl(objectUrl);
      setCropSource(objectUrl);
      setCropFile(file);
      setCropOpen(true);
    },
    [clearTemporaryCropUrl]
  );

  const parseBucketPath = useCallback((value: string) => {
    if (!value) return '';
    const marker = '/storage/v1/object/public/team-assets/';
    if (value.includes(marker)) {
      return value.split(marker)[1];
    }
    if (value.startsWith('team-assets/')) {
      return value.replace('team-assets/', '');
    }
    return '';
  }, []);

  const signPhoto = useCallback(
    async (pathOrUrl: string) => {
      if (!pathOrUrl) return '';
      if (/^https?:\/\//i.test(pathOrUrl) && !pathOrUrl.includes('team-assets')) return pathOrUrl;
      const bucket = 'team-assets';
      const cleanPath = parseBucketPath(pathOrUrl) || pathOrUrl.replace(/.*team-assets\//, '');
      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(cleanPath, 60 * 60 * 24 * 365);
        if (error) throw error;
        return data?.signedUrl || pathOrUrl;
      } catch {
        return pathOrUrl;
      }
    },
    [parseBucketPath]
  );

  const downloadPhotoBlob = useCallback(
    async (pathOrUrl: string): Promise<Blob | null> => {
      const bucket = 'team-assets';
      const bucketPath = parseBucketPath(pathOrUrl);
      if (!bucketPath) {
        try {
          const response = await fetch(pathOrUrl);
          if (!response.ok) throw new Error('failed to load');
          return await response.blob();
        } catch {
          return null;
        }
      }
      try {
        const { data, error } = await supabase.storage.from(bucket).download(bucketPath);
        if (error) throw error;
        return data;
      } catch (err) {
        console.error('Download error', err);
        return null;
      }
    },
    [parseBucketPath]
  );

  const handleAdjustExistingPhoto = useCallback(async () => {
    if (!player) return;
    const hasPhoto = photoPreview || player.photo_url;
    if (!hasPhoto) return;
    setPhotoOpening(true);
    clearTemporaryCropUrl();
    try {
      const directSource =
        photoPreview ||
        (player.photo_url ? await signPhoto(player.photo_url) : '');
      if (!directSource) return;
      if (!photoPreview) {
        setPhotoPreview(directSource);
      }
      const blob = await downloadPhotoBlob(directSource);
      if (blob) {
        const fileName = directSource.split('/').pop() || 'photo.png';
        const croppedFile = new File([blob], fileName, { type: blob.type || 'image/png' });
        setCropFile(croppedFile);
      } else {
        setCropFile(null);
      }
      setCropSource(directSource);
      setCropOpen(true);
    } catch (err) {
      console.error('Failed to load photo for cropping', err);
      setError('Unable to load the photo for cropping.');
    } finally {
      setPhotoOpening(false);
    }
  }, [player?.photo_url, photoPreview, signPhoto, clearTemporaryCropUrl]);

  const handlePhotoInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleCropFileSelected(file);
    }
    event.target.value = '';
  };

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

  const getTeamDivision = (teamId: string | null): string | null => {
    if (!teamId) return null;
    const team = teams.find((t) => t.id === teamId);
    return team?.division || null;
  };

  const loadData = useCallback(async () => {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data: playerRow, error: pErr }] = await Promise.all([
        supabase
          .from('players')
          .select('*')
          .eq('id', playerId)
          .maybeSingle(),
      ]);
      if (pErr) throw pErr;
      if (!playerRow) {
        setError('Player not found.');
        setLoading(false);
        return;
      }
      const normalized: any = { ...playerRow };
      if (playerRow?.birth_date) {
        const raw = String(playerRow.birth_date);
        const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        normalized.birth_date = match ? match[1] : raw;
      }
      normalized.jersey_number = normalizeJerseyNumberInput(playerRow.jersey_number);
      const playerContactEmail =
        ((playerRow as any)?.email || (playerRow as any)?.email_address || '').toString().trim() || null;
      normalized.email = playerContactEmail;
      if ((playerRow as any)?.email_address !== undefined) {
        normalized.email_address = ((playerRow as any)?.email_address || '').toString().trim() || null;
      }
      setPlayer(normalized as any);
      setPlayerColumns(new Set(Object.keys(playerRow || {})));
      setInitialTeamId(playerRow?.team_id || null);
      setInitialSeasonId(playerRow?.season_id || null);
      setInitialUserId(playerRow?.user_id || null);
      setUserEmail(playerContactEmail);
      setDetachIds(new Set());
      setDetachAcknowledge(false);

      // PlayerProfile aggregates stats across all player rows with the same `user_id`.
      // If a merge was done incorrectly, detach the extra linked profiles here.
      if (playerRow?.user_id) {
        setLinkedProfilesLoading(true);
        try {
          const { data: linkedRows, error: linkedErr } = await supabase
            .from('players')
            .select('id,first_name,last_name,jersey_number,position,season_id,team_id,created_at')
            .eq('user_id', playerRow.user_id)
            .order('created_at', { ascending: false });
          if (linkedErr) throw linkedErr;

          const teamIds = Array.from(
            new Set((linkedRows || []).map((r: any) => r.team_id).filter(Boolean))
          ) as string[];
          const seasonIds = Array.from(
            new Set((linkedRows || []).map((r: any) => r.season_id).filter(Boolean))
          ) as string[];

          const teamNameById = new Map<string, string>();
          if (teamIds.length) {
            const { data: teamRows } = await supabase.from('teams').select('id,name').in('id', teamIds);
            (teamRows || []).forEach((t: any) => {
              if (t?.id) teamNameById.set(t.id, t.name || 'Team');
            });
          }

          const seasonNameById = new Map<string, string>();
          if (seasonIds.length) {
            const { data: seasonRows } = await supabase.from('seasons').select('id,name,year').in('id', seasonIds);
            (seasonRows || []).forEach((s: any) => {
              const name = String(s?.name || '').trim();
              const year = s?.year != null ? String(s.year).trim() : '';
              const label = (name + (year && !name.includes(year) ? ` ${year}` : '')).trim() || 'Season';
              if (s?.id) seasonNameById.set(s.id, label);
            });
          }

          const views: LinkedPlayerProfileView[] = (linkedRows || []).map((r: any) => ({
            id: r.id,
            first_name: r.first_name ?? null,
            last_name: r.last_name ?? null,
            jersey_number: r.jersey_number ?? null,
            position: r.position ?? null,
            season_id: r.season_id ?? null,
            team_id: r.team_id ?? null,
            created_at: r.created_at ?? null,
            teamName: r.team_id ? teamNameById.get(r.team_id) || 'Team' : null,
            seasonName: r.season_id ? seasonNameById.get(r.season_id) || 'Season' : null,
          }));
          setLinkedProfiles(views);
        } catch (err) {
          console.warn('linked profiles load failed', err);
          setLinkedProfiles([]);
        } finally {
          setLinkedProfilesLoading(false);
        }
      } else {
        setLinkedProfiles([]);
      }
      // Payment status from profile (best effort, fallback to players column/local)
      const fetchUserEmailViaAuth = async (uid: string) => {
        // First, try profiles.email/email_address to avoid admin key
        try {
          const { data } = await supabase
            .from('profiles')
            .select('email,email_address')
            .eq('user_id', uid)
            .maybeSingle();
          if (data?.email || (data as any)?.email_address) {
            return (data as any)?.email || (data as any)?.email_address || null;
          }
        } catch {}

        if (!supabaseAdmin) return null;
        try {
          const { data, error } = await supabaseAdmin.auth.admin.getUserById(uid);
          if (error) throw error;
          return data?.user?.email || null;
        } catch {
          return null;
        }
      };

      const playerPaymentStatus = (playerRow as any)?.payment_status || null;
      if (playerRow?.user_id) {
        try {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('payment_status,email,email_address')
            .eq('user_id', playerRow.user_id)
            .maybeSingle();
          if (profileRow?.payment_status) {
            setPaymentStatus(profileRow.payment_status as any);
          } else if (playerPaymentStatus) {
            setPaymentStatus(playerPaymentStatus as any);
          } else {
            setPaymentStatus('pending');
          }
          const emailValue = (profileRow as any)?.email || (profileRow as any)?.email_address || null;
          setUserEmail(emailValue);
          if (!emailValue) {
            const authEmail = await fetchUserEmailViaAuth(playerRow.user_id);
            if (authEmail) setUserEmail(authEmail);
          }
        } catch {
          setPaymentStatus((playerPaymentStatus as any) || 'unknown');
          const authEmail = await fetchUserEmailViaAuth(playerRow.user_id);
          setUserEmail(authEmail);
        }
      } else {
        setPaymentStatus((playerPaymentStatus as any) || 'unknown');
        setUserEmail(null);
      }
      if (playerRow.photo_url) {
        const signed = await signPhoto(playerRow.photo_url);
        setPhotoPreview(signed);
      }

      const { data: seasonRows } = await supabase
        .from('seasons')
        .select('id,name,is_current,start_date')
        .order('start_date', { ascending: false });
      setSeasons(
        (seasonRows || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          isActive: !!s.is_current,
        }))
      );

      if (playerRow.season_id) {
        const { data: teamRows } = await supabase
          .from('teams')
          .select('*')
          .eq('season_id', playerRow.season_id);
        setTeams(
          (teamRows || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            logoUrl: t.logo_url || '',
            bannerUrl: t.banner_url || '',
            division: t.division || '',
            seasonId: t.season_id,
            wins: 0,
            losses: 0,
            ties: 0,
            pointsFor: 0,
            pointsAgainst: 0,
          }))
        );
      }
    } catch (err: any) {
      console.error('Load player error', err);
      setError('Failed to load player.');
    } finally {
      setLoading(false);
    }
  }, [playerId, signPhoto]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleDetachId = (id: string) => {
    setDetachIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDetachAcknowledge(false);
  };

  const detachSelectedProfiles = async () => {
    if (!player?.user_id) return;
    const ids = Array.from(detachIds).filter((id) => id && id !== player.id);
    if (!ids.length) return;
    if (!detachAcknowledge) {
      setError('Confirm the detach acknowledgement before proceeding.');
      return;
    }

    setDetaching(true);
    setError(null);
    setMessage(null);
    try {
      const client = supabaseAdmin || supabase;
      const { error: updErr } = await client.from('players').update({ user_id: null }).in('id', ids);
      if (updErr) throw updErr;
      setMessage('Detached selected profiles.');
      await loadData();
    } catch (err: any) {
      console.error('detach profiles failed', err);
      setError(err?.message || 'Failed to detach profiles.');
    } finally {
      setDetaching(false);
    }
  };

  const handleLinkEmail = async () => {
    if (!player) return;
    setLinkError(null);
    setLinkSuccess(null);
    const normalized = normalizeEmail(linkEmail);
    if (!normalized || !isValidEmail(normalized)) {
      setLinkError('Enter a valid email to link.');
      return;
    }
    if (!player.season_id) {
      setLinkError('Season is required before linking an account.');
      return;
    }
    setLinking(true);
    try {
      const userId = await findUserIdByEmail(normalized);
      if (!userId) {
        setLinkError('No account found for that email.');
        return;
      }

      const { data: conflictPlayers, error: conflictErr } = await supabase
        .from('players')
        .select('id,team_id,season_id')
        .eq('season_id', player.season_id)
        .eq('user_id', userId)
        .neq('id', player.id);
      if (conflictErr) throw conflictErr;

      const targetDivision = getTeamDivision(player.team_id);
      if (conflictPlayers?.length) {
        const conflictingTeamIds = conflictPlayers.map((c) => c.team_id).filter(Boolean) as string[];
        const conflictingTeams = teams.filter((t) => conflictingTeamIds.includes(t.id));
        const hasDivisionClash =
          targetDivision &&
          conflictingTeams.some((t) => (t.division || '').toLowerCase() === targetDivision.toLowerCase());
        if (hasDivisionClash) {
          setLinkError('That email already has a roster spot in this season/division.');
          return;
        }
        if (!targetDivision) {
          setLinkError('That email is already rostered this season. Set division to check conflicts.');
          return;
        }
      }

      const updatePayload: any = { user_id: userId };
      if (playerColumns.has('email')) updatePayload.email = normalized;
      if (playerColumns.has('email_address')) updatePayload.email_address = normalized;

      const { error: updErr } = await supabase.from('players').update(updatePayload).eq('id', player.id);
      if (updErr) throw updErr;

      setPlayer({ ...player, user_id: userId, email: normalized, email_address: normalized });
      setUserEmail(normalized);
      setLinkSuccess('Account linked. Save the player to persist other changes.');
    } catch (err: any) {
      console.error('Link email failed', err);
      setLinkError(err?.message || 'Failed to link account.');
    } finally {
      setLinking(false);
    }
  };

  const handleSendClaimInvite = async () => {
    if (!player) return;
    if (player.user_id) {
      setError('This profile is already claimed and linked to an account.');
      return;
    }
    const claimEmail = normalizeEmail(userEmail || player.email || player.email_address || linkEmail || '');
    if (!claimEmail || !isValidEmail(claimEmail)) {
      setError('A valid player email is required before sending a claim invite.');
      return;
    }
    setSendingClaimInvite(true);
    setError(null);
    setMessage(null);
    try {
      const teamRecord = teams.find((t) => t.id === player.team_id) || null;
      const teamName = teamRecord?.name || 'Courtsight League';
      const seasonName = seasons.find((s) => s.id === player.season_id)?.name || 'current season';
      const playerName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player';
      const teamCode = String((teamRecord as any)?.shortName || '').trim().toUpperCase() || null;
      const configured =
        (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.trim() ||
        (import.meta.env.VITE_SITE_URL as string | undefined)?.trim() ||
        '';
      const base = (configured || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
      const inviteUrl = new URL(`${base || 'http://localhost:3000'}/portal/register`);
      inviteUrl.searchParams.set('type', 'join');
      inviteUrl.searchParams.set('invite', '1');
      inviteUrl.searchParams.set('email', claimEmail);
      if (player.team_id) inviteUrl.searchParams.set('team', player.team_id);
      if (teamCode) inviteUrl.searchParams.set('code', teamCode);
      await sendPlayerClaimEmail({
        playerId: player.id,
        email: claimEmail,
        playerName,
        teamName,
        teamId: player.team_id,
        teamCode,
        seasonName,
        inviteLink: inviteUrl.toString(),
        createdBy: 'admin-player-editor',
      });
      setMessage(`Claim invite sent to ${claimEmail}.`);
    } catch (err: any) {
      console.error('send claim invite failed', err);
      setError(err?.message || 'Failed to send claim invite.');
    } finally {
      setSendingClaimInvite(false);
    }
  };

  const handleSave = async () => {
    if (!player) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalizedJerseyNumber = normalizeJerseyNumberInput(player.jersey_number);
      if (!normalizedJerseyNumber) {
        setError('Jersey number is required.');
        setSaving(false);
        return;
      }
      const previousTeamId = initialTeamId;
      const nextTeamId = player.team_id || null;
      const wasCaptain = !!player.is_captain;
      const payload: any = {
        first_name: player.first_name,
        last_name: player.last_name,
        jersey_number: normalizedJerseyNumber,
        position: player.position,
        team_id: player.team_id,
        season_id: player.season_id,
        photo_url: player.photo_url,
      };
      if (player.is_captain && player.team_id && initialTeamId && player.team_id !== initialTeamId) {
        payload.is_captain = false;
      }
      const optionalKeys: (keyof PlayerRow)[] = [
        'birth_date',
        'phone',
        'email',
        'jersey_size',
        'shorts_size',
        'jersey_name',
        'referral_source',
        'nba_comparison',
        'instagram',
      ];
      optionalKeys.forEach((key) => {
        if (playerColumns.has(key as string) && player[key] !== undefined) {
          if (key === 'birth_date' && player[key]) {
            const raw = String(player[key]);
            const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
              ? raw
              : new Date(raw).toISOString().slice(0, 10);
            payload[key] = iso;
          } else {
            const value = player[key];
            payload[key] = value === '' ? null : value ?? null;
          }
        }
      });
      const normalizedPayment = paymentStatus !== 'unknown' ? paymentStatus : null;
      if (playerColumns.has('payment_status')) {
        payload.payment_status = normalizedPayment;
      }
      if (playerColumns.has('email_address')) {
        payload.email_address = payload.email ?? player.email_address ?? null;
      }

      const rosterIdentityChanged =
        (player.user_id || null) !== (initialUserId || null) ||
        (player.season_id || null) !== (initialSeasonId || null) ||
        (player.team_id || null) !== (initialTeamId || null);

      // Prevent duplicate roster spots for same user in same season/division
      // only when linkage context changes. Profile/photo-only edits should still save.
      if (rosterIdentityChanged && player.user_id && player.season_id && player.team_id) {
        const targetDivision = (teams.find((t) => t.id === player.team_id)?.division || '').toLowerCase();
        const { data: dupRows, error: dupErr } = await supabase
          .from('players')
          .select('id,team_id,teams:team_id(division)')
          .eq('season_id', player.season_id)
          .eq('user_id', player.user_id)
          .neq('id', player.id);
        if (dupErr) throw dupErr;
        if (dupRows && dupRows.length) {
          const blocking = dupRows.filter((row: any) => {
            const otherDiv = (row as any)?.teams?.division?.toLowerCase?.() || '';
            if (!targetDivision) return true;
            return otherDiv === targetDivision;
          });
          if (blocking.length) {
            setError('This user already has a roster spot in this season/division. Remove them there first.');
            setSaving(false);
            return;
          }
        }
      }

      // Persist player core fields (anon key should work)
      const { error: updErr } = await supabase.from('players').update(payload).eq('id', player.id);
      if (updErr) {
        setError(`Failed to save player record: ${updErr.message || updErr.toString()}`);
        setSaving(false);
        return;
      }

      // Sync profile/payment using admin key when available to avoid RLS gaps
      if (player.user_id) {
        const profilePayload = {
          user_id: player.user_id,
          phone: player.phone || null,
          display_name: [player.first_name, player.last_name].filter(Boolean).join(' ') || null,
          payment_status: normalizedPayment,
          email: userEmail || null,
          email_address: userEmail || null,
        };
        let profileSaved = false;
        if (supabaseAdmin) {
          try {
            const { error: adminErr } = await supabaseAdmin.from('profiles').upsert(profilePayload, { onConflict: 'user_id' });
            if (adminErr) throw adminErr;
            profileSaved = true;
          } catch (adminErr) {
            console.warn('Profile admin upsert failed, will retry anon', adminErr);
          }
        }
        if (!profileSaved) {
          try {
            const { error: anonErr } = await supabase.from('profiles').upsert(profilePayload, { onConflict: 'user_id' });
            if (anonErr) throw anonErr;
          } catch (profileErr) {
            console.warn('Profile sync failed', profileErr);
            setError(`Failed to save profile/payment status. ${profileErr?.message || ''}`.trim());
          }
        }
        // Best-effort: also persist payment_status on players table even if column is missing in initial payload
        try {
          const client = supabaseAdmin || supabase;
          const { error: pStatusErr } = await client
            .from('players')
            .update({ payment_status: normalizedPayment })
            .eq('id', player.id);
          if (pStatusErr) throw pStatusErr;
        } catch (err) {
          console.warn('player payment_status update failed (non-blocking)', err);
        }
      }

      setMessage('Changes saved.');

      // Notify admins and captains when team changes
      if (previousTeamId !== nextTeamId && nextTeamId) {
        const fetchAdminRecipients = async () => {
          try {
            const { data, error } = await supabase.from('admin_users').select('user_id,role');
            if (error) throw error;
            return (data || []).map((row: any) => ({
              userId: row.user_id ?? null,
              role: row.role ?? null,
            }));
          } catch (err) {
            console.warn('admin recipient lookup failed', err);
            return [];
          }
        };

        const getTeamCaptainUserId = async (teamId: string) => {
          try {
            const { data, error } = await supabase
              .from('players')
              .select('user_id')
              .eq('team_id', teamId)
              .eq('is_captain', true)
              .maybeSingle();
            if (error) throw error;
            return data?.user_id ?? null;
          } catch (err) {
            console.warn('captain lookup failed', err);
            return null;
          }
        };

        const resolveTeamName = async (teamId: string | null) => {
          if (!teamId) return 'Unknown Team';
          const cached = teams.find((t) => t.id === teamId)?.name;
          if (cached) return cached;
          try {
            const { data } = await supabase.from('teams').select('name').eq('id', teamId).maybeSingle();
            return data?.name || 'Unknown Team';
          } catch {
            return 'Unknown Team';
          }
        };

        const adminRecipients = await fetchAdminRecipients();
        let newCaptainId = await getTeamCaptainUserId(nextTeamId);
        let oldCaptainId = previousTeamId ? await getTeamCaptainUserId(previousTeamId) : null;
        // Fallback: if we can't find a captain and this player was the captain, notify them
        if (!newCaptainId && wasCaptain && player.user_id) {
          newCaptainId = player.user_id;
        }
        if (!oldCaptainId && wasCaptain && player.user_id) {
          oldCaptainId = player.user_id;
        }
        const [newTeamName, oldTeamName] = await Promise.all([
          resolveTeamName(nextTeamId),
          resolveTeamName(previousTeamId),
        ]);

        const notifications: any[] = [];
        const seasonLabel =
          seasons.find((s) => s.id === player.season_id)?.name ||
          (player.season_id ? 'Current Season' : 'Season');
        const divisionLabel = teams.find((t) => t.id === nextTeamId)?.division || null;

        adminRecipients.forEach((r) => {
          notifications.push({
            userId: r.userId ?? null,
            role: r.role ?? 'ADMIN_FULL',
            title: 'Player Transferred',
            body: `${player.first_name || 'Player'} ${player.last_name || ''} moved to ${newTeamName} — ${seasonLabel}${
              divisionLabel ? ` • ${divisionLabel}` : ''
            }.`,
            link: '/admin?tab=teams',
            metadata: {
              playerId: player.id,
              fromTeamId: previousTeamId,
              toTeamId: nextTeamId,
              seasonName: seasonLabel,
              seasonId: player.season_id || null,
              division: divisionLabel,
            },
          });
        });

        if (newCaptainId) {
          notifications.push({
            userId: newCaptainId,
            role: null,
            teamId: nextTeamId,
            title: 'New Player Added',
            body: `${player.first_name || 'Player'} ${player.last_name || ''} has joined your team ${newTeamName} — ${seasonLabel}${
              divisionLabel ? ` • ${divisionLabel}` : ''
            }.`,
            link: '/my-team',
            metadata: {
              playerId: player.id,
              teamId: nextTeamId,
              seasonName: seasonLabel,
              seasonId: player.season_id || null,
              division: divisionLabel,
            },
          });
        }

        if (oldCaptainId && previousTeamId && previousTeamId !== nextTeamId) {
          notifications.push({
            userId: oldCaptainId,
            role: null,
            teamId: previousTeamId,
            title: 'Player Departed',
            body: `${player.first_name || 'Player'} ${player.last_name || ''} has left ${oldTeamName} — ${seasonLabel}${
              divisionLabel ? ` • ${divisionLabel}` : ''
            }.`,
            link: '/my-team',
            metadata: {
              playerId: player.id,
              teamId: previousTeamId,
              seasonName: seasonLabel,
              seasonId: player.season_id || null,
              division: divisionLabel,
            },
          });
        }

        if (notifications.length) {
          createNotifications(notifications).catch((err) => console.warn('transfer notification failed', err));
        }
      }

      setMessage('Player updated.');
      if (fromTeamId) {
        navigate(`/admin?tab=teams&team=${fromTeamId}`);
      } else {
        navigate(-1);
      }
    } catch (err: any) {
      console.error('Save player error', err);
      setError(err?.message || 'Failed to save player.');
    } finally {
      setSaving(false);
    }
  };

  const handleSeasonChange = async (seasonId: string) => {
    if (!player) return;
    setPlayer({ ...player, season_id: seasonId, team_id: null });
    const { data: teamRows } = await supabase
      .from('teams')
      .select('*')
      .eq('season_id', seasonId);
    setTeams(
      (teamRows || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        logoUrl: t.logo_url || '',
        bannerUrl: t.banner_url || '',
        division: t.division || '',
        seasonId: t.season_id,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      }))
    );
  };

  const uploadPlayerPhoto = useCallback(
    async (file: File): Promise<boolean> => {
      if (!player?.id) return false;
      setUploading(true);
      setError(null);
      setMessage(null);
      try {
        const safeName = file.name.replace(/\s+/g, '-');
        const path = `players/${player.id}/avatar-${Date.now()}-${safeName}`;
        const bucket = 'team-assets'; // reuse existing bucket
        const { data, error: uploadErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: true });
        if (uploadErr) throw uploadErr;
        const storedPath = data?.path || path;
        const signed = await signPhoto(storedPath);
        setPlayer((prev) => (prev ? { ...prev, photo_url: storedPath } : prev));
        setPhotoPreview(signed);
        setMessage('Photo uploaded. Save to persist.');
        return true;
      } catch (err: any) {
        console.error('Upload error', err);
        setError('Failed to upload photo.');
        return false;
      } finally {
        setUploading(false);
      }
    },
    [player?.id, signPhoto]
  );

  if (loading) return <LoadingOverlay message="Loading player..." />;
  if (!player) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-sports">Player not found.</p>
          <button onClick={() => navigate(-1)} className="mt-4 text-brand-lime underline">Go back</button>
        </div>
      </div>
    );
  }

  const claimEmailCandidate = normalizeEmail(userEmail || player.email || player.email_address || linkEmail || '');
  const isAlreadyClaimedProfile = Boolean(player.user_id);
  const canSendClaimInvite =
    !isAlreadyClaimedProfile &&
    !sendingClaimInvite &&
    Boolean(claimEmailCandidate) &&
    isValidEmail(claimEmailCandidate);

  return (
    <>
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
        <div className="max-w-4xl mx-auto bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-sports text-2xl text-white uppercase">Edit Player</h1>
            <p className="text-xs text-gray-400">Update player details for admin.</p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white text-sm underline"
          >
            Back
          </button>
        </div>

        {error && <div className="text-xs text-brand-red mb-3">{error}</div>}
        {message && <div className="text-xs text-brand-lime mb-3">{message}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Profile Photo</label>
            <div className="flex items-center gap-4">
              <div
                className={`relative w-20 h-20 rounded-full overflow-hidden ${
                  isCaptain ? 'shadow-[0_0_20px_rgba(255,215,0,0.35)] border-2 border-yellow-400' : 'border border-white/10 bg-black'
                }`}
              >
                {isCaptain && (
                  <Crown
                    size={16}
                    className="text-yellow-300 absolute -top-4 left-1/2 -translate-x-1/2 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] z-10"
                    fill="currentColor"
                    strokeWidth={1.5}
                  />
                )}
                <button
                  type="button"
                  className="absolute inset-0"
                  onClick={() => void handleAdjustExistingPhoto()}
                  disabled={photoOpening || uploading}
                  aria-label="Edit player photo"
                >
                  <img
                    src={photoPreview || DEFAULT_PLAYER_AVATAR}
                    alt="Player"
                    className="w-full h-full object-cover"
                  />
                  {photoOpening && (
                    <div className="logo-loading-overlay pointer-events-none">
                      <span className="logo-loading-ring" aria-hidden="true" />
                    </div>
                  )}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <label
                  className="cursor-pointer bg-white/5 hover:bg-white/10 text-white px-3 py-2 rounded text-xs font-bold uppercase border border-white/10 transition-colors"
                >
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoInputChange}
                  />
                  Upload Photo
                </label>
                {uploading && <span className="text-xs text-gray-400">Uploading...</span>}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">First Name</label>
            <input
              value={player.first_name || ''}
              onChange={(e) => setPlayer({ ...player, first_name: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Last Name</label>
            <input
              value={player.last_name || ''}
              onChange={(e) => setPlayer({ ...player, last_name: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Jersey #</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={player.jersey_number ?? ''}
              onChange={(e) =>
                setPlayer({ ...player, jersey_number: normalizeJerseyNumberInput(e.target.value) })
              }
              required
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Position</label>
            <input
              value={player.position || ''}
              onChange={(e) => setPlayer({ ...player, position: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
              placeholder="e.g. PG"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Birthdate</label>
            <div className="relative">
              <input
                ref={birthdateRef}
                type="date"
                value={player.birth_date || ''}
                onChange={(e) => setPlayer({ ...player, birth_date: e.target.value })}
                onFocus={() => birthdateRef.current?.showPicker?.()}
                onClick={() => birthdateRef.current?.showPicker?.()}
                className="w-full bg-black border border-white/20 rounded p-3 pr-10 dropdown-select-spacing text-white appearance-none focus:border-brand-lime focus:outline-none transition-colors"
                placeholder="mm/dd/yyyy"
              />
              <button
                type="button"
                onClick={() => {
                  if (birthdateRef.current) {
                    birthdateRef.current.showPicker?.();
                    birthdateRef.current.focus();
                  }
                }}
                className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                aria-label="Open birthdate calendar"
              >
                <Calendar size={16} />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Phone Number</label>
            <input
              type="tel"
              value={player.phone || ''}
              onChange={(e) => setPlayer({ ...player, phone: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Player Contact Email</label>
            <input
              type="email"
              value={player.email || player.email_address || ''}
              onChange={(e) => {
                const value = e.target.value;
                setPlayer({ ...player, email: value, email_address: value });
              }}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
              placeholder="name@example.com"
            />
            {/* <div className="text-[11px] text-gray-500 mt-1">
              Used as claim-invite email for unclaimed profiles when no linked account email exists.
            </div> */}
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">User Email</label>
            {userEmail ? (
              <div className="space-y-2">
                <input
                  value={userEmail}
                  readOnly
                  className="w-full bg-black border border-white/20 rounded p-3 text-white"
                />
                <button
                  type="button"
                  onClick={handleSendClaimInvite}
                  disabled={!canSendClaimInvite}
                  className="px-4 py-3 rounded bg-white/10 text-white border border-white/20 hover:border-brand-lime hover:text-brand-lime font-bold text-xs uppercase disabled:opacity-60"
                  title={isAlreadyClaimedProfile ? 'Profile already claimed' : undefined}
                >
                  {sendingClaimInvite ? 'Sending...' : isAlreadyClaimedProfile ? 'Already Claimed' : 'Send Claim Invite'}
                </button>
                {isAlreadyClaimedProfile && (
                  <div className="text-xs text-gray-500">Claim invite is only for unclaimed profiles.</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                    placeholder="Link an existing Courtsight account"
                    className="flex-1 bg-black border border-white/20 rounded p-3 text-white"
                  />
                  <button
                    type="button"
                    onClick={handleLinkEmail}
                    disabled={linking}
                    className="px-4 py-3 rounded bg-brand-lime text-black font-bold text-xs uppercase disabled:opacity-60"
                  >
                    {linking ? 'Linking...' : 'Link'}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  Only existing accounts can be linked. Accounts already rostered in this season/division are blocked.
                </div>
                <button
                  type="button"
                  onClick={handleSendClaimInvite}
                  disabled={!canSendClaimInvite}
                  className="px-4 py-3 rounded bg-white/10 text-white border border-white/20 hover:border-brand-lime hover:text-brand-lime font-bold text-xs uppercase disabled:opacity-60"
                  title={isAlreadyClaimedProfile ? 'Profile already claimed' : undefined}
                >
                  {sendingClaimInvite ? 'Sending...' : isAlreadyClaimedProfile ? 'Already Claimed' : 'Send Claim Invite'}
                </button>
                {isAlreadyClaimedProfile && (
                  <div className="text-xs text-gray-500">Claim invite is only for unclaimed profiles.</div>
                )}
                {linkError && <div className="text-xs text-brand-red">{linkError}</div>}
                {linkSuccess && <div className="text-xs text-brand-lime">{linkSuccess}</div>}
              </div>
            )}
          </div>
          {player?.user_id && (
            <div className="md:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                <div>
                  <div className="text-xs text-gray-400 uppercase font-bold">Linked Profiles</div>
                  <div className="text-[11px] text-gray-500">
                    Player stats aggregate across all profiles linked to the same account. Detach any profiles that are not this player.
                  </div>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-2">
                  <label className="flex items-start gap-2 text-xs text-gray-300 select-none">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-brand-lime"
                      checked={detachAcknowledge}
                      disabled={detaching || detachIds.size === 0 || (detachIds.size === 1 && detachIds.has(player.id))}
                      onChange={(e) => setDetachAcknowledge(e.target.checked)}
                    />
                    <span>I understand detaching changes which stats appear.</span>
                  </label>
                  <button
                    type="button"
                    onClick={detachSelectedProfiles}
                    disabled={
                      detaching ||
                      !detachAcknowledge ||
                      detachIds.size === 0 ||
                      (detachIds.size === 1 && detachIds.has(player.id))
                    }
                    className="px-4 py-2 rounded border border-white/15 text-xs uppercase font-bold text-gray-200 hover:border-brand-lime/60 hover:text-brand-lime disabled:opacity-50 disabled:hover:border-white/15 disabled:hover:text-gray-200"
                    title="Detach selected profiles (sets players.user_id = NULL)"
                  >
                    {detaching ? 'Detaching...' : `Detach Selected (${Math.max(0, detachIds.size - (detachIds.has(player.id) ? 1 : 0))})`}
                  </button>
                </div>
              </div>

              <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
                {linkedProfilesLoading ? (
                  <div className="p-4 text-sm text-gray-400">Loading linked profiles...</div>
                ) : linkedProfiles.length <= 1 ? (
                  <div className="p-4 text-sm text-gray-400">No other linked profiles.</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {linkedProfiles.map((lp) => {
                      const name = `${lp.first_name || ''} ${lp.last_name || ''}`.trim() || 'Player';
                      const meta = [
                        lp.jersey_number ? `#${lp.jersey_number}` : null,
                        lp.position || null,
                        lp.teamName ? `Team: ${lp.teamName}` : null,
                        lp.seasonName ? `Season: ${lp.seasonName}` : null,
                      ].filter(Boolean).join(' • ');
                      const isSelf = lp.id === player.id;
                      return (
                        <label key={lp.id} className={`flex items-start gap-3 p-4 ${isSelf ? 'opacity-70' : 'hover:bg-white/5'}`}>
                          <input
                            type="checkbox"
                            className="mt-1 accent-brand-lime"
                            checked={detachIds.has(lp.id)}
                            disabled={isSelf || detaching}
                            onChange={() => toggleDetachId(lp.id)}
                            aria-label={isSelf ? 'Current profile (cannot detach)' : `Select ${name} to detach`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-white font-bold truncate">{name}{isSelf ? ' (CURRENT)' : ''}</div>
                              <button
                                type="button"
                                onClick={() => navigate(`/admin/player/${lp.id}`)}
                                className="text-[11px] uppercase font-bold text-brand-lime hover:underline underline-offset-2"
                              >
                                Open
                              </button>
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono truncate">{lp.id}</div>
                            <div className="text-[11px] text-gray-400 truncate">{meta || 'No metadata'}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Payment Status</label>
            {player?.user_id ? (
              <>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as any)}
                  className="w-full bg-black border border-white/20 rounded p-3 text-white"
                >
                  <option value="paid">Paid</option>
                  <option value="pending-stripe">Pending (Stripe)</option>
                  <option value="pending">Pending (Pay Later)</option>
                  <option value="unknown">Unknown</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">Admins can mark paid to lift temporary access for pay-later users.</p>
              </>
            ) : (
              <div className="w-full bg-black border border-dashed border-white/20 rounded p-3 text-gray-400 text-sm">
                Player has no linked user profile; payment status not applicable.
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Season</label>
            <select
              value={player.season_id || ''}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            >
              <option value="" disabled>Select season</option>
              {sortSeasonsNewestFirst(seasons).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Team</label>
            <select
              value={player.team_id || ''}
              onChange={(e) => setPlayer({ ...player, team_id: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            >
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <p className="text-[11px] text-gray-500">
              Jersey fields below are scoped to this specific team + season profile only.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Jersey Size</label>
            <select
              value={player.jersey_size || ''}
              onChange={(e) => setPlayer({ ...player, jersey_size: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            >
              <option value="">Select size</option>
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="L">L</option>
              <option value="XL">XL</option>
              <option value="XXL">XXL</option>
              <option value="XXXL">XXXL</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Shorts Size</label>
            <select
              value={player.shorts_size || ''}
              onChange={(e) => setPlayer({ ...player, shorts_size: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            >
              <option value="">Select size</option>
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="L">L</option>
              <option value="XL">XL</option>
              <option value="XXL">XXL</option>
              <option value="XXXL">XXXL</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Name on Jersey</label>
            <input
              value={player.jersey_name || ''}
              onChange={(e) => setPlayer({ ...player, jersey_name: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
              placeholder="Last name / nickname"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">How did you hear about us?</label>
            <select
              value={player.referral_source || ''}
              onChange={(e) => setPlayer({ ...player, referral_source: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
            >
              <option value="">Select an option</option>
              <option value="Instagram">Instagram</option>
              <option value="Friend">Friend / Word of Mouth</option>
              <option value="Google">Google Search</option>
              <option value="Flyer">Flyer at Gym</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">NBA Comparison</label>
            <input
              value={player.nba_comparison || ''}
              onChange={(e) => setPlayer({ ...player, nba_comparison: e.target.value })}
              className="w-full bg-black border border-white/20 rounded p-3 text-white"
              placeholder="e.g. Kyrie handles with Draymond shooting"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Instagram Handle</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
              <input
                value={player.instagram || ''}
                onChange={(e) => setPlayer({ ...player, instagram: e.target.value })}
                className="w-full bg-black border border-white/20 rounded p-3 pl-7 text-white"
                placeholder="courtsight"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded border border-white/20 text-white hover:border-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded bg-brand-lime text-black font-bold uppercase shadow disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
    {cropOpen && (
    <ImageCropper
      open={cropOpen}
      source={cropSource}
      file={cropFile}
      spec={CROP_SPECS.player}
      filePrefix={`player-${player?.id ?? 'photo'}-avatar`}
      onSave={uploadPlayerPhoto}
      onUseOriginal={uploadPlayerPhoto}
      onClose={handleCropClose}
    />
    )}
    </>
  );
};

export default AdminPlayer;

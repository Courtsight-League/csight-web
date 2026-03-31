import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredUser, hydrateUserFromSupabase } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { normalizeJerseyNumberInput } from '../utils/jerseyNumber';
import ImageCropper, { CROP_SPECS } from '../components/ImageCropper';
import { Calendar, ChevronDown } from 'lucide-react';
import type { User } from '../types';

type PlayerProfileRow = {
  id: string;
  user_id: string | null;
  season_id: string | null;
  team_id: string | null;
  first_name: string | null;
  last_name: string | null;
  jersey_number: string | number | null;
  position: string | null;
  phone: string | null;
  birth_date: string | null;
  instagram: string | null;
  jersey_name: string | null;
  jersey_size: string | null;
  shorts_size: string | null;
  nba_comparison: string | null;
  referral_source: string | null;
  photo_url: string | null;
  created_at: string | null;
};

const getStaleFreeAgentProfileIds = (rows: PlayerProfileRow[]): string[] => {
  const groups = new Map<string, PlayerProfileRow[]>();
  rows.forEach((row) => {
    if (row.team_id) return;
    const seasonKey = String(row.season_id || '__no_season__').trim();
    const bucket = groups.get(seasonKey) || [];
    bucket.push(row);
    groups.set(seasonKey, bucket);
  });

  const staleIds: string[] = [];
  groups.forEach((bucket) => {
    if (bucket.length <= 1) return;
    const sorted = [...bucket].sort((a, b) => {
      const aTime = a.created_at ? Date.parse(a.created_at) : 0;
      const bTime = b.created_at ? Date.parse(b.created_at) : 0;
      if (bTime !== aTime) return bTime - aTime;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
    sorted.slice(1).forEach((row) => staleIds.push(row.id));
  });
  return staleIds;
};

type AccountFormState = {
  displayName: string;
  email: string;
  phone: string;
  newPassword: string;
  confirmPassword: string;
};

type PlayerFormState = {
  firstName: string;
  lastName: string;
  phone: string;
  jerseyNumber: string;
  position: string;
  instagram: string;
  birthDate: string;
  jerseyName: string;
  jerseySize: string;
  shortsSize: string;
  nbaComparison: string;
  referralSource: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_ASSET_BUCKET = 'team-assets';
const TEAM_ASSET_MARKER = '/storage/v1/object/public/team-assets/';
const POSITION_OPTIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;
const REFERRAL_OPTIONS = [
  'Instagram',
  'Friend',
  'Google',
  'Flyer',
  'Other',
] as const;

const formatSeasonDisplay = (season?: { name?: string | null; year?: number | string | null }) => {
  const name = String(season?.name || 'Season').trim();
  const yearNum = Number(season?.year) || 0;
  const yearText = yearNum ? String(yearNum) : '';
  if (yearText && name.includes(yearText)) return name;
  return `${name}${yearText ? ` ${yearText}` : ''}`.trim();
};

const parseTeamAssetPath = (value?: string | null) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('team-assets/')) return trimmed.replace(/^team-assets\//, '');
  const markerIndex = trimmed.indexOf(TEAM_ASSET_MARKER);
  if (markerIndex >= 0) return trimmed.slice(markerIndex + TEAM_ASSET_MARKER.length);
  if (/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
};

const MyProfile: React.FC = () => {
  const navigate = useNavigate();
  const accountPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const birthDateInputRef = useRef<HTMLInputElement | null>(null);
  const accountPhotoObjectUrlRef = useRef<string | null>(null);
  const cropSourceObjectUrlRef = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerProfileRow[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [seasonNames, setSeasonNames] = useState<Record<string, string>>({});
  const [teamMeta, setTeamMeta] = useState<Record<string, { name: string; division: string }>>({});
  const [accountAvatarPath, setAccountAvatarPath] = useState<string | null>(null);
  const [applyIdentityToAll, setApplyIdentityToAll] = useState(false);
  const [accountPhotoPreview, setAccountPhotoPreview] = useState('');
  const [accountPhotoFile, setAccountPhotoFile] = useState<File | null>(null);
  const [clearAccountPhoto, setClearAccountPhoto] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [accountForm, setAccountForm] = useState<AccountFormState>({
    displayName: '',
    email: '',
    phone: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [playerForm, setPlayerForm] = useState<PlayerFormState>({
    firstName: '',
    lastName: '',
    phone: '',
    jerseyNumber: '',
    position: '',
    instagram: '',
    birthDate: '',
    jerseyName: '',
    jerseySize: '',
    shortsSize: '',
    nbaComparison: '',
    referralSource: '',
  });

  const selectedPlayer = useMemo(
    () => players.find((player) => player.id === selectedPlayerId) || null,
    [players, selectedPlayerId]
  );

  const clearCropSourceObjectUrl = () => {
    if (cropSourceObjectUrlRef.current) {
      URL.revokeObjectURL(cropSourceObjectUrlRef.current);
      cropSourceObjectUrlRef.current = null;
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      const stored = getStoredUser();
      if (!stored) {
        navigate('/login');
        return;
      }
      setUser(stored);
      setLoading(true);
      setError(null);
      setSuccess(null);
      try {
        const [profileRes, playersRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('display_name,phone,email,email_address,avatar_url')
            .eq('user_id', stored.id)
            .maybeSingle(),
          supabase
            .from('players')
            .select(
              'id,user_id,season_id,team_id,first_name,last_name,jersey_number,position,phone,birth_date,instagram,jersey_name,jersey_size,shorts_size,nba_comparison,referral_source,photo_url,created_at'
            )
            .eq('user_id', stored.id)
            .order('created_at', { ascending: false }),
        ]);
        if (!active) return;

        const profileRow: any = profileRes.data || {};
        setAccountForm((prev) => ({
          ...prev,
          displayName: (profileRow.display_name || stored.name || '').trim(),
          email: (profileRow.email || profileRow.email_address || stored.email || '').trim(),
          phone: (profileRow.phone || '').trim(),
        }));
        setAccountAvatarPath((profileRow.avatar_url || '').trim() || null);

        const playerRows = (playersRes.data || []) as PlayerProfileRow[];
        let visibleRows = playerRows;
        const staleFreeAgentIds = getStaleFreeAgentProfileIds(playerRows);
        if (staleFreeAgentIds.length) {
          try {
            const { error: archiveErr } = await supabase
              .from('players')
              .update({ user_id: null })
              .eq('user_id', stored.id)
              .in('id', staleFreeAgentIds);
            if (archiveErr) throw archiveErr;
            const archivedSet = new Set(staleFreeAgentIds);
            visibleRows = playerRows.filter((row) => !archivedSet.has(row.id));
          } catch (archiveErr) {
            console.warn('free-agent duplicate cleanup failed', archiveErr);
          }
        }
        setPlayers(visibleRows);
        const pickPlayerId =
          (selectedPlayerId && visibleRows.some((player) => player.id === selectedPlayerId) && selectedPlayerId) ||
          visibleRows[0]?.id ||
          '';
        setSelectedPlayerId(pickPlayerId);

        const teamIds = Array.from(new Set(visibleRows.map((row) => row.team_id).filter(Boolean))) as string[];
        const seasonIds = Array.from(new Set(visibleRows.map((row) => row.season_id).filter(Boolean))) as string[];

        if (teamIds.length) {
          const { data: teams } = await supabase.from('teams').select('id,name,division').in('id', teamIds);
          if (active && teams) {
            setTeamMeta(
              Object.fromEntries(
                teams.map((team: any) => [
                  team.id,
                  { name: team.name || 'Team', division: (team.division || '').trim() || 'Open' },
                ])
              )
            );
          }
        } else {
          setTeamMeta({});
        }

        if (seasonIds.length) {
          const { data: seasons } = await supabase.from('seasons').select('id,name,year').in('id', seasonIds);
          if (active && seasons) {
            setSeasonNames(
              Object.fromEntries(
                seasons.map((season: any) => [
                  season.id,
                  formatSeasonDisplay({ name: season.name, year: season.year }),
                ])
              )
            );
          }
        } else {
          setSeasonNames({});
        }
      } catch (err: any) {
        console.error('profile load failed', err);
        if (!active) return;
        setError(err?.message || 'Unable to load profile.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    const revokeObjectUrl = () => {
      if (accountPhotoObjectUrlRef.current) {
        URL.revokeObjectURL(accountPhotoObjectUrlRef.current);
        accountPhotoObjectUrlRef.current = null;
      }
    };
    const loadAccountPhoto = async () => {
      revokeObjectUrl();
      setAccountPhotoFile(null);
      setClearAccountPhoto(false);
      const source = accountAvatarPath || user?.avatarUrl || '';
      if (!source) {
        setAccountPhotoPreview('');
        return;
      }
      const raw = source;
      if (/^https?:\/\//i.test(raw) && !raw.includes('team-assets')) {
        setAccountPhotoPreview(raw);
        return;
      }
      const bucketPath = parseTeamAssetPath(raw);
      if (!bucketPath) {
        setAccountPhotoPreview(raw);
        return;
      }
      try {
        const { data, error } = await supabase.storage
          .from(TEAM_ASSET_BUCKET)
          .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
        if (error) throw error;
        setAccountPhotoPreview(data?.signedUrl || '');
      } catch {
        setAccountPhotoPreview(raw);
      }
    };
    loadAccountPhoto();
    return () => {
      revokeObjectUrl();
    };
  }, [accountAvatarPath, user?.avatarUrl]);

  useEffect(() => {
    return () => {
      clearCropSourceObjectUrl();
    };
  }, []);

  useEffect(() => {
    if (!selectedPlayer) {
      setPlayerForm({
        firstName: '',
        lastName: '',
        phone: '',
        jerseyNumber: '',
        position: '',
        instagram: '',
        birthDate: '',
        jerseyName: '',
        jerseySize: '',
        shortsSize: '',
        nbaComparison: '',
        referralSource: '',
      });
      return;
    }
    setPlayerForm({
      firstName: (selectedPlayer.first_name || '').trim(),
      lastName: (selectedPlayer.last_name || '').trim(),
      phone: (selectedPlayer.phone || '').trim(),
      jerseyNumber: normalizeJerseyNumberInput(selectedPlayer.jersey_number) || '',
      position: (selectedPlayer.position || '').trim(),
      instagram: (selectedPlayer.instagram || '').trim(),
      birthDate: (selectedPlayer.birth_date || '').slice(0, 10),
      jerseyName: (selectedPlayer.jersey_name || '').trim(),
      jerseySize: (selectedPlayer.jersey_size || '').trim(),
      shortsSize: (selectedPlayer.shorts_size || '').trim(),
      nbaComparison: (selectedPlayer.nba_comparison || '').trim(),
      referralSource: (selectedPlayer.referral_source || '').trim(),
    });
  }, [selectedPlayer]);

  const playerLabel = (player: PlayerProfileRow) => {
    const seasonLabel = player.season_id ? seasonNames[player.season_id] || 'Season' : 'Season';
    const team = player.team_id ? teamMeta[player.team_id] : null;
    if (!player.team_id) {
      return `${seasonLabel} • Free Agent (No Team Assigned)`;
    }
    const teamLabel = team?.name || 'Team';
    const divisionLabel = team?.division || 'Open';
    return `${seasonLabel} • ${teamLabel} (${divisionLabel})`;
  };

  const saveAccount = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    setError(null);
    setSuccess(null);
    const displayName = accountForm.displayName.trim();
    const email = accountForm.email.trim();
    const phone = accountForm.phone.trim();

    if (!email || !EMAIL_REGEX.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (accountForm.newPassword || accountForm.confirmPassword) {
      if (accountForm.newPassword.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (accountForm.newPassword !== accountForm.confirmPassword) {
        setError('Password confirmation does not match.');
        return;
      }
    }

    setSavingAccount(true);
    try {
      let nextAvatarPath = accountAvatarPath;
      if (accountPhotoFile && user?.id) {
        const extension = (accountPhotoFile.name.split('.').pop() || 'jpg').toLowerCase();
        const safeExt = extension.replace(/[^a-z0-9]/g, '') || 'jpg';
        const uploadPath = `profile-avatars/${user.id}/avatar-${Date.now()}.${safeExt}`;
        const { error: uploadErr } = await supabase.storage
          .from(TEAM_ASSET_BUCKET)
          .upload(uploadPath, accountPhotoFile, { upsert: true });
        if (uploadErr) throw uploadErr;
        nextAvatarPath = uploadPath;
      } else if (clearAccountPhoto) {
        nextAvatarPath = null;
      }

      const { error: profileErr } = await supabase.from('profiles').upsert(
        {
          user_id: user.id,
          display_name: displayName || null,
          phone: phone || null,
          email,
          email_address: email,
          avatar_url: nextAvatarPath || null,
        },
        { onConflict: 'user_id' }
      );
      if (profileErr) throw profileErr;

      const { error: metaErr } = await supabase.auth.updateUser({
        data: { full_name: displayName, avatar_url: nextAvatarPath || null },
      });
      if (metaErr) throw metaErr;

      if (email.toLowerCase() !== (user.email || '').toLowerCase()) {
        const { error: emailErr } = await supabase.auth.updateUser({ email });
        if (emailErr) throw emailErr;
      }

      if (accountForm.newPassword) {
        const { error: passErr } = await supabase.auth.updateUser({ password: accountForm.newPassword });
        if (passErr) throw passErr;
      }

      const hydrated = await hydrateUserFromSupabase();
      if (hydrated) {
        setUser(hydrated);
      }
      setAccountAvatarPath(nextAvatarPath || null);
      setAccountPhotoFile(null);
      setClearAccountPhoto(false);
      setAccountForm((prev) => ({
        ...prev,
        newPassword: '',
        confirmPassword: '',
      }));
      setSuccess(
        email.toLowerCase() !== (user.email || '').toLowerCase()
          ? 'Account updated. Confirm your new email from your inbox if prompted.'
          : 'Account updated successfully.'
      );
    } catch (err: any) {
      console.error('account update failed', err);
      setError(err?.message || 'Unable to update account.');
    } finally {
      setSavingAccount(false);
    }
  };

  const savePlayerProfile = async () => {
    if (!selectedPlayer) {
      setError('No player profile selected.');
      return;
    }
    setError(null);
    setSuccess(null);

    const firstName = playerForm.firstName.trim();
    const lastName = playerForm.lastName.trim();
    const normalizedJersey = normalizeJerseyNumberInput(playerForm.jerseyNumber);
    const publicDisplayName = accountForm.displayName.trim();

    if (!firstName) {
      setError('First name is required.');
      return;
    }

    if (!normalizedJersey) {
      setError('Jersey number is required.');
      return;
    }

    setSavingPlayer(true);
    try {
      const payload: Record<string, any> = {
        first_name: firstName,
        last_name: lastName || null,
        phone: playerForm.phone.trim() || null,
        jersey_number: normalizedJersey,
        position: playerForm.position.trim() || null,
        instagram: playerForm.instagram.trim() || null,
        birth_date: playerForm.birthDate || null,
        jersey_name: playerForm.jerseyName.trim() || null,
        jersey_size: playerForm.jerseySize.trim() || null,
        shorts_size: playerForm.shortsSize.trim() || null,
        nba_comparison: playerForm.nbaComparison.trim() || null,
        referral_source: playerForm.referralSource.trim() || null,
      };
      const { error: playerErr } = await supabase
        .from('players')
        .update(payload)
        .eq('id', selectedPlayer.id)
        .eq('user_id', user?.id || '');
      if (playerErr) throw playerErr;

      if (user?.id) {
        const { error: profileErr } = await supabase.from('profiles').upsert(
          {
            user_id: user.id,
            display_name: publicDisplayName || null,
          },
          { onConflict: 'user_id' }
        );
        if (profileErr) throw profileErr;
      }

      if (applyIdentityToAll && user?.id) {
        const { error: allErr } = await supabase
          .from('players')
          .update({
            first_name: firstName,
            last_name: lastName || null,
            phone: playerForm.phone.trim() || null,
          })
          .eq('user_id', user.id)
          .neq('id', selectedPlayer.id);
        if (allErr) {
          console.warn('apply identity to all profiles failed', allErr);
        }
      }

      setPlayers((prev) =>
        prev.map((player) => {
          if (player.id === selectedPlayer.id) {
            return {
              ...player,
              ...payload,
            };
          }
          if (applyIdentityToAll) {
            return {
              ...player,
              first_name: firstName,
              last_name: lastName || null,
              phone: playerForm.phone.trim() || null,
            };
          }
          return player;
        })
      );

      if (applyIdentityToAll) {
        setAccountForm((prev) => ({
          ...prev,
          phone: playerForm.phone.trim(),
        }));
      }

      setSuccess('Player profile updated for the selected team-season record.');
    } catch (err: any) {
      console.error('player update failed', err);
      setError(err?.message || 'Unable to update player profile.');
    } finally {
      setSavingPlayer(false);
    }
  };

  const handleAccountPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Profile photo must be an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Profile photo must be 8MB or less.');
      return;
    }
    if (accountPhotoObjectUrlRef.current) {
      URL.revokeObjectURL(accountPhotoObjectUrlRef.current);
      accountPhotoObjectUrlRef.current = null;
    }
    clearCropSourceObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    cropSourceObjectUrlRef.current = objectUrl;
    setCropSource(objectUrl);
    setCropFile(file);
    setCropOpen(true);
    setError(null);
    event.currentTarget.value = '';
  };

  const handleRemoveAccountPhoto = () => {
    if (accountPhotoObjectUrlRef.current) {
      URL.revokeObjectURL(accountPhotoObjectUrlRef.current);
      accountPhotoObjectUrlRef.current = null;
    }
    setAccountPhotoPreview('');
    setAccountPhotoFile(null);
    setClearAccountPhoto(true);
  };

  const handleAdjustAccountPhoto = async () => {
    if (!accountPhotoPreview) return;
    try {
      clearCropSourceObjectUrl();
      const response = await fetch(accountPhotoPreview);
      if (!response.ok) throw new Error('Unable to load current profile photo.');
      const blob = await response.blob();
      const extension = blob.type.includes('png') ? 'png' : 'jpg';
      const file = new File([blob], `account-${user?.id || 'profile'}-current.${extension}`, {
        type: blob.type || 'image/jpeg',
      });
      const objectUrl = URL.createObjectURL(file);
      cropSourceObjectUrlRef.current = objectUrl;
      setCropSource(objectUrl);
      setCropFile(file);
      setCropOpen(true);
      setError(null);
    } catch (err: any) {
      console.error('adjust account photo failed', err);
      setError(err?.message || 'Unable to load current photo for editing.');
    }
  };

  const handleCropApply = async (file: File): Promise<boolean> => {
    if (accountPhotoObjectUrlRef.current) {
      URL.revokeObjectURL(accountPhotoObjectUrlRef.current);
      accountPhotoObjectUrlRef.current = null;
    }
    const preview = URL.createObjectURL(file);
    accountPhotoObjectUrlRef.current = preview;
    setAccountPhotoPreview(preview);
    setAccountPhotoFile(file);
    setClearAccountPhoto(false);
    setCropOpen(false);
    setCropSource('');
    setCropFile(null);
    clearCropSourceObjectUrl();
    return true;
  };

  const handleCropClose = () => {
    setCropOpen(false);
    setCropSource('');
    setCropFile(null);
    clearCropSourceObjectUrl();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 px-4">
        <div className="max-w-5xl mx-auto text-gray-400">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl border border-white/10 bg-brand-dark/70 p-6">
          <div className="text-[11px] uppercase tracking-[0.35em] text-gray-500">Settings</div>
          <h1 className="mt-2 font-sports uppercase text-white text-4xl">My Profile</h1>
          <p className="mt-2 text-gray-300 text-sm">
            Edit your account details and your player profile details.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}
        {success && (
          <div className="rounded-xl border border-brand-lime/40 bg-brand-lime/10 px-4 py-3 text-sm text-brand-lime">{success}</div>
        )}

        <section className="rounded-2xl border border-white/10 bg-brand-dark/70 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-sports uppercase text-2xl text-white">Account</h2>
              <p className="text-gray-400 text-sm">This updates your login/account details.</p>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <img
                src={
                  accountPhotoPreview ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    accountForm.displayName || `${playerForm.firstName || 'Player'} ${playerForm.lastName || ''}`.trim()
                  )}&background=111827&color=10b981`
                }
                alt="Account profile"
                className="h-24 w-24 rounded-full border-2 border-white/20 object-cover"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">Profile Photo (Account)</div>
                <div className="text-xs text-gray-400">
                  This photo is shared across your account and all linked player profiles.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => accountPhotoInputRef.current?.click()}
                    className="rounded-lg border border-white/20 bg-black px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:border-brand-lime hover:text-brand-lime"
                  >
                    Upload Photo
                  </button>
                  {accountPhotoPreview && (
                    <button
                      type="button"
                      onClick={handleAdjustAccountPhoto}
                      className="rounded-lg border border-white/20 bg-black px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:border-brand-lime hover:text-brand-lime"
                    >
                      Crop / Adjust
                    </button>
                  )}
                  {(accountPhotoPreview || accountAvatarPath) && (
                    <button
                      type="button"
                      onClick={handleRemoveAccountPhoto}
                      className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-red-300 hover:bg-red-500/20"
                    >
                      Remove Photo
                    </button>
                  )}
                </div>
                <input
                  ref={accountPhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAccountPhotoChange}
                />
              </div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Email</span>
              <input
                type="email"
                value={accountForm.email}
                onChange={(event) => setAccountForm((prev) => ({ ...prev, email: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Phone</span>
              <input
                type="tel"
                value={accountForm.phone}
                onChange={(event) => setAccountForm((prev) => ({ ...prev, phone: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
              />
            </label>
            <div className="hidden md:block" />
            <label className="block">
              <span className="text-xs uppercase tracking-[0.2em] text-gray-400">New Password</span>
              <input
                type="password"
                value={accountForm.newPassword}
                onChange={(event) => setAccountForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                placeholder="Leave blank to keep current password"
                className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Confirm Password</span>
              <input
                type="password"
                value={accountForm.confirmPassword}
                onChange={(event) => setAccountForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={saveAccount}
            disabled={savingAccount}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-red px-6 py-3 font-sports uppercase tracking-wider text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingAccount ? 'Saving...' : 'Save Account'}
          </button>
        </section>

        <section className="rounded-2xl border border-white/10 bg-brand-dark/70 p-6">
          <h2 className="font-sports uppercase text-2xl text-white">Player Profile</h2>
          <p className="text-gray-400 text-sm mt-1">
            Public display name is shown on your public player profile. Legal first/last name remain for private player-record management; jersey details are saved per selected team-season record.
          </p>

          {!players.length ? (
            <div className="mt-5 rounded-xl border border-white/10 bg-black/40 px-4 py-5 text-sm text-gray-400">
              No player profile found for this account yet.
            </div>
          ) : (
            <>
              <label className="block mt-5">
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Profile To Edit</span>
                <div className="relative mt-2">
                  <select
                    value={selectedPlayerId}
                    onChange={(event) => setSelectedPlayerId(event.target.value)}
                    className="w-full appearance-none rounded-xl border border-white/15 bg-black px-4 py-3 pr-11 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none"
                  >
                    {players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {playerLabel(player)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                </div>
              </label>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block md:col-span-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Public Display Name</span>
                  <input
                    type="text"
                    value={accountForm.displayName}
                    onChange={(event) => setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                    placeholder="Name shown on your public player profile"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">First Name</span>
                  <input
                    type="text"
                    value={playerForm.firstName}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, firstName: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Last Name</span>
                  <input
                    type="text"
                    value={playerForm.lastName}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, lastName: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Phone</span>
                  <input
                    type="tel"
                    value={playerForm.phone}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, phone: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Jersey Number</span>
                  <input
                    type="text"
                    value={playerForm.jerseyNumber}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, jerseyNumber: event.target.value }))}
                    required
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Position</span>
                  <div className="relative mt-2">
                    <select
                    value={playerForm.position}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, position: event.target.value }))}
                      className="w-full appearance-none rounded-xl border border-white/15 bg-black px-4 py-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none"
                    >
                      <option value="">Select position</option>
                      {POSITION_OPTIONS.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Instagram</span>
                  <input
                    type="text"
                    value={playerForm.instagram}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, instagram: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Birth Date</span>
                  <div className="relative mt-2">
                    <input
                      ref={birthDateInputRef}
                      type="date"
                      value={playerForm.birthDate}
                      onChange={(event) => setPlayerForm((prev) => ({ ...prev, birthDate: event.target.value }))}
                      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 pr-11 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => birthDateInputRef.current?.showPicker?.()}
                      className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                      aria-label="Open calendar"
                    >
                      <Calendar size={16} />
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Jersey Name</span>
                  <input
                    type="text"
                    value={playerForm.jerseyName}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, jerseyName: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Jersey Size</span>
                  <div className="relative mt-2">
                    <select
                    value={playerForm.jerseySize}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, jerseySize: event.target.value }))}
                      className="w-full appearance-none rounded-xl border border-white/15 bg-black px-4 py-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none"
                    >
                      <option value="">Select size</option>
                      {SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Shorts Size</span>
                  <div className="relative mt-2">
                    <select
                    value={playerForm.shortsSize}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, shortsSize: event.target.value }))}
                      className="w-full appearance-none rounded-xl border border-white/15 bg-black px-4 py-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none"
                    >
                      <option value="">Select size</option>
                      {SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">NBA Comparison</span>
                  <input
                    type="text"
                    value={playerForm.nbaComparison}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, nbaComparison: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Referral Source</span>
                  <div className="relative mt-2">
                    <select
                    value={playerForm.referralSource}
                    onChange={(event) => setPlayerForm((prev) => ({ ...prev, referralSource: event.target.value }))}
                      className="w-full appearance-none rounded-xl border border-white/15 bg-black px-4 py-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none"
                    >
                      <option value="">Select referral source</option>
                      {REFERRAL_OPTIONS.map((referralSource) => (
                        <option key={referralSource} value={referralSource}>
                          {referralSource === 'Friend' ? 'Friend / Word of Mouth' : referralSource}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  </div>
                </label>
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <label className="inline-flex items-start gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={applyIdentityToAll}
                      onChange={(event) => setApplyIdentityToAll(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black text-brand-lime focus:ring-brand-lime"
                    />
                    <span>
                      Apply first name, last name, and phone to all my season/division profiles
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={savePlayerProfile}
                    disabled={savingPlayer}
                    className="w-full md:w-auto md:min-w-[240px] inline-flex items-center justify-center rounded-xl bg-brand-red px-6 py-3 font-sports uppercase tracking-wider text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingPlayer ? 'Saving...' : 'Save Selected Profile'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {cropOpen && (
        <ImageCropper
          open={cropOpen}
          source={cropSource}
          file={cropFile}
          spec={CROP_SPECS.player}
          filePrefix={`account-${user?.id || 'profile'}-avatar`}
          onSave={handleCropApply}
          onUseOriginal={handleCropApply}
          onClose={handleCropClose}
        />
      )}
    </div>
  );
};

export default MyProfile;

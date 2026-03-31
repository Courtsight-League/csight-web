import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Upload, Image as ImageIcon, X } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { getCurrentUser } from '../services/authService';
import { Role } from '../types';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

const CROP_SPECS = {
  logo: {
    label: 'Logo',
    outputWidth: 512,
    outputHeight: 512,
    previewWidth: 240,
    previewHeight: 240,
    previewClass: 'rounded-full',
  },
  banner: {
    label: 'Banner',
    outputWidth: 1600,
    outputHeight: 600,
    previewWidth: 320,
    previewHeight: 120,
    previewClass: 'rounded-2xl',
  },
} as const;

const AddTeam: React.FC = () => {
  const navigate = useNavigate();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<{ id: string; name: string; isCurrent: boolean }[]>([]);
  const [seasonsLoading, setSeasonsLoading] = useState(true);
  const [seasonDivisions, setSeasonDivisions] = useState<string[]>([]);
  const [divisionsLoading, setDivisionsLoading] = useState(false);
  const [previousTeams, setPreviousTeams] = useState<{
    id: string;
    name: string;
    division: string;
    logoPath: string;
    bannerPath: string;
    seasonName: string;
    seasonId: string;
  }[]>([]);
  const [creationMode, setCreationMode] = useState<'scratch' | 'copy'>('scratch');
  const [copySourceSeasonId, setCopySourceSeasonId] = useState('');
  const [copySourceDivision, setCopySourceDivision] = useState('');
  const [copyTeamId, setCopyTeamId] = useState<string>('');
  const [form, setForm] = useState({
    name: '',
    division: '',
    seasonId: '',
    logoPath: '',
    bannerPath: '',
  });
  const [logoPreview, setLogoPreview] = useState('');
  const [bannerPreview, setBannerPreview] = useState('');
  const [logoSource, setLogoSource] = useState('');
  const [bannerSource, setBannerSource] = useState('');
  const [logoSourceFile, setLogoSourceFile] = useState<File | null>(null);
  const [bannerSourceFile, setBannerSourceFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [cropTarget, setCropTarget] = useState<'logo' | 'banner' | null>(null);
  const [cropSource, setCropSource] = useState<string>('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [cropImageSize, setCropImageSize] = useState<{ width: number; height: number } | null>(null);
  const [cropSaving, setCropSaving] = useState(false);
  const [cropLoadToken, setCropLoadToken] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const dataClient = supabaseAdmin ?? supabase;

  const loadPlayerColumns = async () => {
    if (!supabaseAdmin) return new Set<string>();
    try {
      const { data, error } = await supabaseAdmin.from('players').select('*').limit(1);
      if (!error && data?.[0]) {
        return new Set(Object.keys(data[0]));
      }
    } catch (err) {
      console.warn('player columns lookup failed', err);
    }
    return new Set<string>();
  };

  const loadPlayersForTeamCopy = async (teamId: string) => {
    const client = supabaseAdmin ?? supabase;
    const { data, error } = await client
      .from('players')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  };

  useEffect(() => {
    const user = getCurrentUser();
    const canManage =
      user && (user.role === Role.ADMIN_FULL || user.role === Role.ADMIN_COMMISSIONER);

    if (!canManage) {
      navigate('/login');
    } else {
      setIsAuthorized(true);
    }
  }, [navigate]);

  useEffect(() => {
    if (!cropSource) {
      setCropImageSize(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setCropImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      setCropImageSize(null);
    };
    img.src = cropSource;
  }, [cropSource, cropLoadToken]);

  const revokeObjectUrl = (value?: string) => {
    if (value && value.startsWith('blob:')) {
      URL.revokeObjectURL(value);
    }
  };

  useEffect(() => {
    return () => {
      revokeObjectUrl(logoSource);
      revokeObjectUrl(bannerSource);
    };
  }, [logoSource, bannerSource]);

  const filteredCopyTeams = useMemo(() => {
    return previousTeams.filter((team) => {
      if (copySourceSeasonId && team.seasonId !== copySourceSeasonId) return false;
      if (copySourceDivision && team.division !== copySourceDivision) return false;
      return true;
    });
  }, [previousTeams, copySourceSeasonId, copySourceDivision]);

  const copySourceDivisions = useMemo(() => {
    if (!copySourceSeasonId) return [];
    return Array.from(
      new Set(
        previousTeams
          .filter((team) => team.seasonId === copySourceSeasonId)
          .map((team) => team.division.trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));
  }, [previousTeams, copySourceSeasonId]);

  useEffect(() => {
    const loadSeasons = async () => {
      try {
        setSeasonsLoading(true);
        const { data, error: seasonErr } = await dataClient
          .from('seasons')
          .select('id,name,is_current')
          .order('start_date', { ascending: false });
        if (seasonErr) throw seasonErr;
        const mapped =
          data?.map((s: any) => ({
            id: s.id,
            name: s.name,
            isCurrent: !!s.is_current,
          })) || [];
        setSeasons(mapped);
        const active = mapped.find((s) => s.isCurrent) || mapped[0];
        if (active) {
          setForm((prev) => ({ ...prev, seasonId: active.id }));
          setCopySourceSeasonId((prev) => prev || active.id);
        }
      } catch (err) {
        console.error('Load seasons error', err);
        setError('Unable to load seasons. Please try again.');
      } finally {
        setSeasonsLoading(false);
      }
    };

    loadSeasons();
  }, []);

  useEffect(() => {
    const loadTeams = async () => {
      try {
        const { data, error: teamErr } = await dataClient
          .from('teams')
          .select('id,name,division,logo_url,banner_url,season_id,seasons:season_id(name)')
          .order('name', { ascending: true });
        if (teamErr) throw teamErr;
        const mapped =
          (data || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            division: t.division || '',
            logoPath: t.logo_url || '',
            bannerPath: t.banner_url || '',
            seasonName: t.seasons?.name || 'Season',
            seasonId: t.season_id || '',
          })) || [];
        setPreviousTeams(mapped);
      } catch (err) {
        console.warn('Load teams for copy failed', err);
        setPreviousTeams([]);
      }
    };
    loadTeams();
  }, []);

  useEffect(() => {
    const loadSeasonDivisions = async () => {
      if (!form.seasonId) {
        setSeasonDivisions([]);
        setForm((prev) => ({ ...prev, division: '' }));
        return;
      }

      try {
        setDivisionsLoading(true);
        const { data, error: divisionErr } = await dataClient
          .from('divisions')
          .select('name')
          .eq('season_id', form.seasonId)
          .order('name', { ascending: true });
        if (divisionErr) throw divisionErr;

        const uniqueDivisions = Array.from(
          new Set(
            (data || [])
              .map((row: any) => String(row.name || '').trim())
              .filter(Boolean)
          )
        );

        setSeasonDivisions(uniqueDivisions);
        setForm((prev) => ({
          ...prev,
          division: uniqueDivisions.includes(prev.division) ? prev.division : uniqueDivisions[0] || '',
        }));
      } catch (err) {
        console.warn('Load divisions for selected season failed', err);
        setSeasonDivisions([]);
        setForm((prev) => ({ ...prev, division: '' }));
      } finally {
        setDivisionsLoading(false);
      }
    };

    loadSeasonDivisions();
  }, [form.seasonId]);

  useEffect(() => {
    if (!copySourceDivision) return;
    if (!copySourceDivisions.includes(copySourceDivision)) {
      setCopySourceDivision('');
    }
  }, [copySourceDivision, copySourceDivisions]);

  useEffect(() => {
    if (!copyTeamId) return;
    const isStillVisible = filteredCopyTeams.some((team) => team.id === copyTeamId);
    if (!isStillVisible) {
      setCopyTeamId('');
    }
  }, [copyTeamId, filteredCopyTeams]);

  const clearCopiedTeam = () => {
    setCopyTeamId('');
    setForm((prev) => ({
      ...prev,
      name: '',
      logoPath: '',
      bannerPath: '',
    }));
    setLogoPreview('');
    setBannerPreview('');
    setSourceForKind('logo', '', null);
    setSourceForKind('banner', '', null);
  };

  const handleCreationModeChange = (mode: 'scratch' | 'copy') => {
    setCreationMode(mode);
    if (mode === 'scratch') {
      clearCopiedTeam();
    }
  };

  const signUrl = async (path: string) => {
    if (!path) return '';
    const marker = 'team-assets/';
    const idx = path.indexOf(marker);
    const bucketPath = idx >= 0 ? path.slice(idx + marker.length) : path;
    const { data, error: signErr } = await supabase.storage
      .from('team-assets')
      .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
    if (signErr) {
      console.error('Signed URL error', signErr);
      return path;
    }
    return data?.signedUrl || path;
  };

  const setSourceForKind = (kind: 'logo' | 'banner', source: string, file: File | null) => {
    if (kind === 'logo') {
      setLogoSource(source);
      setLogoSourceFile(file);
      return;
    }
    setBannerSource(source);
    setBannerSourceFile(file);
  };

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const getMaxOffsets = (
    targetWidth: number,
    targetHeight: number,
    size: { width: number; height: number },
    zoom: number
  ) => {
    const baseScale = Math.max(targetWidth / size.width, targetHeight / size.height);
    const scaledWidth = size.width * baseScale * zoom;
    const scaledHeight = size.height * baseScale * zoom;
    return {
      maxOffsetX: Math.max(0, (scaledWidth - targetWidth) / 2),
      maxOffsetY: Math.max(0, (scaledHeight - targetHeight) / 2),
    };
  };

  const getCropMetrics = (
    targetWidth: number,
    targetHeight: number,
    size: { width: number; height: number },
    zoom: number,
    offset: { x: number; y: number }
  ) => {
    const baseScale = Math.max(targetWidth / size.width, targetHeight / size.height);
    const scaledWidth = size.width * baseScale * zoom;
    const scaledHeight = size.height * baseScale * zoom;
    const maxOffsetX = Math.max(0, (scaledWidth - targetWidth) / 2);
    const maxOffsetY = Math.max(0, (scaledHeight - targetHeight) / 2);
    const safeOffsetX = clamp(offset.x, -1, 1) * maxOffsetX;
    const safeOffsetY = clamp(offset.y, -1, 1) * maxOffsetY;
    const x = (targetWidth - scaledWidth) / 2 + safeOffsetX;
    const y = (targetHeight - scaledHeight) / 2 + safeOffsetY;
    return { x, y, scaledWidth, scaledHeight };
  };

  const resetCropper = () => {
    setCropTarget(null);
    setCropSource('');
    setCropFile(null);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropImageSize(null);
    setIsDragging(false);
    activePointerIdRef.current = null;
    dragStartRef.current = null;
  };

  const openCropper = (kind: 'logo' | 'banner') => {
    const source = kind === 'logo' ? logoSource || logoPreview : bannerSource || bannerPreview;
    if (!source) return;
    setCropTarget(kind);
    setCropSource(source);
    setCropFile(kind === 'logo' ? logoSourceFile : bannerSourceFile);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropImageSize(null);
    setIsDragging(false);
    setCropLoadToken((prev) => prev + 1);
  };

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeCropSpec || !cropImageSize) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragOffsetRef.current = { ...cropOffset };
    setIsDragging(true);
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || activePointerIdRef.current !== event.pointerId) return;
    if (!activeCropSpec || !cropImageSize || !dragStartRef.current) return;
    event.preventDefault();
    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;
    const { maxOffsetX, maxOffsetY } = getMaxOffsets(
      activeCropSpec.previewWidth,
      activeCropSpec.previewHeight,
      cropImageSize,
      cropZoom
    );
    const nextX =
      maxOffsetX > 0 ? clamp(dragOffsetRef.current.x + deltaX / maxOffsetX, -1, 1) : 0;
    const nextY =
      maxOffsetY > 0 ? clamp(dragOffsetRef.current.y + deltaY / maxOffsetY, -1, 1) : 0;
    setCropOffset({ x: nextX, y: nextY });
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    activePointerIdRef.current = null;
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const handleUpload = async (file: File, kind: 'logo' | 'banner') => {
    const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingBanner;
    setUploading(true);
    setError(null);
    try {
      const path = `teams/${Date.now()}-${file.name}`;
      const { data, error: uploadErr } = await supabase.storage
        .from('team-assets')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const signed = await signUrl(data.path);
      if (kind === 'logo') {
        setForm((prev) => ({ ...prev, logoPath: data.path }));
        setLogoPreview(signed);
      } else {
        setForm((prev) => ({ ...prev, bannerPath: data.path }));
        setBannerPreview(signed);
      }
      return true;
    } catch (err: any) {
      console.error('Upload error', err);
      setError('Upload failed. Please try again.');
      return false;
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, kind: 'logo' | 'banner') => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const objectUrl = URL.createObjectURL(file);
      setSourceForKind(kind, objectUrl, file);
      setCropTarget(kind);
      setCropFile(file);
      setCropSource(objectUrl);
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setCropImageSize(null);
      setCropLoadToken((prev) => prev + 1);
    }
    e.target.value = '';
  };

  const handleCropSave = async () => {
    if (!cropTarget || !cropImageSize || !cropSource) return;
    const spec = CROP_SPECS[cropTarget];
    try {
      setCropSaving(true);
      setError(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const loadImage = new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image.'));
      });
      img.src = cropSource;
      await loadImage;

      const { x, y, scaledWidth, scaledHeight } = getCropMetrics(
        spec.outputWidth,
        spec.outputHeight,
        cropImageSize,
        cropZoom,
        cropOffset
      );

      const canvas = document.createElement('canvas');
      canvas.width = spec.outputWidth;
      canvas.height = spec.outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

      const outputType = cropFile?.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (!result) {
              reject(new Error('Crop failed.'));
              return;
            }
            resolve(result);
          },
          outputType,
          0.92
        );
      });

      const ext = outputType === 'image/png' ? 'png' : 'jpg';
      const croppedFile = new File([blob], `${cropTarget}-${Date.now()}.${ext}`, { type: outputType });
      const success = await handleUpload(croppedFile, cropTarget);
      if (success) {
        resetCropper();
      }
    } catch (err) {
      console.error('Crop error', err);
      setError('Failed to crop image. Please try again.');
    } finally {
      setCropSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Team name is required.');
      return;
    }
    if (!form.seasonId) {
      setError('Select a season.');
      return;
    }
    if (!form.division.trim()) {
      setError('Select a division for this season.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: Record<string, string> = {
        name: form.name.trim(),
        division: form.division,
        season_id: form.seasonId,
      };

      if (form.logoPath.trim()) payload.logo_url = form.logoPath.trim();
      if (form.bannerPath.trim()) payload.banner_url = form.bannerPath.trim();

      const { data: insertedTeam, error: insertError } = await supabase
        .from('teams')
        .insert(payload)
        .select('id')
        .single();
      if (insertError) throw insertError;

      if (creationMode === 'copy' && copyTeamId && insertedTeam?.id) {
        const sourcePlayers = await loadPlayersForTeamCopy(copyTeamId);
        if (sourcePlayers.length) {
          const playerColumns = await loadPlayerColumns();
          const clonedPlayers = sourcePlayers.map((row: any) => {
            const nextRow: Record<string, any> = {
              team_id: insertedTeam.id,
              season_id: form.seasonId,
            };

            const copyIfPresent = (key: string) => {
              if (!playerColumns.size || playerColumns.has(key)) {
                if (row[key] !== undefined) {
                  nextRow[key] = row[key];
                }
              }
            };

            copyIfPresent('user_id');
            copyIfPresent('first_name');
            copyIfPresent('last_name');
            copyIfPresent('jersey_number');
            copyIfPresent('position');
            copyIfPresent('photo_url');
            copyIfPresent('is_captain');
            copyIfPresent('birth_date');
            copyIfPresent('phone');
            copyIfPresent('jersey_size');
            copyIfPresent('shorts_size');
            copyIfPresent('jersey_name');
            copyIfPresent('referral_source');
            copyIfPresent('nba_comparison');
            copyIfPresent('instagram');
            copyIfPresent('email');
            copyIfPresent('email_address');
            copyIfPresent('is_guest');

            return nextRow;
          });

          const { error: playerInsertError } = await (supabaseAdmin ?? supabase)
            .from('players')
            .insert(clonedPlayers);
          if (playerInsertError) throw playerInsertError;
        }
      }

      setSuccess('Team created! Redirecting to list...');
      setTimeout(() => navigate('/admin?tab=teams'), 600);
    } catch (err: any) {
      setError(err?.message || 'Failed to create team.');
    } finally {
      setSaving(false);
    }
  };

  const activeCropSpec = cropTarget ? CROP_SPECS[cropTarget] : null;
  const cropPreviewMetrics =
    activeCropSpec && cropImageSize
      ? getCropMetrics(
          activeCropSpec.previewWidth,
          activeCropSpec.previewHeight,
          cropImageSize,
          cropZoom,
          cropOffset
        )
      : null;

  if (!isAuthorized) return null;

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate('/admin?tab=teams')}
          className="text-gray-400 hover:text-white flex items-center gap-2 mb-6"
        >
          <ArrowLeft size={18} /> Back to Teams
        </button>

        <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="font-sports text-3xl text-white uppercase">Add Team</h1>
              <p className="text-gray-400 text-sm mt-1">
                Create a team record with basic branding details.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs text-gray-400 uppercase font-bold mb-3">
                How do you want to create this team?
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleCreationModeChange('scratch')}
                  className={`rounded-xl border p-4 text-left transition ${
                    creationMode === 'scratch'
                      ? 'border-brand-lime bg-brand-lime/10 text-white'
                      : 'border-white/10 bg-black/40 text-gray-300 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm font-bold uppercase">Create from scratch</div>
                  <p className="text-xs text-gray-400 mt-1">
                    Start with a blank team and enter the details manually.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleCreationModeChange('copy')}
                  className={`rounded-xl border p-4 text-left transition ${
                    creationMode === 'copy'
                      ? 'border-brand-lime bg-brand-lime/10 text-white'
                      : 'border-white/10 bg-black/40 text-gray-300 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm font-bold uppercase">Create from existing team</div>
                  <p className="text-xs text-gray-400 mt-1">
                    Copy the name and branding from another team, then assign the new season and division.
                  </p>
                </button>
              </div>
            </div>

            {creationMode === 'copy' && (
              <div className="space-y-5 rounded-2xl border border-white/10 bg-black/30 p-5">
                <div>
                  <h2 className="text-sm font-bold uppercase text-white">1. Copy From</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Select the existing team you want to use as the starting point.
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Source Season
                  </label>
                  <select
                    value={copySourceSeasonId}
                    onChange={(e) => {
                      setCopySourceSeasonId(e.target.value);
                      setCopySourceDivision('');
                    }}
                    className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                    disabled={seasonsLoading}
                  >
                    <option value="" disabled>
                      {seasonsLoading ? 'Loading seasons...' : 'Select source season'}
                    </option>
                    {sortSeasonsNewestFirst(seasons).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.isCurrent ? '(Current)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Source Division
                  </label>
                  <select
                    value={copySourceDivision}
                    onChange={(e) => setCopySourceDivision(e.target.value)}
                    className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                    disabled={!copySourceSeasonId || !copySourceDivisions.length}
                  >
                    {!copySourceSeasonId && <option value="">Select source season first</option>}
                    {copySourceSeasonId && !copySourceDivisions.length && (
                      <option value="">No divisions found for this source season</option>
                    )}
                    {!!copySourceDivisions.length && <option value="">All divisions</option>}
                    {copySourceDivisions.map((division) => (
                      <option key={division} value={division}>
                        {division}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Source Team
                  </label>
                  <select
                    value={copyTeamId}
                    onChange={async (e) => {
                      const nextId = e.target.value;
                      setCopyTeamId(nextId);
                      if (!nextId) {
                        clearCopiedTeam();
                        return;
                      }
                      const team = previousTeams.find((t) => t.id === nextId);
                      if (!team) return;
                      setForm((prev) => ({
                        ...prev,
                        name: team.name,
                        logoPath: team.logoPath || '',
                        bannerPath: team.bannerPath || '',
                      }));
                      if (team.logoPath) {
                        const signedLogo = await signUrl(team.logoPath);
                        setLogoPreview(signedLogo);
                        setSourceForKind('logo', signedLogo, null);
                      } else {
                        setLogoPreview('');
                        setSourceForKind('logo', '', null);
                      }
                      if (team.bannerPath) {
                        const signedBanner = await signUrl(team.bannerPath);
                        setBannerPreview(signedBanner);
                        setSourceForKind('banner', signedBanner, null);
                      } else {
                        setBannerPreview('');
                        setSourceForKind('banner', '', null);
                      }
                    }}
                    className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none"
                  >
                    <option value="">Select a team to copy</option>
                    {!filteredCopyTeams.length && copySourceSeasonId && (
                      <option value="" disabled>
                        No teams found for the selected source season/division
                      </option>
                    )}
                    {filteredCopyTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} - {t.seasonName}{t.division ? ` - ${t.division}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-2">
                    This copies the team name, logo, and banner. You can still edit them before saving.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-5 rounded-2xl border border-white/10 bg-black/30 p-5">
              <div>
                <h2 className="text-sm font-bold uppercase text-white">
                  {creationMode === 'copy' ? '2. Create In' : '1. Team Placement'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Choose where this new team should be created.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Season
                </label>
                <select
                  value={form.seasonId}
                  onChange={(e) => setForm({ ...form, seasonId: e.target.value })}
                  className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                  disabled={seasonsLoading}
                >
                  <option value="" disabled>
                    {seasonsLoading ? 'Loading seasons...' : 'Select season'}
                  </option>
                  {sortSeasonsNewestFirst(seasons).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.isCurrent ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Division
                </label>
                <select
                  value={form.division}
                  onChange={(e) => setForm({ ...form, division: e.target.value })}
                  className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                  disabled={!form.seasonId || divisionsLoading || !seasonDivisions.length}
                >
                  {!form.seasonId && <option value="">Select season first</option>}
                  {form.seasonId && divisionsLoading && <option value="">Loading divisions...</option>}
                  {form.seasonId && !divisionsLoading && !seasonDivisions.length && (
                    <option value="">No divisions found for this season</option>
                  )}
                  {seasonDivisions.map((division) => (
                    <option key={division} value={division}>
                      {division}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-5 rounded-2xl border border-white/10 bg-black/30 p-5">
              <div>
                <h2 className="text-sm font-bold uppercase text-white">
                  {creationMode === 'copy' ? '3. Team Details' : '2. Team Details'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {creationMode === 'copy'
                    ? 'Review the copied details and adjust anything before creating the team.'
                    : 'Enter the team name and upload the branding assets.'}
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                  Team Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-black border border-white/20 rounded p-3 text-white focus:border-brand-lime focus:outline-none"
                  placeholder="e.g. Excommunicado"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs text-gray-400 uppercase font-bold">
                    Logo Upload
                  </label>
                  <div className="border border-white/10 rounded-lg bg-black/40 p-4 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => openCropper('logo')}
                      disabled={!logoPreview && !logoSource}
                      className={`relative w-16 h-16 rounded-full bg-black border border-white/10 overflow-hidden flex items-center justify-center group ${
                        logoPreview || logoSource ? 'cursor-pointer hover:border-brand-lime/60' : 'cursor-default'
                      }`}
                      aria-label="Edit logo crop"
                    >
                      {logoPreview || logoSource ? (
                        <img
                          src={logoPreview || logoSource}
                          alt="Logo preview"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <ImageIcon className="text-gray-600" />
                      )}
                      {(logoPreview || logoSource) && (
                        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 text-[10px] text-white font-bold uppercase flex items-center justify-center transition-opacity">
                          Edit
                        </span>
                      )}
                    </button>
                    <div className="flex-1">
                      <input
                        id="logo-file"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onFileChange(e, 'logo')}
                      />
                      <label
                        htmlFor="logo-file"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-bold uppercase cursor-pointer border border-white/10"
                      >
                        <Upload size={14} /> {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                      </label>
                      {form.logoPath && (
                        <div className="text-[11px] text-gray-500 mt-1 break-all">{form.logoPath}</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs text-gray-400 uppercase font-bold">
                    Banner Upload
                  </label>
                  <div className="border border-white/10 rounded-lg bg-black/40 p-4 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => openCropper('banner')}
                      disabled={!bannerPreview && !bannerSource}
                      className={`relative w-28 h-16 rounded-md bg-black border border-white/10 overflow-hidden flex items-center justify-center group ${
                        bannerPreview || bannerSource ? 'cursor-pointer hover:border-brand-lime/60' : 'cursor-default'
                      }`}
                      aria-label="Edit banner crop"
                    >
                      {bannerPreview || bannerSource ? (
                        <img
                          src={bannerPreview || bannerSource}
                          alt="Banner preview"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <ImageIcon className="text-gray-600" />
                      )}
                      {(bannerPreview || bannerSource) && (
                        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 text-[10px] text-white font-bold uppercase flex items-center justify-center transition-opacity">
                          Edit
                        </span>
                      )}
                    </button>
                    <div className="flex-1">
                      <input
                        id="banner-file"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onFileChange(e, 'banner')}
                      />
                      <label
                        htmlFor="banner-file"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-bold uppercase cursor-pointer border border-white/10"
                      >
                        <Upload size={14} /> {uploadingBanner ? 'Uploading...' : 'Upload Banner'}
                      </label>
                      {form.bannerPath && (
                        <div className="text-[11px] text-gray-500 mt-1 break-all">{form.bannerPath}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {error && <div className="text-xs text-brand-red font-mono">{error}</div>}
            {success && <div className="text-xs text-brand-lime font-mono">{success}</div>}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => navigate('/admin?tab=teams')}
                className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 bg-brand-lime text-black px-5 py-2 rounded font-bold uppercase text-sm hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={saving}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Create Team'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {cropTarget && activeCropSpec && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-brand-dark border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-sports text-xl text-white uppercase">
                  Adjust {activeCropSpec.label}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Drag the preview to pan, or use the sliders.
                </p>
              </div>
              <button
                type="button"
                onClick={resetCropper}
                className="text-gray-500 hover:text-white"
                disabled={cropSaving}
                aria-label="Close cropper"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6">
              <div className="flex items-center justify-center">
                <div
                  className={`relative bg-black/60 border border-white/10 overflow-hidden ${activeCropSpec.previewClass} ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  style={{
                    width: `${activeCropSpec.previewWidth}px`,
                    height: `${activeCropSpec.previewHeight}px`,
                    touchAction: 'none',
                  }}
                  onPointerDown={handleDragStart}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                >
                  {cropSource && cropPreviewMetrics ? (
                    <img
                      src={cropSource}
                      alt={`${activeCropSpec.label} crop preview`}
                      className="absolute top-0 left-0 max-w-none"
                      style={{
                        width: `${cropPreviewMetrics.scaledWidth}px`,
                        height: `${cropPreviewMetrics.scaledHeight}px`,
                        transform: `translate3d(${cropPreviewMetrics.x}px, ${cropPreviewMetrics.y}px, 0)`,
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                      Loading preview...
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Zoom
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={2.5}
                    step={0.01}
                    value={cropZoom}
                    onChange={(e) => setCropZoom(Number(e.target.value))}
                    className="w-full"
                    disabled={cropSaving}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Horizontal Position
                  </label>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={cropOffset.x}
                    onChange={(e) => setCropOffset((prev) => ({ ...prev, x: Number(e.target.value) }))}
                    className="w-full"
                    disabled={cropSaving}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase font-bold mb-2">
                    Vertical Position
                  </label>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={cropOffset.y}
                    onChange={(e) => setCropOffset((prev) => ({ ...prev, y: Number(e.target.value) }))}
                    className="w-full"
                    disabled={cropSaving}
                  />
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCropZoom(1);
                      setCropOffset({ x: 0, y: 0 });
                    }}
                    className="px-3 py-2 rounded border border-white/20 text-gray-300 text-xs uppercase"
                    disabled={cropSaving}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={resetCropper}
                className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
                disabled={cropSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCropSave}
                className="px-4 py-2 rounded bg-brand-lime text-black text-sm font-bold uppercase disabled:opacity-60"
                disabled={cropSaving || !cropPreviewMetrics}
              >
                {cropSaving ? 'Saving...' : 'Save Crop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddTeam;

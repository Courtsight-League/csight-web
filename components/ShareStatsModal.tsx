import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFontEmbedCSS, toBlob } from 'html-to-image';
import { Copy, Download, ImagePlus, Share2 } from 'lucide-react';
import { StatsShareCard, type ShareCardData } from './StatsShareCard';
import { apiBaseUrl } from '../services/apiBase';
import { supabase } from '../services/supabaseClient';

export type ShareStatsModalProps = {
  open: boolean;
  onClose: () => void;
  data: ShareCardData;
  selectors?: {
    teamOptions: Array<{ id: string; label: string }>;
    selectedTeamId: string;
    onTeamChange: (teamId: string) => void;
    gameOptions: Array<{ id: string; label: string }>;
    selectedGameId: string;
    onGameChange: (gameId: string) => void;
  };
};

const safeFileBase = (value: string) =>
  (value || 'player')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'player';

const STORAGE_PUBLIC_MARKER = '/storage/v1/object/public/';
const STORAGE_SIGNED_MARKER = '/storage/v1/object/sign/';

const blobToDataUrl = async (blob: Blob) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });

const canvasToBlob = async (canvas: HTMLCanvasElement) =>
  await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to produce image blob.'));
    }, 'image/png');
  });

const isRenderableImageDataUrl = async (value: string) =>
  await new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = value;
  });

const toValidImageDataUrl = async (blob: Blob) => {
  if (!blob || blob.size <= 0) return null;
  try {
    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl) return null;
    const ok = await isRenderableImageDataUrl(dataUrl);
    return ok ? dataUrl : null;
  } catch {
    return null;
  }
};

const toSafePath = (value: string) => {
  const noQuery = value.split('?')[0] || '';
  let decoded = noQuery;
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    decoded = noQuery;
  }
  const normalized = decoded.replace(/^\/+/, '');
  if (!normalized) return '';
  return normalized;
};

const svgToDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const buildInitialsAvatarDataUrl = (name?: string | null) => {
  const normalized = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = (normalized[0]?.[0] || 'P').toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <radialGradient id="bg" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stop-color="#ff8d00" />
          <stop offset="100%" stop-color="#f97316" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="256" fill="url(#bg)" />
      <text
        x="50%"
        y="50%"
        dominant-baseline="central"
        text-anchor="middle"
        fill="#ffffff"
        font-family="Arial, Helvetica, sans-serif"
        font-size="220"
        font-weight="700"
      >${initials}</text>
    </svg>
  `;
  return svgToDataUrl(svg);
};

const loadImageElement = async (src: string) =>
  await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = src;
  });

const buildCircularAvatarDataUrl = async (src: string, fallbackSrc: string) => {
  const canvas = document.createElement('canvas');
  const size = 512;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallbackSrc;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  try {
    const img = await loadImageElement(src);
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const targetRatio = 1;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;

    if (imgRatio > targetRatio) {
      sw = img.naturalHeight * targetRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else if (imgRatio < targetRatio) {
      sh = img.naturalWidth / targetRatio;
      sy = (img.naturalHeight - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
  } catch {
    ctx.restore();
    return fallbackSrc;
  }

  ctx.restore();
  return canvas.toDataURL('image/png');
};

const compositeAvatarOntoCardBlob = async (cardBlob: Blob, avatarSrc: string, cardWidth: number, cardHeight: number) => {
  const baseImage = await loadImageElement(await blobToDataUrl(cardBlob));
  const avatarImage = await loadImageElement(avatarSrc);
  const canvas = document.createElement('canvas');
  const outputWidth = Math.max(baseImage.naturalWidth || cardWidth, cardWidth);
  const outputHeight = Math.max(baseImage.naturalHeight || cardHeight, cardHeight);
  const scaleX = outputWidth / cardWidth;
  const scaleY = outputHeight / cardHeight;
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to access canvas context.');

  ctx.drawImage(baseImage, 0, 0, outputWidth, outputHeight);

  const avatarSize = 250 * Math.min(scaleX, scaleY);
  const avatarX = ((cardWidth - 250) / 2) * scaleX;
  const avatarY = 326 * scaleY;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatarImage, avatarX, avatarY, avatarSize, avatarSize);
  ctx.restore();

  return await canvasToBlob(canvas);
};

const isIOSWebKit = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const touchMac = platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1;
  return /iP(hone|ad|od)/i.test(ua) || touchMac;
};

const extractSupabaseStorageRef = (source?: string | null): { bucket: string; path: string } | null => {
  const raw = (source || '').trim();
  if (!raw) return null;
  if (/^(data:|blob:)/i.test(raw)) return null;

  const normalizeBucketPath = (value: string) => {
    const safe = toSafePath(value);
    if (!safe) return null;
    const segments = safe.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const [bucket, ...rest] = segments;
    const path = rest.join('/');
    if (!bucket || !path) return null;
    return { bucket, path };
  };

  if (!/^https?:\/\//i.test(raw)) {
    // Common legacy format: "team-assets/path/to/file.png"
    const prefixed = normalizeBucketPath(raw);
    if (prefixed) return prefixed;
    // Fallback: treat raw as path under team-assets.
    const teamPath = toSafePath(raw);
    return teamPath ? { bucket: 'team-assets', path: teamPath } : null;
  }

  if (raw.includes(STORAGE_PUBLIC_MARKER)) {
    const value = raw.split(STORAGE_PUBLIC_MARKER)[1] || '';
    return normalizeBucketPath(value);
  }
  if (raw.includes(STORAGE_SIGNED_MARKER)) {
    const value = raw.split(STORAGE_SIGNED_MARKER)[1] || '';
    return normalizeBucketPath(value);
  }

  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/(.+)$/i);
    if (!match?.[1]) return null;
    return normalizeBucketPath(match[1]);
  } catch {
    return null;
  }
};

const resolveAvatarDataUrl = async (source: string, previewAvatar?: HTMLImageElement | null) => {
  const raw = (source || '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;

  const storageRef = extractSupabaseStorageRef(raw);
  if (storageRef?.bucket && storageRef?.path) {
    try {
      const { data: blob, error } = await supabase.storage.from(storageRef.bucket).download(storageRef.path);
      if (!error && blob && blob.size > 0) {
        const dataUrl = await toValidImageDataUrl(blob);
        if (dataUrl) return dataUrl;
      }
    } catch {
      // fallback below
    }
  }

  try {
    const proxyUrl = `${apiBaseUrl}/api/avatar-proxy?src=${encodeURIComponent(raw)}`;
    const res = await fetch(proxyUrl, { cache: 'no-store' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        const dataUrl = await toValidImageDataUrl(blob);
        if (dataUrl) return dataUrl;
      }
    }
  } catch {
    // fallback below
  }

  try {
    const res = await fetch(raw, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        const dataUrl = await toValidImageDataUrl(blob);
        if (dataUrl) return dataUrl;
      }
    }
  } catch {
    // fallback below
  }

  try {
    const res = await fetch(raw, { mode: 'no-cors', cache: 'no-store' });
    const blob = await res.blob();
    if (blob && blob.size > 0) {
      const dataUrl = await toValidImageDataUrl(blob);
      if (dataUrl) return dataUrl;
    }
  } catch {
    // fallback below
  }

  if (previewAvatar && previewAvatar.complete && previewAvatar.naturalWidth > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = previewAvatar.naturalWidth;
      canvas.height = previewAvatar.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(previewAvatar, 0, 0);
        return canvas.toDataURL('image/png');
      }
    } catch {
      // tainted canvas or drawing failure
    }
  }

  return null;
};

export const ShareStatsModal: React.FC<ShareStatsModalProps> = ({ open, onClose, data, selectors }) => {
  const exportRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewCardRef = useRef<HTMLDivElement | null>(null);
  const fontEmbedCssRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [bgMode, setBgMode] = useState<'metal' | 'black' | 'white' | 'custom'>('metal');
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null);
  const [embeddedAvatarUrl, setEmbeddedAvatarUrl] = useState<string | null>(null);
  const [exportAvatarUrl, setExportAvatarUrl] = useState<string | null>(null);

  const CARD_W = 540;
  const CARD_H = 960;

  const caption = useMemo(() => {
    const name = (data?.player?.name || 'Player').trim();
    const team = (data?.player?.teamLabel || '').trim();
    const season = (data?.player?.seasonLabel || '').trim();
    const record = (data?.seasonSummary?.recordText || '').trim();
    const rows = data?.lastGameStats?.rows || [];
    const rowText = rows.length ? rows.map((r) => `${r.value} ${r.label}`).join(', ') : '';
    const fg = data?.lastGameStats?.shots?.fg ? ` FG ${data.lastGameStats.shots.fg}` : '';
    const three = data?.lastGameStats?.shots?.three ? ` 3PT ${data.lastGameStats.shots.three}` : '';
    const seasonText = season ? ` (${season})` : '';
    const recordText = record ? ` Season record: ${record}.` : '';
    return `Hey, this is my latest Courtsight League run! ${name}${team ? ` from ${team}` : ''}${seasonText}. Last game line: ${rowText || 'locked in'}${fg}${three}.${recordText} Think you can hoop with us? Join the league via`;
  }, [data]);

  const registrationUrl = useMemo(() => {
    const envUrl = (import.meta as any)?.env?.VITE_REGISTRATION_URL as string | undefined;
    if (envUrl && envUrl.trim()) return envUrl.trim();
    if (typeof window !== 'undefined' && window.location?.origin) return `${window.location.origin}/register`;
    return 'https://courtsight.ca/register';
  }, []);

  const captionWithLink = useMemo(() => `${caption} ${registrationUrl}`, [caption, registrationUrl]);

  const fileName = useMemo(() => {
    const base = safeFileBase(data?.player?.name || 'player');
    return `courtsight-stats-${base}.png`;
  }, [data?.player?.name]);

  const exportAvatarFallback = useMemo(() => buildInitialsAvatarDataUrl(data?.player?.name), [data?.player?.name]);
  const shouldUseIosCompositeExport = useMemo(() => isIOSWebKit(), []);

  const previewData = useMemo<ShareCardData>(
    () => ({
      ...data,
      player: {
        ...data.player,
        avatarUrl: embeddedAvatarUrl || data.player.avatarUrl || '/player-placeholder.svg',
      },
    }),
    [data, embeddedAvatarUrl]
  );

  const exportData = useMemo<ShareCardData>(
    () => ({
      ...data,
      player: {
        ...data.player,
        avatarUrl: exportAvatarUrl || embeddedAvatarUrl || data.player.avatarUrl || exportAvatarFallback,
      },
    }),
    [data, embeddedAvatarUrl, exportAvatarUrl, exportAvatarFallback]
  );

  const cardBackground = useMemo(
    () => ({
      mode: bgMode,
      imageUrl: customBackgroundUrl,
    }),
    [bgMode, customBackgroundUrl]
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setBgMode('metal');
    setCustomBackgroundUrl(null);
    setExportAvatarUrl(null);
  }, [open]);

  useEffect(() => {
    let active = true;

    const embedAvatar = async () => {
      const source = (data?.player?.avatarUrl || '').trim();
      if (!source) {
        if (active) setEmbeddedAvatarUrl(exportAvatarFallback);
        return;
      }
      if (source.startsWith('data:')) {
        if (active) setEmbeddedAvatarUrl(source);
        return;
      }
      const previewAvatar = previewCardRef.current?.querySelector('img[data-share-avatar="true"]') as HTMLImageElement | null;
      const dataUrl = await resolveAvatarDataUrl(source, previewAvatar);
      if (!active) return;
      if (dataUrl) {
        setEmbeddedAvatarUrl(dataUrl);
        return;
      }
      setEmbeddedAvatarUrl(exportAvatarFallback);
    };

    if (open) {
      embedAvatar();
    }

    return () => {
      active = false;
    };
  }, [open, data?.player?.avatarUrl, exportAvatarFallback]);

  useEffect(() => {
    let active = true;

    const prepareExportAvatar = async () => {
      if (!open) return;
      const source = (embeddedAvatarUrl || data?.player?.avatarUrl || exportAvatarFallback).trim();
      if (!source) {
        if (active) setExportAvatarUrl(exportAvatarFallback);
        return;
      }
      const circular = await buildCircularAvatarDataUrl(source, exportAvatarFallback);
      if (active) setExportAvatarUrl(circular || exportAvatarFallback);
    };

    prepareExportAvatar();
    return () => {
      active = false;
    };
  }, [open, embeddedAvatarUrl, data?.player?.avatarUrl, exportAvatarFallback]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const computeScale = () => {
      const el = previewViewportRef.current;
      if (!el) return;
      const w = el.clientWidth || 0;
      const h = el.clientHeight || 0;
      const compact = window.innerWidth < 640;
      const padX = compact ? 16 : 44;
      const padY = compact ? 28 : 86;
      const baseScale = Math.min(1, (w - padX) / CARD_W, (h - padY) / CARD_H);
      const s = baseScale * 0.97;
      setScale(Number.isFinite(s) && s > 0 ? s : 1);
    };
    computeScale();
    const raf = window.requestAnimationFrame(computeScale);
    const el = previewViewportRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(() => computeScale()) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', computeScale);
    return () => {
      window.cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', computeScale);
    };
  }, [open]);

  const ensureEmbeddedAvatarForExport = async () => {
    const current = (exportAvatarUrl || embeddedAvatarUrl || '').trim();
    if (current.startsWith('data:')) return current;

    const previewAvatar = previewCardRef.current?.querySelector('img[data-share-avatar="true"]') as HTMLImageElement | null;
    if (previewAvatar) {
      if (!previewAvatar.complete) {
        await new Promise<void>((resolve) => {
          const done = () => {
            previewAvatar.removeEventListener('load', done);
            previewAvatar.removeEventListener('error', done);
            resolve();
          };
          previewAvatar.addEventListener('load', done, { once: true });
          previewAvatar.addEventListener('error', done, { once: true });
          setTimeout(done, 1200);
        });
      }

      if (previewAvatar.complete && previewAvatar.naturalWidth > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = previewAvatar.naturalWidth;
          canvas.height = previewAvatar.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(previewAvatar, 0, 0);
            const fromPreview = canvas.toDataURL('image/png');
            if (fromPreview) {
              const circular = await buildCircularAvatarDataUrl(fromPreview, exportAvatarFallback);
              setEmbeddedAvatarUrl(fromPreview);
              setExportAvatarUrl(circular);
              return circular;
            }
          }
        } catch {
          const liveSrc = (previewAvatar.currentSrc || previewAvatar.src || '').trim();
          if (liveSrc) return liveSrc;
        }
      }
    }

    const source = (data?.player?.avatarUrl || '').trim();
    if (!source) return exportAvatarFallback;
    if (source.startsWith('data:')) {
      setEmbeddedAvatarUrl(source);
      return source;
    }

    const resolvedDataUrl = await resolveAvatarDataUrl(source, previewAvatar);
    if (resolvedDataUrl) {
      setEmbeddedAvatarUrl(resolvedDataUrl);
      const circular = await buildCircularAvatarDataUrl(resolvedDataUrl, exportAvatarFallback);
      setExportAvatarUrl(circular);
      return circular;
    }

    const liveSrc = (previewAvatar?.currentSrc || previewAvatar?.src || '').trim();
    if (liveSrc && !/^https?:\/\/ui-avatars\.com\//i.test(liveSrc)) return liveSrc;
    setEmbeddedAvatarUrl(exportAvatarFallback);
    setExportAvatarUrl(exportAvatarFallback);
    return exportAvatarFallback;
  };

  const captureBlob = async () => {
    const targetNode = exportRef.current;
    if (!targetNode) throw new Error('Share card not ready.');
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const fontsAny = (document as any).fonts;
    if (fontsAny?.ready) {
      try {
        await fontsAny.ready;
      } catch {
        // ignore
      }
    }

    const waitForImagesReady = async (node: HTMLElement) => {
      const images = Array.from(node.querySelectorAll('img'));
      await Promise.all(
        images.map(async (img) => {
          const imageEl = img as HTMLImageElement;
          if (imageEl.complete && imageEl.naturalWidth > 0) {
            try {
              await imageEl.decode();
            } catch {
              // ignore decode errors
            }
            return;
          }
          await new Promise<void>((resolve) => {
            const done = () => {
              imageEl.removeEventListener('load', done);
              imageEl.removeEventListener('error', done);
              resolve();
            };
            imageEl.addEventListener('load', done, { once: true });
            imageEl.addEventListener('error', done, { once: true });
          });
        })
      );
    };

    const waitForSingleImage = async (img: HTMLImageElement) => {
      if (img.complete && img.naturalWidth > 0) {
        try {
          await img.decode();
        } catch {
          // ignore decode errors
        }
        return;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    };

    const syncAvatarIntoNodes = async (forcedAvatarSrc?: string | null) => {
      const forced = (forcedAvatarSrc || '').trim();
      if (!forced) return;

      const previewAvatar = previewCardRef.current?.querySelector('img[data-share-avatar="true"]') as HTMLImageElement | null;
      const exportAvatar = exportRef.current?.querySelector('img[data-share-avatar="true"]') as HTMLImageElement | null;

      if (previewAvatar && previewAvatar.src !== forced) {
        previewAvatar.src = forced;
      }
      if (previewAvatar) {
        await waitForSingleImage(previewAvatar);
      }

      if (exportAvatar && exportAvatar.src !== forced) {
        exportAvatar.src = forced;
      }
      if (exportAvatar) {
        await waitForSingleImage(exportAvatar);
      }
    };

    let fontEmbedCSS = fontEmbedCssRef.current;
    if (!fontEmbedCSS) {
      try {
        fontEmbedCSS = await getFontEmbedCSS(targetNode);
        fontEmbedCssRef.current = fontEmbedCSS;
      } catch {
        // fallback to runtime font loading if embed CSS fails
      }
    }

    const forcedAvatarSrc = await ensureEmbeddedAvatarForExport();
    await syncAvatarIntoNodes(forcedAvatarSrc);
    await waitForImagesReady(targetNode);

    const blob = await toBlob(targetNode, {
      cacheBust: false,
      includeQueryParams: true,
      pixelRatio: 3,
      backgroundColor: '#080808',
      skipFonts: false,
      fontEmbedCSS: fontEmbedCSS || undefined,
      width: CARD_W,
      height: CARD_H,
      style: {
        transform: 'none',
        transformOrigin: 'top left',
      },
    });
    if (!blob) throw new Error('Unable to capture image.');
    if (shouldUseIosCompositeExport) {
      const avatarForComposite = (exportAvatarUrl || exportAvatarFallback).trim();
      if (avatarForComposite) {
        try {
          return await compositeAvatarOntoCardBlob(blob, avatarForComposite, CARD_W, CARD_H);
        } catch {
          return blob;
        }
      }
    }
    return blob;
  };

  const onDownload = async () => {
    setWorking(true);
    setError(null);
    try {
      const blob = await captureBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Unable to download image.');
    } finally {
      setWorking(false);
    }
  };

  const onShare = async () => {
    setWorking(true);
    setError(null);
    try {
      const blob = await captureBlob();
      const file = new File([blob], fileName, { type: 'image/png' });
      const navAny = navigator as any;
      const isAbortError = (err: any) => err?.name === 'AbortError';

      // Best-effort: keep caption ready for paste in apps that drop prefilled text (e.g. Facebook iOS share extension).
      try {
        await navigator.clipboard.writeText(captionWithLink);
      } catch {
        // ignore clipboard restrictions
      }

      const payloadFileOnly = { files: [file] } as any;
      const payloadFileAndText = { title: 'Courtsight Stats', text: captionWithLink, files: [file] } as any;

      if (navAny?.share && navAny?.canShare?.(payloadFileOnly)) {
        try {
          // Prefer sending file + caption so apps like WhatsApp can prefill message.
          await navAny.share(payloadFileAndText);
          return;
        } catch (e: any) {
          if (isAbortError(e)) return;
          // Some apps/extensions accept image but ignore text payload. Fallback to file-only.
          try {
            await navAny.share(payloadFileOnly);
            return;
          } catch (fallbackErr: any) {
            if (isAbortError(fallbackErr)) return;
          }
        }
      }

      if (navAny?.share) {
        try {
          await navAny.share({ title: 'Courtsight Stats', text: captionWithLink, url: registrationUrl });
          return;
        } catch (e: any) {
          if (isAbortError(e)) return;
        }
      }

      downloadBlob(blob);
      setError('Native share is unavailable on this device. Image downloaded and caption copied.');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Unable to share.');
    } finally {
      setWorking(false);
    }
  };

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onCopyCaption = async () => {
    setWorking(true);
    setError(null);
    try {
      await navigator.clipboard.writeText(captionWithLink);
    } catch (e: any) {
      setError(e?.message || 'Unable to copy caption.');
    } finally {
      setWorking(false);
    }
  };

  const onPickCustomBackground = () => {
    if (working) return;
    fileInputRef.current?.click();
  };

  const onBackgroundFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      if (!result) {
        setError('Unable to read selected image.');
        return;
      }
      setCustomBackgroundUrl(result);
      setBgMode('custom');
      setError(null);
    };
    reader.onerror = () => setError('Unable to read selected image.');
    reader.readAsDataURL(file);

    e.currentTarget.value = '';
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center px-0 py-0 sm:px-4 sm:py-8">
      <div className="absolute inset-0 bg-black/80" onClick={() => !working && onClose()} />

      <div className="relative w-full max-w-4xl h-[100dvh] sm:h-[92vh] bg-brand-dark border border-white/10 rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10">
          <div>
            <h3 className="text-white font-sports text-xl uppercase tracking-wide">Share Your Stats</h3>
            <p className="text-brand-grey text-sm">Preview your shareable image, then share or download.</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-black/40 px-4 py-2 text-sm font-bold text-white hover:border-white/40 transition disabled:opacity-60"
            onClick={() => !working && onClose()}
          >
            Done
          </button>
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/5">
          <div className="text-xs text-white/60">Tip: if native Share is unavailable on desktop, use Download.</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCopyCaption}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 px-4 py-2 text-sm font-bold text-white hover:border-white/40 transition disabled:opacity-60"
              title="Copy caption"
            >
              <Copy size={16} /> Copy caption
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 px-4 py-2 text-sm font-bold text-white hover:border-white/40 transition disabled:opacity-60"
              title="Download image"
            >
              <Download size={16} /> Download
            </button>
            <button
              type="button"
              onClick={onShare}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-lime px-4 py-2 text-sm font-bold text-black hover:brightness-95 transition disabled:opacity-60"
              title="Share"
            >
              <Share2 size={16} /> Share
            </button>
          </div>
        </div>

        {selectors && (
          <div className="px-4 sm:px-6 py-3 grid gap-3 sm:grid-cols-2 border-b border-white/5">
            <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
              Share Team
              <select
                value={selectors.selectedTeamId}
                onChange={(e) => selectors.onTeamChange(e.target.value)}
                className="mt-2 w-full appearance-none rounded-lg border border-white/15 bg-black/40 px-3 py-2 pr-10 dropdown-select-spacing text-xs font-semibold uppercase tracking-wide text-white outline-none transition focus:border-brand-lime"
                disabled={working || !selectors.teamOptions.length}
              >
                {!selectors.teamOptions.length ? (
                  <option value="">No team available</option>
                ) : (
                  selectors.teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.label}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
              Share Game
              <select
                value={selectors.selectedGameId}
                onChange={(e) => selectors.onGameChange(e.target.value)}
                className="mt-2 w-full appearance-none rounded-lg border border-white/15 bg-black/40 px-3 py-2 pr-10 dropdown-select-spacing text-xs font-semibold uppercase tracking-wide text-white outline-none transition focus:border-brand-lime"
                disabled={working || !selectors.gameOptions.length}
              >
                {!selectors.gameOptions.length ? (
                  <option value="">No game available</option>
                ) : (
                  selectors.gameOptions.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        )}

        {error && (
          <div className="px-4 sm:px-6 pt-2">
            <div className="rounded-lg border border-brand-red/40 bg-brand-red/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          </div>
        )}

        <div className="px-4 sm:px-6 pt-2 pb-3 flex-1 min-h-0">
          <div
            ref={previewViewportRef}
            className="rounded-2xl border border-white/10 bg-black/30 p-2 sm:p-4 flex items-center justify-center overflow-hidden h-full"
          >
            <div
                style={{
                  width: `${CARD_W * scale}px`,
                  height: `${CARD_H * scale}px`,
                }}
              >
                <div ref={previewCardRef} style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                  <StatsShareCard data={previewData} background={cardBackground} />
                </div>
              </div>
            </div>
          </div>

        <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-1 flex flex-wrap items-center justify-between gap-3 border-t border-white/5">
          <div className="text-xs uppercase tracking-[0.24em] text-white/55 font-bold">Choose Background</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              title="Metal"
              disabled={working}
              onClick={() => setBgMode('metal')}
              className={`h-10 w-10 rounded-full border-2 transition ${
                bgMode === 'metal' ? 'border-brand-lime' : 'border-white/25 hover:border-white/45'
              }`}
              style={{
                background:
                  'radial-gradient(60% 45% at 24% 62%, rgba(255,118,22,0.35), rgba(255,118,22,0.06) 54%, rgba(0,0,0,0) 78%), linear-gradient(180deg, #1b1f2b 0%, #101522 40%, #0a0e18 100%)',
              }}
            />
            <button
              type="button"
              title="Black"
              disabled={working}
              onClick={() => setBgMode('black')}
              className={`h-10 w-10 rounded-full border-2 transition ${
                bgMode === 'black' ? 'border-brand-lime' : 'border-white/25 hover:border-white/45'
              }`}
              style={{ background: 'linear-gradient(180deg, #090b10 0%, #05070b 100%)' }}
            />
            <button
              type="button"
              title="White"
              disabled={working}
              onClick={() => setBgMode('white')}
              className={`h-10 w-10 rounded-full border-2 transition ${
                bgMode === 'white' ? 'border-brand-lime' : 'border-white/25 hover:border-white/45'
              }`}
              style={{ background: 'linear-gradient(180deg, #ffffff 0%, #ecf0f6 100%)' }}
            />
            <button
              type="button"
              title="Upload Background"
              disabled={working}
              onClick={onPickCustomBackground}
              className={`h-10 w-10 rounded-full border-2 transition inline-flex items-center justify-center ${
                bgMode === 'custom' ? 'border-brand-lime text-brand-lime' : 'border-white/25 text-white/80 hover:border-white/45'
              }`}
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <ImagePlus size={16} />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onBackgroundFileChange} className="hidden" />
          </div>
        </div>
      </div>

      {/* Offscreen, unscaled render for crisp exports */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: CARD_W,
          height: CARD_H,
          opacity: 0,
          pointerEvents: 'none',
          transform: 'translateX(-200vw)',
          transformOrigin: 'top left',
          overflow: 'hidden',
        }}
      >
        <div ref={exportRef}>
          <StatsShareCard data={exportData} background={cardBackground} exportMode />
        </div>
      </div>
    </div>
  );
};

export default ShareStatsModal;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { X } from 'lucide-react';

export type CropSpec = {
  label: string;
  outputWidth: number;
  outputHeight: number;
  previewWidth: number;
  previewHeight: number;
  previewClass?: string;
  shape?: 'rect' | 'circle';
  showGrid?: boolean;
  showOffsetControls?: boolean;
  zoomRange?: { min: number; max: number };
  borderRadius?: string;
};

export const CROP_SPECS: Record<'logo' | 'banner' | 'player', CropSpec> = {
  logo: {
    label: 'Logo',
    outputWidth: 512,
    outputHeight: 512,
    previewWidth: 240,
    previewHeight: 240,
    previewClass: 'rounded-full',
    shape: 'circle',
    showGrid: false,
    zoomRange: { min: 1, max: 4 },
  },
  banner: {
    label: 'Banner',
    outputWidth: 1600,
    outputHeight: 600,
    previewWidth: 360,
    previewHeight: 140,
    previewClass: 'rounded-2xl',
    showGrid: false,
    zoomRange: { min: 1, max: 4 },
  },
  player: {
    label: 'Player Photo',
    outputWidth: 512,
    outputHeight: 512,
    previewWidth: 220,
    previewHeight: 220,
    previewClass: 'rounded-full',
    shape: 'circle',
    showGrid: true,
    showOffsetControls: false,
    borderRadius: '0.75rem',
    zoomRange: { min: 1, max: 4 },
  },
};

const createImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.setAttribute('crossOrigin', 'anonymous');
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.src = src;
  });

const getCroppedImageBlob = async (src: string, area: Area): Promise<Blob> => {
  const image = await createImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.round(area.width), 1);
  canvas.height = Math.max(Math.round(area.height), 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to access canvas context.');
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Unable to produce cropped image.'))), 'image/png');
  });
};

interface ImageCropperProps {
  open: boolean;
  source: string;
  file?: File | null;
  spec: CropSpec;
  filePrefix?: string;
  onSave: (file: File) => Promise<boolean>;
  onUseOriginal?: (file: File) => Promise<boolean>;
  onClose: () => void;
}

const ImageCropper: React.FC<ImageCropperProps> = ({
  open,
  source,
  file,
  spec,
  filePrefix,
  onSave,
  onUseOriginal,
  onClose,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(spec.zoomRange?.min ?? 1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const zoomMin = spec.zoomRange?.min ?? 1;
  const zoomMax = spec.zoomRange?.max ?? 4;

  const handleCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleMediaLoaded = useCallback(() => {
    setZoom(zoomMin);
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
  }, [zoomMin]);

  useEffect(() => {
    if (!source) return;
    setZoom(zoomMin);
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
  }, [source, zoomMin]);

  const handleSave = useCallback(async () => {
    if (!croppedAreaPixels) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await getCroppedImageBlob(source, croppedAreaPixels);
      const outputType = file?.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const ext = outputType === 'image/png' ? 'png' : 'jpg';
      const baseName = (filePrefix || spec.label).replace(/\s+/g, '-').toLowerCase();
      const croppedFile = new File([blob], `${baseName}-${Date.now()}.${ext}`, { type: outputType });
      const success = await onSave(croppedFile);
      if (success) {
        onClose();
      } else {
        setError('Upload failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Crop failed', err);
      setError(err?.message || 'Failed to crop image.');
    } finally {
      setSaving(false);
    }
  }, [croppedAreaPixels, file, filePrefix, onClose, onSave, spec.label, source]);

  const handleUseOriginal = useCallback(async () => {
    if (!file) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const upload = onUseOriginal || onSave;
      const success = await upload(file);
      if (success) {
        onClose();
      } else {
        setError('Upload failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Use original failed', err);
      setError(err?.message || 'Failed to upload the original image.');
    } finally {
      setSaving(false);
    }
  }, [file, onClose, onSave, onUseOriginal]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-brand-dark border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg text-white font-bold uppercase tracking-wide">{spec.label} Crop</h3>
            <p className="text-xs text-gray-400">
              Zoom and drag the photo to frame the {spec.label.toLowerCase()} just how you need it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cropper"
            className="text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className={`relative border border-white/10 bg-black/40 overflow-hidden ${spec.previewClass || 'rounded-xl'}`}
          style={{
            width: spec.previewWidth,
            height: spec.previewHeight,
            margin: '0 auto',
            borderRadius: spec.borderRadius,
          }}
        >
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={spec.outputWidth / spec.outputHeight}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
            objectFit="horizontal-cover"
            restrictPosition
            onMediaLoaded={handleMediaLoaded}
            cropShape={spec.shape === 'circle' ? 'round' : 'rect'}
            classes={{
              cropAreaClassName: spec.shape === 'circle' ? 'logo-crop-area' : undefined,
            }}
            minZoom={zoomMin}
            maxZoom={zoomMax}
          />
          {spec.shape === 'circle' && (
            <div className="logo-crop-overlay">
              <div className="logo-crop-circle" />
            </div>
          )}
          {spec.showGrid && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
                backgroundSize: '60px 60px, 60px 60px',
              }}
            />
          )}
          <div className="absolute inset-0 pointer-events-none border border-white/10" />
        </div>
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-widest text-gray-400 flex items-center justify-between">
            <span>Zoom</span>
            <span className="text-[11px] text-white">{zoom.toFixed(2)}x</span>
          </label>
          <input
            type="range"
            min={zoomMin}
            max={zoomMax}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-brand-lime"
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-white/20 text-xs uppercase tracking-widest text-gray-400 hover:border-white hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUseOriginal}
            disabled={saving}
            className="px-4 py-2 rounded border border-white/20 text-xs uppercase tracking-widest text-white hover:border-white transition-colors disabled:opacity-60"
          >
            USE ORIGINAL
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !croppedAreaPixels}
            className="px-5 py-2 rounded bg-brand-lime text-black font-bold uppercase text-xs tracking-widest disabled:opacity-60"
          >
            {saving ? 'APPLYING...' : 'APPLY CROP & UPLOAD'}
          </button>
        </div>
        {error && <p className="text-xs text-brand-red">{error}</p>}
      </div>
    </div>
  );
};

export default ImageCropper;

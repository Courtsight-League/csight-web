import React, { useEffect, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';

const WAIVER_BUCKET = 'public-assets';
const WAIVER_PATH = 'latest-csl-waiver.pdf';

const RegistrationWaiverManager: React.FC = () => {
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCurrentUrl = () => {
    const { data } = supabase.storage.from(WAIVER_BUCKET).getPublicUrl(WAIVER_PATH);
    setCurrentUrl(data?.publicUrl || '');
    setLoading(false);
  };

  useEffect(() => {
    loadCurrentUrl();
  }, []);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setMessage(null);

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are allowed.');
      return;
    }

    setUploading(true);
    try {
      const uploadWithClient = async (client: typeof supabase) =>
        client.storage.from(WAIVER_BUCKET).upload(WAIVER_PATH, file, {
          upsert: true,
          contentType: 'application/pdf',
          cacheControl: '0',
        });

      let uploadError: any = null;
      try {
        const result = await uploadWithClient(supabase);
        uploadError = result.error;
      } catch (err) {
        uploadError = err;
      }

      if (uploadError && supabaseAdmin) {
        const result = await uploadWithClient(supabaseAdmin);
        uploadError = result.error;
      }

      if (uploadError) throw uploadError;

      loadCurrentUrl();
      setMessage('Registration waiver updated. New registrations will use this PDF.');
    } catch (err: any) {
      console.error('Registration waiver upload error', err);
      setError(err?.message || 'Failed to upload registration waiver.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <div className="text-gray-400 text-sm">Loading registration waiver settings...</div>
      </div>
    );
  }

  return (
    <>
      {showPreviewModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-brand-dark border border-white/10 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div>
                <h3 className="text-white font-sports text-xl">Current Registration Waiver</h3>
                <p className="text-xs text-gray-400">Preview of the live PDF shown during registration.</p>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto bg-black">
              {currentUrl ? (
                <embed
                  key={currentUrl}
                  src={`${currentUrl}${currentUrl.includes('?') ? '&' : '?'}preview=${Date.now()}`}
                  type="application/pdf"
                  className="w-full min-h-[1600px]"
                />
              ) : (
                <div className="p-6 text-gray-400 text-sm">Waiver file not available.</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-2 rounded bg-black border border-white/20 text-white text-sm hover:border-white/40"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="font-sports text-2xl text-white uppercase">Registration Waiver</h2>
            <p className="text-xs text-gray-400">
              Upload the PDF used in the registration waiver modal. This replaces the current live waiver.
            </p>
          </div>
          {currentUrl && (
            <button
              type="button"
              onClick={() => setShowPreviewModal(true)}
              className="inline-flex items-center gap-2 text-xs uppercase text-brand-lime border border-brand-lime/40 px-3 py-2 rounded hover:bg-brand-lime/10"
            >
              <FileText size={14} />
              View current waiver
            </button>
          )}
        </div>

        {error && <div className="text-xs text-brand-red font-mono">{error}</div>}
        {message && <div className="text-xs text-brand-lime font-mono">{message}</div>}

        <div className="border border-dashed border-white/10 rounded-xl p-4 bg-black/20 space-y-3">
          <div className="text-xs uppercase text-brand-grey font-bold">Replace live waiver PDF</div>
          <label className="inline-flex items-center gap-2 bg-brand-lime text-black font-bold text-xs uppercase px-4 py-2 rounded cursor-pointer disabled:opacity-60">
            <Upload size={14} />
            {uploading ? 'Uploading...' : 'Upload waiver PDF'}
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <div className="text-xs text-gray-400">
            Expected live file: <span className="font-mono text-white/80">{WAIVER_PATH}</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default RegistrationWaiverManager;

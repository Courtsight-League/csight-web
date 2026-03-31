import React, { useEffect, useState } from 'react';
import { ChevronDown, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import {
  ABOUT_PAGE_CONTENT_SITE_KEY,
  getDefaultAboutPageContent,
  normalizeAboutPageContent,
  parseAboutPageContentValue,
  serializeAboutPageContent,
  type AboutPageContent,
} from '../services/aboutPageContent';

const sanitizeToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'about';

const getExtension = (file: File) => {
  const byName = (file.name.split('.').pop() || '').toLowerCase();
  if (byName) return byName;
  if (file.type.includes('png')) return 'png';
  if (file.type.includes('jpeg') || file.type.includes('jpg')) return 'jpg';
  if (file.type.includes('webp')) return 'webp';
  if (file.type.includes('gif')) return 'gif';
  return 'png';
};

const AboutContentManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [content, setContent] = useState<AboutPageContent>(getDefaultAboutPageContent());
  const [showOptionalMedia, setShowOptionalMedia] = useState(false);
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);
  const [sectionMediaOpen, setSectionMediaOpen] = useState<Record<string, boolean>>({});
  const [pendingDeleteSection, setPendingDeleteSection] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchWithClient = async (client: typeof supabase) =>
          client
            .from('site_settings')
            .select('value')
            .eq('key', ABOUT_PAGE_CONTENT_SITE_KEY)
            .maybeSingle();

        let data: any = null;
        let loadErr: any = null;
        try {
          const result = await fetchWithClient(supabase);
          data = result.data;
          loadErr = result.error;
        } catch (err) {
          loadErr = err;
        }

        if (loadErr && supabaseAdmin) {
          const fallback = await fetchWithClient(supabaseAdmin);
          data = fallback.data;
          loadErr = fallback.error;
        }

        if (loadErr) throw loadErr;
        setContent(parseAboutPageContentValue((data as any)?.value));
      } catch (err: any) {
        console.error('Load about content error', err);
        setError('Unable to load About content. Using defaults.');
        setContent(getDefaultAboutPageContent());
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, []);

  useEffect(() => {
    if (!content.sections.length) {
      setExpandedSectionId(null);
      return;
    }
    const stillExists = content.sections.some((section) => section.id === expandedSectionId);
    if (!stillExists) {
      setExpandedSectionId(content.sections[0].id);
    }
  }, [content.sections, expandedSectionId]);

  const uploadImage = async (file: File, targetKey: string) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are allowed.');
    }
    const ext = getExtension(file);
    const path = `about/${sanitizeToken(targetKey)}-${Date.now()}.${ext}`;
    const client: any = supabaseAdmin ?? supabase;
    const { error: uploadErr } = await client.storage.from('public-assets').upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
    });
    if (uploadErr) throw uploadErr;
    return supabase.storage.from('public-assets').getPublicUrl(path).data.publicUrl;
  };

  const handleHeroUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingTarget('hero');
    setError(null);
    setMessage(null);
    try {
      const url = await uploadImage(file, 'hero');
      setContent((prev) => ({ ...prev, heroImageUrl: url }));
      setMessage('Hero image uploaded. Click Save About Content to publish.');
    } catch (err: any) {
      console.error('About hero upload error', err);
      setError(err?.message || 'Failed to upload hero image.');
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleSectionImageUpload = async (sectionId: string, file: File | null) => {
    if (!file) return;
    setUploadingTarget(sectionId);
    setError(null);
    setMessage(null);
    try {
      const url = await uploadImage(file, sectionId);
      setContent((prev) => ({
        ...prev,
        sections: prev.sections.map((section) =>
          section.id === sectionId ? { ...section, imageUrl: url } : section
        ),
      }));
      setMessage('Section image uploaded. Click Save About Content to publish.');
    } catch (err: any) {
      console.error('About section upload error', err);
      setError(err?.message || 'Failed to upload section image.');
    } finally {
      setUploadingTarget(null);
    }
  };

  const updateSection = (sectionId: string, updates: Partial<AboutPageContent['sections'][number]>) => {
    setContent((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => (section.id === sectionId ? { ...section, ...updates } : section)),
    }));
  };

  const removeSection = (sectionId: string) => {
    setContent((prev) => ({
      ...prev,
      sections: prev.sections.filter((section) => section.id !== sectionId),
    }));
    setSectionMediaOpen((prev) => {
      const next = { ...prev };
      delete next[sectionId];
      return next;
    });
    setExpandedSectionId((prev) => (prev === sectionId ? null : prev));
  };

  const confirmRemoveSection = () => {
    if (!pendingDeleteSection) return;
    removeSection(pendingDeleteSection.id);
    setPendingDeleteSection(null);
    setError(null);
    setMessage('Section deleted. Click Save About Content to publish.');
  };

  const saveContent = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const normalized = normalizeAboutPageContent(content);
    const payload = {
      key: ABOUT_PAGE_CONTENT_SITE_KEY,
      value: serializeAboutPageContent(normalized),
      updated_at: new Date().toISOString(),
    };
    try {
      const saveWithClient = async (client: typeof supabase) =>
        client.from('site_settings').upsert(payload, { onConflict: 'key' });

      let saveErr: any = null;
      try {
        const result = await saveWithClient(supabase);
        saveErr = result.error;
      } catch (err) {
        saveErr = err;
      }

      if (saveErr && supabaseAdmin) {
        const result = await saveWithClient(supabaseAdmin);
        saveErr = result.error;
      }
      if (saveErr) throw saveErr;

      setContent(normalized);
      setMessage('About page content saved and published.');
    } catch (err: any) {
      console.error('Save about content error', err);
      setError(err?.message || 'Failed to save About page content.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading About page content...</div>;
  }

  return (
    <>
    <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">About Us Content</h2>
          {/* <p className="text-xs text-gray-400 mt-1">Simple editor: update headline, intro, then body sections. Images are optional.</p> */}
          {error && <div className="text-xs text-brand-red font-mono mt-2">{error}</div>}
          {message && <div className="text-xs text-brand-lime font-mono mt-2">{message}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveContent}
            disabled={saving}
            className="bg-brand-lime text-black px-4 py-2 rounded font-bold uppercase text-xs disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save About Content'}
          </button>
        </div>
      </div>

      <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-4">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gray-500">Basic Content</div>
        <label className="text-xs text-brand-grey uppercase block">
          Headline
          <textarea
            value={content.headline}
            onChange={(e) => setContent((prev) => ({ ...prev, headline: e.target.value }))}
            rows={2}
            className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none resize-y min-h-[72px]"
          />
        </label>

        <label className="text-xs text-brand-grey uppercase block">
          Intro text
          <textarea
            value={content.intro}
            onChange={(e) => setContent((prev) => ({ ...prev, intro: e.target.value }))}
            rows={3}
            className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
          />
        </label>

        <div className="border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={() => setShowOptionalMedia((prev) => !prev)}
            className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-gray-200 hover:border-brand-lime/60"
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${showOptionalMedia ? 'rotate-180' : ''}`}
            />
            {showOptionalMedia ? 'Hide Optional Hero Image' : 'Show Optional Hero Image'}
          </button>
          {showOptionalMedia && (
            <div className="mt-3 text-xs text-brand-grey uppercase">
              Hero Image
              <div className="mt-2 flex items-center gap-3">
                <div className="w-20 h-20 rounded-lg overflow-hidden border border-white/10 bg-black/50 flex items-center justify-center text-[10px] text-gray-500">
                  {content.heroImageUrl ? (
                    <img src={content.heroImageUrl} alt="Hero preview" className="w-full h-full object-cover" />
                  ) : (
                    'No image'
                  )}
                </div>
                <label className="inline-flex items-center gap-2 bg-black border border-white/20 rounded px-3 py-2 text-xs text-white cursor-pointer hover:border-brand-lime/60">
                  <ImageIcon size={14} />
                  {uploadingTarget === 'hero' ? 'Uploading...' : 'Upload Hero'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={saving || uploadingTarget === 'hero'}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      e.currentTarget.value = '';
                      void handleHeroUpload(file);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-sports uppercase text-lg">Body Text Sections</h3>
          <button
            type="button"
            onClick={() =>
              setContent((prev) => ({
                ...prev,
                sections: [
                  ...prev.sections,
                  {
                    id: `section-${Date.now()}`,
                    title: `Section ${prev.sections.length + 1}`,
                    body: '',
                    imageUrl: '',
                  },
                ],
              }))
            }
            className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-gray-200 hover:border-brand-lime/60"
          >
            <Plus size={14} />
            Add Section
          </button>
        </div>

        {content.sections.map((section, index) => {
          const isExpanded = expandedSectionId === section.id;
          const showSectionMedia = sectionMediaOpen[section.id] ?? Boolean(section.imageUrl);
          return (
            <div key={section.id} className="bg-black/30 border border-white/10 rounded-lg">
              <button
                type="button"
                onClick={() => setExpandedSectionId((prev) => (prev === section.id ? null : section.id))}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">
                    Section {index + 1}
                  </div>
                  <div className="text-sm text-white truncate">{section.title || 'Untitled section'}</div>
                </div>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/10">
                  <label className="text-[10px] text-brand-grey uppercase block pt-3">
                    Section Title
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) => updateSection(section.id, { title: e.target.value })}
                      className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                      placeholder="Section title"
                    />
                  </label>

                  <label className="text-[10px] text-brand-grey uppercase block">
                    Section Body
                    <textarea
                      value={section.body}
                      onChange={(e) => updateSection(section.id, { body: e.target.value })}
                      rows={4}
                      className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                      placeholder="Section body text"
                    />
                  </label>

                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        setSectionMediaOpen((prev) => ({
                          ...prev,
                          [section.id]: !(prev[section.id] ?? Boolean(section.imageUrl)),
                        }))
                      }
                      className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-gray-200 hover:border-brand-lime/60"
                    >
                      <ImageIcon size={13} />
                      {showSectionMedia ? 'Hide Optional Image' : 'Add Optional Image'}
                    </button>

                    {showSectionMedia && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/10 bg-black/50 flex items-center justify-center text-[10px] text-gray-500">
                          {section.imageUrl ? (
                            <img src={section.imageUrl} alt={section.title || `Section ${index + 1}`} className="w-full h-full object-cover" />
                          ) : (
                            'No image'
                          )}
                        </div>
                        <label className="inline-flex items-center gap-2 bg-black border border-white/20 rounded px-3 py-2 text-xs text-white cursor-pointer hover:border-brand-lime/60">
                          <ImageIcon size={14} />
                          {uploadingTarget === section.id ? 'Uploading...' : 'Upload Image'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={saving || uploadingTarget === section.id}
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              e.currentTarget.value = '';
                              void handleSectionImageUpload(section.id, file);
                            }}
                          />
                        </label>
                        {section.imageUrl && (
                          <button
                            type="button"
                            onClick={() => updateSection(section.id, { imageUrl: '' })}
                            className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-brand-red hover:border-brand-red/60"
                          >
                            <Trash2 size={13} />
                            Remove Image
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setPendingDeleteSection({
                        id: section.id,
                        title: section.title || `Section ${index + 1}`,
                      })
                    }
                    className="inline-flex items-center gap-2 text-xs uppercase border border-white/20 rounded px-3 py-2 text-brand-red hover:border-brand-red/60"
                  >
                    <Trash2 size={13} />
                    Delete Section
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    {pendingDeleteSection && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
        <button
          type="button"
          onClick={() => setPendingDeleteSection(null)}
          className="absolute inset-0 bg-black/70 backdrop-blur-[1px]"
          aria-label="Close delete confirmation"
        />
        <div className="relative w-full max-w-md rounded-xl border border-white/15 bg-brand-dark p-5 shadow-2xl">
          <h3 className="font-sports text-xl text-white uppercase">Delete Section?</h3>
          <p className="mt-2 text-sm text-gray-300">
            This will remove <span className="text-white font-semibold">{pendingDeleteSection.title}</span> from About content.
          </p>
          <p className="mt-1 text-xs text-gray-500">You still need to click Save About Content to publish this change.</p>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDeleteSection(null)}
              className="px-3 py-2 rounded border border-white/20 text-xs font-bold uppercase text-gray-200 hover:border-white/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRemoveSection}
              className="px-3 py-2 rounded border border-brand-red/60 bg-brand-red/15 text-xs font-bold uppercase text-brand-red hover:bg-brand-red/20"
            >
              Confirm Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default AboutContentManager;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import {
  buildFaqDbRows,
  getDefaultHomeFaqItems,
  normalizeHomeFaqItems,
  type HomeFaqItem,
} from '../services/homeFaq';

const createEmptyFaq = (index: number): HomeFaqItem => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `faq-${Date.now()}-${index + 1}`,
  question: '',
  answer: '',
  category: 'General',
});

const FaqContentManager: React.FC = () => {
  const managerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<HomeFaqItem[]>(getDefaultHomeFaqItems());
  const [pendingDeleteItem, setPendingDeleteItem] = useState<{ id: string; question: string } | null>(null);

  const runWithFallback = useCallback(
    async <T,>(runner: (client: any) => Promise<T>): Promise<T> => {
      try {
        return await runner(supabase as any);
      } catch (err) {
        if (!supabaseAdmin) throw err;
        return await runner(supabaseAdmin as any);
      }
    },
    []
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const data = await runWithFallback(async (client) => {
          const result = await client
            .from('faq_items')
            .select('id,question,answer,category,sort_order')
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
          if (result.error) throw result.error;
          return result.data || [];
        });

        if (!data.length) {
          setItems(getDefaultHomeFaqItems());
          return;
        }

        setItems(
          normalizeHomeFaqItems(
            data.map((row: any, index: number) => ({
              id: String(row?.id || `faq-${index + 1}`),
              question: String(row?.question || ''),
              answer: String(row?.answer || ''),
              category: String(row?.category || 'General'),
            }))
          )
        );
      } catch (err: any) {
        console.error('Load FAQ content error', err);
        setError(err?.message || 'Unable to load FAQ content. Using defaults.');
        setItems(getDefaultHomeFaqItems());
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [runWithFallback]);

  const updateItem = (id: string, updates: Partial<HomeFaqItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const addItem = () => {
    setItems((prev) => [createEmptyFaq(prev.length), ...prev]);
    setError(null);
    setMessage(null);
    requestAnimationFrame(() => {
      managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setError(null);
    setMessage(null);
  };

  const confirmRemoveItem = () => {
    if (!pendingDeleteItem) return;
    removeItem(pendingDeleteItem.id);
    setPendingDeleteItem(null);
    setMessage('FAQ removed. Click Save FAQ to publish this change.');
  };

  const resetDefaults = () => {
    setItems(getDefaultHomeFaqItems());
    setError(null);
    setMessage('Reset to default FAQ content (not saved yet).');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    const normalized = normalizeHomeFaqItems(items);
    if (!normalized.length) {
      setSaving(false);
      setError('Please add at least one FAQ with both question and answer.');
      return;
    }

    const rows = buildFaqDbRows(normalized);
    const idsToKeep = rows.map((row) => row.id);

    try {
      await runWithFallback(async (client) => {
        const upsertResult = await client.from('faq_items').upsert(rows, { onConflict: 'id' });
        if (upsertResult.error) throw upsertResult.error;

        const existingResult = await client.from('faq_items').select('id');
        if (existingResult.error) throw existingResult.error;

        const existingIds = (existingResult.data || []).map((row: any) => String(row.id || ''));
        const toDelete = existingIds.filter((id: string) => !!id && !idsToKeep.includes(id));
        if (toDelete.length) {
          const deleteResult = await client.from('faq_items').delete().in('id', toDelete);
          if (deleteResult.error) throw deleteResult.error;
        }
      });

      setItems(normalized);
      setMessage('FAQ content saved and published.');
    } catch (err: any) {
      console.error('Save FAQ content error', err);
      setError(err?.message || 'Failed to save FAQ content.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading FAQ content...</div>;
  }

  return (
    <>
    <div ref={managerRef} className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">FAQ Content</h2>
          {/* <p className="text-xs text-gray-400 mt-1">Edit the Home page FAQ section and publish immediately.</p> */}
          {error && <div className="text-xs text-brand-red font-mono mt-2">{error}</div>}
          {message && <div className="text-xs text-brand-lime font-mono mt-2">{message}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetDefaults}
            disabled={saving}
            className="px-4 py-2 rounded border border-white/20 text-xs uppercase font-bold text-gray-200 hover:bg-white/10 disabled:opacity-60"
          >
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-brand-lime text-black px-4 py-2 rounded font-bold uppercase text-xs disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save FAQ'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {/* <div className="text-xs uppercase tracking-[0.25em] text-gray-500">{items.length} Items</div> */}
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-white/20 text-xs uppercase font-bold text-white hover:bg-white/10"
        >
          <Plus size={14} />
          Add FAQ
        </button>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.id} className="border border-white/10 rounded-xl bg-black/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.32em] text-gray-500">FAQ {index + 1}</div>
              <button
                type="button"
                onClick={() =>
                  setPendingDeleteItem({
                    id: item.id,
                    question: item.question || `FAQ ${index + 1}`,
                  })
                }
                className="inline-flex items-center gap-1 text-xs uppercase font-bold text-brand-red border border-brand-red/50 rounded px-2 py-1 hover:bg-brand-red/10"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>

            <label className="block text-xs text-brand-grey uppercase">
              Question
              <input
                value={item.question}
                onChange={(e) => updateItem(item.id, { question: e.target.value })}
                className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none"
                placeholder="Type the question..."
              />
            </label>

            <label className="block text-xs text-brand-grey uppercase">
              Answer
              <textarea
                value={item.answer}
                onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                rows={3}
                className="mt-2 w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime outline-none resize-y"
                placeholder="Type the answer..."
              />
            </label>

          </div>
        ))}
      </div>
    </div>
    {pendingDeleteItem && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
        <button
          type="button"
          onClick={() => setPendingDeleteItem(null)}
          className="absolute inset-0 bg-black/70 backdrop-blur-[1px]"
          aria-label="Close delete confirmation"
        />
        <div className="relative w-full max-w-md rounded-xl border border-white/15 bg-brand-dark p-5 shadow-2xl">
          <h3 className="font-sports text-xl text-white uppercase">Delete FAQ?</h3>
          <p className="mt-2 text-sm text-gray-300">
            This will remove <span className="text-white font-semibold">{pendingDeleteItem.question}</span>.
          </p>
          <p className="mt-1 text-xs text-gray-500">You still need to click Save FAQ to publish this change.</p>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDeleteItem(null)}
              className="px-3 py-2 rounded border border-white/20 text-xs font-bold uppercase text-gray-200 hover:border-white/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRemoveItem}
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

export default FaqContentManager;

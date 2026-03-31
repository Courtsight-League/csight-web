import { FAQ_ITEMS } from '../constants';
import type { FAQItem } from '../types';
import { supabase } from './supabaseClient';

export type HomeFaqItem = FAQItem;

const toFallbackItems = (): HomeFaqItem[] =>
  FAQ_ITEMS.map((item, index) => ({
    id: item.id || `faq-${index + 1}`,
    question: String(item.question || '').trim(),
    answer: String(item.answer || '').trim(),
    category: String(item.category || 'General').trim() || 'General',
  }));

export const getDefaultHomeFaqItems = (): HomeFaqItem[] => toFallbackItems();

export const normalizeHomeFaqItems = (items: HomeFaqItem[]): HomeFaqItem[] => {
  const normalized = items
    .map((item, index) => ({
      id:
        String(item.id || '').trim() ||
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `faq-${index + 1}`),
      question: String(item.question || '').trim(),
      answer: String(item.answer || '').trim(),
      category: String(item.category || 'General').trim() || 'General',
    }))
    .filter((item) => item.question && item.answer);

  return normalized.length ? normalized : toFallbackItems();
};

export const buildFaqDbRows = (items: HomeFaqItem[]) =>
  normalizeHomeFaqItems(items).map((item, index) => ({
    id: item.id,
    question: item.question,
    answer: item.answer,
    category: item.category,
    sort_order: index,
    is_active: true,
  }));

export const loadHomeFaqItems = async (): Promise<HomeFaqItem[]> => {
  try {
    const { data, error } = await supabase
      .from('faq_items')
      .select('id,question,answer,category,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) throw error;

    const normalized = normalizeHomeFaqItems(
      (data || []).map((row: any, index: number) => ({
        id: String(row?.id || `faq-${index + 1}`),
        question: String(row?.question || '').trim(),
        answer: String(row?.answer || '').trim(),
        category: String(row?.category || 'General').trim() || 'General',
      }))
    );

    return normalized.length ? normalized : toFallbackItems();
  } catch (err) {
    console.warn('Home FAQ lookup failed, using defaults', err);
    return toFallbackItems();
  }
};

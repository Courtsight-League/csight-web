import { supabase } from './supabaseClient';
import { MerchProduct, MerchProductVariant } from '../types';

const JERSEY_BUCKET = (import.meta.env.VITE_SUPABASE_JERSEY_BUCKET as string) || 'jersey-designs';

const FALLBACK_PRODUCTS: MerchProduct[] = [
  {
    id: 'hoodie-carbon',
    name: 'Courtsight Carbon Hoodie',
    slug: 'carbon-hoodie',
    category: 'Hoodies',
    description: 'Premium heavyweight hoodie with tonal Courtsight crest. Minimal seams, pill-resistant knit.',
    price: 95,
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=1200&auto=format&fit=crop',
    availableQuantity: 24,
    leadTimeDays: 14,
    isActive: true,
    variants: [
      { id: 'hoodie-carbon-black', label: 'Black' },
      { id: 'hoodie-carbon-grey', label: 'Heather Grey' },
    ],
  },
  {
    id: 'accessories-sleeve',
    name: 'Courtsight Shooting Sleeve Pack',
    slug: 'shooting-sleeves',
    category: 'Accessories',
    description: 'Compression sleeve kit with moisture-wicking fabric and bold Courtsight logo cuff.',
    price: 30,
    imageUrl: 'https://images.unsplash.com/photo-1521412644187-c49fa049e84d?q=80&w=1200&auto=format&fit=crop',
    availableQuantity: 100,
    leadTimeDays: 14,
    isActive: true,
    variants: [
      { id: 'sleeve-black', label: 'Black / Lime' },
      { id: 'sleeve-white', label: 'White / Black' },
    ],
  },
  {
    id: 'jersey-premium',
    name: 'Courtsight Custom Jersey',
    slug: 'custom-jersey',
    category: 'Jerseys',
    description: 'Custom basketball jersey built to Courtsight specs. Upload your design, we manufacture it in two weeks.',
    price: 140,
    imageUrl: 'https://images.unsplash.com/photo-1521412644187-c49fa049e84d?q=80&w=1200&auto=format&fit=crop',
    availableQuantity: 50,
    leadTimeDays: 14,
    isActive: true,
    isJersey: true,
    variants: [
      { id: 'jersey-home', label: 'Home (White)' },
      { id: 'jersey-away', label: 'Away (Black)' },
    ],
  },
];

const parseVariantOptions = (value: any): MerchProductVariant[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return [];
};

const toMerchProduct = (row: any): MerchProduct => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  category: (row.category || 'Accessories') as MerchProduct['category'],
  description: row.description || row.summary || '',
  price: Number(row.price) || Number(row.price_cents) / 100 || 0,
  imageUrl: row.image_url || row.imageUrl || '',
  availableQuantity: Number(row.available_quantity) || row.availableQuantity || 0,
  leadTimeDays: Number(row.lead_time_days) || row.leadTimeDays || 14,
  isActive: !!row.is_active,
  isJersey: !!row.is_jersey,
  variants: parseVariantOptions(row.variant_options || row.variants),
  metadata: row.metadata || null,
});

export const fetchMerchProducts = async (): Promise<MerchProduct[]> => {
  try {
    const { data, error } = await supabase
      .from('merch_products')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      console.warn('Unable to load merch products', error.message);
      return FALLBACK_PRODUCTS;
    }
    if (!data?.length) {
      return FALLBACK_PRODUCTS;
    }
    return data.map(toMerchProduct);
  } catch (err) {
    console.warn('Merch products load error', err);
    return FALLBACK_PRODUCTS;
  }
};

export const updateMerchProductStock = async (productId: string, availableQuantity: number) => {
  const { error } = await supabase
    .from('merch_products')
    .update({ available_quantity: availableQuantity })
    .eq('id', productId);
  if (error) throw error;
};

export const uploadJerseyDesign = async (file: File) => {
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const timestamp = Date.now();
  const path = `${timestamp}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(JERSEY_BUCKET).upload(path, file, {
    upsert: true,
  });
  if (uploadError) {
    throw uploadError;
  }
  const { data: publicUrlData } = supabase.storage.from(JERSEY_BUCKET).getPublicUrl(path);
  return {
    path,
    publicUrl: publicUrlData.publicUrl,
  };
};

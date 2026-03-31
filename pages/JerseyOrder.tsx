import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MerchProduct, MerchCheckoutPayload, ShippingDetails } from '../types';
import { fetchMerchProducts, uploadJerseyDesign } from '../services/merchService';
import { createStripeCheckoutSession, redirectToStripeCheckout } from '../services/stripeCheckout';
import ShippingDetailsForm from '../components/ShippingDetailsForm';

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const DEFAULT_LEAD_DAYS = 14;
const DAY_IN_MS = 1000 * 60 * 60 * 24;
const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
});

const BASE_SHIPPING: ShippingDetails = {
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'Canada',
  email: '',
  phone: '',
};

const JerseyOrder: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [jerseyProduct, setJerseyProduct] = useState<MerchProduct | null>(null);
  const [sizeBreakdown, setSizeBreakdown] = useState<Record<string, number>>(
    SIZE_OPTIONS.reduce((acc, size) => ({ ...acc, [size]: 0 }), {})
  );
  const [teamName, setTeamName] = useState('');
  const [contactName, setContactName] = useState('');
  const [notes, setNotes] = useState('');
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [designUpload, setDesignUpload] = useState<{ path: string; publicUrl: string } | null>(null);
  const [shipping, setShipping] = useState<ShippingDetails>(BASE_SHIPPING);
  const [loading, setLoading] = useState(true);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalQuantity = useMemo(
    () => Object.values(sizeBreakdown).reduce((sum, qty) => sum + Number(qty || 0), 0),
    [sizeBreakdown]
  );

  const estimatedReadyDate = useMemo(
    () => new Date(Date.now() + DEFAULT_LEAD_DAYS * DAY_IN_MS),
    []
  );
  const formattedReadyDate = estimatedReadyDate.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const success = searchParams.get('checkout_success') === 'true';
  const cancel = searchParams.get('checkout_canceled') === 'true';
  const successSessionId = searchParams.get('session_id');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await fetchMerchProducts();
      if (cancelled) return;
      const jerseys = data.filter((product) => product.category === 'Jerseys');
      setProducts(jerseys);
      setJerseyProduct(jerseys[0] || null);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSizeChange = (size: string, value: number) => {
    setSizeBreakdown((prev) => ({ ...prev, [size]: Math.max(0, value) }));
  };

  const handleDesignSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG, or PDF files are accepted.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('Max file size is 25 MB.');
      return;
    }
    setUploadingDesign(true);
    setError(null);
    try {
      const uploaded = await uploadJerseyDesign(file);
      setDesignFile(file);
      setDesignUpload(uploaded);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload design.');
    } finally {
      setUploadingDesign(false);
    }
  };

  const handleShippingUpdate = (field: keyof ShippingDetails, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }));
  };

  const handleCheckout = async () => {
    if (!jerseyProduct) {
      setError('Unable to load jersey product.');
      return;
    }
    if (!teamName.trim() || !contactName.trim()) {
      setError('Team/purchaser name and contact name are required.');
      return;
    }
    if (!totalQuantity) {
      setError('Please select at least one jersey size.');
      return;
    }
    if (!designUpload) {
      setError('Please upload a jersey design file to continue.');
      return;
    }
    const requiredFields: (keyof ShippingDetails)[] = ['name', 'addressLine1', 'city', 'province', 'postalCode', 'country', 'email'];
    const shippingComplete = requiredFields.every((field) => shipping[field]?.trim());
    if (!shippingComplete) {
      setError('Complete required shipping information before checkout.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload: MerchCheckoutPayload = {
        cart: [
          {
            productId: jerseyProduct.id,
            name: jerseyProduct.name,
            variant: jerseyProduct.variants?.[0]?.label,
            category: jerseyProduct.category,
            quantity: totalQuantity,
            unitPriceCents: Math.round(jerseyProduct.price * 100),
            imageUrl: jerseyProduct.imageUrl,
          },
        ],
        shipping,
        jersey: {
          teamName: teamName.trim(),
          contactName: contactName.trim(),
          sizeBreakdown,
          notes: notes.trim(),
          designUrl: designUpload.publicUrl,
        },
      };

      const { sessionId } = await createStripeCheckoutSession(payload);
      await redirectToStripeCheckout(sessionId);
    } catch (checkoutError) {
      setSubmitting(false);
      setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to reach Stripe.');
    }
  };

  const subtotalCents = jerseyProduct ? Math.round(jerseyProduct.price * 100) * totalQuantity : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 text-white">
        <div className="max-w-5xl mx-auto text-center text-gray-400">Loading jersey flow...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 sm:px-6 lg:px-8 text-white">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.3em] text-brand-grey">Jerseys</p>
          <h1 className="font-sports text-4xl md:text-5xl">Custom Jersey Orders</h1>
          <p className="text-gray-400">
            Build a Courtsight jersey set with uploads just like our registration flow. Upload your design (JPG, PNG, or PDF),
            tell us the team name, and we will pair the order with a Stripe payment.
          </p>
          {success && (
            <div className="bg-brand-lime/10 border border-brand-lime/40 text-brand-lime p-4 rounded-2xl text-sm">
              Thanks for your jersey order! Estimated ready date (estimate): {formattedReadyDate}.
              {successSessionId && <span className="block text-xs text-gray-600">Session: {successSessionId}</span>}
            </div>
          )}
          {cancel && (
            <div className="bg-brand-red/10 border border-brand-red/40 text-brand-red p-4 rounded-2xl text-sm">
              Checkout was canceled—your design and selections are saved above. Continue when ready.
            </div>
          )}
          {error && (
            <div className="bg-brand-red/10 border border-brand-red/40 text-brand-red p-4 rounded-2xl text-sm">
              {error}
            </div>
          )}
        </header>

        <section className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Choose your kit</p>
              <select
                value={jerseyProduct?.id || ''}
                onChange={(event) => {
                  const next = products.find((product) => product.id === event.target.value);
                  setJerseyProduct(next || null);
                }}
                className="w-full bg-black border border-white/15 rounded px-3 py-2 text-white"
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {currencyFormatter.format(product.price)}
                  </option>
                ))}
              </select>
              <p className="text-sm text-gray-400 leading-relaxed">
                Lead time: {jerseyProduct?.leadTimeDays || DEFAULT_LEAD_DAYS} days from the manufacturer.
              </p>
            </div>
            <div className="space-y-3">
              {jerseyProduct && (
                <img
                  src={jerseyProduct.imageUrl || '/logo.png'}
                  alt={jerseyProduct.name}
                  className="w-full h-40 object-cover rounded-2xl border border-white/10"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-2 block">
                Team / Purchaser Name
              </label>
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="The Monstars"
                className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white focus:border-brand-lime"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-2 block">
                Contact Name
              </label>
              <input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Jordan Smith"
                className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white focus:border-brand-lime"
              />
            </div>
          </div>
        </section>

        <section className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-6">
          <h2 className="text-sm uppercase tracking-[0.3em] text-gray-400">Size Breakdown</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {SIZE_OPTIONS.map((size) => (
              <div key={size} className="space-y-1">
                <p className="text-xs uppercase tracking-[0.3em] text-gray-400">{size}</p>
                <input
                  type="number"
                  min={0}
                  value={sizeBreakdown[size] ?? 0}
                  onChange={(event) => handleSizeChange(size, Number(event.target.value) || 0)}
                  className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white focus:border-brand-lime"
                />
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-400">
            Total jerseys: <strong>{totalQuantity}</strong>
          </p>
        </section>

        <section className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-4">
          <h2 className="text-sm uppercase tracking-[0.3em] text-gray-400">Upload Jersey Design</h2>
          <p className="text-xs text-gray-500">
            Supported formats: PDF, PNG, JPG. Max size: 25 MB. The design stays linked to your order after payment.
          </p>
          <label className="flex flex-col gap-2 bg-black/30 border border-dashed border-white/20 rounded-2xl p-4 cursor-pointer text-sm">
            <span>{designFile ? designFile.name : 'Choose a file'}</span>
            <span className="text-[11px] text-gray-400">{uploadingDesign ? 'Uploading...' : 'Click to upload design'}</span>
            <input type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={handleDesignSelect} />
          </label>
          {designUpload && (
            <div className="text-xs text-gray-400">
              Uploaded: <a href={designUpload.publicUrl} className="text-brand-lime underline" target="_blank" rel="noreferrer">View design</a>
            </div>
          )}
        </section>

        <section className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-6">
          <h2 className="text-sm uppercase tracking-[0.3em] text-gray-400">Additional Notes</h2>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder="Optional instructions for the manufacturer"
            className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white focus:border-brand-lime"
          />
        </section>

        <section className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Shipping Details</p>
            <p className="text-[11px] text-gray-500 mt-1">Where do we send the jerseys once ready?</p>
          </div>
          <ShippingDetailsForm shipping={shipping} onChange={handleShippingUpdate} />
        </section>

        <section className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Summary</p>
              <p className="text-[11px] text-gray-500">Estimated ready date (estimate): {formattedReadyDate}</p>
            </div>
            <p className="text-2xl font-sports">{currencyFormatter.format(subtotalCents / 100)}</p>
          </div>
          <button
            onClick={handleCheckout}
            disabled={submitting || uploadingDesign}
            className={`w-full px-4 py-3 rounded-full font-bold uppercase tracking-[0.3em] transition ${
              submitting || uploadingDesign
                ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                : 'bg-brand-lime text-black hover:bg-white'
            }`}
          >
            {submitting ? 'Redirecting to Stripe...' : 'Pay with Stripe'}
          </button>
        </section>
      </div>
    </div>
  );
};

export default JerseyOrder;

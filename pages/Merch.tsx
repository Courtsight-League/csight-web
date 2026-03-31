import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Role, CartItem, MerchCategory, MerchCheckoutPayload, MerchProduct, ShippingDetails } from '../types';
import { getCurrentUser } from '../services/authService';
import { fetchMerchProducts, updateMerchProductStock } from '../services/merchService';
import { createStripeCheckoutSession, redirectToStripeCheckout } from '../services/stripeCheckout';
import ShippingDetailsForm from '../components/ShippingDetailsForm';

const MERCH_CATEGORIES: MerchCategory[] = ['Hoodies', 'Accessories', 'Jerseys'];
const REQUIRED_SHIPPING_FIELDS: (keyof ShippingDetails)[] = [
  'name',
  'addressLine1',
  'city',
  'province',
  'postalCode',
  'country',
  'email',
];
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

const formatMoney = (cents: number) => currencyFormatter.format(cents / 100);

const Merch: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [activeCategory, setActiveCategory] = useState<MerchCategory>('Hoodies');
  const [selectedProduct, setSelectedProduct] = useState<MerchProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [shipping, setShipping] = useState<ShippingDetails>(BASE_SHIPPING);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockDrafts, setStockDrafts] = useState<Record<string, number>>({});
  const [stockUpdating, setStockUpdating] = useState<Record<string, boolean>>({});

  const user = getCurrentUser();
  const isAdmin = user?.role === Role.ADMIN_FULL;
  const estimatedReadyDate = useMemo(
    () => new Date(Date.now() + DEFAULT_LEAD_DAYS * DAY_IN_MS),
    []
  );
  const formattedReadyDate = estimatedReadyDate.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const checkoutSuccess = searchParams.get('checkout_success') === 'true';
  const checkoutCanceled = searchParams.get('checkout_canceled') === 'true';
  const successSessionId = searchParams.get('session_id') || null;

  useEffect(() => {
    const stored = localStorage.getItem('courtsight_merch_cart');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as CartItem[];
        setCartItems(parsed);
      } catch {
        // ignore stale data
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('courtsight_merch_cart', JSON.stringify(cartItems));
  }, [cartItems]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingProducts(true);
      const data = await fetchMerchProducts();
      if (cancelled) return;
      setProducts(data);
      setLoadingProducts(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!products.length) return;
    const activeList = products.filter((product) => product.category === activeCategory);
    const next = activeList[0] || products[0];
    setSelectedProduct(next || null);
  }, [activeCategory, products]);

  useEffect(() => {
    if (!selectedProduct) return;
    setSelectedVariant(selectedProduct.variants?.[0]?.label);
    setSelectedQuantity(1);
  }, [selectedProduct]);

  useEffect(() => {
    setStockDrafts((prev) => {
      const next = { ...prev };
      products.forEach((product) => {
        if (next[product.id] == null) {
          next[product.id] = product.availableQuantity;
        }
      });
      return next;
    });
  }, [products]);

  const categoryProducts = useMemo(() => {
    const map: Record<MerchCategory, MerchProduct[]> = {
      Hoodies: [],
      Accessories: [],
      Jerseys: [],
    };
    products.forEach((product) => {
      map[product.category]?.push(product);
    });
    return map;
  }, [products]);

  const cartTotalCents = useMemo(
    () => cartItems.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0),
    [cartItems]
  );

  const shippingComplete = REQUIRED_SHIPPING_FIELDS.every(
    (field) => shipping[field]?.trim()
  );

  const handleAddToCart = () => {
    if (!selectedProduct) return;
    const variantLabel = selectedVariant;
    const unitPriceCents = Math.round(selectedProduct.price * 100);
    const maxAvailable = Math.max(selectedProduct.availableQuantity, 1);
    const desiredQuantity = Math.min(Math.max(selectedQuantity, 1), maxAvailable);
    if (!desiredQuantity) return;
    setCartItems((prev) => {
      const matchIndex = prev.findIndex(
        (item) => item.productId === selectedProduct.id && item.variant === variantLabel
      );
      if (matchIndex >= 0) {
        const existing = prev[matchIndex];
        const updatedQuantity = Math.min(existing.quantity + desiredQuantity, maxAvailable);
        const next = [...prev];
        next[matchIndex] = { ...existing, quantity: updatedQuantity };
        return next;
      }
      return [
        ...prev,
        {
          productId: selectedProduct.id,
          name: selectedProduct.name,
          imageUrl: selectedProduct.imageUrl,
          variant: variantLabel,
          category: selectedProduct.category,
          quantity: desiredQuantity,
          unitPriceCents,
        },
      ];
    });
    setSelectedQuantity(1);
  };

  const handleCartQuantityChange = (index: number, quantity: number) => {
    setCartItems((prev) => {
      const next = [...prev];
      const item = next[index];
      if (!item) return next;
      const product = products.find((p) => p.id === item.productId);
      const max = product ? product.availableQuantity : item.quantity;
      const safeQty = Math.max(1, Math.min(quantity, Math.max(max, 1)));
      next[index] = { ...item, quantity: safeQty };
      return next;
    });
  };

  const handleRemoveCartItem = (index: number) => {
    setCartItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateShipping = useCallback(
    (field: keyof ShippingDetails, value: string) => {
      setShipping((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleStockUpdate = async (productId: string) => {
    const draft = stockDrafts[productId];
    if (draft == null) return;
    setStockUpdating((prev) => ({ ...prev, [productId]: true }));
    try {
      await updateMerchProductStock(productId, Math.max(draft, 0));
      setProducts((prev) =>
        prev.map((item) =>
          item.id === productId ? { ...item, availableQuantity: Math.max(draft, 0) } : item
        )
      );
    } catch (err) {
      setError('Unable to update inventory. Please try again.');
    } finally {
      setStockUpdating((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const handleCheckout = async () => {
    if (!cartItems.length) {
      setError('Add at least one item to your cart before checking out.');
      return;
    }
    if (!shippingComplete) {
      setError('Please complete required shipping fields before checkout.');
      return;
    }
    setError(null);
    setCheckoutLoading(true);
    try {
      const payload: MerchCheckoutPayload = {
        cart: cartItems.map((item) => ({
          productId: item.productId,
          name: item.name,
          variant: item.variant,
          category: item.category,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          imageUrl: item.imageUrl,
        })),
        shipping,
        userId: user?.id ?? null,
      };
      const { sessionId } = await createStripeCheckoutSession(payload);
      await redirectToStripeCheckout(sessionId);
    } catch (checkoutError) {
      setCheckoutLoading(false);
      setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout failed.');
    }
  };

  const activeCategoryProducts = categoryProducts[activeCategory] ?? [];

  if (loadingProducts) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 text-white">
        <div className="max-w-5xl mx-auto text-center text-gray-400">Loading merch...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 sm:px-6 lg:px-8 text-white">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-brand-grey">Merch Store</p>
          <h1 className="font-sports text-4xl md:text-5xl text-white">Courtsight Merch</h1>
          <p className="text-gray-400 max-w-3xl">
            Browse limited Courtsight hoodies, accessories, and custom jerseys. All merch orders ship from our manufacturer in
            a minimum of two weeks. Orders are processed via Stripe and recorded in your Courtsight account.
          </p>
          <div className="flex flex-wrap gap-3">
            {MERCH_CATEGORIES.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`px-4 py-2 uppercase text-xs tracking-widest rounded-full border transition-colors duration-200 ${
                  activeCategory === category
                    ? 'border-brand-lime text-black bg-brand-lime'
                    : 'border-white/20 text-gray-300 hover:border-white hover:text-white'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
          {checkoutSuccess && (
            <div className="bg-brand-lime/10 border border-brand-lime/40 text-brand-lime p-4 rounded-2xl text-sm">
              Thanks for your order! Estimated ready date (estimate): {formattedReadyDate}.
              {successSessionId && <span className="block text-xs text-gray-600">Session: {successSessionId}</span>}
            </div>
          )}
          {checkoutCanceled && (
            <div className="bg-brand-red/10 border border-brand-red/40 text-brand-red p-4 rounded-2xl text-sm">
              Checkout was canceled. Your cart is saved above—complete shipping info when you are ready.
            </div>
          )}
          {error && (
            <div className="bg-brand-red/10 border border-brand-red/40 text-brand-red p-4 rounded-2xl text-sm">
              {error}
            </div>
          )}
        </header>

        {selectedProduct && (
          <section className="bg-brand-dark border border-white/10 rounded-3xl p-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
              <div className="rounded-2xl overflow-hidden border border-white/5 bg-black/60">
                <img
                  src={selectedProduct.imageUrl || '/logo.png'}
                  alt={selectedProduct.name}
                  className="w-full h-full max-h-[360px] object-cover"
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-sports text-3xl text-white">{selectedProduct.name}</h2>
                  <span className="text-2xl font-bold text-brand-lime">
                    {formatMoney(Math.round(selectedProduct.price * 100))}
                  </span>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">{selectedProduct.description}</p>
                <p className="text-xs uppercase text-gray-400 tracking-[0.3em]">
                  Lead time: {selectedProduct.leadTimeDays || DEFAULT_LEAD_DAYS} days (Minimum 2 weeks)
                </p>
                <div className="grid gap-4">
                  {selectedProduct.variants?.length ? (
                    <div>
                      <label className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-1 block">
                        Variant
                      </label>
                      <select
                        value={selectedVariant ?? selectedProduct.variants[0].label}
                        onChange={(event) => setSelectedVariant(event.target.value)}
                        className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white focus:border-brand-lime"
                      >
                        {selectedProduct.variants.map((variant) => (
                          <option key={variant.id} value={variant.label}>
                            {variant.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <label className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-1 block">
                      Quantity (Available: {selectedProduct.availableQuantity})
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(selectedProduct.availableQuantity, 1)}
                      value={selectedQuantity}
                      onChange={(event) =>
                        setSelectedQuantity(
                          Math.max(1, Math.min(Number(event.target.value) || 1, Math.max(selectedProduct.availableQuantity, 1)))
                        )
                      }
                      className="w-32 bg-black border border-white/20 rounded px-3 py-2 text-white focus:border-brand-lime"
                    />
                  </div>
                  <button
                    onClick={handleAddToCart}
                    disabled={selectedProduct.availableQuantity <= 0}
                    className={`px-6 py-3 rounded-full font-bold uppercase tracking-[0.3em] transition-colors text-sm ${
                      selectedProduct.availableQuantity <= 0
                        ? 'bg-white/10 border border-white/20 text-gray-400 cursor-not-allowed'
                        : 'bg-brand-lime text-black hover:bg-white'
                    }`}
                  >
                    Add to Cart
                  </button>
                  <p className="text-xs text-gray-500">
                    Orders ship in at least 2 weeks from the manufacturer. Checkout confirms your ready date.
                  </p>
                </div>
                {isAdmin && (
                  <div className="border border-white/10 rounded-2xl p-4 bg-black/40 space-y-2">
                    <p className="text-xs uppercase text-brand-lime tracking-[0.3em]">Admin Inventory</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={0}
                        value={stockDrafts[selectedProduct.id] ?? selectedProduct.availableQuantity}
                        onChange={(event) =>
                          setStockDrafts((prev) => ({
                            ...prev,
                            [selectedProduct.id]: Number(event.target.value) || 0,
                          }))
                        }
                        className="w-24 bg-black border border-white/15 rounded px-3 py-2 text-white"
                      />
                      <button
                        onClick={() => handleStockUpdate(selectedProduct.id)}
                        disabled={stockUpdating[selectedProduct.id]}
                        className="px-3 py-2 bg-brand-lime text-black text-xs uppercase tracking-[0.3em] rounded-full font-bold"
                      >
                        {stockUpdating[selectedProduct.id] ? 'Saving...' : 'Update Stock'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            {activeCategoryProducts.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {activeCategoryProducts.map((product) => (
                  <article
                    key={product.id}
                    className="border border-white/10 rounded-3xl bg-gradient-to-b from-white/5 to-transparent overflow-hidden min-h-[320px] group"
                  >
                    <div className="h-48 overflow-hidden">
                      <img
                        src={product.imageUrl || '/logo.png'}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-all duration-500"
                      />
                    </div>
                    <div className="p-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-sports text-xl uppercase tracking-wider">{product.name}</h3>
                        <span className="text-sm text-gray-400">{product.category}</span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-3">{product.description}</p>
                      <div className="flex items-center justify-between text-lg font-bold">
                        <span>{formatMoney(Math.round(product.price * 100))}</span>
                        <button
                          onClick={() => setSelectedProduct(product)}
                          className="px-4 py-2 bg-white/10 border border-white/20 text-xs uppercase tracking-[0.3em] rounded-full text-white hover:bg-white hover:text-black transition-all duration-200"
                        >
                          View
                        </button>
                      </div>
                      <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                        Lead time: {product.leadTimeDays || DEFAULT_LEAD_DAYS} days
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="border border-white/10 rounded-3xl p-6 text-center text-gray-500">
                No products were found for {activeCategory}.
              </div>
            )}
          </div>

          <aside className="space-y-6">
            <div className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-4">
              <h3 className="text-lg font-sports uppercase">Your Cart</h3>
              {cartItems.length === 0 ? (
                <p className="text-sm text-gray-400">Add some merch to see your cart and checkout.</p>
              ) : (
                <div className="space-y-4">
                  {cartItems.map((item, index) => (
                    <div
                      key={`${item.productId}-${item.variant}-${index}`}
                      className="border border-white/5 rounded-2xl p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sm uppercase tracking-widest">
                            {item.name}
                          </p>
                          {item.variant && <p className="text-[11px] text-gray-400">{item.variant}</p>}
                        </div>
                        <span className="text-brand-lime text-sm font-bold">
                          {formatMoney(item.unitPriceCents)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(event) =>
                            handleCartQuantityChange(index, Number(event.target.value) || 1)
                          }
                          className="w-20 bg-black border border-white/15 rounded px-3 py-1 text-white"
                        />
                        <button
                          onClick={() => handleRemoveCartItem(index)}
                          className="text-xs text-brand-red uppercase tracking-[0.3em]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-white/10 pt-4 space-y-1">
                <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Subtotal</p>
                <p className="text-2xl font-sports">{formatMoney(cartTotalCents)}</p>
                <p className="text-xs text-gray-400">Est. ready date (estimate): {formattedReadyDate}</p>
              </div>
            </div>
            <div className="bg-brand-dark border border-white/10 rounded-3xl p-6 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Shipping Details</p>
                <p className="text-[11px] text-gray-500 mt-1">Required for order processing and delivery updates.</p>
              </div>
              <ShippingDetailsForm shipping={shipping} onChange={handleUpdateShipping} />
              <div className="bg-black/40 border border-white/10 rounded-2xl p-4 text-xs text-gray-400">
                <p className="uppercase tracking-[0.3em]">Lead time</p>
                <p>Orders take a minimum of two weeks from the manufacturer.</p>
              </div>
              <button
                onClick={handleCheckout}
                disabled={checkoutLoading || cartItems.length === 0}
                className={`w-full px-4 py-3 rounded-full font-bold uppercase tracking-[0.3em] transition ${
                  checkoutLoading || cartItems.length === 0
                    ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                    : 'bg-brand-lime text-black hover:bg-white'
                }`}
              >
                {checkoutLoading ? 'Redirecting to Stripe...' : 'Checkout via Stripe'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Merch;

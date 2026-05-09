import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { apiClient } from '@/services/apiClient';
import { Alert, Button, Card, Input } from '@/components/UI';
import * as t from '@/types';

const CATALOG_PAGE_CACHE = new Map<string, t.CatalogListResponse>();
const DEFAULT_PRODUCT_IMAGE =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%23cffafe"/><stop offset="100%" stop-color="%23e9d5ff"/></linearGradient></defs><rect width="640" height="360" fill="url(%23g)"/><circle cx="500" cy="70" r="55" fill="%23a5f3fc" opacity="0.6"/><circle cx="130" cy="285" r="80" fill="%23ddd6fe" opacity="0.45"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, Arial" font-size="28" fill="%230f172a">Image unavailable</text></svg>';

function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function buildCatalogCacheKey(params: t.CatalogQueryParams): string {
  return [
    params.page,
    params.page_size,
    params.search || '',
    params.restaurant || '',
    params.cuisine || '',
    params.availability || 'all',
    params.sort_by || 'featured',
  ].join('|');
}

function formatCardInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

export function OrderPlacementPage() {
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const { cart, fetchCart, addItem, updateItem } = useCart();

  const [catalog, setCatalog] = useState<t.CatalogItem[]>([]);
  const [catalogTotalItems, setCatalogTotalItems] = useState(0);
  const [catalogTotalPages, setCatalogTotalPages] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [restaurantOptions, setRestaurantOptions] = useState<string[]>([]);
  const [cuisineOptions, setCuisineOptions] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [restaurantFilter, setRestaurantFilter] = useState('all');
  const [cuisineFilter, setCuisineFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'featured' | 'name' | 'price_asc' | 'price_desc' | 'restaurant'>('featured');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(4);
  const [shippingAddress, setShippingAddress] = useState<t.ShippingAddress>({
    line1: '',
    city: '',
  });
  const [deliveryOption, setDeliveryOption] = useState<'standard' | 'express'>('standard');
  const [paymentReference, setPaymentReference] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkout, setCheckout] = useState<t.CheckoutValidateResponse | null>(null);
  const [orderResult, setOrderResult] = useState<t.OrderCreateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const checkoutPayload = useMemo<t.CheckoutValidateRequest>(
    () => ({
      shipping_address: shippingAddress,
      payment_method_reference: paymentReference,
    }),
    [shippingAddress, paymentReference]
  );

  const fetchCatalogPage = async (params: t.CatalogQueryParams): Promise<t.CatalogListResponse> => {
    const cacheKey = buildCatalogCacheKey(params);
    const cached = CATALOG_PAGE_CACHE.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await apiClient.getCatalogItems(params);
    CATALOG_PAGE_CACHE.set(cacheKey, response);
    return response;
  };

  const loadCatalog = async () => {
    const response = await fetchCatalogPage({
      page: currentPage,
      page_size: pageSize,
      search: debouncedSearchTerm,
      restaurant: restaurantFilter === 'all' ? undefined : restaurantFilter,
      cuisine: cuisineFilter === 'all' ? undefined : cuisineFilter,
      availability: availabilityFilter as 'all' | 'available' | 'out_of_stock',
      sort_by: sortBy,
    });
    setCatalog(response.items);
    setCatalogTotalItems(response.total_items);
    setCatalogTotalPages(response.total_pages);
    setHasNextPage(response.has_next);
    setHasPrevPage(response.has_prev);
    setRestaurantOptions(response.restaurants);
    setCuisineOptions(response.cuisines);
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, restaurantFilter, cuisineFilter, availabilityFilter, sortBy, pageSize]);

  useEffect(() => {
    const loadCatalogOnly = async () => {
      try {
        await loadCatalog();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load catalog');
      }
    };

    if (!loading) {
      loadCatalogOnly();
    }
  }, [
    currentPage,
    pageSize,
    debouncedSearchTerm,
    restaurantFilter,
    cuisineFilter,
    availabilityFilter,
    sortBy,
    loading,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    const loadInitialData = async () => {
      try {
        setError('');
        setLoading(true);
        await Promise.all([
          fetchCatalogPage({
            page: currentPage,
            page_size: pageSize,
            search: debouncedSearchTerm,
            restaurant: restaurantFilter === 'all' ? undefined : restaurantFilter,
            cuisine: cuisineFilter === 'all' ? undefined : cuisineFilter,
            availability: availabilityFilter as 'all' | 'available' | 'out_of_stock',
            sort_by: sortBy,
          }),
          fetchCart(controller.signal),
        ]);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load order screen');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();

    return () => controller.abort();
  }, []);

  const handleAddToCart = async (itemId: string) => {
    await addItem(itemId, 1);
  };

  const handleUpdateQty = async (itemId: string, qty: number) => {
    await updateItem(itemId, qty);
  };

  const handleValidateCheckout = async () => {
    try {
      setError('');
      const result = await apiClient.validateCheckout(checkoutPayload);
      setCheckout(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout validation failed');
    }
  };

  const handleSubmitOrder = async () => {
    if (isGuest) {
      setError('Guest users must login/register before placing an order.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const validation = await apiClient.validateCheckout(checkoutPayload);
      setCheckout(validation);
      if (!validation.valid) {
        setError('Please fix checkout issues before submitting.');
        return;
      }

      const idempotencyKey = `submit_${Date.now()}_${validation.total_cents}`;
      const created = await apiClient.createOrder(
        {
          shipping_address: shippingAddress,
          delivery_option: deliveryOption,
          payment_method_reference: paymentReference,
        },
        idempotencyKey
      );

      setOrderResult(created);
      await fetchCart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading ordering experience...</div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden order-hero-bg">
      <div className="order-blob w-80 h-80 bg-cyan-300 -top-20 -left-16"></div>
      <div className="order-blob order-blob-delay w-80 h-80 bg-amber-300 top-24 right-0"></div>
      <div className="order-blob w-72 h-72 bg-pink-300 bottom-0 left-1/3"></div>

      <div className="relative max-w-7xl mx-auto p-6 space-y-6 order-reveal">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-cyan-900">Order Placement</h1>
            <p className="text-cyan-800/80 font-medium">Build your cart, validate checkout, then submit in simulation mode.</p>
          </div>
          {isGuest && (
            <Card className="bg-amber-50/90 border border-amber-300 shadow-lg backdrop-blur-sm order-reveal">
              <p className="text-sm text-amber-900 font-semibold mb-2">Guest mode limitation</p>
              <p className="text-sm text-amber-800 mb-3">You can browse and manage cart, but final order placement requires authentication.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => navigate('/login')}>Login</Button>
                <Button size="sm" variant="outline" onClick={() => navigate('/register')}>Register</Button>
              </div>
            </Card>
          )}
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError('')} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-white/85 border border-white/70 shadow-xl backdrop-blur-sm order-reveal">
              <h2 className="text-xl font-bold mb-4">Catalog</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 mb-4">
                <Input
                  label="Search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search items, restaurants, descriptions"
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Restaurant</label>
                  <select
                    value={restaurantFilter}
                    onChange={(e) => setRestaurantFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="all">All restaurants</option>
                    {restaurantOptions.map((restaurantName) => (
                      <option key={restaurantName} value={restaurantName}>
                        {restaurantName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Availability</label>
                  <select
                    value={availabilityFilter}
                    onChange={(e) => setAvailabilityFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="all">All items</option>
                    <option value="available">Available only</option>
                    <option value="out_of_stock">Out of stock only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cuisine</label>
                  <select
                    value={cuisineFilter}
                    onChange={(e) => setCuisineFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="all">All cuisines</option>
                    {cuisineOptions.map((cuisineName) => (
                      <option key={cuisineName} value={cuisineName}>
                        {cuisineName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sort by</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="featured">Featured</option>
                    <option value="name">Name</option>
                    <option value="price_asc">Price: Low to high</option>
                    <option value="price_desc">Price: High to low</option>
                    <option value="restaurant">Restaurant</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Per page</label>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                    <option value={12}>12</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between mb-4 text-sm text-gray-600">
                <p>
                  Showing {catalogTotalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                  -{Math.min(currentPage * pageSize, catalogTotalItems)} of {catalogTotalItems}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={!hasPrevPage}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {currentPage} / {catalogTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage((prev) => prev + 1)}
                    disabled={!hasNextPage}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {catalog.map((item, idx) => (
                  <div
                    key={item.item_id}
                    className="catalog-card border border-cyan-100 bg-white/90 rounded-xl p-4 order-reveal"
                    style={{ animationDelay: `${Math.min(idx * 45, 220)}ms` }}
                  >
                    <img
                      src={item.image_url || DEFAULT_PRODUCT_IMAGE}
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src !== DEFAULT_PRODUCT_IMAGE) {
                          target.src = DEFAULT_PRODUCT_IMAGE;
                        }
                      }}
                      alt={item.name}
                      className="w-full h-36 object-cover rounded-lg mb-3 border border-cyan-100"
                      loading="lazy"
                    />
                    <p className="text-xs uppercase tracking-wide text-gray-500">{item.restaurant_name}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {item.restaurant_cuisine && (
                        <span className="px-2 py-1 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-100">
                          {item.restaurant_cuisine}
                        </span>
                      )}
                      {item.restaurant_rating !== null && item.restaurant_rating !== undefined && (
                        <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-100">
                          {item.restaurant_rating.toFixed(1)} rating
                        </span>
                      )}
                      {item.restaurant_delivery_time && (
                        <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-100">
                          {item.restaurant_delivery_time} min
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900 mt-1">{item.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                    <p className="text-sm font-semibold text-cyan-900 mt-2">{formatCents(item.price_cents, item.currency)}</p>
                    <Button
                      className="mt-3 w-full shadow-md"
                      onClick={() => handleAddToCart(item.item_id)}
                      disabled={!item.in_stock}
                    >
                      {item.in_stock ? 'Add to cart' : 'Out of stock'}
                    </Button>
                  </div>
                ))}
              </div>
              {catalogTotalItems === 0 && (
                <div className="mt-4 text-center text-gray-500">
                  No catalog items match your current filters.
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-white/85 border border-white/70 shadow-xl backdrop-blur-sm order-reveal">
              <h2 className="text-xl font-bold mb-4">Cart</h2>
              {!cart || cart.items.length === 0 ? (
                <p className="text-gray-500">Your cart is empty.</p>
              ) : (
                <div className="space-y-3">
                  {cart.items.map((line) => (
                    <div key={line.item_id} className="border border-cyan-100 bg-white/90 rounded-md p-3">
                      <p className="font-semibold text-gray-900">{line.name}</p>
                      <p className="text-sm text-gray-600">{formatCents(line.unit_price_cents)} each</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleUpdateQty(line.item_id, Math.max(0, line.quantity - 1))}>-</Button>
                        <span className="w-8 text-center text-sm font-medium">{line.quantity}</span>
                        <Button size="sm" variant="outline" onClick={() => handleUpdateQty(line.item_id, Math.min(20, line.quantity + 1))}>+</Button>
                        <Button size="sm" onClick={() => handleUpdateQty(line.item_id, 0)}>Remove</Button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-gray-200">
                    <p className="font-semibold text-gray-900">Subtotal: {formatCents(cart.subtotal_cents)}</p>
                  </div>
                </div>
              )}
            </Card>

            {!showCheckout ? (
              <Card className="bg-white/85 border border-white/70 shadow-xl backdrop-blur-sm order-reveal">
                <h2 className="text-xl font-bold mb-2">Checkout</h2>
                <p className="text-gray-600 mb-4">
                  Proceed to checkout when your cart is ready.
                </p>
                <Button
                  onClick={() => setShowCheckout(true)}
                  disabled={!cart || cart.items.length === 0}
                >
                  Proceed to Checkout
                </Button>
              </Card>
            ) : (
              <Card className="bg-white/85 border border-white/70 shadow-xl backdrop-blur-sm order-reveal">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">Checkout details</h2>
                  <Button variant="outline" size="sm" onClick={() => setShowCheckout(false)}>
                    Back to Catalog
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <Input
                    label="Address line"
                    value={shippingAddress.line1}
                    onChange={(e) => setShippingAddress((prev) => ({ ...prev, line1: e.target.value }))}
                    placeholder="42 Example Street"
                  />
                  <Input
                    label="City"
                    value={shippingAddress.city}
                    onChange={(e) => setShippingAddress((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="Beer Sheva"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Delivery option</label>
                    <select
                      value={deliveryOption}
                      onChange={(e) => setDeliveryOption(e.target.value as 'standard' | 'express')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="standard">Standard</option>
                      <option value="express">Express</option>
                    </select>
                  </div>
                  <Input
                    label="Card number"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(formatCardInput(e.target.value))}
                    placeholder="4111 1111 1111 1111"
                  />
                  <div className="rounded-md border border-cyan-100 bg-cyan-50/70 p-3">
                    <p className="text-sm font-semibold text-cyan-900">Use your revealed demo card</p>
                    <p className="text-xs text-cyan-800 mt-1">
                      Reveal the full card in Profile, then enter it here.
                    </p>
                    <p className="text-xs text-cyan-800 mt-2">Tip: card numbers ending with 0000 simulate payment decline.</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <Button variant="outline" onClick={handleValidateCheckout}>Validate checkout</Button>
                  <Button onClick={handleSubmitOrder} disabled={submitting}>
                    {submitting ? 'Submitting...' : 'Submit order'}
                  </Button>
                </div>

                {checkout && (
                  <div className="mt-4 p-4 rounded-md border border-gray-200 bg-gray-50">
                    <p className="font-semibold text-gray-900">
                      Validation: {checkout.valid ? 'valid' : 'needs fixes'}
                    </p>
                    <p className="text-sm text-gray-700 mt-1">Total: {formatCents(checkout.total_cents)}</p>
                    {checkout.issues.length > 0 && (
                      <ul className="list-disc pl-5 mt-2 text-sm text-red-700 space-y-1">
                        {checkout.issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {orderResult && (
                  <div className="mt-4 p-4 rounded-md border border-green-300 bg-green-50">
                    <p className="font-bold text-green-900">Order submitted successfully</p>
                    <p className="text-sm text-green-800 mt-1">Order ID: {orderResult.order_id}</p>
                    <p className="text-sm text-green-800">Status: {orderResult.status_label}</p>
                    <p className="text-sm text-green-800">Total: {formatCents(orderResult.total_cents)}</p>
                    <p className="text-sm text-green-800">Payment auth: {orderResult.payment_authorization_id}</p>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

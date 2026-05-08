import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/apiClient';
import { Alert, Button, Card } from '@/components/UI';
import * as t from '@/types';

function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const [order, setOrder] = useState<t.Order | null>(null);
  const [timeline, setTimeline] = useState<t.OrderTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadOrder = async () => {
      if (!orderId) {
        setError('Missing order id');
        setLoading(false);
        return;
      }

      try {
        setError('');
        const [response, timelineResponse] = await Promise.all([
          apiClient.getOrderDetail(orderId),
          apiClient.getOrderTimeline(orderId),
        ]);
        setOrder(response);
        setTimeline(timelineResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order');
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [orderId]);

  // Listen for live order updates
  useEffect(() => {
    if (!orderId) return;

    const handleOrderNotifications = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const orderNotifications = customEvent.detail as Array<{ order_id: string; [key: string]: unknown }>;

      if (!Array.isArray(orderNotifications)) return;

      // Check if any notification is for this order
      const hasMatchingOrder = orderNotifications.some((notification) => notification.order_id === orderId);

      if (hasMatchingOrder) {
        try {
          const timelineResponse = await apiClient.getOrderTimeline(orderId, { forceRefresh: true });
          setTimeline(timelineResponse);
        } catch (err) {
          console.error(`Failed to update timeline for order ${orderId}:`, err);
        }
      }
    };

    window.addEventListener('order-notifications-received', handleOrderNotifications);

    return () => {
      window.removeEventListener('order-notifications-received', handleOrderNotifications);
    };
  }, [orderId]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading order...</div>;
  }

  if (!order) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}
        <Button onClick={() => navigate('/orders')} variant="outline">
          Back to My Orders
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      <Card className="bg-amber-50 border-amber-200">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Order Summary</h1>
            <p className="text-gray-600 mt-1">{order.order_id}</p>
          </div>
          <Button onClick={() => navigate(`/orders/${order.order_id}/timeline`)}>
            View Timeline
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 text-sm text-gray-700">
          <div>
            <p className="font-semibold text-gray-500">Latest timeline status</p>
            <p>{timeline?.current_status || order.status_label}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-500">Created</p>
            <p>{formatCreatedAt(order.created_at)}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-500">What was ordered</p>
            <p>{order.ordered_items_summary || 'No item summary available'}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-500">Price</p>
            <p>{order.total_cents != null ? formatCents(order.total_cents) : 'Not available'}</p>
          </div>
        </div>

        {timeline && (timeline.issue_code || timeline.is_delayed) && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Delivery outcome</p>
            <p>
              {timeline.is_delayed ? 'Delayed delivery' : 'On-time delivery'}
              {timeline.issue_code ? ` • ${timeline.issue_code.replace(/_/g, ' ')}` : ''}
            </p>
            <p className="mt-1"><span className="font-medium">Ordered:</span> {timeline.ordered_items_summary || 'N/A'}</p>
            <p><span className="font-medium">Received:</span> {timeline.received_items_summary || 'N/A'}</p>
          </div>
        )}

        <p className="mt-4 text-sm text-gray-600">The live progress appears in the timeline.</p>

        {isGuest && <p className="mt-4 text-sm text-orange-700">Guest accounts have limited order features.</p>}
      </Card>

      <Link to="/orders" className="text-blue-600 hover:underline text-sm font-semibold">
        Back to My Orders
      </Link>
    </div>
  );
}
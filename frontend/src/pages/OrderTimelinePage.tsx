import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/services/apiClient';
import { Alert, Button, Card } from '@/components/UI';
import * as t from '@/types';

export function OrderTimelinePage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<t.Order | null>(null);
  const [timeline, setTimeline] = useState<t.OrderTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) {
      setError('Missing order id');
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadInitial = async () => {
      try {
        setError('');
        const [orderResponse, timelineResponse] = await Promise.all([
          apiClient.getOrderDetail(orderId),
          apiClient.getOrderTimeline(orderId),
        ]);
        if (!isMounted) {
          return;
        }
        setOrder(orderResponse);
        setTimeline(timelineResponse);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load timeline');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const refreshTimeline = async () => {
      try {
        const timelineResponse = await apiClient.getOrderTimeline(orderId, { forceRefresh: true });
        if (!isMounted) {
          return;
        }
        setTimeline(timelineResponse);
      } catch {
        // Keep existing timeline and avoid noisy real-time errors.
      }
    };

    const handleNotificationRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<t.LiveNotification[]>;
      const notifications = customEvent.detail || [];
      const hasMatchingOrderUpdate = notifications.some(
        (notification) => notification.order_id === orderId
      );
      if (hasMatchingOrderUpdate) {
        void refreshTimeline();
      }
    };

    void loadInitial();
    window.addEventListener('order-notifications-received', handleNotificationRefresh as EventListener);

    return () => {
      isMounted = false;
      window.removeEventListener('order-notifications-received', handleNotificationRefresh as EventListener);
    };
  }, [orderId]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading timeline...</div>;
  }

  if (!timeline) {
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

      <Card className="bg-blue-50">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Order Timeline</h1>
            <p className="text-gray-600 mt-1">{timeline.order_id}</p>
          </div>
          <Button onClick={() => navigate(`/orders/${timeline.order_id}`)} variant="outline">
            View Summary
          </Button>
        </div>

        {order && (
          <div className="mb-4 text-sm text-gray-700">
            <p className="font-semibold text-gray-500">Order status</p>
            <p>{order.status_label}</p>
            {timeline.eta_from && timeline.eta_to && (
              <p className="mt-1 text-xs text-gray-500">
                ETA (simulated): {new Date(timeline.eta_from).toLocaleTimeString()} -{' '}
                {new Date(timeline.eta_to).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">Latest timeline status: {timeline.current_status}</p>
          {timeline.timeline.map((event, idx) => (
            <div key={idx} className="flex gap-4">
              <div className="w-2 h-2 bg-blue-600 rounded-full mt-1.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">{event.event}</p>
                <p className="text-sm text-gray-600">{event.date}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm text-gray-600">The timeline shows the live fulfillment state.</p>
      </Card>

      <Link to="/orders" className="text-blue-600 hover:underline text-sm font-semibold">
        Back to My Orders
      </Link>
    </div>
  );
}
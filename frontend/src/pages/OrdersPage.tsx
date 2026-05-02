import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/apiClient';
import { Alert, Button, Card } from '@/components/UI';
import * as t from '@/types';

export function OrdersPage() {
  const ORDERS_PER_PAGE = 6;
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isGuest } = useAuth();
  const [accountInfo, setAccountInfo] = useState<{ masked_email: string } | null>(null);
  const [orders, setOrders] = useState<t.Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [latestStatuses, setLatestStatuses] = useState<Record<string, string>>({});
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [isStatusFilterTouched, setIsStatusFilterTouched] = useState(false);
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [refundOrder, setRefundOrder] = useState<t.Order | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [refundSuccess, setRefundSuccess] = useState<t.RefundRequest | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const formatCreatedAt = (value: string): string =>
    new Date(value).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getOrderStatus = (order: t.Order): string => latestStatuses[order.order_id] || order.status;

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    orders.forEach((order) => {
      statuses.add(getOrderStatus(order));
    });
    return Array.from(statuses).sort((a, b) => a.localeCompare(b));
  }, [orders, latestStatuses]);

  useEffect(() => {
    if (!isStatusFilterTouched) {
      setSelectedStatuses(statusOptions);
    }
  }, [statusOptions, isStatusFilterTouched]);

  useEffect(() => {
    setDateFromFilter('');
    setDateToFilter('');
    setIsStatusFilterTouched(false);
    setSelectedStatuses(statusOptions);
  }, [location.key]);

  const toggleStatus = (status: string) => {
    setIsStatusFilterTouched(true);
    setSelectedStatuses((current) => {
      if (current.includes(status)) {
        return current.filter((item) => item !== status);
      }
      return [...current, status];
    });
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const status = getOrderStatus(order);
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(status)) {
        return false;
      }

      const created = new Date(order.created_at);

      if (dateFromFilter) {
        const from = new Date(dateFromFilter);
        if (created < from) {
          return false;
        }
      }

      if (dateToFilter) {
        const to = new Date(dateToFilter);
        to.setHours(23, 59, 59, 999);
        if (created > to) {
          return false;
        }
      }

      return true;
    });
  }, [orders, selectedStatuses, dateFromFilter, dateToFilter]);

  const totalPages = Math.max(1, Math.ceil(ordersTotal / ORDERS_PER_PAGE));
  const pageStart = (currentPage - 1) * ORDERS_PER_PAGE;

  useEffect(() => {
    const loadData = async () => {
      try {
        setError('');
        if (isGuest) {
          setAccountInfo({ masked_email: user?.email || 'Guest user' });
          setOrders([]);
          setOrdersTotal(0);
          setLatestStatuses({});
          setCurrentPage(1);
        } else {
          const offset = (currentPage - 1) * ORDERS_PER_PAGE;
          const [accData, ordersPage] = await Promise.all([
            apiClient.getAccountMe(),
            apiClient.getUserOrders({ limit: ORDERS_PER_PAGE, offset }),
          ]);
          setAccountInfo({ masked_email: accData.email_masked || 'Unknown account' });
          setOrders(ordersPage.items);
          setOrdersTotal(ordersPage.total);

          const statusEntries = await Promise.all(
            ordersPage.items.map(async (order) => {
              const timeline = await apiClient.getOrderTimeline(order.order_id);
              return [order.order_id, timeline.current_status] as const;
            })
          );
          setLatestStatuses(Object.fromEntries(statusEntries));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isGuest, user?.email, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatuses, dateFromFilter, dateToFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (isGuest) {
      return;
    }

    let isMounted = true;

    const handleOrderNotifications = (event: Event) => {
      const customEvent = event as CustomEvent<t.LiveNotification[]>;
      const notifications = Array.isArray(customEvent.detail) ? customEvent.detail : [];
      const updatedOrderIds = new Set(
        notifications
          .map((notification) => notification.order_id)
          .filter((orderId): orderId is string => Boolean(orderId))
      );

      if (updatedOrderIds.size === 0) {
        return;
      }

      void (async () => {
        try {
          const pageOffset = (currentPage - 1) * ORDERS_PER_PAGE;
          const freshOrders = await apiClient.getUserOrders({
            limit: ORDERS_PER_PAGE,
            offset: pageOffset,
            forceRefresh: true,
          });
          if (!isMounted) {
            return;
          }

          setOrders(freshOrders.items);
          setOrdersTotal(freshOrders.total);

          const statusEntries = await Promise.all(
            freshOrders.items.map(async (order) => {
              const timeline = await apiClient.getOrderTimeline(order.order_id, {
                forceRefresh: updatedOrderIds.has(order.order_id),
              });
              return [order.order_id, timeline.current_status] as const;
            })
          );

          if (!isMounted) {
            return;
          }

          setLatestStatuses(Object.fromEntries(statusEntries));
        } catch (err) {
          console.error('[orders] failed to refresh after notification', err);
        }
      })();
    };

    window.addEventListener('order-notifications-received', handleOrderNotifications as EventListener);

    return () => {
      isMounted = false;
      window.removeEventListener('order-notifications-received', handleOrderNotifications as EventListener);
    };
  }, [isGuest, currentPage]);

  const openRefundDialog = (order: t.Order) => {
    setRefundOrder(order);
    setRefundReason('');
    setRefundError('');
    setRefundSuccess(null);
  };

  const closeRefundDialog = () => {
    setRefundOrder(null);
    setRefundReason('');
    setRefundError('');
    setRefundSuccess(null);
  };

  const handleSubmitRefund = async () => {
    if (!refundOrder || !refundReason) {
      return;
    }

    setRefundLoading(true);
    setRefundError('');

    try {
      const idempotencyKey = `refund_${refundOrder.order_id}_${refundReason}_${Date.now()}`;
      const result = await apiClient.createRefundRequest(
        refundOrder.order_id,
        refundReason,
        idempotencyKey
      );
      setRefundSuccess(result.refund_request);
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : 'Failed to submit refund request');
    } finally {
      setRefundLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading orders...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      <Card>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">My Orders</h2>
        <p className="text-sm text-gray-600 mb-2">Account: {accountInfo?.masked_email}</p>

        <div className="grid gap-4 md:grid-cols-4 mb-4 rounded-xl border border-gray-200 p-4 bg-gray-50">
          <div className="md:col-span-2">
            <p className="block text-xs font-semibold text-gray-600 mb-2">Statuses</p>
            <div className="flex flex-wrap gap-3">
              {statusOptions.map((status) => (
                <label key={status} className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={() => toggleStatus(status)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span>{status}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">Choose one or more statuses to display.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Created from (date)</label>
            <input
              type="date"
              value={dateFromFilter}
              onChange={(event) => setDateFromFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Created to (date)</label>
            <input
              type="date"
              value={dateToFilter}
              onChange={(event) => setDateToFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setIsStatusFilterTouched(false);
                setSelectedStatuses(statusOptions);
                setDateFromFilter('');
                setDateToFilter('');
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <p className="text-gray-500">No orders found</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <p>
                Showing {filteredOrders.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + filteredOrders.length, ordersTotal)} of {ordersTotal} orders
              </p>
              <p>
                Page {currentPage} / {totalPages}
              </p>
            </div>

            <div className="space-y-3">
            {filteredOrders.map((order) => (
              <div
                key={order.order_id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition"
              >
                <div className="flex justify-between items-start mb-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${order.order_id}`)}
                    className="text-left"
                  >
                    <p className="font-semibold text-gray-900">{order.order_id}</p>
                    <p className="text-sm text-gray-500">
                      Latest timeline status: {getOrderStatus(order)}
                    </p>
                  </button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openRefundDialog(order)}>
                      Refund
                    </Button>
                    <Button size="sm" onClick={() => navigate(`/orders/${order.order_id}`)} variant="outline">
                      View Order
                    </Button>
                    <Button size="sm" onClick={() => navigate(`/orders/${order.order_id}/timeline`)}>
                      View Timeline
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Created: {formatCreatedAt(order.created_at)}
                </p>
              </div>
            ))}
            </div>

            <div className="flex items-center justify-start gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {refundOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <Card className="w-full max-w-lg space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Request a refund</h3>
                <p className="text-sm text-gray-600">Order: {refundOrder.order_id}</p>
              </div>
              <Button variant="outline" size="sm" onClick={closeRefundDialog}>
                Close
              </Button>
            </div>

            {refundError && <Alert type="error" message={refundError} onClose={() => setRefundError('')} />}

            {refundSuccess ? (
              <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="font-semibold text-green-900">Refund request submitted</p>
                <p className="text-sm text-green-800">Request ID: {refundSuccess.refund_request_id}</p>
                <p className="text-sm text-green-800">
                  Your request was submitted successfully. You can track progress and view details in Refund History.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" onClick={() => navigate('/refunds')}>
                    Go to Refund History
                  </Button>
                  <Button variant="outline" onClick={closeRefundDialog}>
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Reason for refund</label>
                  <select
                    value={refundReason}
                    onChange={(event) => setRefundReason(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select a reason...</option>
                    <option value="missing_item">Missing item</option>
                    <option value="wrong_item">Wrong item</option>
                    <option value="late_delivery">Late delivery</option>
                    <option value="quality_issue">Quality issue</option>
                    <option value="fraud">Fraud / suspicious activity</option>
                    <option value="abuse">Abuse / policy violation</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={closeRefundDialog}>
                    Cancel
                  </Button>
                  <Button onClick={() => void handleSubmitRefund()} disabled={!refundReason || refundLoading}>
                    {refundLoading ? 'Submitting...' : 'Submit refund request'}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
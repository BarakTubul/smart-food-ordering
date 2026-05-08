import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/apiClient';
import { Button, Card, Alert } from '@/components/UI';
import {
  formatRefundDecisionLabel,
  formatRefundEligibilitySummary,
  formatRefundStatusLabel,
} from '@/lib/refundCopy';
import * as t from '@/types';

export function RefundPage() {
  const { isGuest } = useAuth();
  const [orders, setOrders] = useState<t.Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [eligibility, setEligibility] = useState<t.RefundEligibilityResponse | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [refundRequest, setRefundRequest] = useState<t.RefundRequest | null>(null);
  const [orderState, setOrderState] = useState<t.OrderStateSim | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'select' | 'check' | 'done'>('select');
  const [error, setError] = useState('');

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const data = await apiClient.getUserOrders();
        setOrders(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      }
    };

    if (!isGuest) {
      loadOrders();
    }
  }, [isGuest]);

  const handleCheckEligibility = async () => {
    if (!selectedOrderId) return;

    setLoading(true);
    setError('');
    try {
      const [eligible, state] = await Promise.all([
        apiClient.checkRefundEligibility(selectedOrderId),
        apiClient.getOrderStateSim(selectedOrderId),
      ]);
      setEligibility(eligible);
      setOrderState(state);
      setStep('check');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check eligibility');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRefund = async () => {
    if (!selectedOrderId || !reasonCode) return;

    setLoading(true);
    setError('');
    try {
      const idempotencyKey = `${selectedOrderId}_${reasonCode}_${Date.now()}`;
      const { refund_request } = await apiClient.createRefundRequest(
        selectedOrderId,
        reasonCode,
        idempotencyKey
      );
      setRefundRequest(refund_request);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create refund request');
    } finally {
      setLoading(false);
    }
  };

  if (isGuest) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card className="bg-orange-50 border-2 border-orange-300">
          <h2 className="text-2xl font-bold text-orange-900 mb-2">Guest Limitation</h2>
          <p className="text-orange-700">
            Refund requests are only available for registered users. Please create an account to access this feature.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      {step === 'select' && (
        <Card>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Request a Refund</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Select Order
              </label>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Choose an order...</option>
                {orders.map((order) => (
                  <option key={order.order_id} value={order.order_id}>
                    {order.order_id} - {order.status_label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={handleCheckEligibility}
              disabled={!selectedOrderId || loading}
              className="w-full"
            >
              {loading ? 'Checking...' : 'Check Eligibility'}
            </Button>
          </div>
        </Card>
      )}

      {step === 'check' && eligibility && orderState && (
        <div className="space-y-4">
          <Card className={eligibility.eligible ? 'bg-green-50' : 'bg-red-50'}>
            <h2 className="text-2xl font-bold mb-4">
              {eligibility.eligible ? '✓ Refund can be requested' : '✗ Refund cannot be requested now'}
            </h2>
            <p className="text-gray-700 mb-3">
              {formatRefundEligibilitySummary(
                eligibility.eligible,
                eligibility.reason,
                eligibility.decision_reason_codes
              )}
            </p>
            {eligibility.decision_reason_codes.length > 0 && (
              <div>
                <p className="font-semibold text-gray-700 mb-2">Why we reached this result:</p>
                <ul className="list-disc pl-5 space-y-1">
                  {eligibility.decision_reason_codes.map((code) => (
                    <li key={code} className="text-gray-600">
                      {formatRefundDecisionLabel(code)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card className="bg-blue-50">
            <h3 className="font-bold text-gray-900 mb-3">Order State</h3>
            <div className="space-y-2 text-sm">
              <p><span className="font-semibold">Fulfillment:</span> {orderState.fulfillment_state}</p>
              <p><span className="font-semibold">Payment:</span> {orderState.payment_state}</p>
            </div>
          </Card>

          {eligibility.eligible && (
            <Card>
              <h3 className="font-bold text-gray-900 mb-4">Refund Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Tell us what went wrong
                  </label>
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                    className="w-full border border-gray-300 rounded-md p-2"
                  >
                    <option value="">Select a reason...</option>
                    <option value="item_defective">Item was defective</option>
                    <option value="not_as_described">Item was not as described</option>
                    <option value="customer_requested">I changed my mind</option>
                    <option value="damaged_in_shipping">Item was damaged during shipping</option>
                  </select>
                </div>
                <Button
                  onClick={handleCreateRefund}
                  disabled={!reasonCode || loading}
                  className="w-full"
                  variant="secondary"
                >
                  {loading ? 'Creating...' : 'Submit Refund Request'}
                </Button>
                <Button
                  onClick={() => {
                    setStep('select');
                    setEligibility(null);
                    setOrderState(null);
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Back
                </Button>
              </div>
            </Card>
          )}

          {!eligibility.eligible && (
            <Button
              onClick={() => {
                setStep('select');
                setEligibility(null);
                setOrderState(null);
              }}
              variant="outline"
              className="w-full"
            >
              Try Another Order
            </Button>
          )}
        </div>
      )}

      {step === 'done' && refundRequest && (
        <Card className="bg-green-50">
          <h2 className="text-2xl font-bold text-green-900 mb-4">✓ Refund Request Submitted</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-semibold text-gray-700">Request ID:</p>
              <p className="text-gray-900 font-mono bg-white p-2 rounded border">{refundRequest.refund_request_id}</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700">Status:</p>
              <p className="text-gray-900">{formatRefundStatusLabel(refundRequest.status)}</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700">Submitted:</p>
              <p className="text-gray-900">{new Date(refundRequest.created_at).toLocaleString()}</p>
            </div>
          </div>
          <Button
            onClick={() => {
              setStep('select');
              setRefundRequest(null);
              setReasonCode('');
              setSelectedOrderId('');
            }}
            className="mt-4 w-full"
          >
            Submit Another Request
          </Button>
        </Card>
      )}
    </div>
  );
}

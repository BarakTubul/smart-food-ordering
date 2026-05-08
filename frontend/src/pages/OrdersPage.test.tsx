import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { OrdersPage } from '@/pages/OrdersPage';
import { apiClient } from '@/services/apiClient';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'user@example.com' },
    isGuest: false,
  }),
}));

describe('OrdersPage refund access', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disables refund until order is delivered', async () => {
    vi.spyOn(apiClient, 'getAccountMe').mockResolvedValue({
      user_id: 1,
      email_masked: 'u***r@example.com',
      account_status: 'verified_active',
      is_admin: false,
      demo_card_last4: '1234',
    });
    vi.spyOn(apiClient, 'getUserOrders').mockResolvedValue({
      items: [
        {
          order_id: 'ord-1',
          user_id: '1',
          status: 'confirmed',
          status_label: 'Confirmed',
          ordered_items_summary: '1x Burger',
          total_cents: 1200,
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
      limit: 6,
      offset: 0,
    });
    vi.spyOn(apiClient, 'getOrderTimeline').mockResolvedValue({
      order_id: 'ord-1',
      current_status: 'arriving',
      timeline: [],
    });

    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    const refundButton = await screen.findByRole('button', { name: 'Refund' });
    await waitFor(() => {
      expect(refundButton).toBeDisabled();
    });
  });

  it('enables refund after delivery', async () => {
    vi.spyOn(apiClient, 'getAccountMe').mockResolvedValue({
      user_id: 1,
      email_masked: 'u***r@example.com',
      account_status: 'verified_active',
      is_admin: false,
      demo_card_last4: '1234',
    });
    vi.spyOn(apiClient, 'getUserOrders').mockResolvedValue({
      items: [
        {
          order_id: 'ord-2',
          user_id: '1',
          status: 'confirmed',
          status_label: 'Confirmed',
          ordered_items_summary: '1x Pizza',
          total_cents: 2200,
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
      limit: 6,
      offset: 0,
    });
    vi.spyOn(apiClient, 'getOrderTimeline').mockResolvedValue({
      order_id: 'ord-2',
      current_status: 'delivered',
      timeline: [],
    });

    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    const refundButton = await screen.findByRole('button', { name: 'Refund' });
    await waitFor(() => {
      expect(refundButton).toBeEnabled();
    });
  });
});

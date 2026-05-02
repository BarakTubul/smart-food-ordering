import axios, { AxiosInstance } from 'axios';
import * as t from '@/types';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').trim();
const API_PREFIX = (import.meta.env.VITE_API_PREFIX || '/api/v1').trim();
const hasVersionedPrefix = /\/api\/v\d+\/?$/.test(API_ORIGIN);
const API_BASE_URL = hasVersionedPrefix
  ? API_ORIGIN.replace(/\/+$/, '')
  : `${API_ORIGIN.replace(/\/+$/, '')}/${API_PREFIX.replace(/^\/+/, '')}`;

function stringifyErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg: unknown }).msg);
        }
        return JSON.stringify(item);
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail);
  }
  return '';
}

function formatAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Unexpected client error';
  }

  const status = error.response?.status;
  const data = error.response?.data as
    | {
        detail?: unknown;
        message?: unknown;
        error?: {
          message?: unknown;
          details?: unknown;
        };
      }
    | undefined;
  const detailMessage = stringifyErrorDetail(
    data?.detail ?? data?.message ?? data?.error?.message ?? data?.error?.details
  );

  if (status && status >= 400 && status < 500) {
    return detailMessage
      ? `Client error (${status}): ${detailMessage}`
      : `Client error (${status}): Please verify your input and try again.`;
  }

  if (status && status >= 500) {
    return detailMessage
      ? `Server error (${status}): ${detailMessage}`
      : `Server error (${status}): Please try again later.`;
  }

  return detailMessage || error.message || 'Request failed';
}

class APIClient {
  private static readonly ACCOUNT_CACHE_TTL_MS = 60_000;
  private static readonly ORDERS_CACHE_TTL_MS = 30_000;
  private static readonly REFUNDS_CACHE_TTL_MS = 20_000;

  private client: AxiosInstance;
  private accessToken: string | null;
  private unauthorizedHandlers: Array<() => void> = [];
  private orderTimelineCache = new Map<string, t.OrderTimeline>();
  private orderTimelineInFlight = new Map<string, Promise<t.OrderTimeline>>();
  private accountCache: { value: t.AccountMeResponse; expiresAt: number } | null = null;
  private accountInFlight: Promise<t.AccountMeResponse> | null = null;
  private ordersCache = new Map<string, { value: t.OrderListResponse; expiresAt: number }>();
  private ordersInFlight = new Map<string, Promise<t.OrderListResponse>>();
  private refundsCache = new Map<string, { value: t.RefundRequestListResponse; expiresAt: number }>();
  private refundsInFlight = new Map<string, Promise<t.RefundRequestListResponse>>();

  constructor() {
    this.accessToken = sessionStorage.getItem('access_token');
    this.client = axios.create({
      baseURL: API_BASE_URL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      const method = (config.method || 'GET').toUpperCase();

      if (this.accessToken) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }

      console.debug(`[api] request ${method} ${config.baseURL || ''}${config.url || ''}`, {
        withCredentials: config.withCredentials ?? false,
      });
      return config;
    });

    this.client.interceptors.response.use(
      (response) => {
        const method = (response.config.method || 'GET').toUpperCase();
        console.debug(
          `[api] response ${response.status} ${method} ${response.config.url || ''}`
        );
        return response;
      },
      (error) => {
        const formatted = formatAxiosError(error);
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 401 && this.accessToken) {
            this.setAccessToken(null);
            this.clearCachedDomainData();
            this.unauthorizedHandlers.forEach((handler) => handler());
          }
          console.error('[api] axios error', {
            message: error.message,
            method: (error.config?.method || 'GET').toUpperCase(),
            url: `${error.config?.baseURL || ''}${error.config?.url || ''}`,
            status: error.response?.status,
            response: error.response?.data,
            formatted,
          });
        } else {
          console.error('[api] unexpected client error', error);
        }
        return Promise.reject(new Error(formatted));
      }
    );
  }

  private setAccessToken(token: string | null): void {
    const previousToken = this.accessToken;
    this.accessToken = token;

    if (previousToken !== token) {
      this.clearCachedDomainData();
    }

    if (token) {
      sessionStorage.setItem('access_token', token);
      return;
    }
    sessionStorage.removeItem('access_token');
  }

  private clearCachedDomainData(): void {
    this.accountCache = null;
    this.accountInFlight = null;
    this.ordersCache.clear();
    this.ordersInFlight.clear();
    this.refundsCache.clear();
    this.refundsInFlight.clear();
    this.orderTimelineCache.clear();
    this.orderTimelineInFlight.clear();
  }

  private static isFresh(expiresAt: number): boolean {
    return expiresAt > Date.now();
  }

  private invalidateAccountCache(): void {
    this.accountCache = null;
    this.accountInFlight = null;
  }

  private invalidateOrdersCacheInternal(): void {
    this.ordersCache.clear();
    this.ordersInFlight.clear();
    this.orderTimelineCache.clear();
    this.orderTimelineInFlight.clear();
  }

  private invalidateRefundsCache(): void {
    this.refundsCache.clear();
    this.refundsInFlight.clear();
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  onUnauthorized(handler: () => void): () => void {
    this.unauthorizedHandlers.push(handler);
    return () => {
      this.unauthorizedHandlers = this.unauthorizedHandlers.filter((item) => item !== handler);
    };
  }

  // Auth endpoints
  async guestAccess(email: string): Promise<t.AuthTokenResponse> {
    const response = await this.client.post<t.AuthTokenResponse>('/auth/guest', { email });
    this.setAccessToken(response.data.access_token);
    return response.data;
  }

  async register(
    email: string,
    password: string,
    profile: { fullName: string; dateOfBirth: string; address: string }
  ): Promise<t.AuthTokenResponse> {
    const response = await this.client.post<t.AuthTokenResponse>('/auth/register', {
      email,
      password,
      full_name: profile.fullName,
      date_of_birth: profile.dateOfBirth,
      address: profile.address,
    });
    this.setAccessToken(response.data.access_token);
    return response.data;
  }

  async login(email: string, password: string): Promise<t.AuthTokenResponse> {
    const response = await this.client.post<t.AuthTokenResponse>('/auth/login', {
      email,
      password,
    });
    this.setAccessToken(response.data.access_token);
    return response.data;
  }

  async convertGuestToRegistered(password: string): Promise<t.AuthTokenResponse> {
    const response = await this.client.post<t.AuthTokenResponse>('/auth/guest/convert', {
      password,
    });
    this.setAccessToken(response.data.access_token);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.client.post('/auth/logout');
    this.setAccessToken(null);
    this.clearCachedDomainData();
  }

  // Account endpoints
  async getSessionState(): Promise<t.SessionState> {
    const response = await this.client.get<t.SessionState>('/auth/session');
    return response.data;
  }

  async getAccountMe(): Promise<t.AccountMeResponse> {
    if (this.accountCache && APIClient.isFresh(this.accountCache.expiresAt)) {
      return this.accountCache.value;
    }

    if (this.accountInFlight) {
      return this.accountInFlight;
    }

    const request = this.client
      .get<t.AccountMeResponse>('/account/me')
      .then((response) => {
        const value = response.data;
        this.accountCache = {
          value,
          expiresAt: Date.now() + APIClient.ACCOUNT_CACHE_TTL_MS,
        };
        return value;
      })
      .finally(() => {
        this.accountInFlight = null;
      });

    this.accountInFlight = request;
    return request;
  }

  async revealDemoCard(password: string): Promise<t.DemoCardRevealResponse> {
    const response = await this.client.post<t.DemoCardRevealResponse>('/account/demo-card/reveal', {
      password,
    });
    this.invalidateAccountCache();
    return response.data;
  }

  // Order endpoints
  async getUserOrders(
    params: { limit?: number; offset?: number; forceRefresh?: boolean } = {}
  ): Promise<t.OrderListResponse> {
    const cacheKey = JSON.stringify({
      limit: params.limit ?? null,
      offset: params.offset ?? null,
    });

    const cached = this.ordersCache.get(cacheKey);
    if (!params.forceRefresh && cached && APIClient.isFresh(cached.expiresAt)) {
      return cached.value;
    }

    const inFlight = this.ordersInFlight.get(cacheKey);
    if (!params.forceRefresh && inFlight) {
      return inFlight;
    }

    const request = this.client
      .get<t.OrderListResponse>('/orders', {
        params: {
          limit: params.limit,
          offset: params.offset,
        },
      })
      .then((response) => {
        const value = response.data;
        this.ordersCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + APIClient.ORDERS_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        this.ordersInFlight.delete(cacheKey);
      });

    this.ordersInFlight.set(cacheKey, request);
    return request;
  }

  async getOrderDetail(orderId: string): Promise<t.Order> {
    const response = await this.client.get<t.Order>(`/orders/${orderId}`);
    return response.data;
  }

  async getOrderTimeline(orderId: string, options: { forceRefresh?: boolean } = {}): Promise<t.OrderTimeline> {
    if (!options.forceRefresh) {
      const cachedTimeline = this.orderTimelineCache.get(orderId);
      if (cachedTimeline) {
        return cachedTimeline;
      }

      const inFlightTimeline = this.orderTimelineInFlight.get(orderId);
      if (inFlightTimeline) {
        return inFlightTimeline;
      }
    }

    const request = this.client
      .get<{
        order_id: string;
        scenario_id: string;
        is_delayed?: boolean;
        issue_code?: string | null;
        ordered_items_summary?: string | null;
        received_items_summary?: string | null;
        eta_from?: string | null;
        eta_to?: string | null;
        events: Array<{ event: string; timestamp: string; source: string }>;
      }>(`/orders/${orderId}/timeline-sim`)
      .then((response) => {
        const filteredEvents = response.data.events.filter((event) => event.event !== 'status_snapshot');

        const timeline: t.OrderTimeline = {
          order_id: response.data.order_id,
          scenario_id: response.data.scenario_id,
          is_delayed: response.data.is_delayed,
          issue_code: response.data.issue_code,
          ordered_items_summary: response.data.ordered_items_summary,
          received_items_summary: response.data.received_items_summary,
          eta_from: response.data.eta_from,
          eta_to: response.data.eta_to,
          current_status:
            filteredEvents.length > 0
              ? filteredEvents[filteredEvents.length - 1].event
              : 'unknown',
          timeline: filteredEvents.map((event) => ({
            date: new Date(event.timestamp).toLocaleString(),
            event: event.event,
          })),
        };

        this.orderTimelineCache.set(orderId, timeline);
        return timeline;
      })
      .finally(() => {
        this.orderTimelineInFlight.delete(orderId);
      });

    this.orderTimelineInFlight.set(orderId, request);
    return request;
  }

  invalidateOrderTimeline(orderId: string): void {
    this.orderTimelineCache.delete(orderId);
  }

  invalidateOrderSnapshots(orderIds?: string[]): void {
    this.ordersCache.clear();
    this.ordersInFlight.clear();

    if (!orderIds || orderIds.length === 0) {
      this.orderTimelineCache.clear();
      this.orderTimelineInFlight.clear();
      return;
    }

    orderIds.forEach((orderId) => {
      this.orderTimelineCache.delete(orderId);
      this.orderTimelineInFlight.delete(orderId);
    });
  }

  // Intent & FAQ endpoints
  async resolveIntent(
    messageText: string,
    sessionId: string,
    messageId: string
  ): Promise<t.IntentResolveResponse> {
    const response = await this.client.post<t.IntentResolveResponse>('/intent/resolve', {
      session_id: sessionId,
      message_id: messageId,
      message_text: messageText,
      locale: 'en-US',
    });
    return response.data;
  }

  async searchFAQ(queryText: string, sessionId: string, intent: string): Promise<t.FAQSearchResponse> {
    const response = await this.client.post<t.FAQSearchResponse>('/faq/search', {
      session_id: sessionId,
      query_text: queryText,
      intent,
      locale: 'en-US',
    });
    return response.data;
  }

  // Support endpoints
  async createSupportConversation(
    payload: t.SupportConversationCreateRequest
  ): Promise<t.SupportConversationResponse> {
    const response = await this.client.post<t.SupportConversationResponse>('/support/conversations', {
      source_session_id: payload.source_session_id || undefined,
      escalation_reason_code: payload.escalation_reason_code || undefined,
      escalation_reference_id: payload.escalation_reference_id || undefined,
      priority: payload.priority || 'normal',
    });
    return response.data;
  }

  async getSupportConversation(conversationId: string): Promise<t.SupportConversationResponse> {
    const response = await this.client.get<t.SupportConversationResponse>(
      `/support/conversations/${conversationId}`
    );
    return response.data;
  }

  async listSupportMessages(
    conversationId: string,
    limit = 50,
    beforeMessageId?: string
  ): Promise<t.SupportMessageListResponse> {
    const response = await this.client.get<t.SupportMessageListResponse>(
      `/support/conversations/${conversationId}/messages`,
      { params: { limit, before_message_id: beforeMessageId || undefined } }
    );
    return response.data;
  }

  async sendSupportMessage(
    conversationId: string,
    body: string
  ): Promise<t.SupportMessageResponse> {
    const response = await this.client.post<t.SupportMessageResponse>(
      `/support/conversations/${conversationId}/messages`,
      { body }
    );
    return response.data;
  }

  async listSupportQueue(limit = 50): Promise<t.SupportConversationListResponse> {
    const response = await this.client.get<t.SupportConversationListResponse>(
      '/admin/support/conversations/queue',
      { params: { limit } }
    );
    return response.data;
  }

  async listAssignedSupportConversations(limit = 50): Promise<t.SupportConversationListResponse> {
    const response = await this.client.get<t.SupportConversationListResponse>(
      '/admin/support/conversations/assigned',
      { params: { limit } }
    );
    return response.data;
  }

  async claimSupportConversation(conversationId: string): Promise<t.SupportConversationResponse> {
    const response = await this.client.post<t.SupportConversationResponse>(
      `/admin/support/conversations/${conversationId}/claim`
    );
    return response.data;
  }

  async releaseSupportConversation(conversationId: string): Promise<t.SupportConversationResponse> {
    const response = await this.client.post<t.SupportConversationResponse>(
      `/admin/support/conversations/${conversationId}/release`
    );
    return response.data;
  }

  async closeSupportConversation(conversationId: string): Promise<t.SupportConversationResponse> {
    const response = await this.client.post<t.SupportConversationResponse>(
      `/admin/support/conversations/${conversationId}/close`
    );
    return response.data;
  }

  async updateSupportConversationPriority(
    conversationId: string,
    priority: 'normal' | 'high'
  ): Promise<t.SupportConversationResponse> {
    const response = await this.client.patch<t.SupportConversationResponse>(
      `/admin/support/conversations/${conversationId}/priority`,
      { priority }
    );
    return response.data;
  }

  async markSupportConversationRead(conversationId: string): Promise<t.SupportConversationResponse> {
    const response = await this.client.post<t.SupportConversationResponse>(
      `/admin/support/conversations/${conversationId}/read`
    );
    return response.data;
  }

  async listAdminSupportConversations(params: {
    limit?: number;
    priority?: 'normal' | 'high' | 'all';
    unreadOnly?: boolean;
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
  }): Promise<t.SupportConversationListResponse> {
    const response = await this.client.get<t.SupportConversationListResponse>(
      '/admin/support/conversations/all',
      {
        params: {
          limit: params.limit || 100,
          priority: params.priority && params.priority !== 'all' ? params.priority : undefined,
          unread_only: params.unreadOnly || undefined,
          created_after: params.createdAfter || undefined,
          created_before: params.createdBefore || undefined,
          updated_after: params.updatedAfter || undefined,
          updated_before: params.updatedBefore || undefined,
        },
      }
    );
    return response.data;
  }

  async getConversationContext(sessionId: string): Promise<t.ConversationMessage[]> {
    const response = await this.client.get<t.ConversationMessage[]>(
      `/conversations/${sessionId}/context`
    );
    return response.data;
  }

  async getLiveNotifications(): Promise<t.LiveNotification[]> {
    const response = await this.client.get<t.LiveNotification[]>('/notifications/live');
    return response.data;
  }

  // Refund endpoints
  async checkRefundEligibility(orderId: string): Promise<t.RefundEligibilityResponse> {
    const response = await this.client.post<t.RefundEligibilityResponse>(
      '/refunds/eligibility/check',
      { order_id: orderId }
    );
    return response.data;
  }

  async createRefundRequest(
    orderId: string,
    reasonCode: string,
    idempotencyKey?: string
  ): Promise<{ refund_request: t.RefundRequest; status_code: number }> {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    const response = await this.client.post<t.RefundRequest>(
      '/refunds/requests',
      {
        order_id: orderId,
        reason_code: reasonCode,
      },
      { headers }
    );
    this.invalidateRefundsCache();
    return {
      refund_request: response.data,
      status_code: response.status,
    };
  }

  async getRefundRequest(refundRequestId: string): Promise<t.RefundRequest> {
    const response = await this.client.get<t.RefundRequest>(
      `/refunds/requests/${refundRequestId}`
    );
    return response.data;
  }

  async listUserRefundRequests(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    query?: string;
  }): Promise<t.RefundRequestListResponse> {
    const cacheKey = JSON.stringify({
      limit: params?.limit ?? null,
      offset: params?.offset ?? null,
      status: params?.status ?? null,
      query: params?.query ?? null,
    });

    const cached = this.refundsCache.get(cacheKey);
    if (cached && APIClient.isFresh(cached.expiresAt)) {
      return cached.value;
    }

    const inFlight = this.refundsInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this.client.get<t.RefundRequestListResponse>('/refunds/requests', {
      params: {
        limit: params?.limit,
        offset: params?.offset,
        status: params?.status,
        q: params?.query,
      },
    })
      .then((response) => {
        const value = response.data;
        this.refundsCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + APIClient.REFUNDS_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        this.refundsInFlight.delete(cacheKey);
      });

    this.refundsInFlight.set(cacheKey, request);
    return request;
  }

  async getOrderStateSim(
    orderId: string,
    options?: { reasonCode?: string; scenarioId?: string }
  ): Promise<t.OrderStateSim> {
    const response = await this.client.get<t.OrderStateSim>(`/orders/${orderId}/state-sim`, {
      params: {
        reason_code: options?.reasonCode || undefined,
        scenario_id: options?.scenarioId || undefined,
      },
    });
    return response.data;
  }

  async listManualReviewQueue(limit = 50): Promise<t.ManualReviewQueueResponse> {
    const response = await this.client.get<t.ManualReviewQueueResponse>(
      '/admin/refunds/manual-review/queue',
      { params: { limit } }
    );
    return response.data;
  }

  async claimManualReviewRequest(refundRequestId: string): Promise<t.RefundRequest> {
    const response = await this.client.post<t.RefundRequest>(
      `/admin/refunds/requests/${refundRequestId}/claim`
    );
    this.invalidateRefundsCache();
    return response.data;
  }

  async decideManualReviewRequest(
    refundRequestId: string,
    decision: 'resolved' | 'rejected',
    reviewerNote?: string
  ): Promise<t.RefundRequest> {
    const response = await this.client.post<t.RefundRequest>(
      `/admin/refunds/requests/${refundRequestId}/decision`,
      {
        decision,
        reviewer_note: reviewerNote || undefined,
      }
    );
    this.invalidateRefundsCache();
    return response.data;
  }

  // Order placement endpoints
  async getCatalogItems(params: t.CatalogQueryParams): Promise<t.CatalogListResponse> {
    const response = await this.client.get<t.CatalogListResponse>('/catalog/items', {
      params: {
        page: params.page,
        page_size: params.page_size,
        search: params.search || undefined,
        restaurant: params.restaurant || undefined,
        cuisine: params.cuisine || undefined,
        availability: params.availability || 'all',
        sort_by: params.sort_by || 'featured',
      },
    });
    return response.data;
  }

  async getCart(): Promise<t.CartResponse> {
    const response = await this.client.get<t.CartResponse>('/cart');
    return response.data;
  }

  async addCartItem(itemId: string, quantity = 1): Promise<t.CartResponse> {
    const response = await this.client.post<t.CartResponse>('/cart/items', {
      item_id: itemId,
      quantity,
    });
    return response.data;
  }

  async updateCartItem(itemId: string, quantity: number): Promise<t.CartResponse> {
    const response = await this.client.patch<t.CartResponse>(`/cart/items/${itemId}`, {
      quantity,
    });
    return response.data;
  }

  async removeCartItem(itemId: string): Promise<t.CartResponse> {
    const response = await this.client.delete<t.CartResponse>(`/cart/items/${itemId}`);
    return response.data;
  }

  async validateCheckout(payload: t.CheckoutValidateRequest): Promise<t.CheckoutValidateResponse> {
    const response = await this.client.post<t.CheckoutValidateResponse>('/checkout/validate', payload);
    return response.data;
  }

  async authorizePaymentSim(
    payload: t.PaymentAuthorizeSimRequest
  ): Promise<t.PaymentAuthorizeSimResponse> {
    const response = await this.client.post<t.PaymentAuthorizeSimResponse>(
      '/payments/authorize-sim',
      payload
    );
    return response.data;
  }

  async createOrder(
    payload: t.OrderCreateRequest,
    idempotencyKey?: string
  ): Promise<t.OrderCreateResponse> {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    const response = await this.client.post<t.OrderCreateResponse>('/orders', payload, { headers });
    this.invalidateOrdersCacheInternal();
    return response.data;
  }

  async getOrderLifecycleSim(orderId: string, scenarioId = 'default') {
    const response = await this.client.get(`/orders/${orderId}/lifecycle-sim`, {
      params: { scenario_id: scenarioId },
    });
    return response.data;
  }
}

export const apiClient = new APIClient();

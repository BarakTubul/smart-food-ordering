// Type definitions for all API responses and requests

export interface User {
  user_id: string;
  email: string;
  is_guest: boolean;
  is_admin: boolean;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
}

export interface SessionState {
  authenticated: boolean;
  user_id: number;
  is_guest: boolean;
  is_admin: boolean;
  is_active: boolean;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  user_id?: number;
  guest_id?: number;
  is_guest: boolean;
}

export interface LiveNotification {
  notification_id: string;
  kind?: 'order' | 'refund' | 'support';
  order_id?: string | null;
  target_path?: string | null;
  status: string;
  title: string;
  message: string;
  created_at: string;
}

export interface AccountMeResponse {
  user_id: number;
  email_masked: string | null;
  full_name?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
  account_status: string;
  is_admin: boolean;
  demo_card_last4?: string | null;
  balance_cents?: number | null;
}

export interface DemoCardRevealResponse {
  demo_card_number: string;
}

export interface Order {
  order_id: string;
  user_id: string;
  status: string;
  status_label: string;
  ordered_items_summary?: string | null;
  total_cents?: number | null;
  created_at: string;
  eta_from?: string;
  eta_to?: string;
}

export interface OrderTimeline {
  order_id: string;
  scenario_id?: string;
  is_delayed?: boolean;
  issue_code?: string | null;
  ordered_items_summary?: string | null;
  received_items_summary?: string | null;
  eta_from?: string | null;
  eta_to?: string | null;
  current_status: string;
  timeline: Array<{
    date: string;
    event: string;
  }>;
}

export interface ConversationMessage {
  message_id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

export interface FAQCitation {
  chunk_id: string;
  source_id: string;
  snippet: string;
  score: number;
}

export interface IntentResolveResponse {
  intent: string;
  confidence: number;
  route: 'faq_answer' | 'clarify';
  requires_clarification: boolean;
  clarification_question?: string | null;
  trace_id: string;
}

export interface FAQSearchResponse {
  answer: {
    text: string;
    confidence: number;
    source_label: string;
    source_id: string;
    policy_version: string;
  };
  citations: FAQCitation[];
  retrieval_mode: string;
}

export interface SupportConversationCreateRequest {
  source_session_id?: string | null;
  escalation_reason_code?: string | null;
  escalation_reference_id?: string | null;
  priority?: 'normal' | 'high';
}

export interface SupportConversationResponse {
  conversation_id: string;
  customer_user_id: number;
  customer_email?: string | null;
  status: string;
  priority: string;
  assigned_admin_user_id: number | null;
  source_session_id: string | null;
  escalation_reason_code: string | null;
  escalation_reference_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_message_count?: number;
}

export interface SupportConversationListResponse {
  items: SupportConversationResponse[];
  total: number;
}

export interface SupportMessageCreateRequest {
  body: string;
}

export interface SupportMessageResponse {
  message_id: string;
  conversation_id: string;
  sender_user_id: number;
  sender_role: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface SupportMessageListResponse {
  items: SupportMessageResponse[];
  total: number;
}

export interface RefundEligibilityResponse {
  eligible: boolean;
  reason: string;
  decision_reason_codes: string[];
}

export interface RefundRequestListResponse {
  items: RefundRequest[];
  total: number;
  limit: number;
  offset: number;
  status_filter?: string | null;
  query?: string | null;
}

export interface RefundRequest {
  refund_request_id: string;
  order_id: string;
  status: string;
  status_reason?: string;
  reason_code: string;
  decision_reason_codes: string[];
  resolution_action?: string | null;
  policy_version?: string | null;
  refundable_amount_currency?: string | null;
  refundable_amount_value?: number | null;
  manual_review_handoff?: ManualReviewHandoff | null;
  idempotent_replay: boolean;
  created_at: string;
}

export interface ManualReviewHandoff {
  escalation_status: string;
  queue_name: string;
  sla_deadline_at: string;
  payload: Record<string, string | number | boolean>;
  claimed_by_admin_user_id?: number | null;
  claimed_at?: string | null;
  decided_by_admin_user_id?: number | null;
  decided_at?: string | null;
  reviewer_note?: string | null;
}

export interface ManualReviewQueueItem {
  refund_request_id: string;
  order_id: string;
  status: string;
  created_at: string;
  handoff: ManualReviewHandoff;
}

export interface ManualReviewQueueResponse {
  items: ManualReviewQueueItem[];
  total: number;
}

export interface OrderStateSim {
  order_id: string;
  simulation_scenario_id: string;
  fulfillment_state: string;
  payment_state: string;
  ordered_items_summary?: string | null;
  received_items_summary?: string | null;
  is_delayed: boolean;
  eta_to?: string | null;
  delivered_at?: string | null;
  state_timeline: Array<{
    date: string;
    event: string;
  }>;
}

export interface CatalogItem {
  item_id: string;
  restaurant_id: number;
  restaurant_name: string;
  restaurant_cuisine?: string | null;
  restaurant_rating?: number | null;
  restaurant_delivery_time?: string | null;
  restaurant_delivery_fee_cents?: number | null;
  name: string;
  description: string;
  image_url?: string | null;
  price_cents: number;
  currency: string;
  in_stock: boolean;
}

export interface CatalogListResponse {
  items: CatalogItem[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  restaurants: string[];
  cuisines: string[];
}

export interface CatalogQueryParams {
  page: number;
  page_size: number;
  search?: string;
  restaurant?: string;
  cuisine?: string;
  availability?: 'all' | 'available' | 'out_of_stock';
  sort_by?: 'featured' | 'name' | 'price_asc' | 'price_desc' | 'restaurant';
}

export interface CartLine {
  item_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  currency: string;
}

export interface CartResponse {
  user_id: number;
  items: CartLine[];
  subtotal_cents: number;
  currency: string;
}

export interface ShippingAddress {
  line1: string;
  city: string;
}

export interface CheckoutValidateRequest {
  shipping_address: ShippingAddress;
  delivery_option: 'standard' | 'express';
  payment_method_reference: string;
}

export interface CheckoutValidateResponse {
  valid: boolean;
  issues: string[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
}

export interface PaymentAuthorizeSimRequest {
  payment_method_reference: string;
  amount_cents: number;
  currency?: string;
}

export interface PaymentAuthorizeSimResponse {
  authorized: boolean;
  authorization_id?: string;
  reason?: string;
}

export interface OrderCreateRequest {
  shipping_address: ShippingAddress;
  delivery_option: 'standard' | 'express';
  payment_method_reference: string;
}

export interface OrderCreateResponse {
  order_id: string;
  status: string;
  status_label: string;
  total_cents: number;
  remaining_balance_cents: number;
  simulation_scenario_id?: string | null;
  currency: string;
  payment_authorization_id: string;
  idempotent_replay: boolean;
  created_at: string;
}

// Request types
export interface GuestAccessRequest {
  email: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface IntentResolveRequest {
  message: string;
  session_id: string;
}

export interface RefundCheckRequest {
  order_id: string;
}

export interface RefundCreateRequest {
  order_id: string;
  reason_code: string;
}

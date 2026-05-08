from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CatalogItemResponse(BaseModel):
    item_id: str
    restaurant_id: int
    restaurant_name: str
    restaurant_cuisine: str | None = None
    restaurant_rating: float | None = None
    restaurant_delivery_time: str | None = None
    restaurant_delivery_fee_cents: int | None = None
    name: str
    description: str
    image_url: str | None = None
    price_cents: int
    currency: str = "USD"
    in_stock: bool = True


class CatalogListResponse(BaseModel):
    items: list[CatalogItemResponse]
    page: int
    page_size: int
    total_items: int
    total_pages: int
    has_next: bool
    has_prev: bool
    restaurants: list[str]
    cuisines: list[str]


class CartItemMutationRequest(BaseModel):
    item_id: str
    quantity: int = Field(ge=1, le=20)


class CartItemQuantityUpdateRequest(BaseModel):
    quantity: int = Field(ge=0, le=20)


class CartLineResponse(BaseModel):
    item_id: str
    name: str
    quantity: int
    unit_price_cents: int
    line_total_cents: int
    currency: str = "USD"


class CartResponse(BaseModel):
    user_id: int
    items: list[CartLineResponse]
    subtotal_cents: int
    currency: str = "USD"


class ShippingAddressRequest(BaseModel):
    line1: str = Field(min_length=3, max_length=120)
    city: str = Field(min_length=2, max_length=80)


class CheckoutValidateRequest(BaseModel):
    shipping_address: ShippingAddressRequest
    payment_method_reference: str = Field(min_length=3, max_length=128)


class CheckoutValidateResponse(BaseModel):
    valid: bool
    issues: list[str]
    subtotal_cents: int
    delivery_fee_cents: int
    total_cents: int
    available_balance_cents: int | None = None
    currency: str = "USD"


class PaymentAuthorizeSimRequest(BaseModel):
    payment_method_reference: str = Field(min_length=3, max_length=128)
    amount_cents: int = Field(gt=0)
    currency: str = "USD"


class PaymentAuthorizeSimResponse(BaseModel):
    authorized: bool
    authorization_id: str | None = None
    reason: str | None = None


class OrderCreateRequest(BaseModel):
    shipping_address: ShippingAddressRequest
    delivery_option: str = Field(min_length=3, max_length=32)
    payment_method_reference: str = Field(min_length=3, max_length=128)
    simulation_scenario: str | None = Field(default=None, min_length=3, max_length=64)


class OrderCreateResponse(BaseModel):
    order_id: str
    status: str
    status_label: str
    total_cents: int
    simulation_scenario_id: str | None = None
    currency: str = "USD"
    payment_authorization_id: str
    remaining_balance_cents: int | None = None
    idempotent_replay: bool = False
    created_at: datetime


class OrderLifecycleEventResponse(BaseModel):
    timestamp: datetime
    event: str
    source: str = "simulation"


class OrderLifecycleSimResponse(BaseModel):
    order_id: str
    scenario_id: str
    is_delayed: bool = False
    issue_code: str | None = None
    ordered_items_summary: str | None = None
    received_items_summary: str | None = None
    events: list[OrderLifecycleEventResponse]

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


def _register_and_get_token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "secure-pass-123",
            "full_name": "Test User",
            "date_of_birth": "1990-01-01",
            "address": "123 Test Street",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def _reveal_demo_card(client: TestClient, token: str, password: str = "secure-pass-123") -> str:
    response = client.post(
        "/api/v1/account/demo-card/reveal",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": password},
    )
    assert response.status_code == 200
    return response.json()["demo_card_number"]


def _guest_and_get_token(client: TestClient) -> str:
    response = client.post("/api/v1/auth/guest", json={"email": "guest@example.com"})
    assert response.status_code == 201
    return response.json()["access_token"]


def _first_catalog_item_id(client: TestClient) -> str:
    response = client.get("/api/v1/catalog/items")
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"]
    return payload["items"][0]["item_id"]


def test_catalog_and_cart_for_guest_session(client: TestClient) -> None:
    guest_token = _guest_and_get_token(client)
    catalog_item_id = _first_catalog_item_id(client)

    catalog_response = client.get("/api/v1/catalog/items")
    assert catalog_response.status_code == 200
    assert len(catalog_response.json()["items"]) > 0
    assert len(catalog_response.json()["cuisines"]) > 0

    first_cuisine = catalog_response.json()["items"][0].get("restaurant_cuisine")
    if first_cuisine:
        cuisine_response = client.get("/api/v1/catalog/items", params={"cuisine": first_cuisine})
        assert cuisine_response.status_code == 200
        cuisine_items = cuisine_response.json()["items"]
        assert len(cuisine_items) > 0
        assert all(item.get("restaurant_cuisine") == first_cuisine for item in cuisine_items)

    add_response = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {guest_token}"},
        json={"item_id": catalog_item_id, "quantity": 2},
    )
    assert add_response.status_code == 201
    assert add_response.json()["subtotal_cents"] > 0

    validate_response = client.post(
        "/api/v1/checkout/validate",
        headers={"Authorization": f"Bearer {guest_token}"},
        json={
            "shipping_address": {
                "line1": "42 Example Street",
                "city": "Beer Sheva",
            },
            "delivery_option": "standard",
            "payment_method_reference": "sim_card_ok_001",
        },
    )
    assert validate_response.status_code == 200
    assert validate_response.json()["valid"] is True


def test_guest_cannot_submit_order(client: TestClient) -> None:
    guest_token = _guest_and_get_token(client)
    catalog_item_id = _first_catalog_item_id(client)
    client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {guest_token}"},
        json={"item_id": catalog_item_id, "quantity": 1},
    )

    create_response = client.post(
        "/api/v1/orders",
        headers={"Authorization": f"Bearer {guest_token}"},
        json={
            "shipping_address": {
                "line1": "42 Example Street",
                "city": "Beer Sheva",
            },
            "delivery_option": "standard",
            "payment_method_reference": "sim_card_ok_001",
            "simulation_scenario": "default",
        },
    )

    assert create_response.status_code == 403


def test_registered_user_create_order_with_idempotency(client: TestClient) -> None:
    token = _register_and_get_token(client, "order-placement@example.com")
    demo_card_number = _reveal_demo_card(client, token)
    catalog_item_id = _first_catalog_item_id(client)
    client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"item_id": catalog_item_id, "quantity": 1},
    )

    payload = {
        "shipping_address": {
            "line1": "42 Example Street",
            "city": "Beer Sheva",
        },
        "delivery_option": "express",
        "payment_method_reference": demo_card_number,
        "simulation_scenario": "default",
    }

    first = client.post(
        "/api/v1/orders",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": "idem-order-1",
        },
        json=payload,
    )
    assert first.status_code == 201
    first_order_id = first.json()["order_id"]
    assert first.json()["idempotent_replay"] is False

    second = client.post(
        "/api/v1/orders",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": "idem-order-1",
        },
        json=payload,
    )
    assert second.status_code == 201
    assert second.json()["order_id"] == first_order_id
    assert second.json()["idempotent_replay"] is True

    orders_response = client.get("/api/v1/orders", headers={"Authorization": f"Bearer {token}"})
    assert orders_response.status_code == 200
    payload = orders_response.json()
    assert payload["total"] >= 1
    assert len(payload["items"]) >= 1


def test_registered_user_cannot_create_order_with_insufficient_balance(client: TestClient, db_session: Session) -> None:
    email = "low-balance@example.com"
    token = _register_and_get_token(client, email)
    demo_card_number = _reveal_demo_card(client, token)
    catalog_item_id = _first_catalog_item_id(client)
    client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"item_id": catalog_item_id, "quantity": 1},
    )

    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.balance_cents = 200
    db_session.add(user)
    db_session.commit()

    create_response = client.post(
        "/api/v1/orders",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shipping_address": {
                "line1": "42 Example Street",
                "city": "Beer Sheva",
            },
            "delivery_option": "standard",
            "payment_method_reference": demo_card_number,
            "simulation_scenario": "default",
        },
    )

    assert create_response.status_code == 422
    payload = create_response.json()
    assert payload["error"]["message"] == "Checkout validation failed"
    assert "Insufficient balance" in payload["error"]["details"]["issues"]


def test_registered_user_order_debits_balance(client: TestClient, db_session: Session) -> None:
    email = "balance-debit@example.com"
    token = _register_and_get_token(client, email)
    demo_card_number = _reveal_demo_card(client, token)
    catalog_item_id = _first_catalog_item_id(client)
    client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"item_id": catalog_item_id, "quantity": 1},
    )

    user_before = db_session.scalar(select(User).where(User.email == email))
    assert user_before is not None
    start_balance = user_before.balance_cents

    create_response = client.post(
        "/api/v1/orders",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shipping_address": {
                "line1": "42 Example Street",
                "city": "Beer Sheva",
            },
            "delivery_option": "standard",
            "payment_method_reference": demo_card_number,
            "simulation_scenario": "default",
        },
    )

    assert create_response.status_code == 201
    response_total = create_response.json()["total_cents"]
    user_after = db_session.scalar(select(User).where(User.email == email))
    assert user_after is not None
    assert user_after.balance_cents == start_balance - response_total
    assert create_response.json()["remaining_balance_cents"] == user_after.balance_cents

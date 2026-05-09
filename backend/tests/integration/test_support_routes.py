from __future__ import annotations

from fastapi.testclient import TestClient


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


def _guest_token(client: TestClient) -> str:
    response = client.post("/api/v1/auth/guest")
    assert response.status_code == 201
    return response.json()["access_token"]


def test_support_conversation_customer_admin_flow(client: TestClient) -> None:
    customer_token = _register_and_get_token(client, "support-customer@example.com")
    admin_token = _register_and_get_token(client, "admin@example.com")

    create = client.post(
        "/api/v1/support/conversations",
        json={
            "source_session_id": "session-123",
            "priority": "high",
        },
        headers={"Authorization": f"Bearer {customer_token}"},
    )
    assert create.status_code == 200
    conversation_id = create.json()["conversation_id"]
    assert create.json()["status"] == "open"
    assert create.json()["priority"] == "high"

    queue = client.get(
        "/api/v1/admin/support/conversations/queue",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert queue.status_code == 200
    queued_ids = [item["conversation_id"] for item in queue.json()["items"]]
    assert conversation_id in queued_ids

    claim = client.post(
        f"/api/v1/admin/support/conversations/{conversation_id}/claim",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert claim.status_code == 200
    assert claim.json()["status"] == "assigned"

    customer_msg = client.post(
        f"/api/v1/support/conversations/{conversation_id}/messages",
        json={"body": "I still need help with this refund."},
        headers={"Authorization": f"Bearer {customer_token}"},
    )
    assert customer_msg.status_code == 200
    assert customer_msg.json()["sender_role"] == "customer"

    admin_msg = client.post(
        f"/api/v1/support/conversations/{conversation_id}/messages",
        json={"body": "I am reviewing it now."},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_msg.status_code == 200
    assert admin_msg.json()["sender_role"] == "admin"

    messages = client.get(
        f"/api/v1/support/conversations/{conversation_id}/messages",
        headers={"Authorization": f"Bearer {customer_token}"},
    )
    assert messages.status_code == 200
    assert messages.json()["total"] == 2

    close = client.post(
        f"/api/v1/admin/support/conversations/{conversation_id}/close",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert close.status_code == 200
    assert close.json()["status"] == "closed"

    after_close = client.post(
        f"/api/v1/support/conversations/{conversation_id}/messages",
        json={"body": "Any update?"},
        headers={"Authorization": f"Bearer {customer_token}"},
    )
    assert after_close.status_code == 200
    assert after_close.json()["sender_role"] == "customer"

    reopened = client.get(
        f"/api/v1/support/conversations/{conversation_id}",
        headers={"Authorization": f"Bearer {customer_token}"},
    )
    assert reopened.status_code == 200
    assert reopened.json()["status"] in {"open", "assigned"}


def test_support_conversation_access_control(client: TestClient) -> None:
    customer_a = _register_and_get_token(client, "support-a@example.com")
    customer_b = _register_and_get_token(client, "support-b@example.com")

    create = client.post(
        "/api/v1/support/conversations",
        json={"priority": "normal"},
        headers={"Authorization": f"Bearer {customer_a}"},
    )
    assert create.status_code == 200
    conversation_id = create.json()["conversation_id"]

    forbidden = client.get(
        f"/api/v1/support/conversations/{conversation_id}",
        headers={"Authorization": f"Bearer {customer_b}"},
    )
    assert forbidden.status_code == 403


def test_guest_and_non_admin_restrictions_for_support(client: TestClient) -> None:
    guest_token = _guest_token(client)
    regular_token = _register_and_get_token(client, "regular-user@example.com")

    guest_create = client.post(
        "/api/v1/support/conversations",
        json={"priority": "normal"},
        headers={"Authorization": f"Bearer {guest_token}"},
    )
    assert guest_create.status_code == 403

    non_admin_queue = client.get(
        "/api/v1/admin/support/conversations/queue",
        headers={"Authorization": f"Bearer {regular_token}"},
    )
    assert non_admin_queue.status_code == 403

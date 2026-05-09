from __future__ import annotations

from fastapi.testclient import TestClient
from datetime import UTC, datetime, timedelta
from sqlalchemy.orm import Session

from app.repositories.order_repository import OrderRepository
from app.repositories.user_repository import UserRepository


def _register_and_get_token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "secure-pass-123",
            "full_name": "Refund Test User",
            "date_of_birth": "1990-01-01",
            "address": "123 Refund Test Street",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def _guest_token(client: TestClient) -> str:
    response = client.post("/api/v1/auth/guest")
    assert response.status_code == 201
    return response.json()["access_token"]


def _create_delivered_order(order_repo: OrderRepository, *, order_id: str, user_id: int, total_cents: int) -> None:
    order = order_repo.create(order_id=order_id, user_id=user_id, total_cents=total_cents)
    order.created_at = datetime.now(UTC) - timedelta(hours=2)
    order.updated_at = order.created_at
    order_repo.db.add(order)
    order_repo.db.commit()
    order_repo.db.refresh(order)


def test_refund_eligibility_and_create_request(client: TestClient, db_session: Session) -> None:
    token = _register_and_get_token(client, "refund-owner@example.com")
    user_repo = UserRepository(db_session)
    owner = user_repo.get_by_email("refund-owner@example.com")
    assert owner is not None

    order_repo = OrderRepository(db_session)
    _create_delivered_order(order_repo, order_id="ord-ref-1", user_id=owner.id, total_cents=2600)

    eligibility = client.post(
        "/api/v1/refunds/eligibility/check",
        json={
            "order_id": "ord-ref-1",
            "reason_code": "missing_item",
            "simulation_scenario_id": "default",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert eligibility.status_code == 200
    assert "eligible" in eligibility.json()

    created = client.post(
        "/api/v1/refunds/requests",
        json={
            "order_id": "ord-ref-1",
            "reason_code": "missing_item",
            "simulation_scenario_id": "default",
        },
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "idem-ref-1"},
    )
    assert created.status_code == 201
    request_id = created.json()["refund_request_id"]

    fetched = client.get(
        f"/api/v1/refunds/requests/{request_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fetched.status_code == 200
    assert fetched.json()["refund_request_id"] == request_id


def test_refund_create_idempotent_replay_returns_200(client: TestClient, db_session: Session) -> None:
    token = _register_and_get_token(client, "refund-idem@example.com")
    user_repo = UserRepository(db_session)
    owner = user_repo.get_by_email("refund-idem@example.com")
    assert owner is not None
    _create_delivered_order(OrderRepository(db_session), order_id="ord-ref-2", user_id=owner.id, total_cents=3000)

    payload = {
        "order_id": "ord-ref-2",
        "reason_code": "missing_item",
        "simulation_scenario_id": "default",
    }

    first = client.post(
        "/api/v1/refunds/requests",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "idem-ref-2"},
    )
    second = client.post(
        "/api/v1/refunds/requests",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "idem-ref-2"},
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["refund_request_id"] == second.json()["refund_request_id"]
    assert second.json()["idempotent_replay"] is True


def test_refund_second_request_for_same_order_is_blocked(client: TestClient, db_session: Session) -> None:
    token = _register_and_get_token(client, "refund-repeat@example.com")
    user_repo = UserRepository(db_session)
    owner = user_repo.get_by_email("refund-repeat@example.com")
    assert owner is not None
    _create_delivered_order(OrderRepository(db_session), order_id="ord-ref-repeat", user_id=owner.id, total_cents=3000)

    first = client.post(
        "/api/v1/refunds/requests",
        json={
            "order_id": "ord-ref-repeat",
            "reason_code": "missing_item",
            "simulation_scenario_id": "default",
        },
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "idem-repeat-1"},
    )
    assert first.status_code == 201

    second = client.post(
        "/api/v1/refunds/requests",
        json={
            "order_id": "ord-ref-repeat",
            "reason_code": "missing_item",
            "simulation_scenario_id": "default",
        },
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "idem-repeat-2"},
    )

    assert second.status_code == 409
    body = second.json()
    assert body["error"]["message"] == "Refund already requested for this order"
    assert body["error"]["details"]["conflict_type"] == "duplicate_refund_request"
    assert body["error"]["details"]["order_id"] == "ord-ref-repeat"


def test_refund_history_supports_pagination_and_filters(client: TestClient, db_session: Session) -> None:
    token = _register_and_get_token(client, "refund-history-page@example.com")
    user_repo = UserRepository(db_session)
    owner = user_repo.get_by_email("refund-history-page@example.com")
    assert owner is not None

    order_repo = OrderRepository(db_session)
    _create_delivered_order(order_repo, order_id="ord-history-1", user_id=owner.id, total_cents=2500)
    _create_delivered_order(order_repo, order_id="ord-history-2", user_id=owner.id, total_cents=2600)
    _create_delivered_order(order_repo, order_id="ord-history-3", user_id=owner.id, total_cents=2700)

    for index, order_id in enumerate(["ord-history-1", "ord-history-2", "ord-history-3"], start=1):
        response = client.post(
            "/api/v1/refunds/requests",
            json={
                "order_id": order_id,
                "reason_code": "missing_item" if index != 2 else "late_delivery",
                "simulation_scenario_id": "default",
            },
            headers={"Authorization": f"Bearer {token}", "Idempotency-Key": f"idem-history-{index}"},
        )
        assert response.status_code == 201

    page_one = client.get(
        "/api/v1/refunds/requests?limit=2&offset=0&q=ord-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert page_one.status_code == 200
    body_one = page_one.json()
    assert body_one["total"] == 3
    assert body_one["limit"] == 2
    assert body_one["offset"] == 0
    assert len(body_one["items"]) == 2
    assert all("ord-history" in item["order_id"] for item in body_one["items"])

    filtered = client.get(
        "/api/v1/refunds/requests?status=approved&q=ord-history-1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert filtered.status_code == 200
    body_filtered = filtered.json()
    assert body_filtered["total"] == 1
    assert len(body_filtered["items"]) == 1
    assert body_filtered["items"][0]["order_id"] == "ord-history-1"


def test_guest_refund_actions_forbidden(client: TestClient, db_session: Session) -> None:
    owner_token = _register_and_get_token(client, "owner-for-guest-test@example.com")
    owner = UserRepository(db_session).get_by_email("owner-for-guest-test@example.com")
    assert owner is not None
    _create_delivered_order(OrderRepository(db_session), order_id="ord-ref-3", user_id=owner.id, total_cents=1800)

    guest_token = _guest_token(client)
    response = client.post(
        "/api/v1/refunds/eligibility/check",
        json={
            "order_id": "ord-ref-3",
            "reason_code": "missing_item",
            "simulation_scenario_id": "default",
        },
        headers={"Authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == 403

    state_sim = client.get(
        "/api/v1/orders/ord-ref-3/state-sim?scenario_id=default",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert state_sim.status_code == 200
    assert "fulfillment_state" in state_sim.json()


def test_admin_manual_review_queue_and_decision_flow(client: TestClient, db_session: Session) -> None:
    customer_token = _register_and_get_token(client, "refund-customer-admin-flow@example.com")
    customer = UserRepository(db_session).get_by_email("refund-customer-admin-flow@example.com")
    assert customer is not None
    _create_delivered_order(OrderRepository(db_session), order_id="ord-ref-admin-1", user_id=customer.id, total_cents=4200)

    created = client.post(
        "/api/v1/refunds/requests",
        json={
            "order_id": "ord-ref-admin-1",
            "reason_code": "fraud",
            "simulation_scenario_id": "delivered-happy",
        },
        headers={"Authorization": f"Bearer {customer_token}", "Idempotency-Key": "idem-admin-1"},
    )
    assert created.status_code == 201
    request_id = created.json()["refund_request_id"]
    assert created.json()["status"] == "pending_manual_review"

    admin_token = _register_and_get_token(client, "admin@example.com")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    queue = client.get("/api/v1/admin/refunds/manual-review/queue", headers=admin_headers)
    assert queue.status_code == 200
    queue_body = queue.json()
    assert queue_body["total"] == 0
    assert queue_body["items"] == []

    claim = client.post(f"/api/v1/admin/refunds/requests/{request_id}/claim", headers=admin_headers)
    assert claim.status_code == 403

    decision = client.post(
        f"/api/v1/admin/refunds/requests/{request_id}/decision",
        json={"decision": "resolved", "reviewer_note": "Approved after verification"},
        headers=admin_headers,
    )
    assert decision.status_code == 403


def test_admin_manual_review_requires_admin_role(client: TestClient) -> None:
    admin_token = _register_and_get_token(client, "regular-user-no-admin@example.com")
    response = client.get(
        "/api/v1/admin/refunds/manual-review/queue",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 403

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models.user import User
from app.core.security import create_access_token
from app.main import create_app

TEST_DATABASE_URL = "sqlite+pysqlite:///:memory:"


def build_session() -> Session:
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    local_session = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)
    return local_session()


def test_auth_session_prefers_authorization_header():
    session = build_session()
    try:
        # create two users
        u1 = User(email="u1@example.com", password_hash=None, is_guest=False, is_active=True, is_verified=True)
        session.add(u1)
        session.commit()
        session.refresh(u1)

        u2 = User(email="u2@example.com", password_hash=None, is_guest=False, is_active=True, is_verified=True)
        session.add(u2)
        session.commit()
        session.refresh(u2)

        # create tokens
        t1 = create_access_token(str(u1.id), is_guest=False)
        t2 = create_access_token(str(u2.id), is_guest=False)

        app = create_app()
        # override DB to use our in-memory session
        def _get_db_override():
            try:
                yield session
            finally:
                pass

        from app.db.session import get_db

        app.dependency_overrides[get_db] = _get_db_override
        client = TestClient(app)

        # call /auth/session with cookie=t1 and Authorization=t2 -> should return u2
        cookies = {"access_token": t1}
        headers = {"Authorization": f"Bearer {t2}"}
        resp = client.get("/api/v1/auth/session", headers=headers, cookies=cookies)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == u2.id
    finally:
        session.close()

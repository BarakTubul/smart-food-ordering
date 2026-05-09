# Customer Service Backend Skeleton

## What Is Included
- FastAPI app scaffold with route -> service -> repository layering
- Centralized Pydantic settings with env separation (dev, staging, prod)
- SQLAlchemy + PostgreSQL wiring
- Alembic migrations with initial `users` table
- JWT authentication utilities
- LangGraph hybrid intent flow (rule-first, LLM fallback)
- LLM provider abstraction with `mock` and OpenAI implementations
- Seeded RAG FAQ retrieval with chunk citations in API responses
- Mock restaurant/menu dataset loaded from configurable JSON in `backend/data/mock_data.json`
- Guest mode endpoint: `POST /api/v1/auth/guest`
- Guest-to-registered conversion endpoint: `POST /api/v1/auth/guest/convert`
- Custom `AppError` hierarchy and global exception handlers
- Environment-aware CORS, logging, cookie, and error detail behavior
- Pytest unit and integration test skeletons

## Run Locally
1. Create and activate a Python 3.11+ environment.
2. Install dependencies:
   - `pip install -e .[dev]`
3. Copy env template:
   - `cp .env.example .env`
4. Run migrations:
   - `alembic upgrade head`
5. Start server:
   - `uvicorn app.main:app --reload`

## Environment Separation
Environment-specific behavior is centralized in `app/core/settings.py`:
- `APP_ENV` controls whether runtime is `dev`, `staging`, or `prod`.
- Settings are loaded from `.env` and `.env.<APP_ENV>`.
- Business logic in services/repositories is environment-agnostic.
- Environment differences are isolated in:
  - Config values (e.g., `DATABASE_URL`, `CORS_ORIGINS`)
  - Security defaults (cookie `secure` and `samesite`)
  - Error response detail exposure (detailed only in dev)
  - Logging level

This keeps domain logic stable while allowing safe runtime policy changes per environment.

## LLM and Agent Mode
- `LLM_PROVIDER=mock` keeps behavior deterministic and offline-safe.
- `LLM_PROVIDER=openai` enables OpenAI-backed classification/synthesis.
- `OPENAI_API_KEY` and `OPENAI_MODEL` control runtime model access.
- LangGraph orchestrates intent flow:
   - rule classification node
   - confidence gate
   - LLM classification node fallback

## API Endpoints (Current Skeleton)
- `POST /api/v1/auth/guest`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/guest/convert`
- `GET /api/v1/auth/session`
- `GET /api/v1/account/me`
- `GET /api/v1/orders/{order_id}`
- `GET /api/v1/orders/{order_id}/timeline-sim`
- `POST /api/v1/intent/resolve`
- `POST /api/v1/faq/search`
- `GET /api/v1/conversations/{session_id}/context`
- `POST /api/v1/fallback/escalation-check`
- `POST /api/v1/refunds/eligibility/check`
- `POST /api/v1/refunds/requests`
- `GET /api/v1/refunds/requests/{refund_request_id}`
- `GET /api/v1/orders/{order_id}/state-sim`
- `GET /api/v1/catalog/items`
- `GET /api/v1/cart`
- `POST /api/v1/cart/items`
- `PATCH /api/v1/cart/items/{item_id}`
- `DELETE /api/v1/cart/items/{item_id}`
- `POST /api/v1/checkout/validate`
- `POST /api/v1/payments/authorize-sim`
- `POST /api/v1/orders`
- `GET /api/v1/orders/{order_id}/lifecycle-sim`
- `POST /api/v1/dev/mock-data/reload` (dev only)
- `GET /health`

## RAG Demonstration
- FAQ search uses seeded chunk retrieval (RAG-style) before generation.
- Responses include `citations` (chunk id, source, snippet, score).
- In `mock` mode, synthesis is deterministic.
- In `openai` mode, synthesis rewrites grounded context while preserving source attribution.

## Frontend Setup

A modern React + TypeScript frontend is included in the `frontend/` folder.

### Frontend Quick Start
1. Navigate to frontend:
   ```
   cd frontend
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Start dev server:
   ```
   npm run dev
   ```
   Opens on `http://localhost:3000`

### Frontend Features
- **Auth Pages**: Guest access, registration, login, guest-to-registered conversion
- **Dashboard**: Profile, order list, order timeline simulation
- **Chat Interface**: AI intent resolution with FAQ retrieval and citations
- **Refund Workflow**: Eligibility checking, request submission with idempotency
- **Responsive UI**: Tailwind CSS with dark mode support

### Making API Calls
The frontend proxies requests to `http://localhost:8000` via Vite dev server. Authentication now uses cookie-based sessions, so requests include credentials instead of reading JWTs from `localStorage`.

### Mock Data
- The order-placement catalog is sourced from `backend/data/mock_data.json`.
- Set `MOCK_DATA_PATH` in the backend environment to point to a different JSON dataset without changing code.

### Build for Production
```bash
npm run build
npm run preview
```

## Full Stack Demo

To run both backend and frontend together:

1. **Terminal 1 - Backend**:
   ```
   uvicorn app.main:app --reload
   ```
   Runs on `http://localhost:8000`

2. **Terminal 2 - Frontend**:
   ```
   cd frontend
   npm run dev
   ```
   Runs on `http://localhost:3000`

3. Visit `http://localhost:3000` and test the full customer service workflow

## Maintenance: Guest Cleanup

Guest users can accumulate and create many NULL-heavy rows. A safe cleanup script is available:

- Dry run (default):
   - `python -m app.scripts.cleanup_guests --days 30`
- Execute deletions:
   - `python -m app.scripts.cleanup_guests --days 30 --no-dry-run`

Safety rules:
- Only deletes `users` rows where `is_guest=true` and `created_at` is older than the cutoff.
- Skips any guest user that has dependent rows (orders, refunds, support conversations/messages).
- Deletes `conversation_messages` (and any support messages) for the guest before deleting the user.

### Windows Task Scheduler

Create a task that runs periodically and uses a PowerShell action like:

- Program/script: `powershell.exe`
- Arguments:
   - `-NoProfile -ExecutionPolicy Bypass -Command "cd backend; python -m app.scripts.cleanup_guests --days 30 --no-dry-run"`

# 🍽️ Smart Food Ordering Platform — Ordering & FAQ Assistant

> A full-stack food ordering application with an AI-powered FAQ assistant, built with FastAPI, React, and LangGraph.

![Python](https://img.shields.io/badge/Python-3.11%2B-blue?style=flat-square)
![License](https://img.shields.io/badge/License-Unlicense-green?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-96%20passing-success?style=flat-square)

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Features](#features)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [License](#license)
- [Contact](#contact)
- [Acknowledgments](#acknowledgments)

## Overview

The **Smart Food Ordering Platform** is a full-stack application demonstrating modern web development patterns, LLM integration, and production-ready architecture. Users can browse menus, place orders, and interact with an intelligent FAQ assistant powered by Retrieval-Augmented Generation (RAG).

**What makes this project unique:**
- **LangGraph-based intent routing**: Rule-first classification with LLM fallback for user queries
- **RAG FAQ retrieval**: Semantic search over indexed FAQ chunks with citations in responses
- **Guest-to-registered workflow**: Seamless conversion from guest to authenticated user
- **Production patterns**: Environment-aware config, structured error handling, audit trails for refunds
- **Full-stack**: Complete backend (FastAPI + PostgreSQL) and frontend (React + TypeScript)

## Tech Stack

**Backend:**
- ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
- ![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
- ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat-square&logo=postgresql&logoColor=white)
- ![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-red?style=flat-square)
- ![LangGraph](https://img.shields.io/badge/LangGraph-orange?style=flat-square)
- ![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)

**Frontend:**
- ![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=white)
- ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
- ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
- ![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)

**DevOps & Tools:**
- Alembic (database migrations)
- Pytest (96 passing tests)
- pgAdmin (database administration)

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 12+
- Redis (optional, for caching)

### Backend Setup

```bash
# Clone and navigate
cd backend

# Create and activate Python environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -e .[dev]

# Configure environment
cp .env.example .env

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --reload
```

Server runs on `http://localhost:8000`

### Frontend Setup

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs on `http://localhost:3000`

### Running Both Together

**Terminal 1 - Backend:**
```bash
cd backend
uvicorn app.main:app --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Visit `http://localhost:3000` to use the full application.

## Features

### 🔐 Backend Features
- **Authentication**: Guest mode, user registration, JWT-based sessions
- **Order Management**: Menu browsing, cart operations, order placement, lifecycle simulation
- **AI Intent Router**: Hybrid rule + LLM-based classification for user queries
- **FAQ Retrieval**: Semantic search with citations and source attribution
- **Refund System**: Eligibility checking, manual review workflows, audit trails
- **Error Handling**: Custom exception hierarchy with environment-aware detail exposure
- **Database Migrations**: Alembic-managed schema evolution

### 🎨 Frontend Features
- **Auth Pages**: Guest access, registration, login, guest-to-registered conversion
- **Dashboard**: Profile management, order history, order timeline simulation
- **Chat Interface**: Real-time intent resolution with FAQ retrieval and citations
- **Refund Workflow**: Eligibility checker, request submission with idempotency
- **Responsive Design**: Tailwind CSS with dark mode support
- **Type Safety**: Full TypeScript coverage

## Project Structure

```
.
├── backend/                          # FastAPI application
│   ├── app/
│   │   ├── api/                     # Route handlers
│   │   ├── services/                # Business logic
│   │   ├── repositories/            # Data access
│   │   ├── models/                  # SQLAlchemy ORM
│   │   ├── schemas/                 # Pydantic request/response
│   │   ├── core/                    # Settings, security, logging
│   │   └── ai/                      # LangGraph intent routing
│   ├── alembic/                     # Database migrations
│   ├── tests/                       # Unit & integration tests
│   └── pyproject.toml
├── frontend/                         # React + TypeScript app
│   ├── src/
│   │   ├── components/              # Reusable UI components
│   │   ├── pages/                   # Page-level components
│   │   ├── services/                # API client
│   │   ├── context/                 # Auth state management
│   │   └── types/                   # TypeScript interfaces
│   ├── public/                      # Static assets
│   └── package.json
└── README.md
```

## Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Application
APP_NAME=Smart Food Ordering Platform — Ordering & FAQ Assistant
APP_ENV=dev

# Database
DATABASE_URL=postgresql+psycopg://app:app@localhost:5432/customer_service

# JWT
JWT_SECRET_KEY=your-secret-key
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60

# LLM
LLM_PROVIDER=mock  # or 'openai'
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4o-mini

# Redis (optional)
REDIS_ENABLED=false
REDIS_URL=redis://localhost:6379/0
```

### Environment Separation

The app supports three environments via `APP_ENV`:
- **dev**: Detailed error responses, debug logging
- **staging**: Production settings with relaxed security
- **prod**: Strict security, minimal error detail

Settings are loaded from `.env` and `.env.<APP_ENV>` files.

### LLM & FAQ Configuration

- **Mock Mode**: Deterministic responses, no API calls (default)
- **OpenAI Mode**: Real LLM-powered intent classification and FAQ synthesis
- **RAG Retrieval**: Configurable chunk retrieval (`faq_retrieval_top_k`) and synthesis parameters

## API Endpoints

### Authentication
- `POST /api/v1/auth/guest` — Create guest session
- `POST /api/v1/auth/register` — Register new user
- `POST /api/v1/auth/login` — Login
- `POST /api/v1/auth/guest/convert` — Convert guest to registered user

### Orders
- `GET /api/v1/orders/{order_id}` — Get order details
- `POST /api/v1/orders` — Create new order
- `GET /api/v1/catalog/items` — Browse menu

### AI & FAQ
- `POST /api/v1/intent/resolve` — Resolve user intent
- `POST /api/v1/faq/search` — Search FAQ with RAG

### Refunds
- `POST /api/v1/refunds/eligibility/check` — Check refund eligibility
- `POST /api/v1/refunds/requests` — Submit refund request

### Health
- `GET /health` — Health check

See [backend/README.md](backend/README.md) for complete endpoint documentation.

## License

This project is released under the **Unlicense** — it is in the public domain. See [LICENSE.txt](LICENSE.txt) for details.

## Contact

**GitHub:** [BarakTubul/smart-food-ordering](https://github.com/BarakTubul/smart-food-ordering)

Questions or feedback? Open an issue or reach out via GitHub.

## Acknowledgments

- **FastAPI** — Modern async Python web framework
- **React** — UI library
- **LangGraph** — LLM orchestration
- **SQLAlchemy** — Python SQL toolkit and ORM
- **Tailwind CSS** — Utility-first CSS framework
- **Alembic** — Database migration tool
- Inspired by software engineering best practices and production patterns

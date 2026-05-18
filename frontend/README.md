# Smart Food Ordering Platform — Frontend

A React + TypeScript frontend for the Smart Food Ordering Platform. Features include guest access, account management, AI-powered FAQ assistant, and order management.

## Features

- **Authentication**: Guest access, user registration, and login
- **Dashboard**: View profile, orders, and order timelines
- **Chat Interface**: AI-powered intent detection with FAQ retrieval and citations
- **Refund Workflow**: Eligibility checking, request submission with idempotency
- **Responsive Design**: Tailwind CSS for modern UI across all devices

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
# Edit .env.local if backend is not on localhost:8000
```

3. Start development server:
```bash
npm run dev
```

Visit `http://localhost:3000`

## Architecture

- **Pages**: IndexPage, LoginPage, RegisterPage, GuestAccessPage, DashboardPage, ChatPage, RefundPage
- **Components**: Reusable UI components (Button, Input, Card, Alert), Header navigation
- **Services**: API client with type-safe endpoints matching backend contracts
- **Context**: Auth state management with session persistence
- **Types**: TypeScript interfaces for all API models

## API Integration

The frontend communicates with the backend API:
- Auth endpoints: `/auth/guest`, `/auth/login`, `/auth/register`, `/auth/convert-guest`
- Account endpoints: `/account/session`, `/account/me`
- Order endpoints: `/orders`, `/orders/{id}`, `/orders/{id}/timeline-sim`
- Intent endpoints: `/intent/resolve`, `/faq/search`, `/conversations/{id}/context`
- Refund endpoints: `/refunds/eligibility/check`, `/refunds/requests`

## Build

```bash
npm run build
```

## Tech Stack

- React 18
- TypeScript
- React Router DOM
- Axios
- Tailwind CSS
- Vite

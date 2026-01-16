# Shtiebel48 Frontend

Synagogue management system app helps run day‑to‑day synagogue operations. It keeps member and guest records, tracks dues and recurring memberships, records payments and charges, manages balances owed, generates monthly statements, and sends email reminders. It also supports Stripe for card payments and scheduled jobs for monthly billing and email statements.

## Requirements

- Node.js 18+
- npm

## Setup

Install dependencies:

```bash
cd frontend
npm install
```

Create `frontend/.env` and set these:

```bash
VITE_API_BASE_URL=http://localhost:3001/api
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

Notes:
- `VITE_API_BASE_URL` must point to the same backend used by Stripe webhooks and the database you expect.
- Firebase values are required only if you use Google Sign-In.

## Run (Frontend)

```bash
npm run dev
```

The app runs at `http://localhost:5173` by default.

## Backend (API)

The API lives in `server/functions`. See `server/functions/README.md` for local run and env requirements.

## Payments (Stripe)

Payments are handled by the backend. Ensure the backend has Stripe keys and the webhook endpoint configured.

## Build

```bash
npm run build
npm run preview
```

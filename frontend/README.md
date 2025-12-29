# Base44 App


This app was created automatically by Base44.
It's a Vite+React app.

This repo now also includes a local Node.js/Express backend that mimics the Base44 entity + integrations API shape used by the UI.

## Running the app

Start the backend (Terminal 1):

Start MongoDB (Terminal 1a, if you don't already have Mongo running):

```powershell
docker compose up -d
```

Start the Express API (Terminal 1b):

```powershell
npm install
npm run dev:server
```

Create a `.env` file (see `.env.example`) and set `MONGODB_URI` there.

The backend requires MongoDB. Set `MONGODB_URI` (and optionally `MONGODB_DB_NAME`) in a `.env` file (see `.env.example`).

Start the frontend (Terminal 2):

```bash
npm run dev
```

By default, the frontend calls `http://localhost:3001/api`.
To change it, set `VITE_API_BASE_URL`.

## Google Sign-In (Firebase)

This project supports "Continue with Google" via Firebase Authentication.

Frontend:

- Create a Firebase project and enable **Authentication → Sign-in method → Google**.
- Set these in your `.env`:
	- `VITE_FIREBASE_API_KEY`
	- `VITE_FIREBASE_AUTH_DOMAIN`
	- `VITE_FIREBASE_PROJECT_ID`
	- `VITE_FIREBASE_APP_ID` (optional)

Backend:

- The backend exchanges a Firebase ID token for the app JWT at `POST /api/auth/google`.
- Configure Firebase Admin credentials with either `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`.
- See `.env.example`.

## Payments (Stripe)

Card payments use Stripe Checkout (the app does not collect card numbers).

Backend `.env`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_BASE_URL` (defaults to `http://localhost:5173`)

Webhook endpoint:

- `POST http://localhost:3001/api/stripe/webhook`

## Building the app

```bash
npm run build
```

For more information and support, please contact Base44 support at app@base44.com.
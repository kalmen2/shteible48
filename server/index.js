import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import cors from "cors";
import path from "node:path";

import { connectMongo, closeMongo } from "./functions/mongo.js";
import { createMongoEntityStore } from "./functions/store.mongo.js";
import { createEntitiesRouter } from "./functions/routes.entities.js";
import { createIntegrationsRouter } from "./functions/routes.integrations.js";
import { authMiddleware, createAuthRouter } from "./functions/auth.js";
import { createPaymentsRouter } from "./functions/routes.payments.js";
import { createStripeWebhookHandler } from "./functions/stripeWebhook.js";

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
const UPLOADS_DIR = path.resolve(process.cwd(), "server", "uploads");

const app = express();

app.use(cors({ origin: true, credentials: true }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/uploads", express.static(UPLOADS_DIR));

let store;
let mongoDb;
try {
  mongoDb = await connectMongo();
  store = createMongoEntityStore({ db: mongoDb });
} catch (err) {
  const maskMongoUri = (uri) => {
    if (!uri) return "(missing)";
    try {
      const u = new URL(uri);
      u.username = "";
      u.password = "";
      // Drop query params to avoid leaking tokens
      u.search = "";
      return u.toString();
    } catch {
      return "(invalid uri)";
    }
  };
  // eslint-disable-next-line no-console
  console.error("Failed to start backend: MongoDB connection failed.");
  // eslint-disable-next-line no-console
  console.error(`- MONGODB_URI: ${maskMongoUri(process.env.MONGODB_URI)}`);
  // eslint-disable-next-line no-console
  console.error(`- Error: ${err?.message || err}`);
  // eslint-disable-next-line no-console
  console.error("Start MongoDB (local or Docker) and retry `npm run dev:server`.");
  process.exit(1);
}

// Stripe webhook must receive the raw request body (mounted before express.json).
try {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    createStripeWebhookHandler({ store })
  );
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn("Stripe webhook disabled:", e?.message || e);
}

app.use(express.json({ limit: "10mb" }));

const auth = createAuthRouter({ db: mongoDb });

app.post("/api/auth/signup", (req, res, next) => auth.signup(req, res).catch(next));
app.post("/api/auth/login", (req, res, next) => auth.login(req, res).catch(next));
app.post("/api/auth/google", (req, res, next) => auth.google(req, res).catch(next));
app.get("/api/auth/me", authMiddleware, (req, res, next) => auth.me(req, res).catch(next));

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "http://localhost:5173";
app.use(
  "/api/payments",
  authMiddleware,
  createPaymentsRouter({ store, publicBaseUrl: PUBLIC_BASE_URL, frontendBaseUrl: FRONTEND_BASE_URL })
);

app.use("/api/entities", authMiddleware, createEntitiesRouter({ store }));
app.use(
  "/api/integrations",
  authMiddleware,
  createIntegrationsRouter({ uploadsDirAbs: UPLOADS_DIR, publicBaseUrl: PUBLIC_BASE_URL })
);

// Simple error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err?.status ?? 500;
  res.status(status).json({ message: err?.message ?? "Server error" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Express API listening on ${PUBLIC_BASE_URL}`);
});

process.on("SIGINT", async () => {
  await closeMongo();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeMongo();
  process.exit(0);
});

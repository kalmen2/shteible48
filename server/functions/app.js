const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load .env if present
try { dotenv.config(); } catch {}

const { connectMongo } = require('./mongo');
const { createMongoEntityStore } = require('./store.mongo');
const { authMiddleware, createAuthRouter } = require('./auth');
const { createEntitiesRouter } = require('./routes.entities');
const { createPaymentsRouter } = require('./routes.payments');
const { createStripeWebhookHandler } = require('./stripeWebhook');

const { createIntegrationsRouter } = require('./routes.integrations');
const fs = require('fs');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:5001';
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
const FRONTEND_ORIGIN_ALLOWLIST = process.env.FRONTEND_ORIGIN_ALLOWLIST || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const frontendOrigins = FRONTEND_ORIGIN_ALLOWLIST
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const allowedFrontendOrigins = frontendOrigins.length > 0 ? frontendOrigins : [FRONTEND_BASE_URL];

const uploadsDirAbs = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadsDirAbs)) {
  fs.mkdirSync(uploadsDirAbs, { recursive: true });
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
const rawMultipart = express.raw({ type: 'multipart/form-data', limit: '20mb' });
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.startsWith('multipart/form-data')) {
    return rawMultipart(req, res, (err) => {
      if (!err && req.body && !req.rawBody) {
        req.rawBody = req.body;
      }
      next(err);
    });
  }
  return next();
});
const jsonParser = express.json({ limit: '10mb' });
const stripeRawParser = express.raw({ type: 'application/json' });
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') {
    // Keep the raw body for Stripe signature verification
    return stripeRawParser(req, res, (err) => {
      if (!err && req.body && !req.rawBody) {
        req.rawBody = req.body;
      }
      next(err);
    });
  }
  return jsonParser(req, res, next);
});


let store;
let mongoDb;
let routesRegistered = false;

const getUserById = async (id) => mongoDb.collection("User").findOne({ id: String(id) });
let integrationsRouter;

app.use(async (req, res, next) => {
  if (!mongoDb) {
    mongoDb = await connectMongo();
    store = createMongoEntityStore({ db: mongoDb });
  }
  req.store = store;

  // Register routes only once, after db is ready
  if (!routesRegistered) {
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.use('/uploads', express.static(uploadsDirAbs));

    const auth = createAuthRouter({ db: mongoDb });
    //app.post('/api/auth/signup', (req, res, next) => auth.signup(req, res).catch(next));
    app.post('/api/auth/login', (req, res, next) => auth.login(req, res).catch(next));
    app.post('/api/auth/google', (req, res, next) => auth.google(req, res).catch(next));
    app.get('/api/auth/me', authMiddleware, (req, res, next) => auth.me(req, res).catch(next));

    app.use(
      '/api/entities',
      authMiddleware,
      (req, res, next) =>
        createEntitiesRouter({
          store: req.store,
          getUserById,
          adminEmails: ADMIN_EMAILS,
        })(req, res, next)
    );
    app.use(
      '/api/payments',
      authMiddleware,
      (req, res, next) =>
        createPaymentsRouter({
          store: req.store,
          publicBaseUrl: PUBLIC_BASE_URL,
          frontendBaseUrl: FRONTEND_BASE_URL,
          allowedFrontendOrigins,
        })(req, res, next)
    );
    app.post('/api/stripe/webhook', createStripeWebhookHandler({ store }));

    // Add integrations router for file upload and related endpoints
    if (!integrationsRouter) {
      integrationsRouter = createIntegrationsRouter({
        uploadsDirAbs,
        publicBaseUrl: PUBLIC_BASE_URL,
        getUserById,
        adminEmails: ADMIN_EMAILS,
      });
    }
    app.use(
      '/api/integrations',
      authMiddleware,
      integrationsRouter
    );

    routesRegistered = true;
  }
  next();
});

// Error handler
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({ message: err?.message || 'Server error' });
});

module.exports = app;

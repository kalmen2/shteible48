const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const { getFirebaseAdminAuth } = require("./firebaseAdmin.js");

const isDevEnv = process.env.NODE_ENV === "development" || process.env.FUNCTIONS_EMULATOR === "true";
const JWT_SECRET = process.env.JWT_SECRET || (isDevEnv ? process.env.JWT_DEV_SECRET : "secret");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required");
}
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();
const GOOGLE_ADMIN_EMAILS = (
  process.env.GOOGLE_ADMIN_EMAILS ||
  process.env.ADMIN_EMAILS ||
  "shtiebel48@gmail.com"
)
  .split(",")
  .map((email) => normalizeEmail(email))
  .filter(Boolean);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub };
    if (typeof req.getUserById === "function") {
      const user = await req.getUserById(req.user.id);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function getLoginAttemptKey(req, email) {
  return `${getClientIp(req)}|${email || "unknown"}`;
}

function getLoginAttemptRecord(key) {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || now > existing.resetAt) {
    return { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  }
  return existing;
}

function recordFailedLogin(key) {
  const record = getLoginAttemptRecord(key);
  record.count += 1;
  loginAttempts.set(key, record);
  return record;
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

/** @param {{ db: import('mongodb').Db }} deps */
function createAuthRouter({ db }) {
  const users = db.collection("User");
  // best-effort unique index
  users.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  return {
    async signup(req, res) {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const name = String(req.body?.name || "").trim();

      if (!email || !password) return res.status(400).json({ message: "email and password are required" });
      if (password.length < 6) return res.status(400).json({ message: "password must be at least 6 characters" });

      const passwordHash = await bcrypt.hash(password, 10);

      const { nanoid } = await import('nanoid');
      const user = {
        id: nanoid(),
        email,
        name: name || undefined,
        passwordHash,
        created_date: new Date().toISOString(),
      };

      try {
        await users.insertOne(user);
      } catch (e) {
        if (String(e?.code) === "11000") {
          return res.status(409).json({ message: "Email already in use" });
        }
        throw e;
      }

      const token = signToken(user);
      return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    },

    async login(req, res) {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ message: "email and password are required" });

      const attemptKey = getLoginAttemptKey(req, email);
      const attemptRecord = getLoginAttemptRecord(attemptKey);
      if (attemptRecord.count >= LOGIN_MAX_ATTEMPTS) {
        return res.status(429).json({ message: "Too many login attempts. Try again later." });
      }

      const user = await users.findOne({ email });
      if (!user) {
        const record = recordFailedLogin(attemptKey);
        if (record.count >= LOGIN_MAX_ATTEMPTS) {
          return res.status(429).json({ message: "Too many login attempts. Try again later." });
        }
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash || "");
      if (!ok) {
        const record = recordFailedLogin(attemptKey);
        if (record.count >= LOGIN_MAX_ATTEMPTS) {
          return res.status(429).json({ message: "Too many login attempts. Try again later." });
        }
        return res.status(401).json({ message: "Invalid credentials" });
      }

      clearLoginAttempts(attemptKey);
      const token = signToken(user);
      return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    },

    async google(req, res) {
      const idToken = String(req.body?.idToken || "");
      if (!idToken) return res.status(400).json({ message: "idToken is required" });

      let decoded;
      try {
        decoded = await getFirebaseAdminAuth().verifyIdToken(idToken);
      } catch {
        return res.status(401).json({ message: "Invalid Google token" });
      }

      const email = normalizeEmail(decoded?.email);
      if (!email) return res.status(400).json({ message: "Google account email is required" });
      if (!GOOGLE_ADMIN_EMAILS.includes(email)) {
        return res.status(403).json({
          message: "Google sign-in is restricted to the admin account.",
        });
      }

      const providerUser = {
        email,
        name: String(decoded?.name || "").trim() || undefined,
        picture: String(decoded?.picture || "").trim() || undefined,
        firebaseUid: String(decoded?.uid || "").trim() || undefined,
        updated_date: new Date().toISOString(),
      };

      let user = await users.findOne({ email });

      if (!user) {

        const { nanoid } = await import('nanoid');
        user = {
          id: nanoid(),
          ...providerUser,
          created_date: new Date().toISOString(),
        };

        try {
          await users.insertOne(user);
        } catch (e) {
          if (String(e?.code) === "11000") {
            user = await users.findOne({ email });
          } else {
            throw e;
          }
        }
      } else {
        const set = {
          ...providerUser,
        };
        if (!set.name) delete set.name;
        if (!set.picture) delete set.picture;
        if (!set.firebaseUid) delete set.firebaseUid;

        await users.updateOne({ id: user.id }, { $set: set });
        user = { ...user, ...set };
      }

      const token = signToken(user);
      return res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
      });
    },

    async me(req, res) {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await users.findOne({ id: String(userId) });
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      return res.json({ id: user.id, email: user.email, name: user.name, picture: user.picture });
    },

    async logout(_req, res) {
      // JWT is stateless; client-side token removal performs logout.
      return res.status(204).send();
    },
  };
}

module.exports = {
  signToken,
  verifyToken,
  authMiddleware,
  createAuthRouter,
};

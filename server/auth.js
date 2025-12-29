import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { getFirebaseAdminAuth } from "./functions/firebaseAdmin.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

/** @param {{ db: import('mongodb').Db }} deps */
export function createAuthRouter({ db }) {
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

      const user = await users.findOne({ email });
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      const ok = await bcrypt.compare(password, user.passwordHash || "");
      if (!ok) return res.status(401).json({ message: "Invalid credentials" });

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

      const providerUser = {
        email,
        name: String(decoded?.name || "").trim() || undefined,
        picture: String(decoded?.picture || "").trim() || undefined,
        firebaseUid: String(decoded?.uid || "").trim() || undefined,
        updated_date: new Date().toISOString(),
      };

      let user = await users.findOne({ email });

      if (!user) {
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
  };
}

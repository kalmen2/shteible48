const express = require("express");
const path = require("node:path");
const fs = require("node:fs/promises");
const Busboy = require("busboy");
const XLSX = require("xlsx");
const { sendEmail } = require("./emailService");

function safeBaseName(name) {
  return String(name ?? "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
}

const HEADER_ALIASES = {
  english_name: ["english_name", "english name", "name english", "name_eng", "english"],
  hebrew_name: ["hebrew_name", "hebrew name", "name hebrew", "name_heb", "hebrew"],
  full_name: ["full_name", "full name", "name"],
  email: ["email", "email address", "e-mail"],
  phone: ["phone", "phone number", "telephone", "mobile", "cell"],
  address: ["address", "street", "street address"],
  member_id: ["member_id", "member id", "id", "acct", "acct #", "acct#", "account", "account #"],
};

const HEADER_LOOKUP = new Map(
  Object.entries(HEADER_ALIASES).flatMap(([key, aliases]) =>
    [key, ...aliases].map((alias) => [normalizeHeader(alias), key])
  )
);

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapRowToMember(row) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(row || {})) {
    const key = HEADER_LOOKUP.get(normalizeHeader(rawKey));
    if (!key) continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

function parseMultipartFile(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data"));
      return;
    }

    const busboy = Busboy({ headers: req.headers });
    const chunks = [];
    let fileInfo = null;

    busboy.on("file", (_name, file, info) => {
      fileInfo = info;
      file.on("data", (data) => chunks.push(data));
      file.on("error", (err) => reject(err));
    });

    busboy.on("error", (err) => reject(err));
    busboy.on("finish", () => {
      if (!fileInfo) {
        reject(new Error("Missing file"));
        return;
      }
      resolve({
        buffer: Buffer.concat(chunks),
        originalname: fileInfo.filename,
        mimetype: fileInfo.mimeType,
      });
    });

    const bodyBuffer = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    if (bodyBuffer) {
      busboy.end(bodyBuffer);
    } else {
      req.pipe(busboy);
    }
  });
}

async function parseCsvToObjects(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(",").map((h) => h.trim());

  return rows
    .map((row) => row.split(","))
    .map((cells) => {
      /** @type {Record<string, any>} */
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const key = headers[i];
        const raw = (cells[i] ?? "").trim();
        obj[key] = raw === "" ? undefined : raw;
      }
      return mapRowToMember(obj);
    });
}

function parseXlsxToObjects(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((row) => mapRowToMember(row));
}


/** @param {{ uploadsDirAbs: string, publicBaseUrl: string }} deps */
function createIntegrationsRouter({ uploadsDirAbs, publicBaseUrl }) {
  const router = express.Router();

  // POST /api/integrations/Core/SendEmail
  router.post("/Core/SendEmail", async (req, res) => {
    const { to, subject, body, html } = req.body ?? {};
    if (!to || !subject || (!body && !html)) {
      return res.status(400).json({ status: "error", message: "to, subject, and body are required" });
    }

    try {
      const info = await sendEmail({ to, subject, text: body, html });
      return res.json({ status: "success", messageId: info.messageId });
    } catch (err) {
      return res.status(500).json({ status: "error", message: err?.message || "Failed to send email" });
    }
  });

  // POST /api/integrations/Core/UploadFile (multipart field: file)
  router.post("/Core/UploadFile", async (req, res) => {
    try {
      const file = await parseMultipartFile(req);
      if (!file) return res.status(400).json({ message: "Missing file" });

      const safeName = safeBaseName(path.basename(file.originalname || "upload"));
      const finalName = `${Date.now()}-${safeName}`;
      const finalPath = path.join(uploadsDirAbs, finalName);

      await fs.mkdir(uploadsDirAbs, { recursive: true });
      await fs.writeFile(finalPath, file.buffer);

      const file_url = `${publicBaseUrl}/uploads/${encodeURIComponent(finalName)}`;
      res.json({ status: "success", file_url });
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes("Unexpected end of form")) {
        return res.status(400).json({ message: "Upload interrupted. Please try again." });
      }
      return res.status(400).json({ message: msg });
    }
  });

  // POST /api/integrations/Core/ExtractDataFromUploadedFile
  router.post("/Core/ExtractDataFromUploadedFile", async (req, res) => {
    const { file_url } = req.body ?? {};

    if (!file_url || typeof file_url !== "string") {
      return res.status(400).json({ status: "error", message: "file_url is required" });
    }

    try {
      // Support our own uploaded URLs: {publicBaseUrl}/uploads/<name>
      const uploadsPrefix = `${publicBaseUrl}/uploads/`;
      if (!file_url.startsWith(uploadsPrefix)) {
        return res
          .status(400)
          .json({ status: "error", message: "Only local uploaded file_url is supported" });
      }

      const fileName = decodeURIComponent(file_url.slice(uploadsPrefix.length));
      const filePath = path.join(uploadsDirAbs, fileName);
      const buf = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let rows;
      if (ext === ".xlsx" || ext === ".xls") {
        rows = parseXlsxToObjects(buf);
      } else {
        const text = buf.toString("utf8");
        rows = await parseCsvToObjects(text);
      }

      // Base44 returns {status, output}
      res.json({ status: "success", output: { members: rows } });
    } catch (err) {
      res.status(500).json({ status: "error", message: err?.message ?? "Failed to extract" });
    }
  });

  // Stubs used by SDK exports (not used by this app today)
  router.post("/Core/InvokeLLM", async (_req, res) => res.json({ status: "success", output: null }));
  router.post("/Core/GenerateImage", async (_req, res) => res.json({ status: "success", output: null }));
  router.post("/Core/CreateFileSignedUrl", async (_req, res) => res.json({ status: "success", url: null }));
  router.post("/Core/UploadPrivateFile", async (_req, res) => res.json({ status: "success" }));

  return router;
}

module.exports = {
  createIntegrationsRouter,
};

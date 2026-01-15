const express = require("express");
const path = require("node:path");
const fs = require("node:fs/promises");
const Busboy = require("busboy");
const XLSX = require("xlsx");
const { sendEmail, createBalancePdf } = require("./emailService");

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

function parseMultipartFile(req, { uploadsDirAbs, maxFileSizeBytes = 5 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data"));
      return;
    }

    if (!uploadsDirAbs) {
      reject(new Error("uploadsDirAbs is required"));
      return;
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: maxFileSizeBytes,
      },
    });
    let tempFilePath = null;
    let wroteBytes = 0;
    let fileInfo = null;

    busboy.on("file", (_name, file, info) => {
      fileInfo = info;
      const safeName = safeBaseName(path.basename(info.filename || "upload"));
      tempFilePath = path.join(uploadsDirAbs, `${Date.now()}-${safeName}`);
      const out = require("node:fs").createWriteStream(tempFilePath);
      file.on("data", (data) => {
        wroteBytes += data.length;
      });
      file.on("limit", () => {
        out.destroy(new Error("File exceeds upload limit"));
        file.unpipe(out);
        file.resume();
      });
      file.on("error", (err) => {
        out.destroy(err);
      });
      out.on("error", (err) => reject(err));
      out.on("finish", () => resolve({ tempFilePath, originalname: info.filename, mimetype: info.mimeType, size: wroteBytes }));
      file.pipe(out);
    });

    busboy.on("error", (err) => reject(err));
    busboy.on("finish", () => {
      if (!fileInfo) {
        reject(new Error("Missing file"));
        return;
      }
      if (!tempFilePath) {
        reject(new Error("Missing file"));
      }
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
    const { to, subject, body, html, pdf } = req.body ?? {};
    if (!to || !subject || (!body && !html)) {
      return res.status(400).json({ status: "error", message: "to, subject, and body are required" });
    }

    try {
      let attachments;
      if (pdf && typeof pdf === "object") {
        const pdfBuffer = await createBalancePdf({
          memberName: pdf.memberName,
          memberId: pdf.memberId,
          balance: pdf.balance,
          statementDate: pdf.statementDate,
          note: pdf.note,
        });
        attachments = [
          {
            filename: pdf.filename || `Statement-${(pdf.memberName || "member").replace(/\s+/g, "_")}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
            contentDisposition: "attachment",
          },
        ];
      }

      const info = await sendEmail({ to, subject, text: body, html, attachments });
      return res.json({ status: "success", messageId: info.messageId });
    } catch (err) {
      return res.status(500).json({ status: "error", message: err?.message || "Failed to send email" });
    }
  });

  // POST /api/integrations/Core/UploadFile (multipart field: file)
  router.post("/Core/UploadFile", async (req, res) => {
    try {
      await fs.mkdir(uploadsDirAbs, { recursive: true });
      const file = await parseMultipartFile(req, { uploadsDirAbs });
      if (!file) return res.status(400).json({ message: "Missing file" });

      const safeName = safeBaseName(path.basename(file.originalname || "upload"));
      const ext = path.extname(safeName).toLowerCase();
      const allowedExts = new Set([".csv", ".xlsx", ".xls"]);
      if (!allowedExts.has(ext)) {
        if (file.tempFilePath) {
          await fs.unlink(file.tempFilePath).catch(() => {});
        }
        return res.status(400).json({ message: "Only .csv, .xls, and .xlsx files are supported" });
      }

      const finalName = path.basename(file.tempFilePath);
      const finalPath = path.join(uploadsDirAbs, finalName);
      if (file.tempFilePath && file.tempFilePath !== finalPath) {
        await fs.rename(file.tempFilePath, finalPath);
      }

      const file_url = `${publicBaseUrl}/uploads/${encodeURIComponent(finalName)}`;
      res.json({ status: "success", file_url });
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes("Unexpected end of form")) {
        return res.status(400).json({ message: "Upload interrupted. Please try again." });
      }
      if (msg.toLowerCase().includes("upload limit")) {
        return res.status(400).json({ message: "File too large. Max size is 5MB." });
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
      const uploadsRoot = path.resolve(uploadsDirAbs);
      const filePath = path.resolve(uploadsRoot, fileName);
      if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) {
        return res.status(400).json({ status: "error", message: "Invalid file path" });
      }
      const buf = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let rows;
      if (ext === ".xlsx" || ext === ".xls") {
        rows = parseXlsxToObjects(buf);
      } else {
        const text = buf.toString("utf8");
        rows = await parseCsvToObjects(text);
      }

      // returns {status, output}
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

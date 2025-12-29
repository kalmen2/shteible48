const express = require("express");
const path = require("node:path");
const fs = require("node:fs/promises");
const multer = require("multer");

function safeBaseName(name) {
  return String(name ?? "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
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
      return obj;
    });
}

/** @param {{ uploadsDirAbs: string, publicBaseUrl: string }} deps */
function createIntegrationsRouter({ uploadsDirAbs, publicBaseUrl }) {
  const router = express.Router();

  const upload = multer({ dest: uploadsDirAbs });

  // POST /api/integrations/Core/SendEmail
  router.post("/Core/SendEmail", async (req, res) => {
    // Mimic Base44: accept {to, subject, body}
    // This is a stub (no SMTP configured).
    const { to, subject } = req.body ?? {};
    res.json({ status: "success", to, subject });
  });

  // POST /api/integrations/Core/UploadFile (multipart field: file)
  router.post("/Core/UploadFile", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Missing file" });

    const ext = path.extname(req.file.originalname || "");
    const safeName = safeBaseName(path.basename(req.file.originalname || "upload"));
    const finalName = `${req.file.filename}-${safeName}`;
    const finalPath = path.join(uploadsDirAbs, finalName);

    await fs.rename(req.file.path, finalPath);

    const file_url = `${publicBaseUrl}/uploads/${encodeURIComponent(finalName)}`;
    res.json({ status: "success", file_url });
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
      const text = buf.toString("utf8");

      const rows = await parseCsvToObjects(text);

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

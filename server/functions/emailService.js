const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!host || !port || !user || !pass || !from) return null;

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
    from,
  };
}

let cachedTransporter;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const config = getSmtpConfig();
  if (!config) return null;
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });
  return cachedTransporter;
}

function createBalancePdf({ memberName, balance, statementDate, note, memberId }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const safeName = memberName || "Member";
    const safeBalance = Number(balance || 0);
    const dateLabel = statementDate || new Date().toLocaleDateString();

    doc.fillColor("#1f2937").fontSize(20).text("Monthly Balance Statement", { align: "left" });
    doc.moveDown();
    doc.fontSize(12).fillColor("#111827").text(`Date: ${dateLabel}`);
    doc.text(`Recipient: ${safeName}`);
    if (memberId) doc.text(`ID: ${memberId}`);

    doc.moveDown();
    doc.fontSize(16).fillColor("#1f2937").text("Balance Due", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(26).fillColor("#b45309").text(`$${safeBalance.toFixed(2)}`);

    doc.moveDown();
    doc.fontSize(12).fillColor("#111827").text(note || "Please remit payment at your earliest convenience.", {
      align: "left",
    });

    doc.moveDown();
    doc.fontSize(10).fillColor("#6b7280").text("Thank you for your continued support.");

    doc.end();
  });
}

async function sendEmail({ to, subject, text, html, attachments }) {
  const config = getSmtpConfig();
  const transporter = getTransporter();
  if (!config || !transporter) {
    const err = new Error("Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.");
    // @ts-ignore
    err.status = 500;
    throw err;
  }

  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject,
    text: text || undefined,
    html: html || undefined,
    attachments: attachments && attachments.length ? attachments : undefined,
  });

  return info;
}

module.exports = {
  getSmtpConfig,
  getTransporter,
  sendEmail,
  createBalancePdf,
};

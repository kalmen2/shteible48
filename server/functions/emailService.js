const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

const defaultStatementTemplate = {
  header_title: "Shtiebel 48",
  header_subtitle: "Manager",
  header_font_size: 32,
  header_color: "#1e3a8a",
  show_member_id: true,
  show_email: true,
  show_charges_section: true,
  show_payments_section: true,
  charges_color: "#d97706",
  payments_color: "#16a34a",
  balance_color: "#dc2626",
  body_font_size: 14,
  footer_text: "Thank you for your support",
  show_footer: true,
};

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

function createBalancePdf({ memberName, balance, statementDate, note, memberId, template }) {
  const resolvedTemplate = { ...defaultStatementTemplate, ...(template || {}) };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const safeName = memberName || "Member";
    const safeBalance = Number(balance || 0);
    const dateLabel = statementDate || new Date().toLocaleDateString();

    const headerSize = resolvedTemplate.header_font_size || 24;
    const bodySize = resolvedTemplate.body_font_size || 12;

    doc
      .fillColor(resolvedTemplate.header_color)
      .fontSize(headerSize)
      .text(resolvedTemplate.header_title || "Monthly Statement", { align: "left" });
    if (resolvedTemplate.header_subtitle) {
      doc
        .moveDown(0.2)
        .fontSize(Math.round(headerSize * 0.4))
        .fillColor("#475569")
        .text(resolvedTemplate.header_subtitle, { align: "left" });
    }
    doc.moveDown();
    doc.fontSize(bodySize).fillColor("#111827").text(`Date: ${dateLabel}`);
    doc.text(`Recipient: ${safeName}`);
    if (memberId && resolvedTemplate.show_member_id) doc.text(`ID: ${memberId}`);

    doc.moveDown();
    doc
      .fontSize(Math.round(bodySize * 1.2))
      .fillColor(resolvedTemplate.header_color)
      .text("Balance Due", { underline: true });
    doc.moveDown(0.5);
    doc
      .fontSize(Math.round(bodySize * 2))
      .fillColor((safeBalance || 0) > 0 ? resolvedTemplate.balance_color : resolvedTemplate.payments_color)
      .text(`$${safeBalance.toFixed(2)}`);

    doc.moveDown();
    doc
      .fontSize(bodySize)
      .fillColor("#111827")
      .text(note || "Please remit payment at your earliest convenience.", {
        align: "left",
      });

    if (resolvedTemplate.show_footer && resolvedTemplate.footer_text) {
      doc.moveDown();
      doc
        .fontSize(Math.round(bodySize * 0.8))
        .fillColor("#6b7280")
        .text(resolvedTemplate.footer_text);
    }

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

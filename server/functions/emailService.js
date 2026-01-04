const nodemailer = require("nodemailer");

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

async function sendEmail({ to, subject, text, html }) {
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
  });

  return info;
}

module.exports = {
  getSmtpConfig,
  getTransporter,
  sendEmail,
};

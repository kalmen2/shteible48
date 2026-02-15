const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const { connectMongo } = require("./mongo");
const { createMongoEntityStore } = require("./store.mongo");
const { sendEmail, createBalancePdf } = require("./emailService");

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_BASE_URL = (process.env.FRONTEND_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const SAVE_CARD_TOKEN_EXPIRES_IN = process.env.SAVE_CARD_TOKEN_EXPIRES_IN || "7d";

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function monthKeyFromParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function normalizeSchedule(schedule) {
  if (!schedule) return null;
  return {
    id: schedule.id,
    name: schedule.name ? String(schedule.name) : "",
    enabled: Boolean(schedule.enabled),
    day_of_month: Number(schedule.day_of_month ?? 1),
    hour: Number(schedule.hour ?? 9),
    minute: Number(schedule.minute ?? 0),
    time_zone: String(schedule.time_zone || "America/New_York"),
    send_to: schedule.send_to === "selected" ? "selected" : "all",
    selected_member_ids: Array.isArray(schedule.selected_member_ids) ? schedule.selected_member_ids : [],
    subject: String(schedule.subject || "Monthly Statement"),
    body: String(schedule.body ?? ""),
    attach_invoice: Boolean(schedule.attach_invoice),
    center_body: Boolean(schedule.center_body),
    last_sent_month: schedule.last_sent_month ? String(schedule.last_sent_month) : null,
  };
}

function containsHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlFromBody(value) {
  if (containsHtml(value)) return String(value || "");
  return escapeHtml(value).replace(/\n/g, "<br/>");
}

function normalizeQuillHtmlForEmail(value) {
  let html = String(value || "");
  if (!html || !containsHtml(html)) return html;

  const classStyleMap = {
    "ql-align-center": "text-align:center;",
    "ql-align-right": "text-align:right;",
    "ql-align-justify": "text-align:justify;",
    "ql-direction-rtl": "direction:rtl;text-align:right;",
    "ql-size-small": "font-size:0.75em;",
    "ql-size-large": "font-size:1.5em;",
    "ql-size-huge": "font-size:2.5em;",
    "ql-font-serif": "font-family:Georgia, Times New Roman, serif;",
    "ql-font-monospace": "font-family:Monaco, Menlo, Consolas, monospace;",
    "ql-indent-1": "padding-left:3em;",
    "ql-indent-2": "padding-left:6em;",
    "ql-indent-3": "padding-left:9em;",
    "ql-indent-4": "padding-left:12em;",
    "ql-indent-5": "padding-left:15em;",
    "ql-indent-6": "padding-left:18em;",
    "ql-indent-7": "padding-left:21em;",
    "ql-indent-8": "padding-left:24em;",
  };

  html = html.replace(/<span[^>]*class=(["'])[^"']*ql-ui[^"']*\1[^>]*>[\s\S]*?<\/span>/gi, "");

  html = html.replace(
    /<([a-z0-9]+)([^>]*?)\sclass=(["'])([^"']*)\3([^>]*)>/gi,
    (full, tag, before, quote, classAttr, after) => {
      const classes = String(classAttr)
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);

      const styles = [];
      const keepClasses = [];

      for (const cls of classes) {
        const mapped = classStyleMap[cls];
        if (mapped) {
          styles.push(mapped);
        } else if (!cls.startsWith("ql-")) {
          keepClasses.push(cls);
        }
      }

      const attrsRaw = `${before}${after}`;
      const styleMatch = attrsRaw.match(/\sstyle=(["'])(.*?)\1/i);
      const existingStyle = styleMatch ? String(styleMatch[2] || "").trim() : "";
      const attrsWithoutStyle = attrsRaw.replace(/\sstyle=(["']).*?\1/i, "");

      const mergedStyle = [existingStyle, ...styles].filter(Boolean).join(" ").trim();
      const classPart = keepClasses.length ? ` class="${keepClasses.join(" ")}"` : "";
      const stylePart = mergedStyle ? ` style="${mergedStyle}"` : "";

      return `<${tag}${attrsWithoutStyle}${classPart}${stylePart}>`;
    }
  );

  return html;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function wrapCentered(html) {
  return `<div style="text-align:center; white-space:pre-wrap;">${html}</div>`;
}

function computeMemberBalance(member) {
  return Number(member.total_owed || 0);
}

function computeGuestBalance(guest) {
  return Number(guest.total_owed || 0);
}

function normalizeSelectedIds(selectedIds) {
  const memberIds = new Set();
  const guestIds = new Set();
  for (const raw of selectedIds || []) {
    const value = String(raw);
    if (value.startsWith("member:")) {
      memberIds.add(value.slice("member:".length));
    } else if (value.startsWith("guest:")) {
      guestIds.add(value.slice("guest:".length));
    } else {
      memberIds.add(value);
    }
  }
  return { memberIds, guestIds };
}

function buildSaveCardUrlForRecord(record) {
  try {
    const isGuest = record.guest_id || (record.member_id === undefined && record.membership_active === undefined);
    const payload = isGuest
      ? { kind: "guest", id: String(record.id) }
      : { kind: "member", id: String(record.id), member_id: record.member_id };
    const token = jwt.sign(
      { ...payload, jti: randomUUID() },
      JWT_SECRET,
      { expiresIn: SAVE_CARD_TOKEN_EXPIRES_IN }
    );
    return `${FRONTEND_BASE_URL}/save-card?token=${encodeURIComponent(token)}`;
  } catch (err) {
    console.error("Failed to build save card url", err?.message || err);
    return "";
  }
}

function applyTemplate(template, member, balanceValue) {
  const name = member.english_name || member.full_name || member.hebrew_name || "Member";
  const hebrewName = member.hebrew_name || "";
  const balance = Number(balanceValue ?? member.total_owed ?? 0).toFixed(2);
  const memberId = member.member_id || member.id || "";
  const saveCardUrl = buildSaveCardUrlForRecord(member);
  return String(template)
    .replace(/{member_name}/g, name)
    .replace(/{hebrew_name}/g, hebrewName)
    .replace(/{balance}/g, `$${balance}`)
    .replace(/{id}/g, memberId)
    .replace(/{save_card_url}/g, saveCardUrl);
}

async function runMonthlyEmailScheduler() {
  const db = await connectMongo();
  const store = createMongoEntityStore({ db });

  const scheduleRecords = await store.list("EmailSchedule", "-created_date", 200);
  const dueSchedules = [];
  for (const record of scheduleRecords) {
    const schedule = normalizeSchedule(record);
    if (!schedule || !schedule.enabled) continue;
    const nowParts = getZonedParts(new Date(), schedule.time_zone);
    const targetDay = Math.min(schedule.day_of_month, daysInMonth(nowParts.year, nowParts.month));
    if (nowParts.day !== targetDay || nowParts.hour !== schedule.hour || nowParts.minute !== schedule.minute) {
      continue;
    }
    const currentMonth = monthKeyFromParts(nowParts);
    if (schedule.last_sent_month === currentMonth) {
      continue;
    }
    dueSchedules.push({ schedule, currentMonth });
  }

  if (!dueSchedules.length) {
    return { ok: true, skipped: "not_time" };
  }

  const members = await store.list("Member", "-created_date", 10000);
  const guests = await store.list("Guest", "-created_date", 10000);
  const plans = await store.list("MembershipPlan", "-created_date", 1);
  const templates = await store.list("StatementTemplate", "-created_date", 1);
  const currentPlan = plans[0];
  const activeTemplate = templates[0];
  let sent = 0;
  let skippedNoEmail = 0;
  const failed = [];

  for (const entry of dueSchedules) {
    const schedule = entry.schedule;
    const currentMonth = entry.currentMonth;
    const selected = normalizeSelectedIds(schedule.selected_member_ids);
    const recipients =
      schedule.send_to === "selected"
        ? [
            ...members.filter((m) => selected.memberIds.has(m.id)),
            ...guests.filter((g) => selected.guestIds.has(g.id)),
          ]
        : members;

    for (const record of recipients) {
      if (!record.email) {
        skippedNoEmail += 1;
        continue;
      }
      const isGuest = Boolean(record.guest_id || (!record.member_id && record.membership_active === undefined));
      const balanceValue = isGuest ? computeGuestBalance(record) : computeMemberBalance(record);
      const body = applyTemplate(schedule.body, record, balanceValue);
      const htmlBody = normalizeQuillHtmlForEmail(htmlFromBody(body));
      const centeredHtml = schedule.center_body ? wrapCentered(htmlBody) : htmlBody;
      const textBody = stripHtml(htmlBody) || body;
      let attachments;

      if (schedule.attach_invoice) {
        if (!activeTemplate) {
          failed.push({
            id: record.id,
            email: record.email,
            reason: "No statement template saved",
          });
          continue;
        }
        const transactions = isGuest
          ? await store.filter(
              "GuestTransaction",
              { guest_id: String(record.id) },
              "-date",
              2000
            )
          : await store.filter(
              "Transaction",
              { member_id: String(record.id) },
              "-date",
              2000
            );
        const charges = transactions.filter((t) => t.type === "charge");
        const payments = transactions.filter((t) => t.type === "payment");
        const totalCharges = charges.reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const totalPayments = payments.reduce((sum, t) => sum + Number(t.amount || 0), 0);

        const pdfBuffer = await createBalancePdf({
          memberName: record.full_name || record.english_name || record.hebrew_name || "Member",
          memberId: record.member_id || record.id,
          balance: balanceValue,
          statementDate: currentMonth,
          note: "This statement reflects your current balance and transaction history.",
          template: activeTemplate,
          charges,
          payments,
          totalCharges,
          totalPayments,
        });
        attachments = [
          {
            filename: `Statement-${(record.full_name || record.member_id || "member").replace(/\s+/g, "_")}.pdf`,
            content: pdfBuffer,
          },
        ];
      }

      try {
        await sendEmail({
          to: record.email,
          subject: schedule.subject,
          text: textBody,
          html: centeredHtml,
          attachments,
        });
        sent += 1;
      } catch (err) {
        failed.push({
          id: record.id,
          email: record.email,
          reason: err?.message || "Failed to send",
        });
      }
    }

    await store.update("EmailSchedule", schedule.id, { last_sent_month: currentMonth });
  }

  return { ok: true, sent, skippedNoEmail, failed, schedules: dueSchedules.length };
}

module.exports = {
  runMonthlyEmailScheduler,
};

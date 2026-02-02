const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const { connectMongo } = require("./mongo");
const { createMongoEntityStore } = require("./store.mongo");
const { sendEmail, createBalancePdf } = require("./emailService");

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_BASE_URL = (process.env.FRONTEND_BASE_URL || "http://localhost:5173").replace(/\/$/, "");

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
    body: String(schedule.body || "Dear {member_name},\n\nYour balance is {balance}.\n\nThank you."),
    attach_invoice: Boolean(schedule.attach_invoice),
    last_sent_month: schedule.last_sent_month ? String(schedule.last_sent_month) : null,
  };
}

function computeMemberBalance(member, plan, charges, recurringPayments) {
  const standardAmount = Number(plan?.standard_amount || 0);
  const totalOwed = Number(member.total_owed || 0);

  const memberCharges = (charges || []).filter((c) => c.member_id === member.id && c.is_active);
  const chargesTotal = memberCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const recurringTotal = (recurringPayments || [])
    .filter((p) => p.member_id === member.id && p.is_active && p.payment_type !== "membership")
    .reduce((sum, p) => sum + Number(p.amount_per_month || 0), 0);
  const monthlyDue =
    standardAmount +
    (Number.isFinite(chargesTotal) ? chargesTotal : 0) +
    (Number.isFinite(recurringTotal) ? recurringTotal : 0);
  return totalOwed + monthlyDue;
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
    const token = jwt.sign({ ...payload, jti: randomUUID() }, JWT_SECRET, { expiresIn: "24h" });
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
  const membershipCharges = await store.filter("MembershipCharge", { is_active: true }, "-created_date", 10000);
  const recurringPayments = await store.filter("RecurringPayment", { is_active: true }, "-created_date", 10000);
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
      const balanceValue = isGuest
        ? computeGuestBalance(record)
        : computeMemberBalance(record, currentPlan, membershipCharges, recurringPayments);
      const body = applyTemplate(schedule.body, record, balanceValue);
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
        const pdfBuffer = await createBalancePdf({
          memberName: record.full_name || record.english_name || record.hebrew_name || "Member",
          memberId: record.member_id || record.id,
          balance: balanceValue,
          statementDate: currentMonth,
          note: "This statement reflects your current balance.",
          template: activeTemplate,
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
          text: body,
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

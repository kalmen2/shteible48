const { connectMongo } = require("./mongo");
const { createMongoEntityStore } = require("./store.mongo");
const { sendEmail, createBalancePdf } = require("./emailService");

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
  const memberCharges = (charges || []).filter((c) => c.member_id === member.id && c.is_active);
  const memberRecurring = (recurringPayments || []).filter((p) => p.member_id === member.id && p.is_active);
  const chargesTotal = memberCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const recurringTotal = memberRecurring.reduce((sum, p) => sum + Number(p.amount_per_month || 0), 0);
  return Number(member.total_owed || 0) + standardAmount + chargesTotal + recurringTotal;
}

function applyTemplate(template, member, balanceValue) {
  const name = member.english_name || member.full_name || member.hebrew_name || "Member";
  const balance = Number(balanceValue ?? member.total_owed ?? 0).toFixed(2);
  const memberId = member.member_id || member.id || "";
  return String(template)
    .replace(/{member_name}/g, name)
    .replace(/{balance}/g, `$${balance}`)
    .replace(/{id}/g, memberId);
}

async function runMonthlyEmailScheduler() {
  const db = await connectMongo();
  const store = createMongoEntityStore({ db });

  const schedules = await store.filter("EmailSchedule", { id: "default" }, undefined, 1);
  const schedule = normalizeSchedule(schedules[0]);
  if (!schedule || !schedule.enabled) return { ok: true, skipped: "disabled" };

  const nowParts = getZonedParts(new Date(), schedule.time_zone);
  const targetDay = Math.min(schedule.day_of_month, daysInMonth(nowParts.year, nowParts.month));
  if (nowParts.day !== targetDay || nowParts.hour !== schedule.hour || nowParts.minute !== schedule.minute) {
    return { ok: true, skipped: "not_time" };
  }

  const currentMonth = monthKeyFromParts(nowParts);
  if (schedule.last_sent_month === currentMonth) {
    return { ok: true, skipped: "already_sent" };
  }

  const members = await store.list("Member", "-created_date", 10000);
  const plans = await store.list("MembershipPlan", "-created_date", 1);
  const membershipCharges = await store.filter("MembershipCharge", { is_active: true }, "-created_date", 10000);
  const recurringPayments = await store.filter("RecurringPayment", { is_active: true }, "-created_date", 10000);
  const currentPlan = plans[0];
  const recipients =
    schedule.send_to === "selected"
      ? members.filter((m) => schedule.selected_member_ids.includes(m.id))
      : members;

  let sent = 0;
  let skippedNoEmail = 0;
  for (const member of recipients) {
    if (!member.email) {
      skippedNoEmail += 1;
      continue;
    }
    const memberBalance = computeMemberBalance(member, currentPlan, membershipCharges, recurringPayments);
    const body = applyTemplate(schedule.body, member, memberBalance);
    let finalBody = body;
    let attachments;

    if (schedule.attach_invoice) {
      const pdfBuffer = await createBalancePdf({
        memberName: member.full_name || member.english_name || member.hebrew_name || "Member",
        memberId: member.member_id || member.id,
        balance: memberBalance,
        statementDate: currentMonth,
        note: "This statement reflects your current balance.",
      });
      attachments = [
        {
          filename: `Statement-${(member.full_name || member.member_id || "member").replace(/\s+/g, "_")}.pdf`,
          content: pdfBuffer,
        },
      ];
    }

    await sendEmail({
      to: member.email,
      subject: schedule.subject,
      text: finalBody,
      attachments,
    });
    sent += 1;
  }

  await store.update("EmailSchedule", schedules[0].id, { last_sent_month: currentMonth });
  return { ok: true, sent, skippedNoEmail };
}

module.exports = {
  runMonthlyEmailScheduler,
};

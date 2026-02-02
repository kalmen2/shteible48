const { connectMongo } = require("./mongo");
const { createMongoEntityStore } = require("./store.mongo");

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

function monthLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", year: "numeric" }).format(date);
}

function monthStartIsoFromParts(parts) {
  const month = String(parts.month).padStart(2, "0");
  return `${parts.year}-${month}-01`;
}

function isDuplicateError(err) {
  const code = err?.code || err?.errno || err?.sqlState;
  const msg = err?.message || "";
  return (
    code === 11000 ||
    code === 1062 ||
    code === "23505" ||
    code === "ER_DUP_ENTRY" ||
    code === "SQLITE_CONSTRAINT" ||
    /duplicate key/i.test(msg) ||
    /duplicate entry/i.test(msg) ||
    /unique constraint/i.test(msg)
  );
}

async function runMonthlyMembershipCharges() {
  const db = await connectMongo();
  const store = createMongoEntityStore({ db });

  const plans = await store.list("MembershipPlan", "-created_date", 1);
  const currentPlan = plans[0];
  const standardAmount = Number(currentPlan?.standard_amount);
  if (!Number.isFinite(standardAmount) || standardAmount <= 0) {
    return { ok: true, skipped: "no_plan" };
  }

  const members = await store.list("Member", "-created_date", 10000);
  if (!members.length) {
    return { ok: true, skipped: "no_members" };
  }

  const timeZone = process.env.BILLING_TIME_ZONE || "UTC";
  const now = new Date();
  const nowParts = getZonedParts(now, timeZone);
  const currentMonth = monthKeyFromParts(nowParts);
  const label = monthLabel(now, timeZone);
  const chargeDate = monthStartIsoFromParts(nowParts);
  let charged = 0;
  let skipped = 0;

  for (const member of members) {
    const monthlyId = `monthly-membership:${member.id}:${currentMonth}`;
    const [existingById] = await store.filter("Transaction", { id: monthlyId }, undefined, 1);
    if (existingById) {
      skipped += 1;
      continue;
    }

    const [existingByKey] = await store.filter(
      "Transaction",
      { member_id: member.id, type: "charge", monthly_key: currentMonth },
      undefined,
      1
    );
    if (existingByKey) {
      skipped += 1;
      continue;
    }

    const charges = await store.filter(
      "Transaction",
      { member_id: member.id, type: "charge" },
      "-date",
      2000
    );

    const hasChargeThisMonth = charges.some((t) => {
      const desc = String(t.description || "");
      const date = String(t.date || "");
      return desc.startsWith("Standard Monthly") && date.startsWith(currentMonth);
    });

    if (hasChargeThisMonth) {
      skipped += 1;
      continue;
    }

    try {
      await store.create("Transaction", {
        id: monthlyId,
        member_id: member.id,
        member_name: member.full_name || member.english_name || member.hebrew_name || undefined,
        type: "charge",
        description: `Standard Monthly - ${label}`,
        amount: standardAmount,
        date: chargeDate,
        provider: "system",
        monthly_key: currentMonth,
      });
    } catch (err) {
      if (isDuplicateError(err)) {
        skipped += 1;
        continue;
      }
      throw err;
    }

    const newBalance = (member.total_owed || 0) + standardAmount;
    await store.update("Member", member.id, { total_owed: newBalance });
    charged += 1;
  }

  return { ok: true, charged, skipped };
}

module.exports = {
  runMonthlyMembershipCharges,
};

const { connectMongo } = require("./mongo");
const { createMongoEntityStore } = require("./store.mongo");

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function monthStartIso(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split("T")[0];
}

async function runMonthlyMembershipCharges() {
  const db = await connectMongo();
  const store = createMongoEntityStore({ db });

  const plans = await store.list("MembershipPlan", "-created_date", 1);
  const currentPlan = plans[0];
  const amount = Number(currentPlan?.standard_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: true, skipped: "no_plan" };
  }

  const members = await store.filter("Member", { membership_active: true }, "-created_date", 10000);
  if (!members.length) {
    return { ok: true, skipped: "no_members" };
  }

  const now = new Date();
  const currentMonth = monthKey(now);
  const label = monthLabel(now);
  const chargeDate = monthStartIso(now);
  let charged = 0;
  let skipped = 0;

  for (const member of members) {
    const charges = await store.filter(
      "Transaction",
      { member_id: member.id, type: "charge" },
      "-date",
      2000
    );

    const hasChargeThisMonth = charges.some((t) => {
      const desc = String(t.description || "");
      const date = String(t.date || "");
      return desc.startsWith("Monthly Membership") && date.startsWith(currentMonth);
    });

    if (hasChargeThisMonth) {
      skipped += 1;
      continue;
    }

    await store.create("Transaction", {
      member_id: member.id,
      member_name: member.full_name || member.english_name || member.hebrew_name || undefined,
      type: "charge",
      description: `Monthly Membership - ${label}`,
      amount,
      date: chargeDate,
      provider: "system",
    });

    const newBalance = (member.total_owed || 0) + amount;
    await store.update("Member", member.id, { total_owed: newBalance });
    charged += 1;
  }

  return { ok: true, charged, skipped };
}

module.exports = {
  runMonthlyMembershipCharges,
};

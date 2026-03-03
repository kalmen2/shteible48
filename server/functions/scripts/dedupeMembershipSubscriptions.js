const { MongoClient } = require("mongodb");
const Stripe = require("stripe");
require("dotenv").config();

function toDateValue(rec) {
  const d = rec?.updated_date || rec?.created_date || rec?.start_date;
  if (!d) return 0;
  const t = Date.parse(String(d));
  return Number.isFinite(t) ? t : 0;
}

function isMissingStripeResource(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  return code === "resource_missing" || /No such/i.test(message);
}

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  const dbName =
    process.env.MONGODB_DB_NAME ||
    process.env.MONGODB_DATABASE ||
    "synagogue_harmony";
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!mongoUri) throw new Error("MONGODB_URI is required");
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required");

  const stripe = new Stripe(stripeKey);
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  const recCol = db.collection("RecurringPayment");
  const memberCol = db.collection("Member");

  try {
    const activeMembershipRecs = await recCol
      .find({
        payment_type: "membership",
        is_active: true,
        stripe_subscription_id: { $exists: true, $ne: null },
      })
      .toArray();

    const byMember = new Map();
    for (const rec of activeMembershipRecs) {
      const key = String(rec?.member_id || "");
      if (!key) continue;
      if (!byMember.has(key)) byMember.set(key, []);
      byMember.get(key).push(rec);
    }

    let membersWithDuplicates = 0;
    let cancelledSubscriptions = 0;
    let deactivatedRecords = 0;
    let errors = 0;
    const today = new Date().toISOString().split("T")[0];

    for (const [memberId, recs] of byMember.entries()) {
      const uniqueBySub = new Map();
      for (const rec of recs) {
        const subId = String(rec?.stripe_subscription_id || "");
        if (!subId) continue;
        if (!uniqueBySub.has(subId)) uniqueBySub.set(subId, rec);
      }
      const uniqueRecs = [...uniqueBySub.values()];
      if (uniqueRecs.length <= 1) continue;

      membersWithDuplicates += 1;
      uniqueRecs.sort((a, b) => toDateValue(b) - toDateValue(a));
      const keep = uniqueRecs[0];
      const keepSubId = String(keep.stripe_subscription_id);

      for (const rec of uniqueRecs.slice(1)) {
        const subId = String(rec.stripe_subscription_id || "");
        if (!subId || subId === keepSubId) continue;
        try {
          await stripe.subscriptions.cancel(subId);
          cancelledSubscriptions += 1;
        } catch (err) {
          if (!isMissingStripeResource(err)) {
            errors += 1;
            console.error(
              `[dedupe] Failed to cancel subscription ${subId} for member ${memberId}:`,
              err?.message || err
            );
          }
        }

        try {
          await recCol.updateOne(
            { id: String(rec.id) },
            { $set: { is_active: false, ended_date: today } }
          );
          deactivatedRecords += 1;
        } catch (err) {
          errors += 1;
          console.error(
            `[dedupe] Failed to deactivate recurring record ${rec.id}:`,
            err?.message || err
          );
        }
      }

      try {
        await memberCol.updateOne(
          { $or: [{ id: String(memberId) }, { member_id: String(memberId) }] },
          {
            $set: {
              membership_active: true,
              stripe_subscription_id: keepSubId,
            },
          }
        );
      } catch (err) {
        errors += 1;
        console.error(
          `[dedupe] Failed to align member ${memberId} with subscription ${keepSubId}:`,
          err?.message || err
        );
      }
    }

    console.log("Dedupe complete:");
    console.log(`- Members with duplicates: ${membersWithDuplicates}`);
    console.log(`- Stripe subscriptions cancelled: ${cancelledSubscriptions}`);
    console.log(`- Local recurring records deactivated: ${deactivatedRecords}`);
    console.log(`- Errors: ${errors}`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Dedupe failed:", err?.message || err);
  process.exitCode = 1;
});

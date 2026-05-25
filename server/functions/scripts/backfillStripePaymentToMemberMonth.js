require("dotenv").config();
const { MongoClient } = require("mongodb");
const Stripe = require("stripe");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key || !key.startsWith("--")) continue;
    const name = key.slice(2);
    if (!name) continue;
    if (!next || next.startsWith("--")) {
      args[name] = "true";
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function monthLabelFromYYYYMM(yyyyMm) {
  const [year, month] = String(yyyyMm || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return "Unknown Month";
  }
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatIsoDate(yyyyMm) {
  const m = String(yyyyMm || "");
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  return `${m}-01`;
}

function buildBackfillId(paymentIntentId, memberId, yyyyMm) {
  return `backfill-payment:${paymentIntentId}:${memberId}:${yyyyMm}`;
}

function toDollars(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
}

async function run() {
  const args = parseArgs(process.argv);

  const memberInput = String(args["member-id"] || "").trim();
  const paymentIntentId = String(args["payment-intent-id"] || "").trim();
  const targetMonth = String(args["target-month"] || "").trim(); // YYYY-MM
  const force = String(args.force || "").toLowerCase() === "true";

  if (!memberInput || !paymentIntentId || !targetMonth) {
    throw new Error(
      "Usage: node scripts/backfillStripePaymentToMemberMonth.js --member-id <id> --payment-intent-id <pi_...> --target-month <YYYY-MM> [--force true]"
    );
  }

  const targetDate = formatIsoDate(targetMonth);
  if (!targetDate) {
    throw new Error("target-month must be in YYYY-MM format");
  }

  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE || "synagogue_harmony";
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required");

  const stripe = new Stripe(stripeKey);
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  const memberCol = db.collection("Member");
  const txCol = db.collection("Transaction");

  try {
    const member = await memberCol.findOne({
      $or: [{ id: memberInput }, { member_id: memberInput }],
    });
    if (!member) {
      throw new Error(`Member not found for id/member_id '${memberInput}'`);
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!paymentIntent) {
      throw new Error(`Stripe payment intent not found: ${paymentIntentId}`);
    }

    if (String(paymentIntent.status || "") !== "succeeded") {
      throw new Error(
        `Payment intent ${paymentIntentId} is not succeeded (status=${paymentIntent.status})`
      );
    }

    const piCustomer = paymentIntent.customer ? String(paymentIntent.customer) : "";
    const memberCustomer = member?.stripe_customer_id ? String(member.stripe_customer_id) : "";
    if (piCustomer && memberCustomer && piCustomer !== memberCustomer && !force) {
      throw new Error(
        `Stripe customer mismatch (pi customer=${piCustomer}, member customer=${memberCustomer}). Use --force true to override.`
      );
    }

    const existingByPi = await txCol.findOne({
      stripe_payment_intent_id: paymentIntentId,
      type: "payment",
    });

    if (existingByPi) {
      if (String(existingByPi.member_id || "") !== String(member.id || "")) {
        throw new Error(
          `Payment intent already mapped to another member (${existingByPi.member_id}). Aborting.`
        );
      }
      console.log("[backfill] Payment transaction already exists; nothing to insert.", {
        paymentIntentId,
        memberId: member.id,
        transactionId: existingByPi.id,
      });
      return;
    }

    const amountCents = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new Error(`Invalid amount on payment intent ${paymentIntentId}: ${paymentIntent.amount_received}`);
    }
    const amount = toDollars(amountCents);
    const nowIso = new Date().toISOString();
    const txId = buildBackfillId(paymentIntentId, String(member.id), targetMonth);
    const monthLabel = monthLabelFromYYYYMM(targetMonth);

    const txDoc = {
      id: txId,
      member_id: String(member.id),
      member_name:
        member.full_name || member.english_name || member.hebrew_name || undefined,
      type: "payment",
      description: `Monthly Membership - ${monthLabel} (Stripe)`,
      amount,
      date: targetDate,
      provider: "stripe",
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: piCustomer || memberCustomer || undefined,
      created_date: nowIso,
      updated_date: nowIso,
    };

    await txCol.insertOne(txDoc);

    const currentBalance = Number(member.total_owed || 0);
    const newBalance = Math.max(0, currentBalance - amount);
    await memberCol.updateOne(
      { _id: member._id },
      { $set: { total_owed: newBalance, updated_date: nowIso } }
    );

    console.log("[backfill] completed", {
      memberId: member.id,
      memberName: member.full_name || "",
      paymentIntentId,
      amount,
      targetMonth,
      targetDate,
      previousBalance: currentBalance,
      newBalance,
      transactionId: txId,
    });
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("[backfill] failed:", err?.message || err);
  process.exitCode = 1;
});


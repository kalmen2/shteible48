require("dotenv").config();
const { MongoClient } = require("mongodb");
const Stripe = require("stripe");

async function countAllStripeCustomers(stripe) {
  let total = 0;
  let startingAfter = undefined;
  for (;;) {
    const page = await stripe.customers.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    total += page?.data?.length || 0;
    if (!page?.has_more || !page?.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return total;
}

async function countActiveMembershipSubscriptions(stripe) {
  let total = 0;
  let startingAfter = undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const sub of page?.data || []) {
      const status = String(sub?.status || "");
      const paymentType = String(sub?.metadata?.paymentType || sub?.metadata?.payment_type || "");
      if (!["active", "trialing", "past_due", "unpaid", "paused", "incomplete"].includes(status)) continue;
      if (paymentType === "membership") total += 1;
    }

    if (!page?.has_more || !page?.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return total;
}

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE || "synagogue_harmony";
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!mongoUri) throw new Error("MONGODB_URI is required");
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required");

  const stripe = new Stripe(stripeKey);
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  try {
    const memberCol = db.collection("Member");

    const totalMembers = await memberCol.countDocuments({});
    const membersWithStripeCustomer = await memberCol.countDocuments({
      stripe_customer_id: { $exists: true, $ne: null, $ne: "" },
    });
    const uniqueLinkedStripeCustomers = (
      await memberCol.distinct("stripe_customer_id", {
        stripe_customer_id: { $exists: true, $ne: null, $ne: "" },
      })
    ).length;

    const totalStripeCustomers = await countAllStripeCustomers(stripe);
    const activeMembershipSubscriptions = await countActiveMembershipSubscriptions(stripe);

    console.log("Stripe Member Report:");
    console.log(`- Members in DB: ${totalMembers}`);
    console.log(`- Members linked to Stripe customer: ${membersWithStripeCustomer}`);
    console.log(`- Unique linked Stripe customer IDs: ${uniqueLinkedStripeCustomers}`);
    console.log(`- Total Stripe customers in account: ${totalStripeCustomers}`);
    console.log(`- Active membership subscriptions in Stripe: ${activeMembershipSubscriptions}`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Stripe member count failed:", err?.message || err);
  process.exitCode = 1;
});


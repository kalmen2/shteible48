require("dotenv").config();
const { MongoClient } = require("mongodb");
const Stripe = require("stripe");

const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);

async function listAllStripeCustomers(stripe) {
  const out = [];
  let startingAfter = undefined;
  for (;;) {
    const page = await stripe.customers.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...(page?.data || []));
    if (!page?.has_more || !page?.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

async function listCustomerSubscriptions(stripe, customerId) {
  const out = [];
  let startingAfter = undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({
      customer: String(customerId),
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...(page?.data || []));
    if (!page?.has_more || !page?.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

function normalizeIds(ids) {
  return new Set(
    (ids || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );
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
    const guestCol = db.collection("Guest");

    const linkedMemberIds = normalizeIds(
      await memberCol.distinct("stripe_customer_id", {
        stripe_customer_id: { $exists: true, $ne: null, $ne: "" },
      })
    );

    const linkedGuestIds = normalizeIds(
      await guestCol.distinct("stripe_customer_id", {
        stripe_customer_id: { $exists: true, $ne: null, $ne: "" },
      })
    );

    const allCustomers = await listAllStripeCustomers(stripe);
    const unlinked = [];

    for (const c of allCustomers) {
      const customerId = String(c?.id || "");
      if (!customerId) continue;
      if (linkedMemberIds.has(customerId) || linkedGuestIds.has(customerId)) continue;

      const subs = await listCustomerSubscriptions(stripe, customerId);
      const activeSubs = subs.filter((s) => ACTIVE_SUB_STATUSES.has(String(s?.status || "")));

      unlinked.push({
        id: customerId,
        email: c?.email || "",
        name: c?.name || "",
        created: c?.created ? new Date(Number(c.created) * 1000).toISOString() : "",
        activeSubscriptions: activeSubs.length,
        totalSubscriptions: subs.length,
      });
    }

    console.log("Unlinked Stripe Customers Report:");
    console.log(`- Total Stripe customers: ${allCustomers.length}`);
    console.log(`- Linked in Member: ${linkedMemberIds.size}`);
    console.log(`- Linked in Guest: ${linkedGuestIds.size}`);
    console.log(`- Unlinked customers: ${unlinked.length}`);

    if (!unlinked.length) {
      console.log("No unlinked Stripe customers found.");
      return;
    }

    console.log("\nUnlinked customer list:");
    console.log("id,email,name,created,activeSubscriptions,totalSubscriptions");
    for (const row of unlinked) {
      const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
      console.log(
        [
          esc(row.id),
          esc(row.email),
          esc(row.name),
          esc(row.created),
          row.activeSubscriptions,
          row.totalSubscriptions,
        ].join(",")
      );
    }
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Unlinked Stripe customer listing failed:", err?.message || err);
  process.exitCode = 1;
});


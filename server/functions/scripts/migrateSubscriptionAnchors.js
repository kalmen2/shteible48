require("dotenv").config();
const Stripe = require("stripe");

function getTargetAnchorDate(baseDate = new Date()) {
  const year = baseDate.getUTCFullYear();
  const month = baseDate.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 14, 0, 0));
}

function toIso(date) {
  return date.toISOString();
}

function isMembershipLike(sub) {
  const paymentType = String(sub?.metadata?.paymentType || sub?.metadata?.payment_type || "");
  if (paymentType === "membership") return true;
  return /membership/i.test(String(sub?.description || "")) || /membership/i.test(String(sub?.plan?.nickname || ""));
}

async function listActiveSubscriptions(stripe) {
  const out = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...(page?.data || []));
    if (!page?.has_more || !page?.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

async function run() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required");

  const stripe = new Stripe(stripeKey);

  const targetAnchorDate = getTargetAnchorDate(new Date());
  const targetAnchorTs = Math.floor(targetAnchorDate.getTime() / 1000);
  const targetAnchorIso = toIso(targetAnchorDate);
  const migrateOnlyMembership = String(process.env.MIGRATE_ONLY_MEMBERSHIP || "").toLowerCase() === "true";

  const allActive = await listActiveSubscriptions(stripe);
  const subscriptions = migrateOnlyMembership
    ? allActive.filter(isMembershipLike)
    : allActive;

  let attempted = 0;
  let updated = 0;
  let failed = 0;
  const failedIds = [];

  console.log("[anchor-migration] starting", {
    totalActiveSubscriptions: allActive.length,
    selectedSubscriptions: subscriptions.length,
    migrateOnlyMembership,
    targetAnchorUtc: targetAnchorIso,
  });

  for (const sub of subscriptions) {
    attempted += 1;
    const subId = String(sub.id);
    try {
      const result = await stripe.subscriptions.update(subId, {
        // Stripe update API does not accept a future billing_cycle_anchor timestamp directly.
        // Setting trial_end to target timestamp updates billing_cycle_anchor to the same value.
        trial_end: targetAnchorTs,
        proration_behavior: "none",
        metadata: {
          ...(sub.metadata || {}),
          migrated_anchor_utc: targetAnchorIso,
          anchor_migration_version: "2026-03-04",
        },
      });

      const actualAnchor = Number(result?.billing_cycle_anchor || 0);
      if (actualAnchor === targetAnchorTs) {
        updated += 1;
      } else {
        failed += 1;
        failedIds.push(subId);
        console.error("[anchor-migration] anchor mismatch", {
          subscriptionId: subId,
          expected: targetAnchorTs,
          actual: actualAnchor,
        });
      }
    } catch (err) {
      failed += 1;
      failedIds.push(subId);
      console.error("[anchor-migration] failed subscription update", {
        subscriptionId: subId,
        message: err?.message || err,
        code: err?.code || null,
        type: err?.type || null,
      });
      // continue to next subscription
    }
  }

  console.log("[anchor-migration] complete", {
    attempted,
    updated,
    failed,
    targetAnchorUtc: targetAnchorIso,
    failedIds,
  });
}

run().catch((err) => {
  console.error("[anchor-migration] fatal", err?.message || err);
  process.exitCode = 1;
});

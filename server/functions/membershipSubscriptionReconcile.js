const { connectMongo } = require("./mongo");
const { createMongoEntityStore } = require("./store.mongo");
const { getStripe } = require("./stripeClient");

const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);

function isMissingStripeResource(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  return code === "resource_missing" || /No such/i.test(msg);
}

function toTs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : 0;
}

function isActiveSubscription(sub) {
  return ACTIVE_SUB_STATUSES.has(String(sub?.status || ""));
}

function looksLikeMembershipSub(sub, member, localMembershipSubIds) {
  const paymentType = String(sub?.metadata?.paymentType || sub?.metadata?.payment_type || "");
  if (paymentType === "membership") return true;
  if (member?.stripe_subscription_id && String(sub?.id || "") === String(member.stripe_subscription_id)) return true;
  return localMembershipSubIds.has(String(sub?.id || ""));
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

async function runMembershipSubscriptionReconciliation() {
  const db = await connectMongo();
  const store = createMongoEntityStore({ db });
  const stripe = getStripe();

  const members = await store.list("Member", "-created_date", 10000);
  const today = new Date().toISOString().split("T")[0];

  let checked = 0;
  let membersWithDuplicates = 0;
  let cancelled = 0;
  let localDeactivated = 0;
  let memberAligned = 0;
  let errors = 0;

  for (const member of members) {
    const memberId = String(member?.id || "");
    const customerId = String(member?.stripe_customer_id || "");
    if (!memberId || !customerId) continue;
    checked += 1;

    try {
      const localMembershipRecs = await store.filter(
        "RecurringPayment",
        { member_id: memberId, payment_type: "membership", is_active: true },
        "-created_date",
        1000
      );
      const localMembershipSubIds = new Set(
        localMembershipRecs
          .map((r) => String(r?.stripe_subscription_id || ""))
          .filter(Boolean)
      );

      const subs = await listCustomerSubscriptions(stripe, customerId);
      const activeMembershipSubs = subs.filter(
        (s) => isActiveSubscription(s) && looksLikeMembershipSub(s, member, localMembershipSubIds)
      );

      if (!activeMembershipSubs.length) {
        if (member.membership_active || member.stripe_subscription_id) {
          await store.update("Member", memberId, {
            membership_active: false,
            stripe_subscription_id: null,
          });
          memberAligned += 1;
        }
        continue;
      }

      // Keep pinned subscription if still active; otherwise keep newest Stripe sub.
      let keep = activeMembershipSubs.find((s) => String(s.id) === String(member.stripe_subscription_id || ""));
      if (!keep) {
        keep = [...activeMembershipSubs].sort((a, b) => Number(b.created || 0) - Number(a.created || 0))[0];
      }
      const keepId = String(keep.id);
      const extra = activeMembershipSubs.filter((s) => String(s.id) !== keepId);

      if (extra.length) membersWithDuplicates += 1;

      for (const sub of extra) {
        const subId = String(sub.id);
        try {
          await stripe.subscriptions.cancel(subId);
          cancelled += 1;
        } catch (err) {
          if (!isMissingStripeResource(err)) {
            errors += 1;
            console.error("[membership-reconcile] Failed to cancel Stripe sub", { memberId, subId, err: err?.message || err });
          }
        }
      }

      // Deactivate any local active membership records that don't match the kept subscription.
      for (const rec of localMembershipRecs) {
        const recSubId = String(rec?.stripe_subscription_id || "");
        if (recSubId && recSubId === keepId) continue;
        await store.update("RecurringPayment", String(rec.id), {
          is_active: false,
          ended_date: today,
        });
        localDeactivated += 1;
      }

      // If there are duplicate local records pointing to the kept subscription, keep newest one active.
      const sameKeepRecs = localMembershipRecs
        .filter((r) => String(r?.stripe_subscription_id || "") === keepId)
        .sort((a, b) => toTs(b?.updated_date || b?.created_date) - toTs(a?.updated_date || a?.created_date));
      for (const rec of sameKeepRecs.slice(1)) {
        await store.update("RecurringPayment", String(rec.id), {
          is_active: false,
          ended_date: today,
        });
        localDeactivated += 1;
      }

      if (!member.membership_active || String(member.stripe_subscription_id || "") !== keepId) {
        await store.update("Member", memberId, {
          membership_active: true,
          stripe_subscription_id: keepId,
        });
        memberAligned += 1;
      }
    } catch (err) {
      errors += 1;
      console.error("[membership-reconcile] member check failed", {
        memberId,
        customerId,
        err: err?.message || err,
      });
    }
  }

  const summary = {
    ok: errors === 0,
    checked,
    membersWithDuplicates,
    cancelled,
    localDeactivated,
    memberAligned,
    errors,
  };
  console.log("[membership-reconcile] summary", summary);
  return summary;
}

module.exports = {
  runMembershipSubscriptionReconciliation,
};


const { getStripe } = require("./stripeClient.js");

function centsToDollars(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function isoDateFromUnixSeconds(sec) {
  const ms = Number(sec) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
  return d.toISOString().split("T")[0];
}

async function recordOneTimePayment({ store, memberId, memberName, amountCents, description, stripePaymentIntentId }) {
  const amount = centsToDollars(amountCents);

  await store.create("Transaction", {
    member_id: String(memberId),
    member_name: memberName || undefined,
    type: "payment",
    description: description || "Stripe payment",
    amount,
    date: new Date().toISOString().split("T")[0],
    provider: "stripe",
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
  });

  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (member) {
    const newBalance = (member.total_owed || 0) - amount;
    await store.update("Member", member.id, { total_owed: newBalance });
  }
}

async function upsertRecurringFromCheckout({ store, memberId, memberName, paymentType, amountCents, customerId, subscriptionId }) {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // Try to find existing record for this subscription
  const existing = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);

  const base = {
    member_id: String(memberId),
    member_name: memberName || undefined,
    payment_type: paymentType,
    amount_per_month: centsToDollars(amountCents),
    is_active: true,
    start_date: today.toISOString().split("T")[0],
    next_charge_date: nextMonth.toISOString().split("T")[0],
    stripe_customer_id: customerId || undefined,
    stripe_subscription_id: subscriptionId || undefined,
  };

  if (existing[0]?.id) {
    await store.update("RecurringPayment", existing[0].id, base);
    return;
  }

  // For payoff plans, initialize remaining_amount from optional metadata if present; otherwise leave undefined.
  await store.create("RecurringPayment", base);
}

async function recordSubscriptionInvoicePayment({ store, subscriptionId, customerId, amountPaidCents, periodStart, memberId, paymentType }) {
  const amount = centsToDollars(amountPaidCents);
  const date = isoDateFromUnixSeconds(periodStart);

  // Create a matching charge + payment so reporting stays consistent.
  const descBase =
    paymentType === "membership"
      ? "Monthly Membership"
      : paymentType === "balance_payoff"
        ? "Balance Payoff Plan"
        : "Additional Monthly Payment";

  await store.create("Transaction", {
    member_id: String(memberId),
    type: "charge",
    description: descBase,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
  });

  await store.create("Transaction", {
    member_id: String(memberId),
    type: "payment",
    description: `${descBase} (Stripe)` ,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
  });

  // Net effect is zero if we also update member.total_owed by +charge and -payment.
  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (member) {
    const newBalance = (member.total_owed || 0);
    await store.update("Member", member.id, { total_owed: newBalance });
  }

  // Update RecurringPayment bookkeeping
  const recs = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);
  const rec = recs[0];
  if (!rec) return;

  if (paymentType === "balance_payoff") {
    const remaining = Number(rec.remaining_amount ?? rec.total_amount ?? 0);
    if (Number.isFinite(remaining) && remaining > 0) {
      const newRemaining = Math.max(0, remaining - amount);
      const patch = {
        remaining_amount: newRemaining,
      };
      // If fully paid, deactivate; backend also cancels subscription in webhook handler.
      if (newRemaining <= 0) {
        patch.is_active = false;
        patch.ended_date = new Date().toISOString().split("T")[0];
      }
      await store.update("RecurringPayment", rec.id, patch);
    }
  }
}

/**
 * Stripe webhook handler. Must be mounted with express.raw({ type: 'application/json' }).
 * @param {{ store: any }} deps
 */
function createStripeWebhookHandler({ store }) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // Fail fast during development; without signature verification this is unsafe.
    const err = new Error("Missing STRIPE_WEBHOOK_SECRET");
    // @ts-ignore
    err.status = 500;
    throw err;
  }

  return async function stripeWebhook(req, res) {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (e) {
      return res.status(400).send(`Webhook Error: ${e?.message || e}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        // One-time payments
        if (session.mode === "payment") {
          const md = session.metadata || {};
          const memberId = md.memberId;
          if (memberId) {
            await recordOneTimePayment({
              store,
              memberId,
              memberName: md.memberName,
              amountCents: Number(md.amountCents || 0),
              description: md.description,
              stripePaymentIntentId: session.payment_intent,
            });
          }
        }

        // Subscriptions
        if (session.mode === "subscription") {
          const md = session.metadata || {};
          const memberId = md.memberId;
          const paymentType = md.paymentType || "additional_monthly";
          if (memberId && session.subscription) {
            await upsertRecurringFromCheckout({
              store,
              memberId,
              memberName: md.memberName,
              paymentType,
              amountCents: Number(md.amountCents || 0),
              customerId: session.customer,
              subscriptionId: session.subscription,
            });

            if (paymentType === "membership") {
              await store.update("Member", String(memberId), {
                membership_active: true,
                stripe_subscription_id: session.subscription,
                stripe_customer_id: session.customer,
              });
            }
          }
        }
      }

      if (event.type === "invoice.paid") {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (subscriptionId && invoice.lines?.data?.length) {
          const firstLine = invoice.lines.data[0];
          const md = firstLine.metadata || invoice.metadata || {};
          const memberId = md.memberId;
          const paymentType = md.paymentType || "additional_monthly";

          if (memberId) {
            await recordSubscriptionInvoicePayment({
              store,
              subscriptionId,
              customerId: invoice.customer,
              amountPaidCents: invoice.amount_paid,
              periodStart: firstLine.period?.start || invoice.created,
              memberId,
              paymentType,
            });

            // For payoff plans, cancel when remaining is <= 0.
            if (paymentType === "balance_payoff") {
              const recs = await store.filter(
                "RecurringPayment",
                { stripe_subscription_id: String(subscriptionId) },
                undefined,
                1
              );
              const rec = recs[0];
              if (rec && Number(rec.remaining_amount ?? 0) <= 0) {
                await stripe.subscriptions.cancel(String(subscriptionId));
              }
            }
          }
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        const recs = await store.filter("RecurringPayment", { stripe_subscription_id: String(sub.id) }, undefined, 1);
        const rec = recs[0];
        if (rec) {
          await store.update("RecurringPayment", rec.id, {
            is_active: false,
            ended_date: new Date().toISOString().split("T")[0],
          });
        }
      }

      return res.json({ received: true });
    } catch (e) {
      return res.status(500).json({ message: e?.message || String(e) });
    }
  };
}

module.exports = {
  createStripeWebhookHandler,
};

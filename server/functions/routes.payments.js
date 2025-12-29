const express = require("express");
const { getStripe } = require("./stripeClient.js");

function dollarsToCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents <= 0) return null;
  return cents;
}

function safeString(v, max = 500) {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

async function ensureCustomer({ stripe, store, memberId }) {
  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (!member) {
    const err = new Error("Member not found");
    // @ts-ignore
    err.status = 404;
    throw err;
  }

  if (member.stripe_customer_id) {
    return { member, customerId: member.stripe_customer_id };
  }

  const customer = await stripe.customers.create({
    name: member.full_name || undefined,
    email: member.email || undefined,
    metadata: {
      memberId: String(member.id),
    },
  });

  await store.update("Member", member.id, { stripe_customer_id: customer.id });
  const [updated] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  return { member: updated ?? member, customerId: customer.id };
}

/**
 * Auth-required endpoints that create Stripe Checkout sessions.
 * @param {{ store: any, publicBaseUrl: string, frontendBaseUrl: string }} deps
 */
function createPaymentsRouter({ store, publicBaseUrl, frontendBaseUrl }) {
  const router = express.Router();

  router.post("/checkout", async (req, res) => {
    const stripe = getStripe();

    const memberId = safeString(req.body?.memberId, 200);
    const amountCents = dollarsToCents(req.body?.amount);
    const description = safeString(req.body?.description || "Payment", 500);

    if (!memberId || !amountCents) return res.status(400).json({ message: "memberId and valid amount are required" });

    const { member, customerId } = await ensureCustomer({ stripe, store, memberId });

    const successUrl = `${frontendBaseUrl}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=success`;
    const cancelUrl = `${frontendBaseUrl}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: process.env.STRIPE_CURRENCY || "usd",
            product_data: {
              name: description,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: "one_time_payment",
        memberId: String(memberId),
        memberName: safeString(member.full_name || "", 200),
        amountCents: String(amountCents),
        description,
      },
    });

    return res.json({ url: session.url });
  });

  router.post("/subscription-checkout", async (req, res) => {
    const stripe = getStripe();

    const memberId = safeString(req.body?.memberId, 200);
    const paymentType = safeString(req.body?.paymentType, 60);
    const amountCents = dollarsToCents(req.body?.amountPerMonth);

    if (!memberId || !amountCents || !paymentType) {
      return res.status(400).json({ message: "memberId, paymentType, and valid amountPerMonth are required" });
    }

    const { member, customerId } = await ensureCustomer({ stripe, store, memberId });

    const successUrl = `${frontendBaseUrl}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=success`;
    const cancelUrl = `${frontendBaseUrl}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: process.env.STRIPE_CURRENCY || "usd",
            product_data: {
              name:
                paymentType === "membership"
                  ? "Monthly Membership"
                  : paymentType === "balance_payoff"
                    ? "Balance Payoff Plan"
                    : "Additional Monthly Payment",
            },
            recurring: { interval: "month" },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: "subscription",
        memberId: String(memberId),
        memberName: safeString(member.full_name || "", 200),
        paymentType,
        amountCents: String(amountCents),
        // optional payoff metadata
        payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
      },
    });

    return res.json({ url: session.url });
  });

  // Helpful for local sanity checks
  router.get("/config", (_req, res) => {
    const hasKey = Boolean(process.env.STRIPE_SECRET_KEY);
    return res.json({
      ok: true,
      currency: process.env.STRIPE_CURRENCY || "usd",
      webhook: `${publicBaseUrl}/api/stripe/webhook`,
      hasSecretKey: hasKey,
    });
  });

  return router;
}

module.exports = {
  createPaymentsRouter,
};

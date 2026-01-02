import express from "express";
import { getStripe } from "./functions/stripeClient.js";

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

async function ensureGuestCustomer({ stripe, store, guestId }) {
  const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  if (!guest) {
    const err = new Error("Guest not found");
    // @ts-ignore
    err.status = 404;
    throw err;
  }

  if (guest.stripe_customer_id) {
    return { guest, customerId: guest.stripe_customer_id };
  }

  const customer = await stripe.customers.create({
    name: guest.full_name || undefined,
    email: guest.email || undefined,
    metadata: {
      guestId: String(guest.id),
    },
  });

  await store.update("Guest", guest.id, { stripe_customer_id: customer.id });
  const [updated] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  return { guest: updated ?? guest, customerId: customer.id };
}

/**
 * Auth-required endpoints that create Stripe Checkout sessions.
 * @param {{ store: any, publicBaseUrl: string, frontendBaseUrl: string }} deps
 */
export function createPaymentsRouter({ store, publicBaseUrl, frontendBaseUrl }) {
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

  router.post("/guest/checkout", async (req, res) => {
    const stripe = getStripe();

    const guestId = safeString(req.body?.guestId, 200);
    const amountCents = dollarsToCents(req.body?.amount);
    const description = safeString(req.body?.description || "Donation", 500);

    if (!guestId || !amountCents) return res.status(400).json({ message: "guestId and valid amount are required" });

    const { guest, customerId } = await ensureGuestCustomer({ stripe, store, guestId });

    const successUrl = `${frontendBaseUrl}${safeString(req.body?.successPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=success`;
    const cancelUrl = `${frontendBaseUrl}${safeString(req.body?.cancelPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=cancel`;

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
        kind: "guest_one_time_payment",
        guestId: String(guestId),
        guestName: safeString(guest.full_name || "", 200),
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
    let amountCents = dollarsToCents(req.body?.amountPerMonth);

    if (!memberId || !amountCents || !paymentType) {
      return res.status(400).json({ message: "memberId, paymentType, and valid amountPerMonth are required" });
    }

    const { member, customerId } = await ensureCustomer({ stripe, store, memberId });

    if (paymentType === "balance_payoff") {
      const payoffTotalCents = dollarsToCents(req.body?.payoffTotal ?? member.total_owed);
      if (!payoffTotalCents) {
        return res.status(400).json({ message: "payoff total must be greater than zero" });
      }
      amountCents = Math.min(amountCents, payoffTotalCents);
    }

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

  router.post("/guest/subscription-checkout", async (req, res) => {
    const stripe = getStripe();

    const guestId = safeString(req.body?.guestId, 200);
    const paymentType = safeString(req.body?.paymentType, 60);
    let amountCents = dollarsToCents(req.body?.amountPerMonth);

    if (!guestId || !amountCents || !paymentType) {
      return res.status(400).json({ message: "guestId, paymentType, and valid amountPerMonth are required" });
    }

    const { guest, customerId } = await ensureGuestCustomer({ stripe, store, guestId });

    if (paymentType === "guest_balance_payoff") {
      const payoffTotalCents = dollarsToCents(req.body?.payoffTotal ?? guest.total_owed);
      if (!payoffTotalCents) {
        return res.status(400).json({ message: "payoff total must be greater than zero" });
      }
      amountCents = Math.min(amountCents, payoffTotalCents);
    }

    const successUrl = `${frontendBaseUrl}${safeString(req.body?.successPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=success`;
    const cancelUrl = `${frontendBaseUrl}${safeString(req.body?.cancelPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: process.env.STRIPE_CURRENCY || "usd",
            product_data: {
              name:
                paymentType === "guest_balance_payoff"
                  ? "Guest Balance Payoff"
                  : "Guest Monthly Donation",
              metadata: {
                guestId: String(guestId),
                paymentType,
              },
            },
            recurring: { interval: "month" },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          guestId: String(guestId),
          paymentType,
          guestName: safeString(guest.full_name || "", 200),
          amountCents: String(amountCents),
          payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: "guest_subscription",
        guestId: String(guestId),
        guestName: safeString(guest.full_name || "", 200),
        paymentType,
        amountCents: String(amountCents),
        payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
      },
    });

    return res.json({ url: session.url });
  });

  router.post("/save-card-checkout", async (req, res) => {
    const stripe = getStripe();

    const memberId = safeString(req.body?.memberId, 200);

    if (!memberId) {
      return res.status(400).json({ message: "memberId is required" });
    }

    const { member, customerId } = await ensureCustomer({ stripe, store, memberId });

    const successUrl = `${frontendBaseUrl}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=card_saved`;
    const cancelUrl = `${frontendBaseUrl}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: "save_card",
        memberId: String(memberId),
        memberName: safeString(member.full_name || "", 200),
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

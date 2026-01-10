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

function monthLabelFromUnixSeconds(sec) {
  const ms = Number(sec) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "Unknown Month";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function isoDateFromUnixSeconds(sec) {
  const ms = Number(sec) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
  return d.toISOString().split("T")[0];
}

async function hasInvoiceTransaction(store, entity, invoiceId, type) {
  if (!invoiceId) return false;
  const [existing] = await store.filter(
    entity,
    { stripe_invoice_id: String(invoiceId), type },
    undefined,
    1
  );
  return Boolean(existing);
}

async function createInvoiceTransactionIfMissing(store, entity, invoiceId, type, payload) {
  if (await hasInvoiceTransaction(store, entity, invoiceId, type)) return false;
  await store.create(entity, payload);
  return true;
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

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "string") return null;
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Auth-required endpoints that create Stripe Checkout sessions.
 * @param {{ store: any, publicBaseUrl: string, frontendBaseUrl: string, allowedFrontendOrigins?: string[] }} deps
 */
function createPaymentsRouter({ store, publicBaseUrl, frontendBaseUrl, allowedFrontendOrigins = [] }) {
  const router = express.Router();
  const normalizedAllowlist = allowedFrontendOrigins
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
  const fallbackOrigin = normalizeOrigin(frontendBaseUrl) || frontendBaseUrl;

  const resolveFrontendBaseUrl = (req) => {
    const origin = normalizeOrigin(req.body?.origin);
    if (origin && normalizedAllowlist.includes(origin)) {
      return origin;
    }
    return fallbackOrigin;
  };

  router.post("/checkout", async (req, res) => {
    const stripe = getStripe();

    const memberId = safeString(req.body?.memberId, 200);
    const amountCents = dollarsToCents(req.body?.amount);
    const description = safeString(req.body?.description || "Payment", 500);

    if (!memberId || !amountCents) return res.status(400).json({ message: "memberId and valid amount are required" });

    const { member, customerId } = await ensureCustomer({ stripe, store, memberId });

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=success`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=cancel`;

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

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=success`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=cancel`;

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

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=success`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=cancel`;

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
      subscription_data: {
        metadata: {
          memberId: String(memberId),
          paymentType,
          memberName: safeString(member.full_name || "", 200),
          amountCents: String(amountCents),
          payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
        },
      },
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

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=success`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/GuestDetail?id=${encodeURIComponent(guestId)}`)}&stripe=cancel`;

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

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=card_saved`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(memberId)}`)}&stripe=cancel`;

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

  router.post("/activate-memberships-bulk", async (req, res) => {
    const stripe = getStripe();
    const memberIds = Array.isArray(req.body?.memberIds)
      ? req.body.memberIds.map((id) => String(id)).filter(Boolean)
      : [];
    if (memberIds.length === 0) {
      return res.status(400).json({ message: "memberIds are required" });
    }

    let amountCents = dollarsToCents(req.body?.amountPerMonth);
    if (!amountCents) {
      const plans = await store.list("MembershipPlan", "-created_date", 1);
      const plan = plans[0];
      amountCents = dollarsToCents(plan?.standard_amount);
    }
    if (!amountCents) {
      return res.status(400).json({ message: "Valid amountPerMonth is required" });
    }

    const missing = [];
    const alreadyActive = [];
    const toActivate = [];

    for (const memberId of memberIds) {
      const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
      if (!member) {
        missing.push({ id: memberId, name: "Unknown", reason: "Member not found" });
        continue;
      }
      if (member.membership_active) {
        alreadyActive.push({ id: member.id, name: member.full_name || member.english_name || member.hebrew_name });
        continue;
      }
      if (!member.stripe_customer_id || !member.stripe_default_payment_method_id) {
        missing.push({
          id: member.id,
          name: member.full_name || member.english_name || member.hebrew_name || "Member",
          reason: "Missing saved card",
        });
        continue;
      }
      toActivate.push(member);
    }

    if (missing.length > 0) {
      return res.status(400).json({ message: "Some members are missing saved cards", missing });
    }

    const activated = [];
    const errors = [];

    for (const member of toActivate) {
      try {
        const subscription = await stripe.subscriptions.create({
          customer: member.stripe_customer_id,
          default_payment_method: member.stripe_default_payment_method_id,
          items: [
            {
              price_data: {
                currency: process.env.STRIPE_CURRENCY || "usd",
                product_data: { name: "Monthly Membership" },
                recurring: { interval: "month" },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
          ],
          metadata: {
            kind: "membership",
            memberId: String(member.id),
            memberName: safeString(member.full_name || member.english_name || "", 200),
            paymentType: "membership",
            amountCents: String(amountCents),
          },
          expand: ["latest_invoice.payment_intent"],
        });

        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
        const recs = await store.filter(
          "RecurringPayment",
          { stripe_subscription_id: String(subscription.id) },
          undefined,
          1
        );
        const recPayload = {
          member_id: String(member.id),
          member_name: safeString(member.full_name || member.english_name || "", 200),
          payment_type: "membership",
          amount_per_month: Math.round(amountCents) / 100,
          is_active: true,
          start_date: today.toISOString().split("T")[0],
          next_charge_date: nextMonth.toISOString().split("T")[0],
          stripe_customer_id: member.stripe_customer_id,
          stripe_subscription_id: subscription.id,
        };
        if (recs[0]?.id) {
          await store.update("RecurringPayment", recs[0].id, recPayload);
        } else {
          await store.create("RecurringPayment", recPayload);
        }

        await store.update("Member", member.id, {
          membership_active: true,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: member.stripe_customer_id,
        });

        const latestInvoice = subscription?.latest_invoice;
        if (latestInvoice && typeof latestInvoice === "object" && latestInvoice.id) {
          const paid =
            latestInvoice.status === "paid" ||
            latestInvoice.payment_intent?.status === "succeeded";
          if (paid) {
            const amountPaidCents =
              Number(latestInvoice.amount_paid ?? latestInvoice.total ?? amountCents);
            const periodStart =
              latestInvoice.lines?.data?.[0]?.period?.start || latestInvoice.created;
            const amount = Math.round(amountPaidCents) / 100;
            const date = isoDateFromUnixSeconds(periodStart);
            const monthLabel = monthLabelFromUnixSeconds(periodStart);
            const descBase = `Monthly Membership - ${monthLabel}`;
            const basePayload = {
              member_id: String(member.id),
              member_name: safeString(member.full_name || member.english_name || "", 200),
              amount,
              date,
              provider: "stripe",
              stripe_invoice_id: latestInvoice.id,
              stripe_subscription_id: subscription.id,
              stripe_customer_id: member.stripe_customer_id,
            };

            const chargeCreated = await createInvoiceTransactionIfMissing(
              store,
              "Transaction",
              latestInvoice.id,
              "charge",
              {
                ...basePayload,
                type: "charge",
                description: descBase,
              }
            );
            await createInvoiceTransactionIfMissing(
              store,
              "Transaction",
              latestInvoice.id,
              "payment",
              {
                ...basePayload,
                type: "payment",
                description: `${descBase} (Stripe)`,
              }
            );

            if (chargeCreated) {
              const currentBalance = Number(member.total_owed || 0);
              const newBalance = Math.max(0, currentBalance - amount);
              await store.update("Member", member.id, { total_owed: newBalance });
            }
          }
        }
        activated.push({ id: member.id, name: member.full_name || member.english_name || member.hebrew_name });
      } catch (err) {
        errors.push({
          id: member.id,
          name: member.full_name || member.english_name || member.hebrew_name,
          message: err?.message || "Failed to activate membership",
        });
      }
    }

    return res.json({ ok: true, activated, alreadyActive, errors });
  });

    // Admin endpoint to update a member's monthly bill (e.g., add donation or payment plan)
    router.post("/update-monthly-bill", async (req, res) => {
      const callerId = req.user?.id;
      if (!callerId || typeof req.getUserById !== "function") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const caller = await req.getUserById(callerId);
      const isAdmin = caller?.is_admin === true || caller?.role === "admin";
      if (!isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const memberId = safeString(req.body?.memberId, 200);
      const amount = Number(req.body?.amount);
      const reason = safeString(req.body?.reason, 500);
      if (!memberId || !Number.isFinite(amount)) {
        return res.status(400).json({ message: "memberId and valid amount are required" });
      }

      const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
      if (!member) return res.status(404).json({ message: "Member not found" });

      const newMonthlyBill = (member.monthly_bill || 0) + amount;
      await store.update("Member", member.id, { monthly_bill: newMonthlyBill });

      // Audit log the change
      try {
        await store.create("AuditLog", {
          member_id: String(member.id),
          action: "update_monthly_bill",
          amount,
          reason: reason || undefined,
          performed_by: req.user?.id || undefined,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("Failed to write audit log for update-monthly-bill", e?.message || e);
      }

      // If member already has an active Stripe subscription, update its price to match newMonthlyBill
      if (member.stripe_subscription_id) {
        try {
          const stripe = getStripe();
          const subscription = await stripe.subscriptions.retrieve(member.stripe_subscription_id);
          const item = subscription.items.data[0];
          if (item && item.price && item.price.product) {
            // Create a new price for this product with the updated amount
            const unitAmount = Math.round(newMonthlyBill * 100);
            const newPrice = await stripe.prices.create({
              unit_amount: unitAmount,
              currency: process.env.STRIPE_CURRENCY || "usd",
              product: item.price.product,
              recurring: { interval: "month" },
            });

            // Update subscription item to use the new price
            await stripe.subscriptionItems.update(item.id, { price: newPrice.id });
          }
        } catch (e) {
          console.error("Failed to update Stripe subscription for member", memberId, e?.message || e);
        }
      }

      return res.json({ ok: true, memberId, newMonthlyBill });
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

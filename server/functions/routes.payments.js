const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const { getStripe } = require("./stripeClient.js");

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_DEV_SECRET || "dev-secret";
const SAVE_CARD_TOKEN_EXPIRES_IN = process.env.SAVE_CARD_TOKEN_EXPIRES_IN || "7d";

function dollarsToCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents <= 0) return null;
  return cents;
}

function centsFromNumber(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
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

function firstOfNextMonthUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

function isoDateOnly(date) {
  return date.toISOString().split("T")[0];
}

async function updateMembershipSubscriptionAmount({
  stripe,
  store,
  memberId,
  subscriptionId,
  totalMonthlyCents,
  standardAmountCents,
  payoffAmountCents,
}) {
  if (!subscriptionId || !Number.isFinite(totalMonthlyCents) || totalMonthlyCents <= 0) return;

  const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
  const item = sub?.items?.data?.[0];
  const productId = item?.price?.product;
  const currentCents = item?.price?.unit_amount;

  if (productId && currentCents !== totalMonthlyCents) {
    const newPrice = await stripe.prices.create({
      unit_amount: totalMonthlyCents,
      currency: process.env.STRIPE_CURRENCY || "usd",
      product: productId,
      recurring: { interval: "month" },
    });
    await stripe.subscriptionItems.update(item.id, {
      price: newPrice.id,
      proration_behavior: "none",
    });
  }

  await stripe.subscriptions.update(String(subscriptionId), {
    metadata: {
      ...(sub?.metadata || {}),
      amountCents: String(totalMonthlyCents),
      standardAmountCents: String(standardAmountCents ?? ""),
      payoffAmountCents: String(payoffAmountCents ?? 0),
    },
  });

  const membershipRecs = await store.filter(
    "RecurringPayment",
    { member_id: String(memberId), payment_type: "membership", is_active: true },
    "-created_date",
    1
  );
  if (membershipRecs[0]?.id) {
    await store.update("RecurringPayment", membershipRecs[0].id, {
      amount_per_month: Math.round(totalMonthlyCents) / 100,
    });
  }
}

async function detachMemberPayoffSubscriptions({ stripe, store, memberId }) {
  const payoffRecs = await store.filter(
    "RecurringPayment",
    { member_id: String(memberId), payment_type: "balance_payoff", is_active: true },
    "-created_date",
    1000
  );
  if (!payoffRecs.length) return;

  for (const rec of payoffRecs) {
    if (rec.stripe_subscription_id) {
      const subId = rec.stripe_subscription_id;
      await store.update("RecurringPayment", rec.id, {
        stripe_subscription_id: null,
      });
      try {
        await stripe.subscriptions.cancel(String(subId));
      } catch (err) {
        console.warn("Failed to cancel payoff subscription", subId, err?.message || err);
      }
    }
  }
}

function signSaveCardToken(payload) {
  const jti = randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: SAVE_CARD_TOKEN_EXPIRES_IN });
}

function verifySaveCardToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function buildSaveCardUrl({ token, frontendBaseUrl }) {
  const base = (frontendBaseUrl || "").replace(/\/$/, "");
  return `${base}/save-card?token=${encodeURIComponent(token)}`;
}

// Resolve a member using several identifiers to tolerate stale or alternate ids.
async function findMemberByAnyId(store, { memberId, stripeCustomerId, subscriptionId }) {
  const lookups = [];
  if (memberId) {
    lookups.push({ id: String(memberId) });
    lookups.push({ member_id: String(memberId) });
  }
  if (subscriptionId) {
    lookups.push({ stripe_subscription_id: String(subscriptionId) });
  }
  if (stripeCustomerId) {
    lookups.push({ stripe_customer_id: String(stripeCustomerId) });
  }

  for (const where of lookups) {
    const [member] = await store.filter("Member", where, undefined, 1);
    if (member) return member;
  }
  return null;
}

// Resolve the canonical Member using any reasonable key (id, member_id, email, or Stripe ids).
async function resolveMemberFromInput(store, memberKey, opts = {}) {
  const key = String(memberKey ?? "").trim();
  // First try id/member_id/stripe_* via existing helper.
  const direct = await findMemberByAnyId(store, {
    memberId: key,
    stripeCustomerId: opts.stripeCustomerId,
    subscriptionId: opts.subscriptionId,
  });
  if (direct) return direct;

  // If the input looks like an email, try matching on email.
  if (key.includes("@")) {
    const lower = key.toLowerCase();
    const [byEmailLower] = await store.filter("Member", { email: lower }, undefined, 1);
    if (byEmailLower) return byEmailLower;
    if (lower !== key) {
      const [byEmailExact] = await store.filter("Member", { email: key }, undefined, 1);
      if (byEmailExact) return byEmailExact;
    }
  }

  return null;
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
  console.log("[ensureCustomer] incoming memberId:", memberId);
  const member = await resolveMemberFromInput(store, memberId);
  console.log(
    "[ensureCustomer] resolved member:",
    member
      ? {
          id: member.id,
          member_id: member.member_id,
          email: member.email,
        }
      : null
  );
  if (!member) {
    const err = new Error("Member not found");
    // @ts-ignore
    err.status = 404;
    throw err;
  }

  const updateKey = member.member_id || member.id || memberId;
  if (!updateKey) {
    const err = new Error("Member not found");
    // @ts-ignore
    err.status = 404;
    throw err;
  }

  if (member.stripe_customer_id) {
    // Update Stripe customer with current member info (in case email/name changed)
    try {
      await stripe.customers.update(member.stripe_customer_id, {
        name: member.full_name || undefined,
        email: member.email || undefined,
        metadata: {
          memberId: String(member.id || member.member_id),
        },
      });
    } catch (err) {
      console.error("[ensureCustomer] Failed to update Stripe customer:", err?.message || err);
    }
    return { member, customerId: member.stripe_customer_id };
  }

  const customer = await stripe.customers.create({
    name: member.full_name || undefined,
    email: member.email || undefined,
    metadata: {
      memberId: String(member.id || member.member_id),
    },
  });

  await store.update("Member", String(updateKey), { stripe_customer_id: customer.id });
  const [updated] = await store.filter("Member", { id: String(member.id || updateKey) }, undefined, 1);
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
    // Update Stripe customer with current guest info (in case email/name changed)
    try {
      await stripe.customers.update(guest.stripe_customer_id, {
        name: guest.full_name || undefined,
        email: guest.email || undefined,
        metadata: {
          guestId: String(guest.id),
        },
      });
    } catch (err) {
      console.error("[ensureGuestCustomer] Failed to update Stripe customer:", err?.message || err);
    }
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

  // Generate a public save-card link for a member or guest (auth required to generate)
  router.post("/save-card-link", async (req, res) => {
    const memberId = safeString(req.body?.memberId, 200);
    const guestId = safeString(req.body?.guestId, 200);
    if (!memberId && !guestId) {
      return res.status(400).json({ message: "memberId or guestId is required" });
    }

    if (memberId) {
      const member = await resolveMemberFromInput(store, memberId);
      if (!member) return res.status(404).json({ message: "Member not found" });
      const token = signSaveCardToken({ kind: "member", id: String(member.id), member_id: member.member_id });
      return res.json({ url: buildSaveCardUrl({ token, frontendBaseUrl }) });
    }

    const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
    if (!guest) return res.status(404).json({ message: "Guest not found" });
    const token = signSaveCardToken({ kind: "guest", id: String(guest.id) });
    return res.json({ url: buildSaveCardUrl({ token, frontendBaseUrl }) });
  });

  router.post("/checkout", async (req, res) => {
    const stripe = getStripe();

    const memberId = safeString(req.body?.memberId, 200);
    const amountCents = dollarsToCents(req.body?.amount);
    const description = safeString(req.body?.description || "Payment", 500);

    if (!memberId || !amountCents) return res.status(400).json({ message: "memberId and valid amount are required" });

    const { member, customerId } = await ensureCustomer({ stripe, store, memberId });

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(member.id)}`)}&stripe=success`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(member.id)}`)}&stripe=cancel`;

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
        memberId: String(member.id),
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
    const applyMonthRaw = safeString(req.body?.applyMonth, 20);
    const applyMonth = applyMonthRaw === "next_month" ? "next_month" : "this_month";

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

      const membershipRecs = await store.filter(
        "RecurringPayment",
        { member_id: String(member.id), payment_type: "membership", is_active: true },
        "-created_date",
        1
      );
      const membershipSubscriptionId =
        member.stripe_subscription_id || membershipRecs[0]?.stripe_subscription_id;

      await detachMemberPayoffSubscriptions({ stripe, store, memberId: member.id });

      const payoffRecs = await store.filter(
        "RecurringPayment",
        { member_id: String(member.id), payment_type: "balance_payoff", is_active: true },
        "-created_date",
        1000
      );
      const today = new Date().toISOString().split("T")[0];
      const nextChargeDate = isoDateOnly(firstOfNextMonthUtc());
      const payoffPayload = {
        member_id: String(member.id),
        member_name: safeString(member.full_name || "", 200),
        payment_type: "balance_payoff",
        amount_per_month: Math.round(amountCents) / 100,
        is_active: true,
        start_date: today,
        next_charge_date: nextChargeDate,
        stripe_customer_id: member.stripe_customer_id || undefined,
        stripe_subscription_id: null,
      };
      if (payoffRecs[0]?.id) {
        await store.update("RecurringPayment", payoffRecs[0].id, payoffPayload);
        if (payoffRecs.length > 1) {
          for (const extra of payoffRecs.slice(1)) {
            await store.update("RecurringPayment", extra.id, {
              is_active: false,
              ended_date: today,
              amount_per_month: 0,
              remaining_amount: 0,
            });
          }
        }
      } else {
        await store.create("RecurringPayment", payoffPayload);
      }

      if (membershipSubscriptionId) {
        const plans = await store.list("MembershipPlan", "-created_date", 1);
        const standardAmountCents = centsFromNumber(plans[0]?.standard_amount || 0);
        const memberCharges = await store.filter(
          "MembershipCharge",
          { member_id: String(member.id), is_active: true },
          "-created_date",
          10000
        );
        const recurring = await store.filter(
          "RecurringPayment",
          { member_id: String(member.id), is_active: true },
          "-created_date",
          10000
        );
        const chargesTotalCents = memberCharges
          .filter(
            (c) => c.charge_type === "standard_donation" || c.charge_type === "payoff"
          )
          .reduce((sum, c) => sum + centsFromNumber(c.amount || 0), 0);
        const recurringPayoffCents = recurring
          .filter((p) => p.payment_type === "balance_payoff")
          .reduce((sum, p) => sum + centsFromNumber(p.amount_per_month || 0), 0);
        const totalMonthlyCents =
          standardAmountCents + chargesTotalCents + recurringPayoffCents + amountCents;

        await updateMembershipSubscriptionAmount({
          stripe,
          store,
          memberId: member.id,
          subscriptionId: membershipSubscriptionId,
          totalMonthlyCents,
          standardAmountCents,
          payoffAmountCents: amountCents,
        });

        return res.json({ ok: true, combined: true, amountCents: totalMonthlyCents });
      }

      return res.json({ ok: true, combined: false, amountCents });
    }

    let standardAmountCents = amountCents;
    let payoffAmountCents = 0;
    let effectivePayoffCents = 0;
    if (paymentType === "membership") {
      const memberCharges = await store.filter(
        "MembershipCharge",
        { member_id: String(member.id), is_active: true },
        "-created_date",
        10000
      );
      const recurring = await store.filter(
        "RecurringPayment",
        { member_id: String(member.id), is_active: true },
        "-created_date",
        10000
      );
      const donationCents = memberCharges
        .filter((c) => c.charge_type === "standard_donation")
        .reduce((sum, c) => sum + dollarsToCents(c.amount || 0), 0);
      const payoffChargeCents = memberCharges
        .filter((c) => c.charge_type === "payoff")
        .reduce((sum, c) => sum + dollarsToCents(c.amount || 0), 0);
      const recurringPayoffCents = recurring
        .filter((p) => p.payment_type === "balance_payoff")
        .reduce((sum, p) => sum + dollarsToCents(p.amount_per_month || 0), 0);
      payoffAmountCents = recurringPayoffCents || payoffChargeCents;

      const balanceOwedCents = dollarsToCents(member.total_owed || 0);
      effectivePayoffCents = payoffAmountCents;
      let totalMonthlyCents =
        (Number.isFinite(standardAmountCents) ? standardAmountCents : 0) +
        (Number.isFinite(donationCents) ? donationCents : 0) +
        (Number.isFinite(recurringPayoffCents) && recurringPayoffCents > 0
          ? recurringPayoffCents
          : Number.isFinite(payoffChargeCents)
            ? payoffChargeCents
            : 0);

      if (
        Number.isFinite(balanceOwedCents) &&
        Number.isFinite(standardAmountCents) &&
        standardAmountCents > 0 &&
        standardAmountCents + payoffAmountCents > balanceOwedCents
      ) {
        effectivePayoffCents = 0;
        totalMonthlyCents =
          (Number.isFinite(donationCents) ? donationCents : 0) +
          (Number.isFinite(balanceOwedCents) ? balanceOwedCents : 0);
      }
      if (Number.isFinite(totalMonthlyCents) && totalMonthlyCents > 0) {
        amountCents = totalMonthlyCents;
      }
    }

    const frontendOrigin = resolveFrontendBaseUrl(req);
    const successUrl = `${frontendOrigin}${safeString(req.body?.successPath || `/MemberDetail?id=${encodeURIComponent(member.id)}`)}&stripe=success`;
    const cancelUrl = `${frontendOrigin}${safeString(req.body?.cancelPath || `/MemberDetail?id=${encodeURIComponent(member.id)}`)}&stripe=cancel`;

    const isMembershipThisMonth = paymentType === "membership" && applyMonth === "this_month";
    if (isMembershipThisMonth) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        payment_intent_data: {
          setup_future_usage: "off_session",
        },
        line_items: [
          {
            price_data: {
              currency: process.env.STRIPE_CURRENCY || "usd",
              product_data: {
                name: "Monthly Membership",
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          kind: "membership_first_month",
          memberId: String(member.id),
          memberName: safeString(member.full_name || "", 200),
          paymentType,
          amountCents: String(amountCents),
          applyMonth,
          standardAmountCents: String(standardAmountCents),
          payoffAmountCents: String(effectivePayoffCents),
          payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
        },
      });

      return res.json({ url: session.url });
    }

    const subscriptionData = {
      metadata: {
        memberId: String(member.id),
        paymentType,
        memberName: safeString(member.full_name || "", 200),
        amountCents: String(amountCents),
        standardAmountCents: String(standardAmountCents),
        payoffAmountCents: String(effectivePayoffCents),
        payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
      },
    };

    let billingAnchorDate;
    if (paymentType === "membership") {
      subscriptionData.metadata.applyMonth = applyMonth;
      if (applyMonth === "next_month") {
        billingAnchorDate = firstOfNextMonthUtc();
        const billingAnchor = Math.floor(billingAnchorDate.getTime() / 1000);
        subscriptionData.trial_end = billingAnchor;
        subscriptionData.metadata.billingAnchor = isoDateOnly(billingAnchorDate);
      }
    }

    const sessionMetadata = {
      kind: "subscription",
      memberId: String(member.id),
      memberName: safeString(member.full_name || "", 200),
      paymentType,
      amountCents: String(amountCents),
      standardAmountCents: String(standardAmountCents),
      payoffAmountCents: String(effectivePayoffCents),
      payoffTotalCents: req.body?.payoffTotal ? String(dollarsToCents(req.body.payoffTotal) ?? "") : "",
    };
    if (paymentType === "membership") {
      sessionMetadata.applyMonth = applyMonth;
      if (billingAnchorDate) {
        sessionMetadata.billingAnchor = isoDateOnly(billingAnchorDate);
      }
    }

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
      subscription_data: subscriptionData,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: sessionMetadata,
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
        memberId: String(member.id),
        memberName: safeString(member.full_name || "", 200),
      },
    });

    return res.json({ url: session.url });
  });

  router.post("/cancel-subscription", async (req, res) => {
    const recurringPaymentId = req.body?.recurringPaymentId
      ? safeString(req.body.recurringPaymentId, 200)
      : null;
    const subscriptionId = req.body?.subscriptionId
      ? safeString(req.body.subscriptionId, 200)
      : null;

    if (!recurringPaymentId && !subscriptionId) {
      return res.status(400).json({ message: "recurringPaymentId or subscriptionId is required" });
    }

    const [recurring] = recurringPaymentId
      ? await store.filter("RecurringPayment", { id: String(recurringPaymentId) }, undefined, 1)
      : await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);

    if (!recurring) {
      return res.status(404).json({ message: "Recurring payment not found" });
    }

    const stripeSubscriptionId = recurring.stripe_subscription_id || subscriptionId;
    if (!stripeSubscriptionId) {
      if (recurring.payment_type === "balance_payoff") {
        const today = new Date().toISOString().split("T")[0];
        await store.update("RecurringPayment", recurring.id, {
          is_active: false,
          ended_date: today,
          amount_per_month: 0,
          remaining_amount: 0,
        });

        if (recurring.member_id) {
          const membershipRecs = await store.filter(
            "RecurringPayment",
            { member_id: String(recurring.member_id), payment_type: "membership", is_active: true },
            "-created_date",
            1
          );
          const membershipSubscriptionId =
            membershipRecs[0]?.stripe_subscription_id ||
            (await store.filter("Member", { id: String(recurring.member_id) }, undefined, 1))[0]
              ?.stripe_subscription_id;
          if (membershipSubscriptionId) {
            const plans = await store.list("MembershipPlan", "-created_date", 1);
            const standardAmountCents = centsFromNumber(plans[0]?.standard_amount || 0);
            const memberCharges = await store.filter(
              "MembershipCharge",
              { member_id: String(recurring.member_id), is_active: true },
              "-created_date",
              10000
            );
            const allRecurring = await store.filter(
              "RecurringPayment",
              { member_id: String(recurring.member_id), is_active: true },
              "-created_date",
              10000
            );
            const chargesTotalCents = memberCharges.reduce(
              (sum, c) => sum + centsFromNumber(c.amount || 0),
              0
            );
            const recurringNonMembershipCents = allRecurring
              .filter(
                (p) => p.payment_type !== "membership" && p.payment_type !== "balance_payoff"
              )
              .reduce((sum, p) => sum + centsFromNumber(p.amount_per_month || 0), 0);
            const totalMonthlyCents =
              standardAmountCents + chargesTotalCents + recurringNonMembershipCents;

            await updateMembershipSubscriptionAmount({
              stripe: getStripe(),
              store,
              memberId: recurring.member_id,
              subscriptionId: membershipSubscriptionId,
              totalMonthlyCents,
              standardAmountCents,
              payoffAmountCents: 0,
            });
          }
        }

        return res.json({ ok: true, subscriptionId: null });
      }
      return res.status(400).json({ message: "Missing Stripe subscription id" });
    }

    const stripe = getStripe();
    try {
      await stripe.subscriptions.cancel(stripeSubscriptionId);
    } catch (err) {
      const message = err?.message || "Failed to cancel Stripe subscription";
      return res.status(502).json({ message });
    }

    const today = new Date().toISOString().split("T")[0];
    await store.update("RecurringPayment", recurring.id, { is_active: false, ended_date: today });

    if (recurring.member_id && recurring.payment_type === "membership") {
      await store.update("Member", recurring.member_id, {
        membership_active: false,
        stripe_subscription_id: null,
      });
    }

    return res.json({ ok: true, subscriptionId: stripeSubscriptionId });
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

// Public (no auth) endpoints
function createPublicPaymentsRouter({ store, publicBaseUrl, frontendBaseUrl }) {
  const router = express.Router();

  router.post("/save-card-session", async (req, res) => {
    const stripe = getStripe();
    const token = safeString(req.body?.token, 2000);
    if (!token) return res.status(400).json({ message: "token is required" });

    let payload;
    try {
      payload = verifySaveCardToken(token);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const isMember = payload?.kind === "member";
    const isGuest = payload?.kind === "guest";
    if (!isMember && !isGuest) {
      return res.status(400).json({ message: "Invalid token payload" });
    }

    // Single-use enforcement: reject if jti already used; otherwise mark used
    if (!payload?.jti) {
      return res.status(400).json({ message: "Invalid token payload" });
    }
    const existingToken = await store.filter("WebhookEvent", { id: String(payload.jti) }, undefined, 1);
    if (existingToken[0]) {
      return res.status(409).json({ message: "This link has already been used" });
    }
    await store.create("WebhookEvent", {
      id: String(payload.jti),
      event_type: "save_card_token_used",
      stripe_created: Math.floor(Date.now() / 1000),
      stripe_livemode: false,
      stripe_request_id: undefined,
    });

    let customerId;
    let member;
    let guest;

    if (isMember) {
      member = await resolveMemberFromInput(store, payload.id || payload.member_id);
      if (!member) return res.status(404).json({ message: "Member not found" });
      const result = await ensureCustomer({ stripe, store, memberId: member.id || member.member_id || payload.id });
      member = result.member;
      customerId = result.customerId;
    } else {
      const [g] = await store.filter("Guest", { id: String(payload.id) }, undefined, 1);
      if (!g) return res.status(404).json({ message: "Guest not found" });
      guest = g;
      const result = await ensureGuestCustomer({ stripe, store, guestId: guest.id });
      guest = result.guest;
      customerId = result.customerId;
    }

    const frontendOrigin = normalizeOrigin(req.body?.origin) || frontendBaseUrl;
    const successPath = safeString(req.body?.successPath) || (isMember ? `/MemberDetail?id=${encodeURIComponent(member.id)}` : `/GuestDetail?id=${encodeURIComponent(guest.id)}`);
    const cancelPath = safeString(req.body?.cancelPath) || successPath;
    const successUrl = `${frontendOrigin}${successPath}${successPath.includes('?') ? '&' : '?'}stripe=card_saved`;
    const cancelUrl = `${frontendOrigin}${cancelPath}${cancelPath.includes('?') ? '&' : '?'}stripe=cancel`;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: customerId,
        payment_method_types: ["card"],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          kind: "save_card",
          memberId: isMember ? String(member.id) : "",
          guestId: isGuest ? String(guest.id) : "",
          name: isMember
            ? safeString(member.full_name || member.english_name || member.hebrew_name || "")
            : safeString(guest.full_name || guest.english_name || guest.hebrew_name || ""),
        },
      });
      return res.json({ url: session.url });
    } catch (err) {
      return res.status(500).json({ message: err?.message || "Failed to create save-card session" });
    }
  });

  return router;
}

module.exports = {
  createPaymentsRouter,
  createPublicPaymentsRouter,
};

const { getStripe } = require("./stripeClient.js");

function centsToDollars(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function dollarsToCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function isoDateFromUnixSeconds(sec) {
  const ms = Number(sec) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
  return d.toISOString().split("T")[0];
}

function monthLabelFromUnixSeconds(sec) {
  const ms = Number(sec) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "Unknown Month";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function isDuplicateError(err) {
  const code = err?.code || err?.errno || err?.sqlState;
  const msg = err?.message || "";
  return (
    code === 11000 ||
    code === 1062 ||
    code === "23505" ||
    code === "ER_DUP_ENTRY" ||
    code === "SQLITE_CONSTRAINT" ||
    /duplicate key/i.test(msg) ||
    /duplicate entry/i.test(msg) ||
    /unique constraint/i.test(msg)
  );
}

async function createRecordOnce(store, entity, payload) {
  try {
    await store.create(entity, payload);
    return true;
  } catch (err) {
    if (isDuplicateError(err)) return false;
    throw err;
  }
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

async function hasPaymentIntentTransaction(store, entity, paymentIntentId, type) {
  if (!paymentIntentId) return false;
  const [existing] = await store.filter(
    entity,
    { stripe_payment_intent_id: String(paymentIntentId), type },
    undefined,
    1
  );
  return Boolean(existing);
}

async function createPaymentIntentTransactionIfMissing(store, entity, paymentIntentId, type, payload) {
  if (await hasPaymentIntentTransaction(store, entity, paymentIntentId, type)) return false;
  return await createRecordOnce(store, entity, payload);
}

async function markEventProcessed({ store, event }) {
  if (!event?.id) return false;
  if (typeof store.ensureWebhookEventIndex === "function") {
    await store.ensureWebhookEventIndex();
  }
  const created = await createRecordOnce(store, "WebhookEvent", {
    id: String(event.id),
    event_type: event.type,
    stripe_created: event.created,
    stripe_livemode: event.livemode,
    stripe_request_id: event.request?.id || undefined,
  });
  return created;
}

async function recordOneTimePayment({
  store,
  memberId,
  memberName,
  amountCents,
  description,
  stripePaymentIntentId,
  paymentType,
}) {
  const amount = centsToDollars(amountCents);
  const kind = String(paymentType || "payment");
  const txType = kind === "donation" ? "donation" : "payment";
  const desc =
    description ||
    (kind === "donation"
      ? "Donation (Stripe)"
      : kind === "balance_payoff"
        ? "Balance Payoff (Stripe)"
        : "Stripe payment");

  const created = await createPaymentIntentTransactionIfMissing(
    store,
    "Transaction",
    stripePaymentIntentId,
    txType,
    {
    member_id: String(memberId),
    member_name: memberName || undefined,
    type: txType,
    description: desc,
    amount,
    date: new Date().toISOString().split("T")[0],
    provider: "stripe",
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
    }
  );
  if (!created) return;

  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (member && kind !== "donation") {
    const current = Number(member.total_owed || 0);
    const newBalance = Math.max(0, current - amount);
    await store.update("Member", member.id, { total_owed: newBalance });
  }
}

async function recordMembershipFirstMonthPayment({
  store,
  memberId,
  memberName,
  amountCents,
  standardAmountCents,
  payoffAmountCents,
  stripePaymentIntentId,
  subscriptionId,
  customerId,
  createdAtSeconds,
}) {
  const amount = centsToDollars(amountCents);
  const date = isoDateFromUnixSeconds(createdAtSeconds || Math.floor(Date.now() / 1000));
  const monthLabel = monthLabelFromUnixSeconds(createdAtSeconds || Math.floor(Date.now() / 1000));
  const monthKey = String(date || "").slice(0, 7);
  const descBase = `Monthly Membership - ${monthLabel}`;
  const chargeId = stripePaymentIntentId ? `membership-first-month:${stripePaymentIntentId}:charge` : undefined;
  const paymentId = stripePaymentIntentId ? `membership-first-month:${stripePaymentIntentId}:payment` : undefined;

  const chargePayload = {
    id: chargeId,
    member_id: String(memberId),
    member_name: memberName || undefined,
    type: "charge",
    description: descBase,
    amount,
    date,
    provider: "stripe",
    monthly_key: monthKey || undefined,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
  };

  const paymentPayload = {
    id: paymentId,
    member_id: String(memberId),
    member_name: memberName || undefined,
    type: "payment",
    description: `${descBase} (Stripe)`,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
  };

  const chargeCreated = await createRecordOnce(store, "Transaction", chargePayload);

  const paymentCreated = await createPaymentIntentTransactionIfMissing(
    store,
    "Transaction",
    stripePaymentIntentId,
    "payment",
    paymentPayload
  );

  if (!chargeCreated && !paymentCreated) return null;

  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  let balanceResult = null;
  if (paymentCreated && member) {
    const currentBalanceCents = dollarsToCents(member.total_owed || 0);
    const standardCents = Number(standardAmountCents);
    const payoffCents = Number(payoffAmountCents || 0);
    let reductionCents =
      Number.isFinite(standardCents) && standardCents > 0
        ? standardCents + (Number.isFinite(payoffCents) ? payoffCents : 0)
        : Number(amountCents);
    if (!Number.isFinite(reductionCents) || reductionCents < 0) {
      reductionCents = 0;
    }
    if (Number.isFinite(currentBalanceCents) && currentBalanceCents >= 0) {
      reductionCents = Math.min(currentBalanceCents, reductionCents);
    }
    if (Number.isFinite(currentBalanceCents) && currentBalanceCents >= 0) {
      reductionCents = Math.min(currentBalanceCents, reductionCents);
    }
    const newBalanceCents = Math.max(0, currentBalanceCents - reductionCents);
    await store.update("Member", member.id, { total_owed: centsToDollars(newBalanceCents) });
    balanceResult = {
      currentBalanceCents,
      newBalanceCents,
      standardCents,
      payoffCents,
    };
  }

  return balanceResult;
}

async function recordGuestOneTimePayment({
  store,
  guestId,
  guestName,
  amountCents,
  description,
  stripePaymentIntentId,
  paymentType,
}) {
  const amount = centsToDollars(amountCents);
  const kind = String(paymentType || "payment");
  const txType = kind === "donation" ? "donation" : "payment";
  const desc =
    description ||
    (kind === "donation"
      ? "Donation (Stripe)"
      : kind === "balance_payoff"
        ? "Balance Payoff (Stripe)"
        : "Stripe payment");

  const created = await createPaymentIntentTransactionIfMissing(
    store,
    "GuestTransaction",
    stripePaymentIntentId,
    txType,
    {
    guest_id: String(guestId),
    guest_name: guestName || undefined,
    type: txType,
    description: desc,
    amount,
    date: new Date().toISOString().split("T")[0],
    provider: "stripe",
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
    }
  );
  if (!created) return;

  const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  if (guest && kind !== "donation") {
    const current = Number(guest.total_owed || 0);
    const newBalance = Math.max(0, current - amount);
    await store.update("Guest", guest.id, { total_owed: newBalance });
  }
}

function firstOfNextMonthUtcFrom(baseDate) {
  const base = baseDate instanceof Date ? baseDate : new Date();
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
}

async function upsertRecurringFromCheckout({
  store,
  memberId,
  memberName,
  paymentType,
  amountCents,
  customerId,
  subscriptionId,
  billingAnchorDate,
}) {
  const today = new Date();
  let nextCharge = null;
  if (billingAnchorDate) {
    const parsed = new Date(billingAnchorDate);
    if (!Number.isNaN(parsed.getTime())) {
      nextCharge = parsed;
    }
  }
  if (!nextCharge) {
    nextCharge = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
  }

  // Try to find existing record for this subscription
  const existing = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);

  const base = {
    member_id: String(memberId),
    member_name: memberName || undefined,
    payment_type: paymentType,
    amount_per_month: centsToDollars(amountCents),
    is_active: true,
    start_date: today.toISOString().split("T")[0],
    next_charge_date: nextCharge.toISOString().split("T")[0],
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

async function upsertGuestRecurringFromCheckout({ store, guestId, guestName, paymentType, amountCents, customerId, subscriptionId, payoffTotalCents }) {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const existing = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);

  const base = {
    guest_id: String(guestId),
    guest_name: guestName || undefined,
    payment_type: paymentType,
    amount_per_month: centsToDollars(amountCents),
    is_active: true,
    start_date: today.toISOString().split("T")[0],
    next_charge_date: nextMonth.toISOString().split("T")[0],
    stripe_customer_id: customerId || undefined,
    stripe_subscription_id: subscriptionId || undefined,
    total_amount: paymentType === "guest_balance_payoff" && payoffTotalCents ? centsToDollars(payoffTotalCents) : undefined,
    remaining_amount: paymentType === "guest_balance_payoff" && payoffTotalCents ? centsToDollars(payoffTotalCents) : undefined,
  };

  if (existing[0]?.id) {
    await store.update("RecurringPayment", existing[0].id, base);
    return;
  }

  await store.create("RecurringPayment", base);
}

async function deactivateMemberPayoffPlans({ store, stripe, memberId }) {
  const payoffRecs = await store.filter(
    "RecurringPayment",
    { member_id: String(memberId), payment_type: "balance_payoff", is_active: true },
    "-created_date",
    1000
  );
  if (!payoffRecs.length) return;
  const endedDate = new Date().toISOString().split("T")[0];
  for (const rec of payoffRecs) {
    if (rec.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(String(rec.stripe_subscription_id));
      } catch (err) {
        console.warn("Failed to cancel payoff subscription", rec.stripe_subscription_id, err?.message || err);
      }
    }
    await store.update("RecurringPayment", rec.id, {
      is_active: false,
      ended_date: endedDate,
      amount_per_month: 0,
      remaining_amount: 0,
    });
  }
}

async function detachMemberPayoffSubscriptions({ store, stripe, memberId }) {
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

async function updateMembershipSubscriptionAmount({
  store,
  stripe,
  memberId,
  subscriptionId,
  standardAmountCents,
}) {
  if (!subscriptionId) return;
  let standardCents = Number(standardAmountCents);
  if (!Number.isFinite(standardCents) || standardCents <= 0) {
    const plans = await store.list("MembershipPlan", "-created_date", 1);
    standardCents = dollarsToCents(plans[0]?.standard_amount || 0);
  }
  if (!Number.isFinite(standardCents) || standardCents <= 0) return;

  const memberCharges = await store.filter(
    "MembershipCharge",
    { member_id: String(memberId), is_active: true },
    "-created_date",
    10000
  );
  const recurring = await store.filter(
    "RecurringPayment",
    { member_id: String(memberId), is_active: true },
    "-created_date",
    10000
  );
  const chargesTotalCents = memberCharges.reduce(
    (sum, c) => sum + dollarsToCents(c.amount || 0),
    0
  );
  const recurringNonMembershipCents = recurring
    .filter((p) => p.payment_type !== "membership" && p.payment_type !== "balance_payoff")
    .reduce((sum, p) => sum + dollarsToCents(p.amount_per_month || 0), 0);
  const newTotalCents = standardCents + chargesTotalCents + recurringNonMembershipCents;
  if (!Number.isFinite(newTotalCents) || newTotalCents <= 0) return;

  const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
  const item = sub?.items?.data?.[0];
  const currentCents = item?.price?.unit_amount;
  const productId = item?.price?.product;

  if (!Number.isFinite(currentCents) || currentCents !== newTotalCents) {
    if (productId) {
      const newPrice = await stripe.prices.create({
        unit_amount: newTotalCents,
        currency: process.env.STRIPE_CURRENCY || "usd",
        product: productId,
        recurring: { interval: "month" },
      });
      await stripe.subscriptionItems.update(item.id, {
        price: newPrice.id,
        proration_behavior: "none",
      });
    }
  }

  await stripe.subscriptions.update(String(subscriptionId), {
    metadata: {
      ...(sub?.metadata || {}),
      amountCents: String(newTotalCents),
      standardAmountCents: String(standardCents),
      payoffAmountCents: "0",
    },
  });

  const membershipRec = recurring.find((p) => p.payment_type === "membership");
  if (membershipRec?.id) {
    await store.update("RecurringPayment", membershipRec.id, {
      amount_per_month: centsToDollars(newTotalCents),
    });
  }
}

async function recordSubscriptionInvoicePayment({
  store,
  subscriptionId,
  customerId,
  amountPaidCents,
  periodStart,
  memberId,
  paymentType,
  invoiceId,
  standardAmountCents,
  payoffAmountCents,
}) {
  const amount = centsToDollars(amountPaidCents);
  const date = isoDateFromUnixSeconds(periodStart);
  const monthLabel = monthLabelFromUnixSeconds(periodStart);

  // Create a matching charge + payment so reporting stays consistent.
  const descBase =
    paymentType === "membership"
      ? `Monthly Membership - ${monthLabel}`
      : paymentType === "balance_payoff"
        ? "Balance Payoff Plan"
        : paymentType === "monthly_donation"
          ? `Monthly Donation - ${monthLabel}`
        : "Additional Monthly Payment";

  if (paymentType === "monthly_donation") {
    const donationPayload = {
      member_id: String(memberId),
      type: "donation",
      description: `${descBase} (Stripe)`,
      amount,
      date,
      provider: "stripe",
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      stripe_invoice_id: invoiceId || undefined,
    };
    const created = invoiceId
      ? await createInvoiceTransactionIfMissing(
          store,
          "Transaction",
          invoiceId,
          "donation",
          donationPayload
        )
      : await createRecordOnce(store, "Transaction", donationPayload);
    if (!created) return null;
    return null;
  }

  const chargePayload = {
    member_id: String(memberId),
    type: "charge",
    description: descBase,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    stripe_invoice_id: invoiceId || undefined,
  };

  const paymentPayload = {
    member_id: String(memberId),
    type: "payment",
    description: `${descBase} (Stripe)` ,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    stripe_invoice_id: invoiceId || undefined,
  };

  const chargeCreated = invoiceId
    ? await createInvoiceTransactionIfMissing(store, "Transaction", invoiceId, "charge", chargePayload)
    : await createRecordOnce(store, "Transaction", chargePayload);

  const paymentCreated = await (invoiceId
    ? createInvoiceTransactionIfMissing(store, "Transaction", invoiceId, "payment", paymentPayload)
    : createRecordOnce(store, "Transaction", paymentPayload));

  if (!paymentCreated && !chargeCreated) {
    return null;
  }

  // Net effect is zero if we also update member.total_owed by +charge and -payment.
  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  let balanceResult = null;
  if (paymentCreated && member) {
    const currentBalanceCents = dollarsToCents(member.total_owed || 0);
    let reductionCents = Number(amountPaidCents);
    let standardCents = null;
    let payoffCents = null;
    if (paymentType === "membership") {
      standardCents = Number(standardAmountCents);
      payoffCents = Number(payoffAmountCents || 0);
      if (Number.isFinite(standardCents) && standardCents > 0) {
        reductionCents =
          standardCents + (Number.isFinite(payoffCents) ? payoffCents : 0);
      }
    }
    if (!Number.isFinite(reductionCents) || reductionCents < 0) {
      reductionCents = 0;
    }
    const newBalanceCents = Math.max(0, currentBalanceCents - reductionCents);
    await store.update("Member", member.id, { total_owed: centsToDollars(newBalanceCents) });
    if (paymentType === "membership") {
      balanceResult = {
        currentBalanceCents,
        newBalanceCents,
        standardCents,
        payoffCents,
      };
    }
  }

  // Update RecurringPayment bookkeeping
  const recs = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);
  const rec = recs[0];
  if (!rec || !paymentCreated) return;

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

  return balanceResult;
}

// Try to resolve a member even when the id coming from Stripe metadata is missing or stale.
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

async function recordGuestSubscriptionInvoicePayment({ store, subscriptionId, customerId, amountPaidCents, periodStart, guestId, paymentType, invoiceId }) {
  const amount = centsToDollars(amountPaidCents);
  const date = isoDateFromUnixSeconds(periodStart);

  const descBase = paymentType === "guest_balance_payoff" ? "Guest Balance Payoff" : "Guest Monthly Donation";

  const chargePayload = {
    guest_id: String(guestId),
    type: "charge",
    description: descBase,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    stripe_invoice_id: invoiceId || undefined,
  };

  const paymentPayload = {
    guest_id: String(guestId),
    type: "payment",
    description: `${descBase} (Stripe)`,
    amount,
    date,
    provider: "stripe",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    stripe_invoice_id: invoiceId || undefined,
  };

  const chargeCreated = invoiceId
    ? await createInvoiceTransactionIfMissing(store, "GuestTransaction", invoiceId, "charge", chargePayload)
    : await createRecordOnce(store, "GuestTransaction", chargePayload);

  const paymentCreated = await (invoiceId
    ? createInvoiceTransactionIfMissing(store, "GuestTransaction", invoiceId, "payment", paymentPayload)
    : createRecordOnce(store, "GuestTransaction", paymentPayload));

  if (!paymentCreated && !chargeCreated) {
    return;
  }

  const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  if (paymentCreated && guest) {
    const newBalance = paymentType === "guest_balance_payoff"
      ? Math.max(0, (guest.total_owed || 0) - amount)
      : (guest.total_owed || 0);
    await store.update("Guest", guest.id, { total_owed: newBalance });
  }

  const recs = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);
  const rec = recs[0];
  if (!rec || !paymentCreated) return;

  if (paymentType === "guest_balance_payoff") {
    const remaining = Number(rec.remaining_amount ?? rec.total_amount ?? 0);
    if (Number.isFinite(remaining) && remaining > 0) {
      const newRemaining = Math.max(0, remaining - amount);
      const patch = {
        remaining_amount: newRemaining,
      };
      if (newRemaining <= 0) {
        patch.is_active = false;
        patch.ended_date = new Date().toISOString().split("T")[0];
      }
      await store.update("RecurringPayment", rec.id, patch);
    }
  }
}

async function recordLatestSubscriptionInvoice({
  store,
  stripe,
  subscriptionId,
  memberId,
  guestId,
  paymentType,
}) {
  if (!subscriptionId) return;
  const sub = await stripe.subscriptions.retrieve(String(subscriptionId), {
    expand: ["latest_invoice"],
  });
  const latestInvoice = sub?.latest_invoice;
  const invoiceId = typeof latestInvoice === "string" ? latestInvoice : latestInvoice?.id;
  if (!invoiceId) return;

  const invoice =
    typeof latestInvoice === "object" && latestInvoice?.id
      ? latestInvoice
      : await stripe.invoices.retrieve(String(invoiceId), {
          expand: ["payment_intent", "lines"],
        });

  const paid = invoice?.status === "paid" || invoice?.payment_intent?.status === "succeeded";
  if (!paid) return;

  const amountPaidCents = Number(invoice.amount_paid ?? invoice.total ?? 0);
  const periodStart = invoice.lines?.data?.[0]?.period?.start || invoice.created;

  if (memberId) {
    const standardAmountCents =
      Number(invoice?.metadata?.standardAmountCents ?? 0) ||
      Number(invoice?.lines?.data?.[0]?.metadata?.standardAmountCents ?? 0) ||
      Number(sub?.metadata?.standardAmountCents ?? 0);
    const payoffAmountCents =
      Number(invoice?.metadata?.payoffAmountCents ?? 0) ||
      Number(invoice?.lines?.data?.[0]?.metadata?.payoffAmountCents ?? 0) ||
      Number(sub?.metadata?.payoffAmountCents ?? 0);
    await recordSubscriptionInvoicePayment({
      store,
      subscriptionId: String(subscriptionId),
      customerId: invoice.customer,
      amountPaidCents,
      periodStart,
      memberId,
      paymentType,
      invoiceId,
      standardAmountCents,
      payoffAmountCents,
    });
  } else if (guestId) {
    await recordGuestSubscriptionInvoicePayment({
      store,
      subscriptionId: String(subscriptionId),
      customerId: invoice.customer,
      amountPaidCents,
      periodStart,
      guestId,
      paymentType,
      invoiceId,
    });
  }
}

/**
 * Stripe webhook handler. Must be mounted with express.raw({ type: 'application/json' }).
 * @param {{ store: any }} deps
 */
function createStripeWebhookHandler({ store }) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Prefer a preserved raw body (set by middleware) for Stripe signature verification
  const getRawBody = (req) => {
    if (req.rawBody && (Buffer.isBuffer(req.rawBody) || typeof req.rawBody === "string")) return req.rawBody;
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return req.body;
    return null;
  };

  if (!webhookSecret) {
    // Fail fast during development; without signature verification this is unsafe.
    const err = new Error("Missing STRIPE_WEBHOOK_SECRET");
    // @ts-ignore
    err.status = 500;
    throw err;
  }

  return async function stripeWebhook(req, res) {
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).send("Webhook Error: missing stripe-signature header.");
    }
    const rawBody = getRawBody(req);
    if (!rawBody) {
      return res
        .status(400)
        .send("Webhook Error: raw body required. Mount route with express.raw({ type: 'application/json' }) or provide req.rawBody.");
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (e) {
      return res.status(400).send(`Webhook Error: ${e?.message || e}`);
    }

    try {
      if (!event?.id) {
        return res.status(400).json({ message: "Missing event id" });
      }

      const recorded = await markEventProcessed({ store, event });
      const isDuplicate = !recorded;
      if (isDuplicate && event.type !== "invoice.paid" && event.type !== "checkout.session.completed") {
        return res.json({ received: true, duplicate: true });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        if (isDuplicate && session.mode !== "subscription") {
          return res.json({ received: true, duplicate: true });
        }

        // One-time payments
        if (session.mode === "payment") {
          const md = session.metadata || {};
          const memberId = md.memberId;
          const guestId = md.guestId;
          const paymentType = md.paymentType;
          const applyMonth = md.applyMonth === "next_month" ? "next_month" : "this_month";
          const isMembershipFirstMonth =
            md.kind === "membership_first_month" && paymentType === "membership" && applyMonth === "this_month";

          if (memberId && isMembershipFirstMonth) {
            const amountCents = Number(md.amountCents || session.amount_total || 0);
            const standardAmountCents = Number(md.standardAmountCents || md.standard_amount_cents || 0);
            const payoffAmountCents = Number(md.payoffAmountCents || md.payoff_amount_cents || 0);
            const member = await findMemberByAnyId(store, {
              memberId,
              stripeCustomerId: session.customer,
            });
            const resolvedMemberId = member?.id || memberId;
            if (!resolvedMemberId || !session.customer) {
              throw new Error("Missing member or customer for membership activation");
            }

            let paymentMethodId;
            if (session.payment_intent) {
              const paymentIntent = await stripe.paymentIntents.retrieve(String(session.payment_intent));
              paymentMethodId = paymentIntent?.payment_method ? String(paymentIntent.payment_method) : undefined;
            }

            if (paymentMethodId) {
              await stripe.customers.update(String(session.customer), {
                invoice_settings: { default_payment_method: paymentMethodId },
              });
              if (member) {
                await store.update("Member", String(member.id), {
                  stripe_customer_id: session.customer,
                  stripe_default_payment_method_id: paymentMethodId,
                });
              }
            }

            const baseDate = session.created ? new Date(session.created * 1000) : new Date();
            const anchorDate = firstOfNextMonthUtcFrom(baseDate);
            const anchorSeconds = Math.floor(anchorDate.getTime() / 1000);

            const price = await stripe.prices.create(
              {
                unit_amount: amountCents,
                currency: process.env.STRIPE_CURRENCY || "usd",
                recurring: { interval: "month" },
                product_data: { name: "Monthly Membership" },
              },
              { idempotencyKey: `membership-first-month-price:${session.id}` }
            );

            const subscription = await stripe.subscriptions.create(
              {
                customer: session.customer,
                default_payment_method: paymentMethodId || undefined,
                items: [
                  {
                    price: price.id,
                    quantity: 1,
                  },
                ],
                billing_cycle_anchor: anchorSeconds,
                proration_behavior: "none",
                metadata: {
                  memberId: String(resolvedMemberId),
                  paymentType: "membership",
                  amountCents: String(amountCents),
                  applyMonth: "this_month",
                  standardAmountCents: String(standardAmountCents),
                  payoffAmountCents: String(payoffAmountCents),
                },
              },
              { idempotencyKey: `membership-first-month:${session.id}` }
            );

            await upsertRecurringFromCheckout({
              store,
              memberId: resolvedMemberId,
              memberName: md.memberName,
              paymentType: "membership",
              amountCents,
              customerId: session.customer,
              subscriptionId: subscription.id,
              billingAnchorDate: anchorDate.toISOString().split("T")[0],
            });

            await detachMemberPayoffSubscriptions({
              store,
              stripe,
              memberId: resolvedMemberId,
            });

            await store.update("Member", String(resolvedMemberId), {
              membership_active: true,
              stripe_subscription_id: subscription.id,
              stripe_customer_id: session.customer,
            });

            const balanceResult = await recordMembershipFirstMonthPayment({
              store,
              memberId: resolvedMemberId,
              memberName: md.memberName,
              amountCents,
              standardAmountCents,
              payoffAmountCents,
              stripePaymentIntentId: session.payment_intent,
              subscriptionId: subscription.id,
              customerId: session.customer,
              createdAtSeconds: session.created,
            });
            if (balanceResult) {
              const {
                currentBalanceCents,
                newBalanceCents,
                standardCents,
                payoffCents,
              } = balanceResult;
              const shouldDropPayoff =
                Number.isFinite(standardCents) &&
                standardCents > 0 &&
                Number.isFinite(payoffCents) &&
                payoffCents > 0 &&
                standardCents + payoffCents > currentBalanceCents;
              const shouldEndPayoff =
                Number.isFinite(newBalanceCents) && newBalanceCents <= 0;
              if (shouldDropPayoff || shouldEndPayoff) {
                await deactivateMemberPayoffPlans({
                  store,
                  stripe,
                  memberId: resolvedMemberId,
                });
                await updateMembershipSubscriptionAmount({
                  store,
                  stripe,
                  memberId: resolvedMemberId,
                  subscriptionId: subscription.id,
                  standardAmountCents: standardCents,
                });
              }
            }
          } else if (memberId) {
            await recordOneTimePayment({
              store,
              memberId,
              memberName: md.memberName,
              amountCents: Number(md.amountCents || 0),
              paymentType: md.paymentType,
              description: md.description,
              stripePaymentIntentId: session.payment_intent,
            });
          } else if (guestId) {
            await recordGuestOneTimePayment({
              store,
              guestId,
              guestName: md.guestName,
              amountCents: Number(md.amountCents || 0),
              paymentType: md.paymentType,
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
          const guestId = md.guestId;
          let billingAnchorDate = md.billingAnchor;
          const member = await findMemberByAnyId(store, {
            memberId,
            stripeCustomerId: session.customer,
            subscriptionId: session.subscription,
          });
          const resolvedMemberId = member?.id || memberId;

          if (resolvedMemberId && session.subscription && !guestId) {
            await upsertRecurringFromCheckout({
              store,
              memberId: resolvedMemberId,
              memberName: md.memberName,
              paymentType,
              amountCents: Number(md.amountCents || 0),
              customerId: session.customer,
              subscriptionId: session.subscription,
              billingAnchorDate,
            });

            if (member && paymentType === "membership") {
              await detachMemberPayoffSubscriptions({
                store,
                stripe,
                memberId: resolvedMemberId,
              });
              await store.update("Member", String(member.id), {
                membership_active: true,
                stripe_subscription_id: session.subscription,
                stripe_customer_id: session.customer,
              });
            }

            await recordLatestSubscriptionInvoice({
              store,
              stripe,
              subscriptionId: session.subscription,
              memberId: resolvedMemberId,
              paymentType,
            });
          } else if (guestId && session.subscription) {
            await upsertGuestRecurringFromCheckout({
              store,
              guestId,
              guestName: md.guestName,
              paymentType,
              amountCents: Number(md.amountCents || 0),
              customerId: session.customer,
              subscriptionId: session.subscription,
              payoffTotalCents: md.payoffTotalCents ? Number(md.payoffTotalCents) : undefined,
            });

            await recordLatestSubscriptionInvoice({
              store,
              stripe,
              subscriptionId: session.subscription,
              guestId,
              paymentType,
            });
          }
        }

        // Save-card setup sessions
        if (session.mode === "setup") {
          const md = session.metadata || {};
          const memberId = md.memberId;
          const guestId = md.guestId;
          const saveCardTokenJti = md.saveCardTokenJti ? String(md.saveCardTokenJti) : null;
          if (session.setup_intent) {
            const setupIntent = await stripe.setupIntents.retrieve(String(session.setup_intent));
            const paymentMethodId = setupIntent?.payment_method;
            if (paymentMethodId) {
              if (session.customer) {
                await stripe.customers.update(String(session.customer), {
                  invoice_settings: { default_payment_method: paymentMethodId },
                });
              }
              if (memberId) {
                await store.update("Member", String(memberId), {
                  stripe_customer_id: session.customer || undefined,
                  stripe_default_payment_method_id: paymentMethodId,
                });
              } else if (guestId) {
                await store.update("Guest", String(guestId), {
                  stripe_customer_id: session.customer || undefined,
                  stripe_default_payment_method_id: paymentMethodId,
                });
              }
            }
          }

          if (saveCardTokenJti) {
            const existingToken = await store.filter(
              "WebhookEvent",
              { id: String(saveCardTokenJti) },
              undefined,
              1
            );
            if (!existingToken[0]) {
              await store.create("WebhookEvent", {
                id: String(saveCardTokenJti),
                event_type: "save_card_token_used",
                stripe_created: Math.floor(Date.now() / 1000),
                stripe_livemode: Boolean(event.livemode),
                stripe_request_id: event.request?.id || undefined,
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
          let memberId = md.memberId;
          let guestId = md.guestId;
          let paymentType = md.paymentType;
          let sub;

          if (!memberId && !guestId) {
            sub = await stripe.subscriptions.retrieve(String(subscriptionId));
            if (sub?.metadata) {
              memberId = memberId || sub.metadata.memberId;
              guestId = guestId || sub.metadata.guestId;
              paymentType = paymentType || sub.metadata.paymentType || "additional_monthly";
            }
          }
          if (!paymentType) {
            const recs = await store.filter(
              "RecurringPayment",
              { stripe_subscription_id: String(subscriptionId) },
              undefined,
              1
            );
            paymentType = recs[0]?.payment_type;
          }
          paymentType = paymentType || "additional_monthly";

          if (memberId) {
            if (!sub) {
              sub = await stripe.subscriptions.retrieve(String(subscriptionId));
            }
            const standardAmountCents =
              Number(md.standardAmountCents ?? md.standard_amount_cents ?? 0) ||
              Number(sub?.metadata?.standardAmountCents ?? 0) ||
              Number(sub?.metadata?.standard_amount_cents ?? 0);
            const payoffAmountCents =
              Number(md.payoffAmountCents ?? md.payoff_amount_cents ?? 0) ||
              Number(sub?.metadata?.payoffAmountCents ?? 0) ||
              Number(sub?.metadata?.payoff_amount_cents ?? 0);
            const resolvedMember = await findMemberByAnyId(store, {
              memberId,
              stripeCustomerId: invoice.customer,
              subscriptionId,
            });
            const resolvedMemberId = resolvedMember?.id || memberId;
            const balanceResult = await recordSubscriptionInvoicePayment({
              store,
              subscriptionId,
              customerId: invoice.customer,
              amountPaidCents: invoice.amount_paid,
              periodStart: firstLine.period?.start || invoice.created,
              memberId: resolvedMemberId,
              paymentType,
              invoiceId: invoice.id,
              standardAmountCents,
              payoffAmountCents,
            });

            if (paymentType === "membership" && balanceResult) {
              const {
                currentBalanceCents,
                newBalanceCents,
                standardCents,
                payoffCents,
              } = balanceResult;
              const shouldDropPayoff =
                Number.isFinite(standardCents) &&
                standardCents > 0 &&
                Number.isFinite(payoffCents) &&
                payoffCents > 0 &&
                standardCents + payoffCents > currentBalanceCents;
              const shouldEndPayoff =
                Number.isFinite(newBalanceCents) && newBalanceCents <= 0;
              if (shouldDropPayoff || shouldEndPayoff) {
                await deactivateMemberPayoffPlans({
                  store,
                  stripe,
                  memberId: resolvedMemberId,
                });
                await updateMembershipSubscriptionAmount({
                  store,
                  stripe,
                  memberId: resolvedMemberId,
                  subscriptionId,
                  standardAmountCents: standardCents,
                });
              }
            }

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
          } else if (guestId) {
            await recordGuestSubscriptionInvoicePayment({
              store,
              subscriptionId,
              customerId: invoice.customer,
              amountPaidCents: invoice.amount_paid,
              periodStart: firstLine.period?.start || invoice.created,
              guestId,
              paymentType,
              invoiceId: invoice.id,
            });

            if (paymentType === "guest_balance_payoff") {
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

      // If a membership invoice fails, accrue it to the member's balance with a month label.
      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (subscriptionId && invoice.lines?.data?.length) {
          const firstLine = invoice.lines.data[0];
          const md = firstLine.metadata || invoice.metadata || {};
          let memberId = md.memberId;
          let paymentType = md.paymentType;

          if (!memberId) {
            const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
            if (sub?.metadata) {
              memberId = memberId || sub.metadata.memberId;
              paymentType = paymentType || sub.metadata.paymentType;
            }
          }
          if (!paymentType) {
            const recs = await store.filter(
              "RecurringPayment",
              { stripe_subscription_id: String(subscriptionId) },
              undefined,
              1
            );
            paymentType = recs[0]?.payment_type;
          }
          paymentType = paymentType || "additional_monthly";
          if (!memberId) {
            const [memberBySub] = await store.filter(
              "Member",
              { stripe_subscription_id: String(subscriptionId) },
              undefined,
              1
            );
            if (memberBySub) {
              memberId = memberBySub.id;
            }
          }
          if (!memberId && invoice.customer) {
            const [memberByCustomer] = await store.filter(
              "Member",
              { stripe_customer_id: String(invoice.customer) },
              undefined,
              1
            );
            if (memberByCustomer) {
              memberId = memberByCustomer.id;
            }
          }

          // Only accrue unpaid monthly memberships
          if (memberId && paymentType === "membership") {
            const amount = centsToDollars(invoice.amount_due ?? firstLine.amount ?? 0);
            const periodStart = firstLine.period?.start || invoice.created;
            const monthLabel = monthLabelFromUnixSeconds(periodStart);
            const date = isoDateFromUnixSeconds(periodStart);

            const createdCharge = await (invoice.id
              ? createInvoiceTransactionIfMissing(store, "Transaction", invoice.id, "charge", {
                  member_id: String(memberId),
                  type: "charge",
                  description: `Unpaid Monthly Membership - ${monthLabel}`,
                  amount,
                  date,
                  provider: "stripe",
                  stripe_subscription_id: subscriptionId,
                  stripe_customer_id: invoice.customer,
                  stripe_invoice_id: invoice.id,
                })
              : createRecordOnce(store, "Transaction", {
                  member_id: String(memberId),
                  type: "charge",
                  description: `Unpaid Monthly Membership - ${monthLabel}`,
                  amount,
                  date,
                  provider: "stripe",
                  stripe_subscription_id: subscriptionId,
                  stripe_customer_id: invoice.customer,
                }));

            if (createdCharge) {
              const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
              if (member) {
                const newBalance = (member.total_owed || 0) + amount;
                await store.update("Member", member.id, { total_owed: newBalance });
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

      return res.json({ received: true, duplicate: isDuplicate || undefined });
    } catch (e) {
      return res.status(500).json({ message: e?.message || String(e) });
    }
  };
}

module.exports = {
  createStripeWebhookHandler,
};

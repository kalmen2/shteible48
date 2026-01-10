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

async function recordOneTimePayment({ store, memberId, memberName, amountCents, description, stripePaymentIntentId }) {
  const amount = centsToDollars(amountCents);

  const created = await createRecordOnce(store, "Transaction", {
    member_id: String(memberId),
    member_name: memberName || undefined,
    type: "payment",
    description: description || "Stripe payment",
    amount,
    date: new Date().toISOString().split("T")[0],
    provider: "stripe",
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
  });
  if (!created) return;

  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (member) {
    const newBalance = (member.total_owed || 0) - amount;
    await store.update("Member", member.id, { total_owed: newBalance });
  }
}

async function recordGuestOneTimePayment({ store, guestId, guestName, amountCents, description, stripePaymentIntentId }) {
  const amount = centsToDollars(amountCents);

  const created = await createRecordOnce(store, "GuestTransaction", {
    guest_id: String(guestId),
    guest_name: guestName || undefined,
    type: "payment",
    description: description || "Stripe payment",
    amount,
    date: new Date().toISOString().split("T")[0],
    provider: "stripe",
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
  });
  if (!created) return;

  const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  if (guest) {
    const newBalance = (guest.total_owed || 0) - amount;
    await store.update("Guest", guest.id, { total_owed: newBalance });
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

async function recordSubscriptionInvoicePayment({ store, subscriptionId, customerId, amountPaidCents, periodStart, memberId, paymentType, invoiceId }) {
  const amount = centsToDollars(amountPaidCents);
  const date = isoDateFromUnixSeconds(periodStart);
  const monthLabel = monthLabelFromUnixSeconds(periodStart);

  // Create a matching charge + payment so reporting stays consistent.
  const descBase =
    paymentType === "membership"
      ? `Monthly Membership - ${monthLabel}`
      : paymentType === "balance_payoff"
        ? "Balance Payoff Plan"
        : "Additional Monthly Payment";

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

  await (invoiceId
    ? createInvoiceTransactionIfMissing(store, "Transaction", invoiceId, "payment", paymentPayload)
    : createRecordOnce(store, "Transaction", paymentPayload));

  if (!chargeCreated) {
    return;
  }

  // Net effect is zero if we also update member.total_owed by +charge and -payment.
  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (member) {
    const currentBalance = Number(member.total_owed || 0);
    const newBalance = Math.max(0, currentBalance - amount);
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

  await (invoiceId
    ? createInvoiceTransactionIfMissing(store, "GuestTransaction", invoiceId, "payment", paymentPayload)
    : createRecordOnce(store, "GuestTransaction", paymentPayload));

  if (!chargeCreated) {
    return;
  }

  const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  if (guest) {
    const newBalance = paymentType === "guest_balance_payoff"
      ? Math.max(0, (guest.total_owed || 0) - amount)
      : (guest.total_owed || 0);
    await store.update("Guest", guest.id, { total_owed: newBalance });
  }

  const recs = await store.filter("RecurringPayment", { stripe_subscription_id: String(subscriptionId) }, undefined, 1);
  const rec = recs[0];
  if (!rec) return;

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
    await recordSubscriptionInvoicePayment({
      store,
      subscriptionId: String(subscriptionId),
      customerId: invoice.customer,
      amountPaidCents,
      periodStart,
      memberId,
      paymentType,
      invoiceId,
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
          if (memberId) {
            await recordOneTimePayment({
              store,
              memberId,
              memberName: md.memberName,
              amountCents: Number(md.amountCents || 0),
              description: md.description,
              stripePaymentIntentId: session.payment_intent,
            });
          } else if (guestId) {
            await recordGuestOneTimePayment({
              store,
              guestId,
              guestName: md.guestName,
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
          const guestId = md.guestId;
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

            await recordLatestSubscriptionInvoice({
              store,
              stripe,
              subscriptionId: session.subscription,
              memberId,
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
          if (memberId && session.setup_intent) {
            const setupIntent = await stripe.setupIntents.retrieve(String(session.setup_intent));
            const paymentMethodId = setupIntent?.payment_method;
            if (paymentMethodId) {
              if (session.customer) {
                await stripe.customers.update(String(session.customer), {
                  invoice_settings: { default_payment_method: paymentMethodId },
                });
              }
              await store.update("Member", String(memberId), {
                stripe_customer_id: session.customer || undefined,
                stripe_default_payment_method_id: paymentMethodId,
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
          let paymentType = md.paymentType || "additional_monthly";

          if (!memberId && !guestId) {
            const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
            if (sub?.metadata) {
              memberId = memberId || sub.metadata.memberId;
              guestId = guestId || sub.metadata.guestId;
              paymentType = paymentType || sub.metadata.paymentType || "additional_monthly";
            }
          }

          if (memberId) {
            await recordSubscriptionInvoicePayment({
              store,
              subscriptionId,
              customerId: invoice.customer,
              amountPaidCents: invoice.amount_paid,
              periodStart: firstLine.period?.start || invoice.created,
              memberId,
              paymentType,
              invoiceId: invoice.id,
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
          let paymentType = md.paymentType || "additional_monthly";

          if (!memberId) {
            const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
            if (sub?.metadata) {
              memberId = memberId || sub.metadata.memberId;
              paymentType = paymentType || sub.metadata.paymentType || "additional_monthly";
            }
          }

          // Only accrue unpaid monthly memberships
          if (memberId && paymentType === "membership") {
            const amount = centsToDollars(invoice.amount_due ?? firstLine.amount ?? 0);
            const periodStart = firstLine.period?.start || invoice.created;
            const monthLabel = monthLabelFromUnixSeconds(periodStart);
            const date = isoDateFromUnixSeconds(periodStart);

            const createdCharge = await createRecordOnce(store, "Transaction", {
              member_id: String(memberId),
              type: "charge",
              description: `Unpaid Monthly Membership - ${monthLabel}`,
              amount,
              date,
              provider: "stripe",
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: invoice.customer,
            });

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

require("dotenv").config();
const { MongoClient } = require("mongodb");
const Stripe = require("stripe");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key || !key.startsWith("--")) continue;
    const name = key.slice(2);
    if (!name) continue;
    if (!next || next.startsWith("--")) {
      args[name] = "true";
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function toDollars(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
}

function monthLabelFromYYYYMM(yyyyMm) {
  const [year, month] = String(yyyyMm || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return "Unknown Month";
  }
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatIsoDate(yyyyMm) {
  const m = String(yyyyMm || "");
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  return `${m}-01`;
}

function parseDateStartToUnix(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return Math.floor(Date.UTC(y, mo - 1, d, 0, 0, 0) / 1000);
}

function parseDateEndToUnix(dateStr) {
  const start = parseDateStartToUnix(dateStr);
  if (!Number.isFinite(start)) return null;
  return start + 86399;
}

function buildBackfillId(paymentIntentId, memberId, yyyyMm) {
  return `backfill-payment:${paymentIntentId}:${memberId}:${yyyyMm}`;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseDayOfMonth(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const day = Math.floor(n);
  if (day < 1 || day > 31) return null;
  return day;
}

function unixToYyyyMmDd(sec) {
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function unixToUtcDayOfMonth(sec) {
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCDate();
}

async function listPaymentIntentsForCustomer(stripe, customerId, createdFilter) {
  const out = [];
  let startingAfter = undefined;
  for (;;) {
    const page = await stripe.paymentIntents.list({
      customer: String(customerId),
      limit: 100,
      ...(createdFilter ? { created: createdFilter } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...(page?.data || []));
    if (!page?.has_more || !page?.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

function looksLikeMembershipPaymentIntent(pi) {
  const paymentType = String(pi?.metadata?.paymentType || pi?.metadata?.payment_type || "");
  if (paymentType === "membership") return true;

  const description = String(pi?.description || "").toLowerCase();
  if (description.includes("subscription creation")) return true;
  if (description.includes("monthly membership")) return true;

  return false;
}

function getInvoiceSubscriptionId(invoice) {
  const topLevel = invoice?.subscription ? String(invoice.subscription) : "";
  if (topLevel) return topLevel;

  const parentSub = invoice?.parent?.subscription_details?.subscription
    ? String(invoice.parent.subscription_details.subscription)
    : "";
  if (parentSub) return parentSub;

  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  for (const line of lines) {
    const lineParentSub = line?.parent?.subscription_item_details?.subscription
      ? String(line.parent.subscription_item_details.subscription)
      : "";
    if (lineParentSub) return lineParentSub;
  }

  return "";
}

async function invoiceLooksLikeMembership({ stripe, invoice, memberSubscriptionIds }) {
  const invoiceSubId = getInvoiceSubscriptionId(invoice);
  if (invoiceSubId && memberSubscriptionIds.has(invoiceSubId)) return true;

  const invMdType = String(invoice?.metadata?.paymentType || invoice?.metadata?.payment_type || "");
  if (invMdType === "membership") return true;

  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  for (const line of lines) {
    const lineMdType = String(line?.metadata?.paymentType || line?.metadata?.payment_type || "");
    if (lineMdType === "membership") return true;
    const lineDesc = String(line?.description || "").toLowerCase();
    if (lineDesc.includes("monthly membership")) return true;
  }

  if (invoiceSubId) {
    try {
      const sub = await stripe.subscriptions.retrieve(invoiceSubId);
      const subMdType = String(sub?.metadata?.paymentType || sub?.metadata?.payment_type || "");
      if (subMdType === "membership") return true;
    } catch (_err) {
      return false;
    }
  }

  return false;
}

async function resolveMembershipFromInvoice({
  stripe,
  paymentIntent,
  memberSubscriptionIds,
}) {
  const invoiceId = paymentIntent?.invoice ? String(paymentIntent.invoice) : "";
  let invoice;
  if (invoiceId) {
    try {
      invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["lines"] });
    } catch (_err) {
      invoice = null;
    }
  }

  if (invoice && (await invoiceLooksLikeMembership({ stripe, invoice, memberSubscriptionIds }))) {
    return true;
  }

  const customerId = paymentIntent?.customer ? String(paymentIntent.customer) : "";
  const paymentDateUtc = unixToYyyyMmDd(paymentIntent?.created);
  if (customerId && paymentDateUtc) {
    try {
      const page = await stripe.invoices.list({
        customer: customerId,
        created: {
          gte: parseDateStartToUnix(paymentDateUtc),
          lte: parseDateEndToUnix(paymentDateUtc),
        },
        limit: 20,
      });

      for (const candidate of page?.data || []) {
        const detailedInvoice = await stripe.invoices.retrieve(String(candidate.id), {
          expand: ["lines"],
        });
        if (await invoiceLooksLikeMembership({
          stripe,
          invoice: detailedInvoice,
          memberSubscriptionIds,
        })) {
          return true;
        }
      }
    } catch (_err) {
      return false;
    }
  }

  return false;
}

async function run() {
  const args = parseArgs(process.argv);

  const targetMonth = String(args["target-month"] || "").trim(); // YYYY-MM
  const targetDate = formatIsoDate(targetMonth);
  if (!targetDate) {
    throw new Error("target-month is required and must be YYYY-MM");
  }

  const createdFrom = String(args["created-from"] || "").trim(); // YYYY-MM-DD
  const createdTo = String(args["created-to"] || "").trim(); // YYYY-MM-DD
  const createdFromUnix = createdFrom ? parseDateStartToUnix(createdFrom) : null;
  const createdToUnix = createdTo ? parseDateEndToUnix(createdTo) : null;
  if (createdFrom && !Number.isFinite(createdFromUnix)) {
    throw new Error("created-from must be YYYY-MM-DD");
  }
  if (createdTo && !Number.isFinite(createdToUnix)) {
    throw new Error("created-to must be YYYY-MM-DD");
  }
  const createdFilter =
    Number.isFinite(createdFromUnix) || Number.isFinite(createdToUnix)
      ? {
          ...(Number.isFinite(createdFromUnix) ? { gte: createdFromUnix } : {}),
          ...(Number.isFinite(createdToUnix) ? { lte: createdToUnix } : {}),
        }
      : null;

  const memberInput = String(args["member-id"] || "").trim();
  const apply = parseBoolean(args.apply, false);
  const allowIfMonthAlreadyPaid = parseBoolean(args["allow-if-month-already-paid"], false);
  const maxPerMember = parsePositiveInt(args["max-per-member"], 1);
  const paidDay = parseDayOfMonth(args["paid-day"]);
  const paidDate = String(args["paid-date"] || "").trim();
  if (args["paid-day"] && !Number.isFinite(paidDay)) {
    throw new Error("paid-day must be an integer from 1 to 31");
  }
  if (paidDate && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    throw new Error("paid-date must be YYYY-MM-DD");
  }

  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE || "synagogue_harmony";
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required");

  const stripe = new Stripe(stripeKey);
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  const memberCol = db.collection("Member");
  const txCol = db.collection("Transaction");
  const recurringCol = db.collection("RecurringPayment");

  const summary = {
    apply,
    targetMonth,
    targetDate,
    createdFrom: createdFrom || null,
    createdTo: createdTo || null,
    memberFilter: memberInput || null,
    maxPerMember,
    paidDay: Number.isFinite(paidDay) ? paidDay : null,
    paidDate: paidDate || null,
    checkedMembers: 0,
    matchedPaymentIntents: 0,
    candidates: 0,
    skippedNoStripeCustomer: 0,
    skippedAlreadyMapped: 0,
    skippedNotMembership: 0,
    skippedByPaidDay: 0,
    skippedByPaidDate: 0,
    skippedMonthAlreadyPaid: 0,
    skippedNonSucceededOrZero: 0,
    insertedTransactions: 0,
    updatedBalances: 0,
    errors: 0,
    errorMembers: [],
    affected: [],
    observedSucceededPaymentDatesUtc: {},
  };

  try {
    const memberWhere = memberInput
      ? { $or: [{ id: memberInput }, { member_id: memberInput }] }
      : { stripe_customer_id: { $exists: true, $ne: null, $ne: "" } };

    const members = await memberCol.find(memberWhere).toArray();
    const monthLabel = monthLabelFromYYYYMM(targetMonth);

    console.log("[backfill-all] starting", {
      apply,
      targetMonth,
      targetDate,
      createdFilter,
      members: members.length,
      maxPerMember,
      allowIfMonthAlreadyPaid,
      paidDay: Number.isFinite(paidDay) ? paidDay : null,
      paidDate: paidDate || null,
    });

    for (const member of members) {
      const memberId = String(member?.id || "");
      if (!memberId) continue;
      summary.checkedMembers += 1;

      try {
        const customerId = member?.stripe_customer_id ? String(member.stripe_customer_id) : "";
        if (!customerId) {
          summary.skippedNoStripeCustomer += 1;
          continue;
        }

        const membershipRecs = await recurringCol
          .find({
            member_id: memberId,
            payment_type: "membership",
            stripe_subscription_id: { $exists: true, $ne: null, $ne: "" },
          })
          .toArray();
        const memberSubscriptionIds = new Set(
          membershipRecs.map((r) => String(r?.stripe_subscription_id || "")).filter(Boolean)
        );
        if (member?.stripe_subscription_id) {
          memberSubscriptionIds.add(String(member.stripe_subscription_id));
        }

        const paymentIntents = await listPaymentIntentsForCustomer(stripe, customerId, createdFilter);
        paymentIntents.sort((a, b) => Number(b?.created || 0) - Number(a?.created || 0));

        let processedForMember = 0;
        for (const pi of paymentIntents) {
          const paymentIntentId = String(pi?.id || "");
          if (!paymentIntentId) continue;
          summary.matchedPaymentIntents += 1;

          const status = String(pi?.status || "");
          const amountCents = Number(pi?.amount_received || pi?.amount || 0);
          if (status !== "succeeded" || !Number.isFinite(amountCents) || amountCents <= 0) {
            summary.skippedNonSucceededOrZero += 1;
            continue;
          }
          const piDateUtc = unixToYyyyMmDd(pi?.created) || "unknown";
          summary.observedSucceededPaymentDatesUtc[piDateUtc] =
            (summary.observedSucceededPaymentDatesUtc[piDateUtc] || 0) + 1;

          if (paidDate) {
            const piDate = piDateUtc;
            if (piDate !== paidDate) {
              summary.skippedByPaidDate += 1;
              continue;
            }
          } else if (Number.isFinite(paidDay)) {
            const piDay = unixToUtcDayOfMonth(pi?.created);
            if (piDay !== paidDay) {
              summary.skippedByPaidDay += 1;
              continue;
            }
          }

          const existingByPi = await txCol.findOne({
            stripe_payment_intent_id: paymentIntentId,
            type: "payment",
          });
          if (existingByPi) {
            summary.skippedAlreadyMapped += 1;
            continue;
          }

          let isMembership = looksLikeMembershipPaymentIntent(pi);
          if (!isMembership) {
            isMembership = await resolveMembershipFromInvoice({
              stripe,
              paymentIntent: pi,
              memberSubscriptionIds,
            });
          }
          if (!isMembership) {
            summary.skippedNotMembership += 1;
            continue;
          }

          if (!allowIfMonthAlreadyPaid) {
            const monthAlreadyPaid = await txCol.findOne({
              member_id: memberId,
              type: "payment",
              provider: "stripe",
              date: targetDate,
              description: { $regex: /^Monthly Membership\s*-\s*/i },
            });
            if (monthAlreadyPaid) {
              summary.skippedMonthAlreadyPaid += 1;
              continue;
            }
          }

          summary.candidates += 1;
          const amount = toDollars(amountCents);
          const nowIso = new Date().toISOString();
          const txId = buildBackfillId(paymentIntentId, memberId, targetMonth);
          const txDoc = {
            id: txId,
            member_id: memberId,
            member_name:
              member.full_name || member.english_name || member.hebrew_name || undefined,
            type: "payment",
            description: `Monthly Membership - ${monthLabel} (Stripe)`,
            amount,
            date: targetDate,
            provider: "stripe",
            stripe_payment_intent_id: paymentIntentId,
            stripe_customer_id: customerId,
            created_date: nowIso,
            updated_date: nowIso,
          };

          if (apply) {
            await txCol.insertOne(txDoc);
            summary.insertedTransactions += 1;

            const currentBalance = Number(member.total_owed || 0);
            const newBalance = Math.max(0, currentBalance - amount);
            await memberCol.updateOne(
              { _id: member._id },
              { $set: { total_owed: newBalance, updated_date: nowIso } }
            );
            member.total_owed = newBalance;
            summary.updatedBalances += 1;
          }

          console.log("[backfill-all] matched", {
            apply,
            memberId,
            memberName: member?.full_name || "",
            paymentIntentId,
            amount,
            targetMonth,
            targetDate,
            paymentDateUtc: unixToYyyyMmDd(pi?.created),
          });

          summary.affected.push({
            memberId,
            memberName: member?.full_name || "",
            stripeCustomerId: customerId,
            paymentIntentId,
            amount,
            paymentDateUtc: unixToYyyyMmDd(pi?.created),
            targetMonth,
          });

          processedForMember += 1;
          if (processedForMember >= maxPerMember) break;
        }
      } catch (err) {
        summary.errors += 1;
        summary.errorMembers.push(memberId);
        console.error("[backfill-all] member processing failed", {
          memberId,
          err: err?.message || err,
        });
      }
    }

    console.log("[backfill-all] complete", summary);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("[backfill-all] failed:", err?.message || err);
  process.exitCode = 1;
});

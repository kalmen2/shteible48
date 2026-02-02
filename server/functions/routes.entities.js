const express = require("express");
const { assertEntityName } = require("./entityStore.js");

const ENTITY_FIELD_ALLOWLIST = {
  Member: [
    "english_name",
    "hebrew_name",
    "full_name",
    "email",
    "phone",
    "address",
    "member_id",
    "membership_active",
  ],
  Guest: ["full_name", "email", "phone", "address", "notes"],
  Transaction: ["member_id", "member_name", "type", "description", "amount", "date", "category", "provider"],
  GuestTransaction: ["guest_id", "guest_name", "type", "description", "amount", "date", "category", "provider"],
  InputType: ["name", "options", "honors", "is_custom"],
  MembershipPlan: ["standard_amount", "is_active"],
  MembershipCharge: ["member_id", "member_name", "charge_type", "amount", "is_active"],
  RecurringPayment: [
    "member_id",
    "guest_id",
    "member_name",
    "guest_name",
    "payment_type",
    "amount_per_month",
    "is_active",
    "start_date",
    "next_charge_date",
    "total_amount",
    "remaining_amount",
  ],
  StatementTemplate: [
    "header_title",
    "header_subtitle",
    "header_font_size",
    "header_color",
    "show_member_id",
    "show_email",
    "show_charges_section",
    "show_payments_section",
    "charges_color",
    "payments_color",
    "balance_color",
    "body_font_size",
    "footer_text",
    "show_footer",
  ],
  EmailSchedule: [
    "name",
    "id",
    "enabled",
    "day_of_month",
    "hour",
    "minute",
    "time_zone",
    "send_to",
    "selected_member_ids",
    "subject",
    "body",
    "attach_invoice",
  ],
};

function sanitizeEntityData(entity, data) {
  if (!data || typeof data !== "object") return {};
  const allowlist = ENTITY_FIELD_ALLOWLIST[entity] || [];
  const out = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      out[key] = data[key];
    }
  }
  return out;
}

function getBalanceDeltaFromTransaction(transaction, direction) {
  const amount = Number(transaction?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const sign = direction === "delete" ? -1 : 1;
  if (transaction?.type === "charge") return sign * amount;
  if (transaction?.type === "payment") return sign * -amount;
  return 0;
}

function getMonthKey(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

function getMonthLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", year: "numeric" }).format(
    date
  );
}

function getDateOnly(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function assertRelatedExists(store, entity, id, fieldName) {
  if (!id) {
    const err = new Error(`${fieldName || entity} is required`);
    err.status = 400;
    throw err;
  }
  const [record] = await store.filter(entity, { id: String(id) }, undefined, 1);
  if (!record) {
    const err = new Error(`${entity} not found`);
    err.status = 404;
    throw err;
  }
  return record;
}

async function resolveMemberIdForUpdate(store, memberId) {
  const [memberById] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (memberById) {
    return { resolvedId: memberById.id, matchedField: "id" };
  }

  const [memberByMemberId] = await store.filter(
    "Member",
    { member_id: String(memberId) },
    undefined,
    1
  );
  if (memberByMemberId) {
    return { resolvedId: memberByMemberId.id, matchedField: "member_id" };
  }

  const err = new Error("Member not found in this backend");
  err.status = 404;
  throw err;
}

async function applyMemberBalanceDelta(store, memberId, delta) {
  if (!delta) return;
  const [member] = await store.filter("Member", { id: String(memberId) }, undefined, 1);
  if (!member) {
    const err = new Error("Member not found");
    err.status = 404;
    throw err;
  }
  const current = Number(member.total_owed || 0);
  await store.update("Member", member.id, { total_owed: current + delta });
}

async function applyGuestBalanceDelta(store, guestId, delta) {
  if (!delta) return;
  const [guest] = await store.filter("Guest", { id: String(guestId) }, undefined, 1);
  if (!guest) {
    const err = new Error("Guest not found");
    err.status = 404;
    throw err;
  }
  const current = Number(guest.total_owed || 0);
  await store.update("Guest", guest.id, { total_owed: current + delta });
}

async function createInitialStandardCharge(store, member) {
  const plans = await store.list("MembershipPlan", "-created_date", 1);
  const standardAmount = Number(plans[0]?.standard_amount);
  if (!Number.isFinite(standardAmount) || standardAmount <= 0) return;

  const timeZone = process.env.BILLING_TIME_ZONE || "UTC";
  const now = new Date();
  const monthKey = getMonthKey(now, timeZone);
  const label = getMonthLabel(now, timeZone);
  const date = getDateOnly(now, timeZone);
  const existing = await store.filter(
    "Transaction",
    { member_id: member.id, type: "charge", monthly_key: monthKey },
    undefined,
    1
  );
  if (existing[0]) return;

  const created = await store.create("Transaction", {
    id: `member-signup-standard:${member.id}:${monthKey}`,
    member_id: member.id,
    member_name: member.full_name || member.english_name || member.hebrew_name || undefined,
    type: "charge",
    description: `Standard Monthly - ${label}`,
    amount: standardAmount,
    date,
    provider: "system",
    monthly_key: monthKey,
  });
  const delta = getBalanceDeltaFromTransaction(created, "create");
  await applyMemberBalanceDelta(store, created.member_id, delta);
}

/** @param {{ store: { list: Function, filter: Function, create: Function, bulkCreate: Function, update: Function, remove: Function } }} deps */
function createEntitiesRouter({ store }) {
  const router = express.Router();

  // List: GET /api/entities/:entity?sort=-field&limit=100
  router.get("/:entity", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      assertEntityName(entity);

      const sort = req.query.sort ? String(req.query.sort) : undefined;
      const rawLimit = req.query.limit ? Number(req.query.limit) : undefined;
      const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 1000) : undefined;
      const rawPage = req.query.page ? Number(req.query.page) : undefined;
      const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : undefined;
      const skip = page && limit ? (page - 1) * limit : undefined;

      const out = await store.list(entity, sort, limit, skip);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  // Filter: POST /api/entities/:entity/filter { where, sort, limit }
  // Accepts body directly as "where" too, for convenience.
  router.post("/:entity/filter", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      assertEntityName(entity);

      const body = req.body ?? {};
      const where = body.where && typeof body.where === "object" ? body.where : body;
      for (const key of Object.keys(where)) {
        if (key.startsWith("$")) {
          return res.status(400).json({ message: "Invalid filter key" });
        }
      }
      const sort = body.sort;
      const rawLimit = body.limit;
      const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 1000) : undefined;
      const rawPage = body.page;
      const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : undefined;
      const skip = page && limit ? (page - 1) * limit : undefined;

      const out = await store.filter(entity, where, sort, limit, skip);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  // Create: POST /api/entities/:entity
  router.post("/:entity", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      assertEntityName(entity);

      const payload = sanitizeEntityData(entity, req.body ?? {});
      if (entity === "Transaction") {
        const resolved = await resolveMemberIdForUpdate(store, payload.member_id);
        payload.member_id = resolved.resolvedId;
        const created = await store.create(entity, payload);
        const delta = getBalanceDeltaFromTransaction(created, "create");
        await applyMemberBalanceDelta(store, created.member_id, delta);
        return res.status(201).json(created);
      }
      if (entity === "GuestTransaction") {
        await assertRelatedExists(store, "Guest", payload.guest_id, "guest_id");
        const created = await store.create(entity, payload);
        const delta = getBalanceDeltaFromTransaction(created, "create");
        await applyGuestBalanceDelta(store, created.guest_id, delta);
        return res.status(201).json(created);
      }
      const created = await store.create(entity, payload);
      if (entity === "Member") {
        await createInitialStandardCharge(store, created);
      }
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  // Bulk create: POST /api/entities/:entity/bulk
  router.post("/:entity/bulk", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      assertEntityName(entity);

      const items = Array.isArray(req.body) ? req.body : req.body?.items;
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "Expected an array or { items: [] }" });
      }

      const sanitizedItems = items.map((item) => sanitizeEntityData(entity, item ?? {}));

      // Ensure Members always have a canonical id when created.
      if (entity === "Member") {
        for (const item of sanitizedItems) {
          if (!item.id && item.member_id) {
            item.id = String(item.member_id);
          }
        }
      }
      if (entity === "Transaction") {
        for (const item of sanitizedItems) {
          const resolved = await resolveMemberIdForUpdate(store, item.member_id);
          item.member_id = resolved.resolvedId;
        }
        const createdItems = await store.bulkCreate(entity, sanitizedItems);
        const deltasByMember = new Map();
        for (const created of createdItems) {
          const delta = getBalanceDeltaFromTransaction(created, "create");
          if (!delta) continue;
          const key = String(created.member_id);
          deltasByMember.set(key, (deltasByMember.get(key) || 0) + delta);
        }
        for (const [memberId, delta] of deltasByMember.entries()) {
          await applyMemberBalanceDelta(store, memberId, delta);
        }
        return res.status(201).json(createdItems);
      }
      if (entity === "GuestTransaction") {
        for (const item of sanitizedItems) {
          await assertRelatedExists(store, "Guest", item.guest_id, "guest_id");
        }
        const createdItems = await store.bulkCreate(entity, sanitizedItems);
        const deltasByGuest = new Map();
        for (const created of createdItems) {
          const delta = getBalanceDeltaFromTransaction(created, "create");
          if (!delta) continue;
          const key = String(created.guest_id);
          deltasByGuest.set(key, (deltasByGuest.get(key) || 0) + delta);
        }
        for (const [guestId, delta] of deltasByGuest.entries()) {
          await applyGuestBalanceDelta(store, guestId, delta);
        }
        return res.status(201).json(createdItems);
      }
      const createdItems = await store.bulkCreate(entity, sanitizedItems);
      if (entity === "Member") {
        for (const member of createdItems) {
          await createInitialStandardCharge(store, member);
        }
      }
      res.status(201).json(createdItems);
    } catch (err) {
      next(err);
    }
  });

  // Update: PATCH /api/entities/:entity/:id
  router.patch("/:entity/:id", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      const id = String(req.params.id);
      assertEntityName(entity);

      const patch = sanitizeEntityData(entity, req.body ?? {});

      if (entity === "Member") {
        const resolved = await resolveMemberIdForUpdate(store, id);
        const updated = await store.update(entity, resolved.resolvedId, patch);
        if (resolved.matchedField === "member_id") {
          res.set("x-member-id-resolved", resolved.resolvedId);
        }
        return res.json(updated);
      }

      const updated = await store.update(entity, id, patch);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Delete: DELETE /api/entities/:entity/:id
  router.delete("/:entity/:id", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      const id = String(req.params.id);
      assertEntityName(entity);

      const [existing] = await store.filter(entity, { id }, undefined, 1);
      if (!existing) return res.status(404).json({ message: `${entity} not found` });
      const deleted = await store.remove(entity, id);
      if (!deleted) return res.status(404).json({ message: `${entity} not found` });
      if (entity === "Transaction") {
        const delta = getBalanceDeltaFromTransaction(existing, "delete");
        await applyMemberBalanceDelta(store, existing.member_id, delta);
      }
      if (entity === "GuestTransaction") {
        const delta = getBalanceDeltaFromTransaction(existing, "delete");
        await applyGuestBalanceDelta(store, existing.guest_id, delta);
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Resolve a member by id, member_id, or email and return the canonical id
function createMemberResolveRouter({ store }) {
  const router = express.Router();

  router.get("/members/resolve", async (req, res, next) => {
    try {
      const key = String(req.query.key ?? "").trim();
      if (!key) return res.status(400).json({ message: "key is required" });

      const [byId] = await store.filter("Member", { id: key }, undefined, 1);
      if (byId) return res.json({ id: byId.id, member: byId });

      const [byMemberId] = await store.filter("Member", { member_id: key }, undefined, 1);
      if (byMemberId) return res.json({ id: byMemberId.id, member: byMemberId });

      if (key.includes("@")) {
        const lower = key.toLowerCase();
        const [byEmail] = await store.filter("Member", { email: lower }, undefined, 1);
        if (byEmail) return res.json({ id: byEmail.id, member: byEmail });
      }

      return res.status(404).json({ message: "Member not found" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
module.exports = {
  createEntitiesRouter,
  createMemberResolveRouter,
};

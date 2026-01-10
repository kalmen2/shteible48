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

      const out = await store.list(entity, sort, limit);
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

      const out = await store.filter(entity, where, sort, limit);
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
        await assertRelatedExists(store, "Member", payload.member_id, "member_id");
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
      if (entity === "Transaction") {
        for (const item of sanitizedItems) {
          await assertRelatedExists(store, "Member", item.member_id, "member_id");
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
module.exports = {
  createEntitiesRouter,
};

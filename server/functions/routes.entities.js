const express = require("express");
const { assertEntityName } = require("./entityStore.js");

/** @param {{ store: { list: Function, filter: Function, create: Function, bulkCreate: Function, update: Function, remove: Function } }} deps */
function createEntitiesRouter({ store }) {
  const router = express.Router();

  // List: GET /api/entities/:entity?sort=-field&limit=100
  router.get("/:entity", async (req, res, next) => {
    try {
      const entity = req.params.entity;
      assertEntityName(entity);

      const sort = req.query.sort ? String(req.query.sort) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

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
      const sort = body.sort;
      const limit = body.limit;

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

      const created = await store.create(entity, req.body ?? {});
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

      const createdItems = await store.bulkCreate(entity, items);
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

      const updated = await store.update(entity, id, req.body ?? {});
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

      const deleted = await store.remove(entity, id);
      if (!deleted) return res.status(404).json({ message: `${entity} not found` });
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

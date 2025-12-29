
const { assertEntityName, createRecord, updateRecord } = require("./entityStore.js");

function normalizeSort(sort) {
  if (!sort || typeof sort !== "string") return null;
  const dir = sort.startsWith("-") ? -1 : 1;
  const field = sort.startsWith("-") ? sort.slice(1) : sort;
  if (!field) return null;
  return { [field]: dir };
}

function normalizeLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeWhere(where) {
  if (!where || typeof where !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(where)) {
    out[k] = v;
  }
  return out;
}

function toPublic(doc) {
  if (!doc) return doc;
  // strip Mongo internal _id by default
  // eslint-disable-next-line no-unused-vars
  const { _id, ...rest } = doc;
  return rest;
}

/** @param {{ db: import('mongodb').Db }} deps */
function createMongoEntityStore({ db }) {
  function collectionFor(entity) {
    assertEntityName(entity);
    return db.collection(entity);
  }

  return {
    async list(entity, sort, limit) {
      const col = collectionFor(entity);
      const cursor = col.find({});
      const sortSpec = normalizeSort(sort);
      if (sortSpec) cursor.sort(sortSpec);
      const lim = normalizeLimit(limit);
      if (lim) cursor.limit(lim);
      const docs = await cursor.toArray();
      return docs.map(toPublic);
    },

    async filter(entity, where, sort, limit) {
      const col = collectionFor(entity);
      const query = normalizeWhere(where);
      const cursor = col.find(query);
      const sortSpec = normalizeSort(sort);
      if (sortSpec) cursor.sort(sortSpec);
      const lim = normalizeLimit(limit);
      if (lim) cursor.limit(lim);
      const docs = await cursor.toArray();
      return docs.map(toPublic);
    },


    async create(entity, data) {
      const col = collectionFor(entity);
      let created;
      if (data?.id) {
        created = await createRecord({ ...(data ?? {}), id: String(data.id) });
      } else {
        const { nanoid } = await import('nanoid');
        created = await createRecord({ ...(data ?? {}), id: nanoid() });
      }
      await col.insertOne(created);
      return created;
    },


    async bulkCreate(entity, items) {
      const col = collectionFor(entity);
      const createdItems = [];
      const { nanoid } = await import('nanoid');
      for (const x of items ?? []) {
        const id = x?.id ? String(x.id) : nanoid();
        createdItems.push(await createRecord({ ...(x ?? {}), id }));
      }
      if (createdItems.length === 0) return [];
      await col.insertMany(createdItems);
      return createdItems;
    },

    async update(entity, id, patch) {
      const col = collectionFor(entity);
      const existing = await col.findOne({ id: String(id) });
      if (!existing) {
        const err = new Error(`${entity} not found`);
        // @ts-ignore
        err.status = 404;
        throw err;
      }
      const updated = updateRecord(toPublic(existing), patch ?? {});
      await col.updateOne({ id: String(id) }, { $set: updated });
      return updated;
    },

    async remove(entity, id) {
      const col = collectionFor(entity);
      const result = await col.deleteOne({ id: String(id) });
      return result.deletedCount > 0;

    },

    // Used nowhere currently, but handy for debugging
    async _dangerous_clear(entity) {
      const col = collectionFor(entity);
      await col.deleteMany({});
    },
  };
}

module.exports = {
  createMongoEntityStore,
};

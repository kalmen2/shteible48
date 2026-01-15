
const { assertEntityName, createRecord } = require("./entityStore.js");

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
  const indexPromises = new Map();

  function ensureIndexes(entity) {
    if (indexPromises.has(entity)) return indexPromises.get(entity);
    const col = db.collection(entity);
    const specs = [
      { keys: { id: 1 }, options: { unique: true } },
    ];

    if (entity === "Transaction") {
      specs.push({ keys: { member_id: 1, date: -1 } });
    }
    if (entity === "GuestTransaction") {
      specs.push({ keys: { guest_id: 1, date: -1 } });
    }
    if (entity === "MembershipCharge") {
      specs.push({ keys: { member_id: 1, is_active: 1 } });
    }
    if (entity === "RecurringPayment") {
      specs.push({ keys: { member_id: 1, is_active: 1 } });
      specs.push({ keys: { guest_id: 1, is_active: 1 } });
      specs.push({ keys: { stripe_subscription_id: 1 } });
    }

    const promise = Promise.all(
      specs.map(({ keys, options }) => col.createIndex(keys, options).catch((err) => {
        console.error(`Failed to create index for ${entity}`, err?.message || err);
      }))
    );
    indexPromises.set(entity, promise);
    return promise;
  }

  function collectionFor(entity) {
    assertEntityName(entity);
    const col = db.collection(entity);
    ensureIndexes(entity);
    return col;
  }

  return {
    async list(entity, sort, limit, skip) {
      const col = collectionFor(entity);
      const cursor = col.find({});
      const sortSpec = normalizeSort(sort);
      if (sortSpec) cursor.sort(sortSpec);
      const lim = normalizeLimit(limit);
      if (lim) cursor.limit(lim);
      if (Number.isFinite(skip) && skip > 0) cursor.skip(skip);
      const docs = await cursor.toArray();
      return docs.map(toPublic);
    },

    async filter(entity, where, sort, limit, skip) {
      const col = collectionFor(entity);
      const query = normalizeWhere(where);
      const cursor = col.find(query);
      const sortSpec = normalizeSort(sort);
      if (sortSpec) cursor.sort(sortSpec);
      const lim = normalizeLimit(limit);
      if (lim) cursor.limit(lim);
      if (Number.isFinite(skip) && skip > 0) cursor.skip(skip);
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
      const patchData = { ...(patch ?? {}) };
      delete patchData.id;
      delete patchData.created_date;
      delete patchData.updated_date;
      const updatedDate = new Date().toISOString();
      const result = await col.findOneAndUpdate(
        { id: String(id) },
        { $set: { ...patchData, updated_date: updatedDate } },
        { returnDocument: "after" }
      );
      if (!result.value) {
        const err = new Error(`${entity} not found`);
        // @ts-ignore
        err.status = 404;
        throw err;
      }
      return toPublic(result.value);
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

    async ensureWebhookEventIndex() {
      await ensureIndexes("WebhookEvent");
    },
  };
}

module.exports = {
  createMongoEntityStore,
};

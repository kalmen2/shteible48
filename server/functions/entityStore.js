

/** @typedef {{ [k: string]: any, id?: string }} AnyRecord */

const ENTITY_NAMES = [
  "Member",
  "Transaction",
  "InputType",
  "MembershipPlan",
  "MembershipCharge",
  "Invoice",
  "RecurringPayment",
  "Guest",
  "GuestTransaction",
  "StatementTemplate",
  "EmailSchedule",
  "WebhookEvent",
];

function assertEntityName(entity) {
  if (!ENTITY_NAMES.includes(entity)) {
    const err = new Error(`Unknown entity: ${entity}`);
    // @ts-ignore
    err.status = 404;
    throw err;
  }
}

function normalizeSort(sort) {
  if (!sort || typeof sort !== "string") return { field: null, dir: "asc" };
  const dir = sort.startsWith("-") ? "desc" : "asc";
  const field = sort.startsWith("-") ? sort.slice(1) : sort;
  return { field, dir };
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function applySortLimit(items, sort, limit) {
  const { field, dir } = normalizeSort(sort);
  let out = [...items];

  if (field) {
    out.sort((x, y) => {
      const cmp = compareValues(x?.[field], y?.[field]);
      return dir === "desc" ? -cmp : cmp;
    });
  }

  if (typeof limit === "number" && Number.isFinite(limit)) {
    out = out.slice(0, Math.max(0, limit));
  }

  return out;
}

function matchWhere(record, where) {
  if (!where || typeof where !== "object") return true;
  for (const [key, value] of Object.entries(where)) {
    if (record?.[key] !== value) return false;
  }
  return true;
}

async function createRecord(data) {
  const now = new Date().toISOString();
  let id;
  if (data?.id) {
    id = String(data.id);
  } else {
    const { nanoid } = await import('nanoid');
    id = nanoid();
  }
  return {
    ...data,
    id,
    created_date: now,
    updated_date: now,
  };
}

function updateRecord(existing, patch) {
  const now = new Date().toISOString();
  return {
    ...existing,
    ...patch,
    id: existing.id,
    created_date: existing.created_date,
    updated_date: now,
  };
}
module.exports = {
  ENTITY_NAMES,
  assertEntityName,
  applySortLimit,
  matchWhere,
  createRecord,
  updateRecord,
};

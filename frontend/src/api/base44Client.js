const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

import { getToken, setToken, clearToken } from "@/lib/auth";

const clientOrigin = typeof window !== "undefined" ? window.location.origin : undefined;

async function requestJson(path, { method = "GET", body, headers, rawBody } = {}) {
  const token = getToken();
  // If sending FormData (rawBody), do NOT set Content-Type header; browser will set it automatically
  const computedHeaders = {
    ...(rawBody ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers || {})
  };
  // Remove Content-Type if rawBody is FormData and user accidentally set it
  if (rawBody && computedHeaders["Content-Type"]) {
    delete computedHeaders["Content-Type"];
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: computedHeaders,
    body: rawBody ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined;

  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
    }
    const message = payload?.message || `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return payload;
}

function entityClient(entityName) {
  const list = (sort, limit, page) => {
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    if (limit !== undefined) params.set("limit", String(limit));
    if (page !== undefined) params.set("page", String(page));
    const qs = params.toString();
    return requestJson(`/entities/${entityName}${qs ? `?${qs}` : ""}`);
  };

  const filter = (where, sort, limit, page) => {
    const body = { where };
    if (sort !== undefined) body.sort = sort;
    if (limit !== undefined) body.limit = limit;
    if (page !== undefined) body.page = page;
    return requestJson(`/entities/${entityName}/filter`, { method: "POST", body });
  };

  const listAll = async (sort, pageSize = 1000) => {
    const safePageSize = Number.isFinite(pageSize) ? Math.min(pageSize, 1000) : 1000;
    const out = [];
    let page = 1;
    while (true) {
      const chunk = await list(sort, safePageSize, page);
      out.push(...chunk);
      if (!Array.isArray(chunk) || chunk.length < safePageSize) break;
      page += 1;
    }
    return out;
  };

  const filterAll = async (where, sort, pageSize = 1000) => {
    const safePageSize = Number.isFinite(pageSize) ? Math.min(pageSize, 1000) : 1000;
    const out = [];
    let page = 1;
    while (true) {
      const chunk = await filter(where, sort, safePageSize, page);
      out.push(...chunk);
      if (!Array.isArray(chunk) || chunk.length < safePageSize) break;
      page += 1;
    }
    return out;
  };

  return {
    list,
    listAll,
    filter,
    filterAll,
    create: (data) => requestJson(`/entities/${entityName}`, { method: "POST", body: data }),
    bulkCreate: (items) => requestJson(`/entities/${entityName}/bulk`, { method: "POST", body: items }),
    update: (id, data) => requestJson(`/entities/${entityName}/${id}`, { method: "PATCH", body: data }),
    delete: (id) => requestJson(`/entities/${entityName}/${id}`, { method: "DELETE" }),
  };
}

export const base44 = {
  entities: {
    Member: entityClient("Member"),
    Transaction: entityClient("Transaction"),
    InputType: entityClient("InputType"),
    MembershipPlan: entityClient("MembershipPlan"),
    MembershipCharge: entityClient("MembershipCharge"),
    Invoice: entityClient("Invoice"),
    RecurringPayment: entityClient("RecurringPayment"),
    Guest: entityClient("Guest"),
    GuestTransaction: entityClient("GuestTransaction"),
    StatementTemplate: entityClient("StatementTemplate"),
    EmailSchedule: entityClient("EmailSchedule"),
  },
  members: {
    resolve: async (key) => {
      const params = new URLSearchParams();
      if (key !== undefined && key !== null) params.set("key", String(key));
      return requestJson(`/members/resolve?${params.toString()}`);
    },
  },
  integrations: {
    Core: {
      SendEmail: (payload) => requestJson(`/integrations/Core/SendEmail`, { method: "POST", body: payload }),
      UploadFile: async ({ file }) => {
        const fd = new FormData();
        fd.append("file", file);
        return requestJson(`/integrations/Core/UploadFile`, { method: "POST", rawBody: fd });
      },
      ExtractDataFromUploadedFile: (payload) =>
        requestJson(`/integrations/Core/ExtractDataFromUploadedFile`, { method: "POST", body: payload }),
      InvokeLLM: (payload) => requestJson(`/integrations/Core/InvokeLLM`, { method: "POST", body: payload }),
      GenerateImage: (payload) => requestJson(`/integrations/Core/GenerateImage`, { method: "POST", body: payload }),
      CreateFileSignedUrl: (payload) => requestJson(`/integrations/Core/CreateFileSignedUrl`, { method: "POST", body: payload }),
      UploadPrivateFile: (payload) => requestJson(`/integrations/Core/UploadPrivateFile`, { method: "POST", body: payload }),
    },
  },
  auth: {
    login: async ({ email, password }) => {
      const out = await requestJson(`/auth/login`, { method: "POST", body: { email, password } });
      if (out?.token) setToken(out.token);
      return out;
    },
    loginWithGoogle: async ({ idToken }) => {
      const out = await requestJson(`/auth/google`, { method: "POST", body: { idToken } });
      if (out?.token) setToken(out.token);
      return out;
    },
    signup: async ({ name, email, password }) => {
      const out = await requestJson(`/auth/signup`, { method: "POST", body: { name, email, password } });
      if (out?.token) setToken(out.token);
      return out;
    },
    logout: async () => {
      clearToken();
    },
    getUser: async () => requestJson(`/auth/me`),
  },
  payments: {
    createCheckout: async ({ memberId, amount, description, successPath, cancelPath }) =>
      requestJson(`/payments/checkout`, {
        method: "POST",
        body: { memberId, amount, description, successPath, cancelPath, origin: clientOrigin },
      }),
    createSubscriptionCheckout: async ({ memberId, paymentType, amountPerMonth, payoffTotal, successPath, cancelPath }) =>
      requestJson(`/payments/subscription-checkout`, {
        method: "POST",
        body: { memberId, paymentType, amountPerMonth, payoffTotal, successPath, cancelPath, origin: clientOrigin },
      }),
    createGuestCheckout: async ({ guestId, amount, description, successPath, cancelPath }) =>
      requestJson(`/payments/guest/checkout`, {
        method: "POST",
        body: { guestId, amount, description, successPath, cancelPath, origin: clientOrigin },
      }),
    createGuestSubscriptionCheckout: async ({ guestId, paymentType, amountPerMonth, payoffTotal, successPath, cancelPath }) =>
      requestJson(`/payments/guest/subscription-checkout`, {
        method: "POST",
        body: { guestId, paymentType, amountPerMonth, payoffTotal, successPath, cancelPath, origin: clientOrigin },
      }),
    createSaveCardCheckout: async ({ memberId, successPath, cancelPath }) =>
      requestJson(`/payments/save-card-checkout`, {
        method: "POST",
        body: { memberId, successPath, cancelPath, origin: clientOrigin },
      }),
    activateMembershipBulk: async ({ memberIds, amountPerMonth }) =>
      requestJson(`/payments/activate-memberships-bulk`, {
        method: "POST",
        body: { memberIds, amountPerMonth },
      }),
    cancelSubscription: async ({ recurringPaymentId, subscriptionId }) =>
      requestJson(`/payments/cancel-subscription`, {
        method: "POST",
        body: { recurringPaymentId, subscriptionId },
      }),
    getConfig: async () => requestJson(`/payments/config`),
  },
};

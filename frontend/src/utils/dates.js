import { format } from "date-fns";

// Shared date helpers to avoid timezone drift with date-only strings
// Parse YYYY-MM-DD as local date (midnight local)
export function toLocalDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split("-").map(Number);
  if (parts.length < 3) return null;
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

// Parse YYYY-MM as local month start
export function toLocalMonthDate(monthStr) {
  if (!monthStr) return null;
  const parts = String(monthStr).split("-").map(Number);
  if (parts.length < 2) return null;
  const [y, m] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return new Date(y, m - 1, 1);
}

// Format date-only string safely
export function formatDateLocal(dateStr, fmt = "MMM d, yyyy", fallback = "N/A") {
  const date = toLocalDate(dateStr);
  if (!date) return fallback;
  return format(date, fmt);
}

// Today's date in YYYY-MM-DD
export function todayISO() {
  return new Date().toISOString().split("T")[0];
}

import { HDate, getSedra, HebrewCalendar, flags } from "@hebcal/core";
import { isLeapYear as hebcalIsLeapYear } from "@hebcal/hdate";

function formatHebrewNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    const formatted = new Intl.NumberFormat("he-u-nu-hebr").format(n);
    if (formatted && formatted !== String(n)) return formatted;
  } catch {}

  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל"];
  if (n <= 9) return ones[n];
  if (n === 10) return "י";
  if (n === 15) return "טו";
  if (n === 16) return "טז";
  if (n < 20) return `י${ones[n - 10]}`;
  if (n <= 30) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return `${tens[t]}${ones[o]}`;
  }
  return String(n);
}

function getHebrewMonthName(year, month, locale = "he") {
  const h = new HDate(1, month, year);
  if (typeof h.getMonthName === "function") {
    return h.getMonthName(locale) || h.getMonthName();
  }
  return h.getMonthName?.() || String(month);
}

export function getHebrewDate(date) {
  const h = new HDate(date);
  return {
    day: h.getDate(),
    dayHebrew: formatHebrewNumber(h.getDate()),
    month: getHebrewMonthName(h.getFullYear(), h.getMonth()),
    monthNum: h.getMonth(), // 1-based month number from Hebcal
    year: h.getFullYear(),
  };
}

export function hebrewDateToGregorian(year, month, day) {
  return new HDate(day, month, year).greg();
}

export function getParsha(date) {
  const shabbat = new Date(date);
  const daysUntilShabbat = (6 - shabbat.getDay() + 7) % 7;
  shabbat.setDate(shabbat.getDate() + daysUntilShabbat);
  const hd = new HDate(shabbat);
  const sedra = getSedra(hd.getFullYear(), false).lookup(hd);
  const names = sedra?.parsha;
  if (!names || names.length === 0) return null;
  return names.join(" - ");
}

export function isShabbat(date) {
  return date.getDay() === 6;
}

export function isErevShabbat(date) {
  return date.getDay() === 5;
}

export function getHebrewMonthsList(hebrewYear) {
  const monthsInYear = hebcalIsLeapYear(hebrewYear) ? 13 : 12;
  const months = [];
  for (let month = 1; month <= monthsInYear; month += 1) {
    months.push(getHebrewMonthName(hebrewYear, month));
  }
  return months;
}

export function isHebrewLeap(year) {
  return hebcalIsLeapYear(year);
}

const HOLIDAY_MASK =
  flags.CHAG |
  flags.MINOR_HOLIDAY |
  flags.MINOR_FAST |
  flags.MAJOR_FAST |
  flags.MODERN_HOLIDAY |
  flags.ROSH_CHODESH |
  flags.CHOL_HAMOED;

export function getHolidaysByDate(startDate, endDate, { israel = false } = {}) {
  const events = HebrewCalendar.calendar({
    start: startDate,
    end: endDate,
    il: israel,
    sedrot: false,
    omer: false,
    candlelighting: false,
  });

  const map = {};
  for (const ev of events) {
    const mask = ev.getFlags?.() ?? ev.mask ?? 0;
    if ((mask & HOLIDAY_MASK) === 0) continue;
    const g = ev.getDate?.().greg?.();
    if (!g) continue;
    const key = g.toISOString().slice(0, 10);
    if (!map[key]) map[key] = [];
    map[key].push(ev.render ? ev.render("en") : ev.getDesc());
  }
  return map;
}

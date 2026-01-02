import { HDate, getSedra, HebrewCalendar, flags } from "@hebcal/core";
import { isLeapYear as hebcalIsLeapYear } from "@hebcal/hdate";

const MONTH_NAMES = [
  "Nisan",
  "Iyyar",
  "Sivan",
  "Tamuz",
  "Av",
  "Elul",
  "Tishrei",
  "Cheshvan",
  "Kislev",
  "Tevet",
  "Sh'vat",
  "Adar",
];

const MONTH_NAMES_LEAP = [
  "Nisan",
  "Iyyar",
  "Sivan",
  "Tamuz",
  "Av",
  "Elul",
  "Tishrei",
  "Cheshvan",
  "Kislev",
  "Tevet",
  "Sh'vat",
  "Adar I",
  "Adar II",
];

export function getHebrewDate(date) {
  const h = new HDate(date);
  return {
    day: h.getDate(),
    month: h.getMonthName(),
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

export function getHebrewMonthsList(isLeap) {
  return isLeap ? MONTH_NAMES_LEAP : MONTH_NAMES;
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
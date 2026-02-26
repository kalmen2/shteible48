import { gematriya, HDate, HebrewCalendar, Locale, flags } from '@hebcal/core';

const HEBREW_LOCALE = 'he-x-NoNikud';
const PARSHA_MASK = flags.PARSHA_HASHAVUA;
const HOLIDAY_MASK =
  flags.CHAG |
  flags.MINOR_HOLIDAY |
  flags.MINOR_FAST |
  flags.MAJOR_FAST |
  flags.MODERN_HOLIDAY |
  flags.ROSH_CHODESH |
  flags.CHOL_HAMOED;

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function atStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateRange(startDate, endDate) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) return null;
  const start = atStartOfDay(startDate);
  const end = atStartOfDay(endDate);
  if (start.getTime() <= end.getTime()) return { start, end };
  return { start: end, end: start };
}

function getHebrewMonthName(hebrewYear, hebrewMonth, locale = HEBREW_LOCALE) {
  const monthName = HDate.getMonthName(hebrewMonth, hebrewYear);
  return Locale.gettext(monthName, locale);
}

function getUpcomingShabbat(date) {
  return new HDate(date).onOrAfter(6).greg();
}

function getEventRender(ev, locale) {
  return ev.render ? ev.render(locale) : ev.getDesc();
}

export function getHebrewDate(date) {
  const hd = new HDate(date);
  const day = hd.getDate();
  const year = hd.getFullYear();
  const monthNum = hd.getMonth();

  return {
    day,
    dayHebrew: gematriya(day),
    month: getHebrewMonthName(year, monthNum, HEBREW_LOCALE),
    monthNum, // 1-based month number from Hebcal (Nisan=1)
    year,
    yearHebrew: gematriya(year),
  };
}

export function hebrewDateToGregorian(year, month, day) {
  return new HDate(day, month, year).greg();
}

export function getParshaMapByDate(
  startDate,
  endDate,
  { israel = false, locale = HEBREW_LOCALE } = {}
) {
  const range = normalizeDateRange(startDate, endDate);
  if (!range) return {};

  const events = HebrewCalendar.calendar({
    start: range.start,
    end: addDays(range.end, 1),
    il: israel,
    sedrot: true,
    noHolidays: true,
    candlelighting: false,
    mask: PARSHA_MASK,
  });

  const map = {};
  for (const ev of events) {
    const g = ev.getDate?.().greg?.();
    if (!g) continue;
    map[toDateKey(g)] = getEventRender(ev, locale);
  }
  return map;
}

export function getParsha(date, { israel = false, locale = HEBREW_LOCALE } = {}) {
  if (!isValidDate(date)) return null;

  const shabbat = getUpcomingShabbat(date);
  const events = HebrewCalendar.calendar({
    start: shabbat,
    end: addDays(shabbat, 1),
    il: israel,
    sedrot: true,
    noHolidays: true,
    candlelighting: false,
    mask: PARSHA_MASK,
  });

  const parsha = events.find((ev) => ((ev.getFlags?.() ?? ev.mask ?? 0) & PARSHA_MASK) !== 0);
  if (!parsha) return null;
  return getEventRender(parsha, locale);
}

export function isShabbat(date) {
  return date.getDay() === 6;
}

export function isErevShabbat(date) {
  return date.getDay() === 5;
}

export function getHebrewMonthsList(hebrewYear, { locale = HEBREW_LOCALE } = {}) {
  const monthsInYear = HDate.isLeapYear(hebrewYear) ? 13 : 12;
  return Array.from({ length: monthsInYear }, (_, index) =>
    getHebrewMonthName(hebrewYear, index + 1, locale)
  );
}

export function isHebrewLeap(year) {
  return HDate.isLeapYear(year);
}

export function getHolidaysByDate(
  startDate,
  endDate,
  { israel = false, locale = HEBREW_LOCALE } = {}
) {
  const range = normalizeDateRange(startDate, endDate);
  if (!range) return {};

  const events = HebrewCalendar.calendar({
    start: range.start,
    end: addDays(range.end, 1),
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
    const key = toDateKey(g);
    if (!map[key]) map[key] = [];
    map[key].push(getEventRender(ev, locale));
  }
  return map;
}

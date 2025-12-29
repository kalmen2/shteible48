// Hebrew Calendar - Using KosherJava algorithm

const HEBREW_MONTHS = [
  "Nisan", "Iyar", "Sivan", "Tammuz", "Av", "Elul",
  "Tishrei", "Cheshvan", "Kislev", "Tevet", "Shevat", "Adar"
];

const HEBREW_MONTHS_LEAP = [
  "Nisan", "Iyar", "Sivan", "Tammuz", "Av", "Elul",
  "Tishrei", "Cheshvan", "Kislev", "Tevet", "Shevat", "Adar I", "Adar II"
];

const PARSHIYOT = [
  "Bereishit", "Noach", "Lech-Lecha", "Vayera", "Chayei Sara", "Toldot", 
  "Vayetzei", "Vayishlach", "Vayeshev", "Miketz", "Vayigash", "Vayechi",
  "Shemot", "Vaera", "Bo", "Beshalach", "Yitro", "Mishpatim", "Terumah",
  "Tetzaveh", "Ki Tisa", "Vayakhel", "Pekudei", "Vayikra", "Tzav", "Shmini",
  "Tazria", "Metzora", "Achrei Mot", "Kedoshim", "Emor", "Behar", "Bechukotai",
  "Bamidbar", "Nasso", "Beha'alotcha", "Sh'lach", "Korach", "Chukat", "Balak",
  "Pinchas", "Matot", "Masei", "Devarim", "Vaetchanan", "Eikev", "Re'eh",
  "Shoftim", "Ki Teitzei", "Ki Tavo", "Nitzavim", "Vayeilech", "Ha'Azinu", "V'Zot HaBerachah"
];

function gregToJulian(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function julianToGreg(jd) {
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return new Date(year, month - 1, day);
}

function isHebrewLeapYear(year) {
  return (((year * 7) + 1) % 19) < 7;
}

function hebrewMonthsInYear(year) {
  return isHebrewLeapYear(year) ? 13 : 12;
}

function hebrewDaysInMonth(month, year) {
  if (month === 2 || month === 4 || month === 6 || month === 10 || month === 13) {
    return 29;
  }
  if (month === 8) { // Cheshvan
    return isLongCheshvan(year) ? 30 : 29;
  }
  if (month === 9) { // Kislev
    return isShortKislev(year) ? 29 : 30;
  }
  if (month === 12) {
    return isHebrewLeapYear(year) ? 30 : 29;
  }
  return 30;
}

function hebrewDaysInYear(year) {
  return hebrewToAbsolute(year + 1, 7, 1) - hebrewToAbsolute(year, 7, 1);
}

function isLongCheshvan(year) {
  return hebrewDaysInYear(year) % 10 === 5;
}

function isShortKislev(year) {
  return hebrewDaysInYear(year) % 10 === 3;
}

function hebrewToAbsolute(year, month, day) {
  let tempDate = day;
  
  if (month < 7) {
    for (let m = 7; m <= hebrewMonthsInYear(year); m++) {
      tempDate += hebrewDaysInMonth(m, year);
    }
    for (let m = 1; m < month; m++) {
      tempDate += hebrewDaysInMonth(m, year);
    }
  } else {
    for (let m = 7; m < month; m++) {
      tempDate += hebrewDaysInMonth(m, year);
    }
  }
  
  return tempDate + hebrewElapsedDays(year) + -1373429;
}

function hebrewElapsedDays(year) {
  const monthsElapsed = Math.floor(((235 * year) - 234) / 19);
  const partsElapsed = 12084 + (13753 * monthsElapsed);
  const days = Math.floor(monthsElapsed * 29) + Math.floor(partsElapsed / 25920);
  
  return days;
}

export function getHebrewDate(date) {
  const d = new Date(date);
  const jd = gregToJulian(d.getFullYear(), d.getMonth() + 1, d.getDate());
  
  let year = Math.floor(((jd - (-1373429)) * 98496.0) / 35975351.0);
  
  while (hebrewToAbsolute(year + 1, 7, 1) <= jd) {
    year++;
  }
  
  let month = 7;
  while (hebrewToAbsolute(year, month, hebrewDaysInMonth(month, year)) < jd) {
    month++;
    if (month > hebrewMonthsInYear(year)) {
      month = 1;
    }
  }
  
  const day = jd - hebrewToAbsolute(year, month, 1) + 1;
  
  const monthsList = isHebrewLeapYear(year) ? HEBREW_MONTHS_LEAP : HEBREW_MONTHS;
  
  return {
    day: day,
    month: monthsList[month - 1],
    monthNum: month,
    year: year
  };
}

export function hebrewDateToGregorian(year, month, day) {
  const jd = hebrewToAbsolute(year, month, day);
  return julianToGreg(jd);
}

export function getParsha(date) {
  const heb = getHebrewDate(date);
  
  // Find the Shabbat of this week
  const dayOfWeek = date.getDay();
  const daysUntilShabbat = (6 - dayOfWeek + 7) % 7;
  const shabbat = new Date(date);
  shabbat.setDate(date.getDate() + daysUntilShabbat);
  
  const shabbatHeb = getHebrewDate(shabbat);
  
  // Simchat Torah reference: Oct 25, 2024 was V'Zot HaBerachah (Tishrei 23, 5785)
  const referenceDate = new Date(2024, 9, 25);
  const weeksSince = Math.floor((shabbat - referenceDate) / (7 * 24 * 60 * 60 * 1000));
  
  const parshaIndex = ((weeksSince % 54) + 54) % 54;
  return PARSHIYOT[parshaIndex];
}

export function isShabbat(date) {
  return date.getDay() === 6;
}

export function isErevShabbat(date) {
  return date.getDay() === 5;
}

export function getHebrewMonthsList(isLeap) {
  return isLeap ? HEBREW_MONTHS_LEAP : HEBREW_MONTHS;
}

export function isHebrewLeap(year) {
  return isHebrewLeapYear(year);
}
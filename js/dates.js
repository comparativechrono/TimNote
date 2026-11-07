/* Dates. Everything here works in the computer's local time, with dates written as YYYY-MM-DD. */
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());
export const timeHM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 'YYYY-MM-DD' → Date at local midnight, or null if it isn't a real date */
export function fromIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}
export const validIso = (s) => !!fromIso(s);
export function addDays(isoDate, n) {
  const d = fromIso(isoDate) || new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function daysBetween(a, b) {
  const da = fromIso(a), db = fromIso(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
}

/** Friday 6 November 2026 */
export function fmtLong(s) {
  const d = fromIso(s);
  return d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}
/** Fri 6 Nov 2026 (the year only if it isn't this year, unless always) */
export function fmtShort(s, alwaysYear = false) {
  const d = fromIso(s);
  if (!d) return '';
  const y = d.getFullYear() !== new Date().getFullYear() || alwaysYear ? ' ' + d.getFullYear() : '';
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${y}`;
}
/** 6 Nov (or 6 Nov 2025) */
export function fmtDayMonth(s) {
  const d = fromIso(s);
  if (!d) return '';
  const y = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${y}`;
}
export const weekday = (s) => {
  const d = fromIso(s);
  return d ? DAYS[d.getDay()] : '';
};
export const monthTitle = (y, m) => `${MONTHS[m]} ${y}`;

/** Today, Tomorrow, Yesterday, or Fri 13 Nov */
export function relDay(s) {
  const n = daysBetween(todayIso(), s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return fmtShort(s);
}

const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** a word or phrase for a day ('today', 'tomorrow', 'friday', 'next fri', 'next week', 'end of week', 'end of month'),
    counted from base (YYYY-MM-DD). → YYYY-MM-DD or null */
export function dayWord(word, base) {
  const w = String(word || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const b = fromIso(base) || new Date();
  const out = (d) => iso(d);
  if (w === 'today' || w === 'tonight') return out(b);
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return out(new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1));
  if (w === 'next week') {
    const k = ((8 - b.getDay()) % 7) || 7; // the coming Monday
    return out(new Date(b.getFullYear(), b.getMonth(), b.getDate() + k));
  }
  if (w === 'end of week' || w === 'end of the week' || w === 'eow') {
    let k = (5 - b.getDay() + 7) % 7; // this Friday (today if it is Friday)
    return out(new Date(b.getFullYear(), b.getMonth(), b.getDate() + k));
  }
  if (w === 'end of month' || w === 'end of the month' || w === 'eom') return out(new Date(b.getFullYear(), b.getMonth() + 1, 0));
  const m = /^(next )?([a-z]+)$/.exec(w);
  if (m && m[2] in WD) {
    let k = (WD[m[2]] - b.getDay() + 7) % 7 || 7; // the next one after base
    if (m[1]) k += 7;
    return out(new Date(b.getFullYear(), b.getMonth(), b.getDate() + k));
  }
  return null;
}
export const isDayWord = (w) => dayWord(w, '2000-01-03') != null;

/** '13/11', '13/11/26', '13.11.2026' (day first, as in the UK) → YYYY-MM-DD; without a year, the next such day on
    or after base */
export function ukDate(d, m, y, base) {
  d = +d;
  m = +m;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  let year;
  if (y) year = String(y).length === 2 ? 2000 + +y : +y;
  else {
    const b = fromIso(base) || new Date();
    year = b.getFullYear();
    const cand = new Date(year, m - 1, d);
    if (cand < new Date(b.getFullYear(), b.getMonth(), b.getDate())) year++;
  }
  const s = `${year}-${pad(m)}-${pad(d)}`;
  return validIso(s) ? s : null;
}
/** '13 Nov', '13th November 2026' → YYYY-MM-DD */
export function dayMonthName(d, mon, y, base) {
  const k = String(mon || '').toLowerCase().slice(0, 4).replace(/[^a-z]/g, '');
  const mi = k in MON ? MON[k] : MON[k.slice(0, 3)];
  if (mi == null) return null;
  return ukDate(d, mi + 1, y, base);
}

/** a date from the start of a file's name: 2026-11-06, 2026_11_06, 2026.11.06 or 20261106. → {date, rest} or null */
export function dateFromName(name) {
  const m = /^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?=$|[\s_.\-–—,:)])[\s_\-–—,:]*/.exec(name);
  if (!m) return null;
  const s = `${m[1]}-${m[2]}-${m[3]}`;
  if (!validIso(s)) return null;
  return { date: s, rest: name.slice(m[0].length) };
}

/** the weeks of a month for a calendar, Monday first: [[YYYY-MM-DD × 7], …] */
export function monthGrid(y, m) {
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) row.push(iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i)));
    weeks.push(row);
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (w + 1) * 7);
    if (next.getMonth() !== m && w >= 3) break;
  }
  return weeks;
}

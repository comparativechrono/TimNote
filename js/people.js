/* People: @Millie anywhere in a note tags it with Millie. (@Millie_Smith is "Millie Smith"; @Millie's is Millie.)
   Dates — @friday, @tomorrow, @end of month, @the 12th — aren't people, and neither is an email address or the
   @name in a web address. */
import { isDayWord } from './dates.js';

const MENTION = /(^|[\s(\[{,;:"'“‘])@([\p{L}][\p{L}\p{N}_'’.-]*)/gu;
const NOT_PEOPLE = /^(next|end|the|this|eow|eom)$/i; // (the start of a date: @next week, @end of month, @the 12th)

/** a mention's name, tidied (no full stop or apostrophe at its end), or null if it is a date, not a person */
export function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[._'’-]+$/, '')
    .replace(/['’]s$/i, '') // (@Millie's)
    .replace(/[._'’-]+$/, '');
  if (!name || NOT_PEOPLE.test(name) || isDayWord(name) || /^\d/.test(name)) return null;
  return name;
}
export const personKey = (name) => String(name).toLowerCase();
export const displayName = (name) => String(name).replace(/_/g, ' ');

/** every mention in a text (not in code): [{name, key, line, from, to}] — from/to: where "@Name" is on its line */
export function mentions(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let fence = null;
  let front = lines[0] === '---';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (front) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      continue;
    }
    const fm = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
      continue;
    }
    if (fm) {
      fence = fm[1];
      continue;
    }
    if (line.indexOf('@') < 0) continue;
    // (not inside `code`)
    const code = [];
    for (const m of line.matchAll(/`[^`]*`/g)) code.push([m.index, m.index + m[0].length]);
    for (const m of line.matchAll(MENTION)) {
      const from = m.index + m[1].length;
      if (code.some(([a, b]) => from >= a && from < b)) continue;
      const name = cleanName(m[2]);
      if (!name) continue;
      out.push({ name, key: personKey(name), line: i, from, to: from + 1 + name.length });
    }
  }
  return out;
}

/** the people in a text: [{key, name}] in the order they first appear */
export function peopleIn(text) {
  const seen = new Map();
  for (const m of mentions(text)) if (!seen.has(m.key)) seen.set(m.key, m.name);
  return Array.from(seen, ([key, name]) => ({ key, name }));
}

/** initials for a person's badge: "Millie Smith" → "MS", "Millie" → "Mi" */
export function initials(name) {
  const parts = displayName(name).split(/\s+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  const p = parts[0] || '?';
  return p[0].toUpperCase() + (p[1] || '').toLowerCase();
}
/** a steady colour for a person (one of the highlighters) */
export function personColour(key) {
  const colours = ['blue', 'green', 'pink', 'orange', 'lilac', 'yellow'];
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colours[h % colours.length];
}

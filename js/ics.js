/* Dated items as a calendar file (.ics), to open in Outlook, Google Calendar or Apple Calendar: each is an all-day
   event on its date, with a reminder at 9 in the morning. */
import { addDays } from './dates.js';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  let s = line;
  const enc = new TextEncoder();
  while (enc.encode(s).length > 74) {
    let n = 74;
    while (enc.encode(s.slice(0, n)).length > 74) n--;
    out.push(s.slice(0, n));
    s = ' ' + s.slice(n);
  }
  out.push(s);
  return out.join('\r\n');
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
/** items: [{task: {text, due, raw}, note: {title, path}}] → the file's text */
export function toICS(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TimNote//Notes//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const { task, note } of items) {
    if (!task.due) continue;
    L.push(
      'BEGIN:VEVENT',
      `UID:${hash((note.path || '') + '|' + task.raw)}-${task.due}@timnote`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${task.due.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(task.due, 1).replace(/-/g, '')}`,
      fold('SUMMARY:' + esc(task.text)),
      fold('DESCRIPTION:' + esc(`From the note “${note.title}”${note.path ? ' (' + note.path + ')' : ''}`)),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold('DESCRIPTION:' + esc(task.text)),
      'TRIGGER;RELATED=START:PT9H',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

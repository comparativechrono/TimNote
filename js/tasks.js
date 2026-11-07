/* =====================================================================
   Lists: the lines of the notes that are pulled out into lists.

   A list has words that put a line into it ("TO DO:", "TODO:", "ACTION:")
   and, if things on it can be done, a word for done ("DONE:"). A line is
   on a list when:
     inline    it has one of the list's words: "Spoke to Sam. TO DO: book
               the room" (the rest of the line is the item). Ticking it off
               changes the word: "DONE: book the room".
     checkbox  it is a Markdown checkbox, "- [ ] book the room", which goes
               on the first list (To do) if that's turned on. Ticking it off
               makes it "- [x] book the room".
     item      it is a bullet under a heading or a line that is just one of
               the words: "## To do" or "TO DO:" followed by "- book the
               room". Ticking it off makes it "- [x] book the room".
   Everything is plain text, so the files can be searched in any file
   manager: search for "TO DO:" and you find what's still to do.

   Nothing here touches the page or the files: it is text in, text out.
   ===================================================================== */
import { dayWord, ukDate, dayMonthName, isDayWord, validIso, iso } from './dates.js';

export const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'lilac', 'grey'];

export const DEFAULT_LISTS = [
  { id: 'todo', name: 'To do', triggers: ['TO DO:', 'TODO:', 'ACTION:', 'REMINDER:'], done: 'DONE:', color: 'yellow' },
  { id: 'followup', name: 'Follow up', triggers: ['FOLLOW UP:'], done: 'FOLLOWED UP:', color: 'blue' },
  { id: 'waiting', name: 'Waiting for', triggers: ['WAITING FOR:', 'WAITING ON:'], done: 'RECEIVED:', color: 'orange' },
  { id: 'questions', name: 'Questions', triggers: ['QUESTION:', 'ASK:'], done: 'ANSWERED:', color: 'pink' },
  { id: 'ideas', name: 'Ideas', triggers: ['IDEA:'], done: '', color: 'green' },
  { id: 'decisions', name: 'Decisions', triggers: ['DECISION:', 'DECIDED:'], done: '', color: 'lilac' }
];

const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMPH = '(\\*\\*|__)?';

/** 'TO DO:' → {label: 'TO DO', colon: true, core: regex source for the words} */
export function parseTrigger(t) {
  const s = String(t || '').trim();
  const colon = /:\s*$/.test(s);
  const label = s.replace(/\s*:\s*$/, '').trim();
  const words = label.split(/[\s-]+/).filter(Boolean);
  return { label, colon, core: words.map(reEsc).join('[\\s-]*'), words };
}

/** the lists and options → what the parser uses */
export function compile(lists, opts = {}) {
  const flags = opts.caseSensitive ? 'u' : 'iu';
  const entries = [];
  const good = (lists || []).filter((l) => l && l.id && (l.triggers || []).some((t) => parseTrigger(t).words.length));
  for (const list of good) {
    const add = (t, kind) => {
      const p = parseTrigger(t);
      if (!p.words.length) return;
      const tail = p.colon ? '[ \\t]*:' + EMPH : '(?![\\p{L}\\p{N}])()';
      entries.push({
        list,
        kind,
        label: p.label,
        inline: new RegExp('(^|[^\\p{L}\\p{N}])' + EMPH + '(' + p.core + ')' + EMPH + tail, flags),
        block: new RegExp('^(' + p.core + ')s?$', flags)
      });
    };
    for (const t of list.triggers || []) add(t, 'open');
    if (list.done) add(list.done, 'done');
  }
  // longer words first, so that "WAITING FOR:" wins over a shorter word at the same place
  entries.sort((a, b) => b.label.length - a.label.length);
  return { lists: good, entries, main: good[0] || null, checkboxes: opts.checkboxes !== false, byId: new Map(good.map((l) => [l.id, l])) };
}

/* ---------------- reading a line ---------------- */
const LI = /^(\s*)([-*+]|\d{1,3}[.)])(\s+|$)(?:\[([ xX])\](?=\s|$)\s*)?(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
/** a list item: {indent, marker, box (' ' | 'x' | null), boxAt (column of '['), content, contentAt} */
export function listItem(line) {
  if (HR.test(line)) return null;
  const m = LI.exec(line);
  if (!m) return null;
  const indent = m[1].replace(/\t/g, '    ').length;
  const boxAt = m[4] != null ? m[1].length + m[2].length + m[3].length : -1;
  const contentAt = line.length - m[5].length;
  return { indent, marker: m[2], box: m[4] != null ? (m[4] === ' ' ? ' ' : 'x') : null, boxAt, content: m[5], contentAt };
}
/** the line without its heading marks, list marker, checkbox, bold and final colon. → {s, heading} */
function strip(line) {
  let s = line.trim();
  let heading = 0;
  const hm = /^(#{1,6})\s+/.exec(s);
  if (hm) {
    heading = hm[1].length;
    s = s.slice(hm[0].length).replace(/\s+#+\s*$/, '');
  }
  s = s.replace(/^([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?/, '');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/^(\*\*|__|\*|_)(.+)\1$/, '$2').trim();
    s = s.replace(/\s*:\s*$/, '').trim();
  }
  return { s, heading };
}
/** the first of the lists' words in a line. → {entry, start (where the word and its bold start), labelStart, labelEnd, end} */
export function findLabel(line, C) {
  let best = null;
  for (const e of C.entries) {
    const m = e.inline.exec(line);
    if (!m) continue;
    const start = m.index + m[1].length;
    if (best && start >= best.start) continue;
    const labelStart = start + (m[2] || '').length;
    best = { entry: e, start, labelStart, labelEnd: labelStart + m[3].length, end: m.index + m[0].length };
  }
  return best;
}
function taskText(after) {
  let t = after.replace(/^\s*(?:\*\*|__)?\s*(?:[-–—]\s+)?/, '').trim();
  for (const x of ['**', '__']) if (t.endsWith(x) && t.split(x).length % 2 === 0) t = t.slice(0, -2).trim();
  return t;
}

/* ---------------- dates, people and tags in an item ---------------- */
const PRE = '(?:^|[\\s(\\[,;])';
const KW = '(?:@|\\u{1F4C5}\\s*|due(?:\\s+(?:by|on))?:?\\s+|by:?\\s+|before\\s+)';
const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DAYW = '((?:next\\s+)?(?:today|tonight|tomorrow|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|next\\s+week|end\\s+of\\s+(?:the\\s+)?(?:week|month)|eow|eom)';
const DUE = [
  [new RegExp(PRE + KW + '(\\d{4}-\\d{2}-\\d{2})(?!\\d)', 'iu'), (m) => (validIso(m[1]) ? m[1] : null)],
  [new RegExp(PRE + KW + '(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{4}|\\d{2}))?(?![\\d/.]*\\d)', 'iu'), (m, b) => ukDate(m[1], m[2], m[3], b)],
  [new RegExp(PRE + KW + '(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTHS + '(?:,?\\s+(\\d{4}))?(?![\\p{L}\\d])', 'iu'), (m, b) => dayMonthName(m[1], m[2], m[3], b)],
  [new RegExp(PRE + KW + DAYW + '(?![\\p{L}])', 'iu'), (m, b) => dayWord(m[1], b)]
];
const PEOPLE = /(?:^|[\s(\[,;])@([\p{L}][\p{L}\p{N}_'’.-]*)/gu;
const TAGS = /(?:^|[\s(\[,;])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;

/** {due, dueText, people, tags, priority} from an item's text; base: the note's date, for "by Friday" */
export function itemMeta(text, base) {
  let due = null, dueText = '';
  for (const [re, fn] of DUE) {
    const m = re.exec(text);
    if (m) {
      const d = fn(m, base);
      if (d) {
        due = d;
        dueText = m[0].trim();
        break;
      }
    }
  }
  const people = [];
  for (const m of text.matchAll(PEOPLE)) {
    const name = m[1].replace(/[.'’-]+$/, '');
    if (!name || /^next$/i.test(name) || isDayWord(name) || /^\d/.test(name)) continue;
    if (!people.includes(name)) people.push(name);
  }
  const tags = [];
  for (const m of text.matchAll(TAGS)) if (!tags.includes(m[1].toLowerCase())) tags.push(m[1].toLowerCase());
  const priority = /!!|\(!\)|\bURGENT\b|\bASAP\b/.test(text);
  return { due, dueText, people, tags, priority };
}

/* ---------------- the whole note ---------------- */
/** text → {tasks, labels}. tasks: [{list, line, kind, done, checkable, text, raw, box, due, dueText, people, tags,
    priority}]. labels: the places of the lists' words, for highlighting [{line, from, to, list, kind}]. base: the
    note's date (YYYY-MM-DD) for words like "Friday". */
export function parse(text, C, base) {
  const tasks = [];
  const labels = [];
  if (!C || !C.entries.length) return { tasks, labels };
  const lines = String(text).split('\n');
  base = base || iso(new Date());
  let fence = null;
  let block = null; // {list, kind, heading, indent, started}
  let front = lines[0] === '---';

  const push = (list, line, kind, done, raw, text2, box) => {
    if (!text2) return;
    const meta = itemMeta(text2, base);
    const checkable = box != null || !!list.done;
    tasks.push(Object.assign({ list: list.id, line, kind, done: !!done, checkable, text: text2, raw, box }, meta));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // front matter at the top of a file
    if (front) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      continue;
    }
    // code: not read
    const fm = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
      continue;
    }
    if (fm) {
      fence = fm[1];
      block = null;
      continue;
    }

    const li = listItem(line);
    const isHeading = /^\s{0,3}#{1,6}\s/.test(line);

    // the end of a block of items
    if (block) {
      if (block.heading) {
        if (isHeading) {
          const lv = /^\s*(#+)/.exec(line)[1].length;
          if (lv <= block.heading) block = null;
        }
      } else if (!line.trim()) {
        if (block.started) block = null;
      } else if (!li) block = null;
    }

    const found = findLabel(line, C);
    const rest = found ? taskText(line.slice(found.end)) : '';
    const st = strip(line);
    let blockEntry = null;
    if (st.s && !rest) {
      for (const e of C.entries) {
        if (e.block.test(st.s)) {
          blockEntry = e;
          break;
        }
      }
    }

    if (found && rest) {
      const e = found.entry;
      labels.push({ line: i, from: found.start, to: found.end, list: e.list.id, kind: e.kind });
      const box = li ? li.box : null;
      push(e.list, i, 'inline', e.kind === 'done' || box === 'x', line, rest, box);
      if (block && li) block.started = true;
      continue;
    }
    if (blockEntry) {
      // a heading, or a line that is just one of the words: the bullets after it are items
      if (found) labels.push({ line: i, from: found.start, to: found.end, list: blockEntry.list.id, kind: blockEntry.kind, block: true });
      else {
        const at = line.indexOf(st.s);
        if (at >= 0) labels.push({ line: i, from: at, to: at + st.s.length, list: blockEntry.list.id, kind: blockEntry.kind, block: true });
      }
      block = { list: blockEntry.list, kind: blockEntry.kind, heading: st.heading, indent: null, started: false };
      continue;
    }
    // (one of the words with nothing after it: shown, but not an item)
    if (found) labels.push({ line: i, from: found.start, to: found.end, list: found.entry.list.id, kind: found.entry.kind });
    if (block && li) {
      block.started = true;
      if (block.indent == null) block.indent = li.indent;
      if (li.indent > block.indent) continue; // (a note under an item, not an item)
      push(block.list, i, 'item', li.box === 'x' || block.kind === 'done', line, li.content.trim(), li.box);
      continue;
    }
    if (li && li.box != null && C.checkboxes && C.main) push(C.main, i, 'checkbox', li.box === 'x', line, li.content.trim(), li.box);
  }
  return { tasks, labels };
}

/* ---------------- ticking off ---------------- */
function matchCase(word, like) {
  if (like === like.toLowerCase()) return word.toLowerCase();
  if (like[0] === like[0].toUpperCase() && like.slice(1) === like.slice(1).toLowerCase()) return word[0].toUpperCase() + word.slice(1).toLowerCase();
  return word;
}
/** one line, ticked off (done = true) or not. task: the item on that line, as parse found it */
export function toggleLine(line, task, done, C) {
  let out = line;
  const li = listItem(out);
  if (li && li.box != null) out = out.slice(0, li.boxAt) + (done ? '[x]' : '[ ]') + out.slice(li.boxAt + 3);
  else if (li && task.kind === 'item' && done) out = out.slice(0, li.contentAt) + '[x] ' + out.slice(li.contentAt);
  if (task.kind === 'inline' || task.kind === 'checkbox') {
    const f = findLabel(out, C);
    if (f && f.entry.list.id === task.list) {
      const list = f.entry.list;
      const old = out.slice(f.labelStart, f.labelEnd);
      let word = null;
      if (done && f.entry.kind === 'open' && list.done) word = parseTrigger(list.done).label;
      if (!done && f.entry.kind === 'done') word = parseTrigger(list.triggers[0]).label;
      if (word) out = out.slice(0, f.labelStart) + matchCase(word, old) + out.slice(f.labelEnd);
    }
  }
  return out;
}

/** the whole text with one item ticked off (or not). → new text, or null if the item isn't where it was (the note
    has changed: then nothing is changed) */
export function toggleInText(text, task, done, C, base) {
  const lines = String(text).split('\n');
  let at = task.line;
  if (lines[at] !== task.raw) {
    at = lines.indexOf(task.raw);
    if (at < 0) return null;
  }
  const now = parse(text, C, base).tasks.find((t) => t.line === at && t.list === task.list);
  if (!now) return null;
  const next = toggleLine(lines[at], now, done, C);
  if (next === lines[at]) return done === now.done ? text : null;
  lines[at] = next;
  return lines.join('\n');
}

/** a new line for a list: "TO DO: book the room @2026-11-13" */
export function newItemLine(list, text, due) {
  const word = parseTrigger((list.triggers || [])[0] || 'TO DO:');
  return `${word.label}${word.colon ? ':' : ''} ${String(text).trim()}${due ? ' @' + due : ''}`;
}

/** the line with the first list's word added at its start, or taken away if it has one */
export function toggleWordOnLine(line, C) {
  const f = findLabel(line, C);
  if (f && f.entry.list === C.main) {
    return (line.slice(0, f.start) + line.slice(f.end)).replace(/^(\s*(?:[-*+]|\d+[.)])?\s*)\s+/, '$1');
  }
  const word = C.main ? parseTrigger(C.main.triggers[0]) : { label: 'TO DO', colon: true };
  const li = listItem(line);
  const at = li ? li.contentAt : line.length - line.trimStart().length;
  return line.slice(0, at) + word.label + (word.colon ? ': ' : ' ') + line.slice(at);
}

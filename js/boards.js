/* =====================================================================
   Boards (kanban), kept as Markdown files, in the form the Kanban plugin
   for Obsidian uses, so they read well anywhere:

     ---
     kanban-plugin: basic
     ---

     ## To do

     - [ ] Book the seminar room
     - [ ] [[2026-11-06 Lab meeting]]
     - [ ] send Sarah the figures (from [[2026-11-06 Lab meeting]])

     ## Doing

     ## Done

     - [x] Order the antibodies

   A file is a board only if its front matter has "kanban-plugin:" (so a
   note is never taken for one). A column is a "##" heading; a card is a
   bullet at the start of a line. A card that is only a link to a note is
   that note; a card that ends "(from [[a note]])" is an item on one of
   the lists, in that note.

   Everything else in the file (lines under a card, other headings, text,
   code, the plugin's settings at the end) is kept exactly as it is: a
   change to a board changes only the lines it is about.

   Nothing here touches the page or the files: text in, text out.
   ===================================================================== */

export const NEW_BOARD = (columns = ['To do', 'Doing', 'Done']) => `---\nkanban-plugin: basic\n---\n\n${columns.map((c) => `## ${c}\n\n`).join('')}`;

/** is this text a board? (front matter with "kanban-plugin:") */
export function isBoardText(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(t);
  return !!m && /^kanban-plugin[ \t]*:/m.test(m[1]);
}

const CARD = /^([-*+])[ \t]+(?:\[([ xX])\][ \t]*)?(.*)$/;
const COLUMN = /^##[ \t]+(.*?\S)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** a board file's text → {front, pre, columns: [{title, heading, head, cards: [{text, done, marker, raw, sub}], after}],
    tail, eol}. heading/raw: the lines as they were (null once changed); head: the lines between a column's heading and
    its first card; sub: the lines under a card; after: the blank lines at the end of a column */
export function parseBoard(text) {
  const lines = String(text || '').split('\n');
  const board = { front: [], pre: [], columns: [], tail: [], eol: false };
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
    board.eol = true;
  }
  let i = 0;
  if (/^---[ \t]*\r?$/.test(lines[0] || '')) {
    let j = 1;
    while (j < lines.length && !/^---[ \t]*\r?$/.test(lines[j])) j++;
    if (j < lines.length) {
      board.front = lines.slice(0, j + 1);
      i = j + 1;
    }
  }
  let col = null, card = null, fence = null;
  const where = () => (card ? card.sub : col ? col.head : board.pre);
  const endColumn = () => {
    // (what comes after a column's last card, after a blank line and not indented under it — the gap before the next
    // heading, a rule — belongs to the column, not to the card)
    if (col && col.cards.length) {
      const sub = col.cards[col.cards.length - 1].sub;
      let k = sub.length;
      for (let j = sub.length - 1; j >= 0; j--) {
        if (!sub[j].trim()) k = j;
        else if (/^[ \t]/.test(sub[j])) break;
      }
      col.after = sub.splice(k).concat(col.after);
    }
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const bare = line.replace(/\r$/, '');
    if (fence) {
      where().push(line);
      const fm = FENCE.exec(bare);
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && !bare.trim().slice(fm[1].length).trim()) fence = null;
      continue;
    }
    const fm = FENCE.exec(bare);
    if (fm) {
      fence = fm[1];
      where().push(line);
      continue;
    }
    if (/^%%/.test(bare)) {
      // (the Kanban plugin's settings, and anything after them)
      endColumn();
      board.tail = lines.slice(i);
      break;
    }
    const hm = COLUMN.exec(bare);
    if (hm) {
      endColumn();
      col = { title: hm[1].trim(), heading: line, head: [], cards: [], after: [], prev: i > 0 ? lines[i - 1].replace(/\r$/, '') : null };
      board.columns.push(col);
      card = null;
      continue;
    }
    const cm = col ? CARD.exec(bare) : null;
    if (cm && cm[3].trim()) {
      card = { text: cm[3].trim(), done: !!cm[2] && cm[2] !== ' ', marker: cm[1], raw: line, sub: [] };
      col.cards.push(card);
      continue;
    }
    where().push(line);
  }
  endColumn();
  return board;
}

/** a board → its file's text (what wasn't changed, exactly as it was) */
export function serializeBoard(b) {
  const out = [...b.front, ...b.pre];
  const last = () => (out.length ? out[out.length - 1].replace(/\r$/, '') : '');
  for (const col of b.columns) {
    // (a blank line before a new heading, or one that now comes after something else)
    if (out.length && last().trim() && (col.heading == null || last() !== col.prev)) out.push('');
    out.push(col.heading != null ? col.heading : `## ${String(col.title).replace(/\s*\n\s*/g, ' ')}`);
    out.push(...col.head);
    for (const c of col.cards) {
      out.push(c.raw != null ? c.raw : `${c.marker || '-'} [${c.done ? 'x' : ' '}] ${String(c.text).replace(/\s*\n\s*/g, ' ')}`);
      out.push(...(c.sub || []));
    }
    let after = col.after || [];
    // (a column whose cards have all gone: one blank line under its heading, not two)
    if (!col.cards.length && out.length && !last().trim()) after = after.slice(after.findIndex((l) => l.trim()) < 0 ? after.length : after.findIndex((l) => l.trim()));
    out.push(...after);
  }
  if (b.tail.length) {
    if (out.length && last().trim()) out.push('');
    out.push(...b.tail);
  }
  let text = out.join('\n');
  if (b.eol) text += '\n';
  return text;
}

/** what a card is: {kind: 'note', ref} | {kind: 'item', text, ref} | {kind: 'plain', text} */
export function cardKind(text) {
  const t = String(text || '').trim();
  let m = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(t);
  if (m) return { kind: 'note', ref: m[1].trim() };
  m = /^(.*\S)\s+\(from \[\[([^\]|]+)(?:\|[^\]]*)?\]\]\)$/.exec(t);
  if (m) return { kind: 'item', text: m[1].trim(), ref: m[2].trim() };
  return { kind: 'plain', text: t };
}
/** a card's text for a note, and for an item on a list in a note (ref: the note's file name without .md) */
export const noteCard = (ref) => `[[${ref}]]`;
export const itemCard = (text, ref) => `${String(text).trim()} (from [[${ref}]])`;
export const noteRef = (path) => path.split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
/** a card's text with its links to one note changed to another (a note renamed) → the new text, or null if none */
export function relinkCard(text, from, to) {
  const re = new RegExp('\\[\\[' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\|[^\\]]*)?\\]\\]', 'gi');
  if (!re.test(text)) return null;
  return text.replace(re, (m, label) => `[[${to}${label || ''}]]`);
}

/* ---------------- changes to a board ---------------- *
   Each change finds its column by title and its card by text, so that it can be made again on the file as it is
   now (if it changed on another computer meanwhile). Each returns false if what it changes isn't there. */
const col = (b, title) => b.columns.find((c) => c.title === title) || null;
const cardIndex = (c, text, hint) => {
  if (hint != null && c.cards[hint] && c.cards[hint].text === text) return hint;
  return c.cards.findIndex((x) => x.text === text);
};
export const ops = {
  addCard(b, { column, text, index = null, done = false }) {
    const c = col(b, column);
    const t = String(text || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!c || !t) return false;
    const card = { text: t, done, marker: '-', raw: null, sub: [] };
    if (index == null || index > c.cards.length) c.cards.push(card);
    else c.cards.splice(Math.max(0, index), 0, card);
    return true;
  },
  moveCard(b, { from, text, hint, to, index }) {
    const a = col(b, from), z = col(b, to);
    if (!a || !z) return false;
    const i = cardIndex(a, text, hint);
    if (i < 0) return false;
    const [card] = a.cards.splice(i, 1);
    let at = index == null ? z.cards.length : index;
    if (a === z && i < at) at--; // (moving down within a column: the gap it left)
    z.cards.splice(Math.max(0, Math.min(at, z.cards.length)), 0, card);
    return true;
  },
  editCard(b, { column, text, hint, to }) {
    const c = col(b, column);
    const t = String(to || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!c || !t) return false;
    const i = cardIndex(c, text, hint);
    if (i < 0) return false;
    if (c.cards[i].text !== t) Object.assign(c.cards[i], { text: t, raw: null });
    return true;
  },
  setDone(b, { column, text, hint, done }) {
    const c = col(b, column);
    if (!c) return false;
    const i = cardIndex(c, text, hint);
    if (i < 0) return false;
    if (c.cards[i].done !== !!done) Object.assign(c.cards[i], { done: !!done, raw: null });
    return true;
  },
  deleteCard(b, { column, text, hint }) {
    const c = col(b, column);
    if (!c) return false;
    const i = cardIndex(c, text, hint);
    if (i < 0) return false;
    c.cards.splice(i, 1);
    return true;
  },
  addColumn(b, { title }) {
    const t = String(title || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!t || col(b, t)) return false;
    b.columns.push({ title: t, heading: null, head: [''], cards: [], after: [] });
    return true;
  },
  renameColumn(b, { title, to }) {
    const c = col(b, title);
    const t = String(to || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!c || !t || (t !== title && col(b, t))) return false;
    if (t !== title) Object.assign(c, { title: t, heading: null });
    return true;
  },
  deleteColumn(b, { title }) {
    const i = b.columns.findIndex((c) => c.title === title);
    if (i < 0) return false;
    b.columns.splice(i, 1);
    return true;
  },
  moveColumn(b, { title, by }) {
    const i = b.columns.findIndex((c) => c.title === title);
    const j = i + by;
    if (i < 0 || j < 0 || j >= b.columns.length) return false;
    const [c] = b.columns.splice(i, 1);
    b.columns.splice(j, 0, c);
    return true;
  }
};

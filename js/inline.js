/* A line of a note, shown on a card, a tile or a board: **bold**, *italic*, `code` and links as such, @Millie as
   "Millie", #tags, [[links to notes]], and the lists' words highlighted. → nodes to put in an element. */
import { displayName, cleanName, personKey } from './people.js';
import * as S from './settings.js';

const TOKEN = /(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(`[^`\n]+`)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\((?:https?:|mailto:)[^)\s]+\))|((?<=^|[\s(\[{,;:"'“‘])@[\p{L}][\p{L}\p{N}_'’.-]*)|((?<=^|[\s(\[,;])#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)|((?<![\p{L}\p{N}*])\*[^*\s][^*\n]*\*(?![\p{L}\p{N}*]))|((?<![\p{L}\p{N}_])_[^_\s][^_\n]*_(?![\p{L}\p{N}_]))/gu;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** the lists' words in plain text, highlighted (marks), the rest as text */
function words(text, out, { marks = true } = {}) {
  if (!marks) return out.push(document.createTextNode(text));
  const C = S.lists();
  const found = [];
  for (const e of C.entries) {
    const re = new RegExp(e.inline.source, e.inline.flags.includes('g') ? e.inline.flags : e.inline.flags + 'g');
    let m;
    while ((m = re.exec(text))) {
      found.push({ from: m.index + m[1].length, to: m.index + m[0].length, e });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  found.sort((a, b) => a.from - b.from || b.to - a.to);
  let at = 0;
  for (const f of found) {
    if (f.from < at) continue;
    if (f.from > at) out.push(document.createTextNode(text.slice(at, f.from)));
    const mk = el('mark', `hl hl-${f.e.kind === 'done' ? 'done' : f.e.list.color || 'yellow'}`, text.slice(f.from, f.to));
    out.push(mk);
    at = f.to;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
}

/** text → [nodes]. opts: {marks: highlight list words (true), hide: a piece of text not to show (an item's @date,
    shown beside it instead), links: make @people and [[notes]] links (true)} */
export function inline(text, opts = {}) {
  const out = [];
  let s = String(text || '');
  if (opts.hide) {
    const i = s.indexOf(opts.hide);
    if (i >= 0 && opts.hide.startsWith('@')) s = (s.slice(0, i) + s.slice(i + opts.hide.length)).replace(/\s{2,}/g, ' ').trim();
  }
  let at = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > at) words(s.slice(at, m.index), out, opts);
    const t = m[0];
    if (m[1]) out.push(el('strong', '', t.slice(2, -2)));
    else if (m[2]) out.push(el('s', '', t.slice(2, -2)));
    else if (m[3]) out.push(el('code', '', t.slice(1, -1)));
    else if (m[4]) {
      const inner = t.slice(2, -2);
      const [target, label] = inner.split('|');
      const a = el('span', 'wikilink', (label || target.replace(/^\d{4}-\d{2}-\d{2}\s+/, '')).trim());
      a.dataset.wiki = target.trim();
      out.push(a);
    } else if (m[5]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      const a = el('a', 'ext', mm[1]);
      a.href = mm[2];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      out.push(a);
    } else if (m[6]) {
      const name = cleanName(t.slice(1));
      if (!name) out.push(el('span', 'when', t));
      else {
        const p = el('span', 'person', displayName(name));
        p.dataset.person = personKey(name);
        out.push(p);
        if (t.length > name.length + 1) out.push(document.createTextNode(t.slice(name.length + 1)));
      }
    } else if (m[7]) out.push(el('span', 'tag', t));
    else if (m[8] || m[9]) out.push(el('em', '', t.slice(1, -1)));
    at = m.index + t.length;
  }
  if (at < s.length) words(s.slice(at), out, opts);
  return out;
}

/* Searching the notes: every word must be there (in any order); "words in quotes" must be there together;
   -word must not be; in:Folder looks only in that folder. Matches in a title count most. */
import { all, fold } from './library.js';

export function parseQuery(q) {
  const terms = [], not = [];
  let folder = '';
  const re = /(-)?"([^"]+)"|(-)?(\S+)/g;
  let m;
  while ((m = re.exec(String(q || '')))) {
    const neg = !!(m[1] || m[3]);
    let t = m[2] != null ? m[2] : m[4];
    if (m[4] && /^in:/i.test(t)) {
      folder = fold(t.slice(3));
      continue;
    }
    t = fold(t).trim();
    if (!t) continue;
    (neg ? not : terms).push(t);
  }
  return { terms, not, folder };
}

/** → [{note, score, snippets: [{line, text, hits: [[from, to]]}]}] */
export function search(q, { limit = 200, archived = true } = {}) {
  const { terms, not, folder } = parseQuery(q);
  if (!terms.length && !folder) return [];
  const out = [];
  for (const n of all({ archived })) {
    if (folder && !fold(n.dir).startsWith(folder)) continue;
    const hay = n.lc;
    if (!terms.every((t) => hay.includes(t))) continue;
    if (not.some((t) => hay.includes(t))) continue;
    const title = fold(n.title);
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 20;
      score += Math.min(10, count(hay, t));
    }
    if (n.archived) score -= 5;
    // (newer notes first among equals)
    score += Math.max(0, 5 - (Date.now() - n.mtime) / (86400000 * 60));
    out.push({ note: n, score, snippets: snippets(n, terms) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
function count(hay, t) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(t, i)) >= 0 && n < 50) {
    n++;
    i += t.length;
  }
  return n;
}
/** up to three lines with the words in them, cut down around the first word found */
export function snippets(n, terms, max = 3) {
  const out = [];
  if (!terms.length) return out;
  const lines = n.text.split('\n');
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i];
    const lc = fold(line);
    const hits = [];
    for (const t of terms) {
      let k = 0;
      while ((k = lc.indexOf(t, k)) >= 0) {
        hits.push([k, k + t.length]);
        k += t.length;
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a[0] - b[0]);
    let from = Math.max(0, hits[0][0] - 50);
    let to = Math.min(line.length, from + 180);
    if (from > 0) from = line.lastIndexOf(' ', from) + 1 || from;
    const text = line.slice(from, to);
    out.push({ line: i, text: (from > 0 ? '…' : '') + text + (to < line.length ? '…' : ''), hits: hits.filter((h) => h[0] >= from && h[1] <= to).map((h) => [h[0] - from + (from > 0 ? 1 : 0), h[1] - from + (from > 0 ? 1 : 0)]) });
  }
  return out;
}

/** a quick score for the command palette: how well a title matches what was typed (0: not at all) */
export function fuzzy(text, q) {
  const t = fold(text), s = fold(q).trim();
  if (!s) return 1;
  if (t.startsWith(s)) return 100 - t.length / 100;
  const i = t.indexOf(s);
  if (i >= 0) return 80 - i / 10;
  const words = s.split(/\s+/);
  if (words.every((w) => t.includes(w))) return 60;
  // letters in order
  let k = 0, gaps = 0;
  for (const c of s) {
    const j = t.indexOf(c, k);
    if (j < 0) return 0;
    gaps += j - k;
    k = j + 1;
  }
  return Math.max(1, 40 - gaps);
}

/* =====================================================================
   What goes on a mind map: a note as cards (its title in the middle, its
   headings around it, and each paragraph, bullet or line on a card of its
   own, joined to the heading it is under), or the lists with their items
   around them. Then where each card goes, at first: a mind map that
   grows out to both sides of the middle.

   Nothing here touches the page or the files: text in, cards out.
   ===================================================================== */
import { parse } from './tasks.js';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
/** a key for a card that stays the same while its text does (the nth card with the same text has #n) */
function keyer(prefix) {
  const seen = new Map();
  return (text) => {
    const k = norm(text).slice(0, 160);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return `${prefix}${k}#${n}`;
  };
}

/** a note's blocks: [{kind: 'heading' | 'para' | 'item' | 'code', text, line, level, indent}] */
export function noteBlocks(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let para = null, fence = null, code = null;
  let front = lines[0] === '---';
  const endPara = () => {
    if (para) out.push(para);
    para = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (front) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      continue;
    }
    const fm = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) {
        fence = null;
        out.push(code);
        code = null;
      } else code.lines.push(line);
      continue;
    }
    if (fm) {
      endPara();
      fence = fm[1];
      code = { kind: 'code', text: '', line: i, lines: [] };
      continue;
    }
    if (!line.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endPara();
      continue;
    }
    const hm = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (hm) {
      endPara();
      out.push({ kind: 'heading', text: hm[2], line: i, level: hm[1].length });
      continue;
    }
    const lm = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (lm) {
      endPara();
      const indent = lm[1].replace(/\t/g, '    ').length;
      const body = lm[3].replace(/^\[[ xX]\]\s*/, '');
      if (body.trim()) out.push({ kind: 'item', text: body, line: i, indent, box: /^\[[ xX]\]/.test(lm[3]) ? /^\[[xX]\]/.test(lm[3]) : null });
      continue;
    }
    const t = line.replace(/^\s*>\s?/, '');
    if (para) para.text += '\n' + t;
    else para = { kind: 'para', text: t, line: i };
  }
  endPara();
  if (code) out.push(code);
  for (const b of out) if (b.kind === 'code') b.text = b.lines.slice(0, 8).join('\n') + (b.lines.length > 8 ? '\n…' : '');
  return out.filter((b) => norm(b.text));
}

/** a note → {root, nodes, links}: a tree of cards (root: the title), and the lines that join them [[from, to]] */
export function noteTree(text, title, C, base) {
  const key = keyer('b:');
  const tasks = new Map();
  if (C) for (const t of parse(text, C, base).tasks) tasks.set(t.line, t);
  const root = { key: 'root', kind: 'root', text: title || 'Untitled', line: 0, children: [] };
  const nodes = [root];
  const links = [];
  const heads = [{ level: 0, node: root }];
  let items = []; // [{indent, node}] (bullets, for bullets under bullets)
  // (a line on a list is a card of its own, even in the middle of a paragraph)
  const blocks = [];
  for (const b of noteBlocks(text)) {
    if (b.kind !== 'para' || !b.text.includes('\n') || !tasks.size) {
      blocks.push(b);
      continue;
    }
    let cur = null;
    b.text.split('\n').forEach((t, i) => {
      const ln = b.line + i;
      if (!norm(t)) return;
      if (tasks.has(ln)) {
        if (cur) blocks.push(cur);
        cur = null;
        blocks.push({ kind: 'para', text: t, line: ln });
      } else if (cur) cur.text += '\n' + t;
      else cur = { kind: 'para', text: t, line: ln };
    });
    if (cur) blocks.push(cur);
  }
  blocks.forEach((b, i) => {
    // (a first heading that is the title is the middle card itself)
    if (b.kind === 'heading' && i === 0 && b.level === 1 && norm(b.text).toLowerCase() === norm(title).toLowerCase()) {
      root.line = b.line;
      return;
    }
    const node = { key: key(b.text), kind: b.kind, text: b.text, line: b.line, children: [], level: b.level || 0 };
    if (b.box != null) node.box = b.box;
    const t = tasks.get(b.line);
    if (t) node.task = t;
    let parent;
    if (b.kind === 'heading') {
      while (heads.length > 1 && heads[heads.length - 1].level >= b.level) heads.pop();
      parent = heads[heads.length - 1].node;
      heads.push({ level: b.level, node });
      items = [];
    } else if (b.kind === 'item') {
      while (items.length && items[items.length - 1].indent >= b.indent) items.pop();
      parent = items.length ? items[items.length - 1].node : heads[heads.length - 1].node;
      items.push({ indent: b.indent, node });
    } else {
      items = [];
      parent = heads[heads.length - 1].node;
    }
    parent.children.push(node);
    nodes.push(node);
    links.push([parent.key, node.key]);
  });
  return { root, nodes, links };
}

/** where each card of a tree goes: a mind map, out to the right and the left of the middle card.
    sizeOf(node) → {w, h}. → Map key → {x, y} (top left corners) */
export function treeLayout(root, sizeOf, { gapX = 70, gapY = 14 } = {}) {
  const pos = new Map();
  const size = new Map();
  const sz = (n) => {
    if (!size.has(n.key)) size.set(n.key, sizeOf(n));
    return size.get(n.key);
  };
  const subH = new Map();
  const heightOf = (n) => {
    if (subH.has(n.key)) return subH.get(n.key);
    const kids = n.children || [];
    const ch = kids.reduce((a, c) => a + heightOf(c), 0) + Math.max(0, kids.length - 1) * gapY;
    const v = Math.max(sz(n).h, ch);
    subH.set(n.key, v);
    return v;
  };
  // place a subtree: dir 1 grows to the right of x, dir -1 to the left of x; top: where its block starts
  const place = (n, x, top, dir) => {
    const s = sz(n);
    const block = heightOf(n);
    const nx = dir > 0 ? x : x - s.w;
    pos.set(n.key, { x: nx, y: top + (block - s.h) / 2 });
    const kids = n.children || [];
    const kidsH = kids.reduce((a, c) => a + heightOf(c), 0) + Math.max(0, kids.length - 1) * gapY;
    let y = top + (block - kidsH) / 2;
    const cx = dir > 0 ? nx + s.w + gapX : nx - gapX;
    for (const c of kids) {
      place(c, cx, y, dir);
      y += heightOf(c) + gapY;
    }
  };
  const rs = sz(root);
  pos.set(root.key, { x: -rs.w / 2, y: -rs.h / 2 });
  // the first half (by height) to the right, the rest to the left
  const kids = root.children || [];
  const total = kids.reduce((a, c) => a + heightOf(c), 0);
  const right = [], left = [];
  let acc = 0;
  for (const c of kids) {
    if (acc < total / 2 || !right.length) right.push(c);
    else left.push(c);
    acc += heightOf(c);
  }
  for (const [side, dir] of [[right, 1], [left, -1]]) {
    const h = side.reduce((a, c) => a + heightOf(c), 0) + Math.max(0, side.length - 1) * gapY;
    let y = -h / 2;
    const x = dir > 0 ? rs.w / 2 + gapX : -rs.w / 2 - gapX;
    for (const c of side) {
      place(c, x, y, dir);
      y += heightOf(c) + gapY;
    }
  }
  return pos;
}

/** items on lists as a tree: the title in the middle, each group (a list, or a day, a note or a person on a list's
    page) around it, and its items around that. groups: [{key, title, color, items: [{task, note}]}]; max: the most
    items shown in a group (then a card for the rest). → {root, nodes, links} */
export function itemsTree(title, groups, { max = 40 } = {}) {
  const key = keyer('i:');
  const root = { key: 'root', kind: 'root', text: title, children: [] };
  const nodes = [root];
  const links = [];
  const add = (parent, node) => {
    parent.children.push(node);
    nodes.push(node);
    links.push([parent.key, node.key]);
  };
  for (const g of groups) {
    // (a group with no title: its items straight round the middle)
    let parent = root;
    if (g.title != null) {
      parent = { key: 'g:' + g.key, kind: 'heading', text: g.title, color: g.color, group: g, children: [] };
      add(root, parent);
    }
    for (const it of g.items.slice(0, max)) add(parent, { key: key(it.note.path + '|' + it.task.text), kind: 'item', text: it.task.text, task: it.task, note: it.note, children: [] });
    if (g.items.length > max) add(parent, { key: 'more:' + g.key, kind: 'more', text: `and ${g.items.length - max} more`, group: g, children: [] });
  }
  return { root, nodes, links };
}

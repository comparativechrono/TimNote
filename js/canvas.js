/* =====================================================================
   The mind map: cards on a table, after Mind Map Studio. Drag a card to
   move it (Shift+click for several; Shift+drag to pick a group), drag
   the table to move around, wheel or pinch to zoom, F to fit. Drag from
   the dot on a card's edge to another card to join them. Double-click a
   card to open it where it is in its note.

   The note is never changed. Where the cards are, their colours, the
   lines drawn and the cards taken off the map are kept in the notes
   folder (.timnote/maps/), so the map is the same on every computer.
   ===================================================================== */
import { h, icon, iconEl, iconBtn, btn, toast, download, menu, debounce } from './util.js';
import * as fsx from './fsx.js';
import { inline } from './inline.js';
import { displayName, cleanName } from './people.js';

const MIN_ZOOM = 0.12, MAX_ZOOM = 2.5;
const CARD_MAX = 240, ROOT_MAX = 300, PAD_X = 16, PAD_Y = 11;
const BRANCH = ['#3f8fdc', '#4daa33', '#e2609d', '#e98a22', '#8c6be6', '#d9ad00', '#1f9e9a', '#c9483f'];
export const CARD_COLOURS = [
  { hex: '', name: 'As it was' }, { hex: '#ffffff', name: 'White' }, { hex: '#fef3e2', name: 'Peach' }, { hex: '#fde8e8', name: 'Rose' },
  { hex: '#e8f4e8', name: 'Mint' }, { hex: '#e3edf8', name: 'Sky' }, { hex: '#f0e8f5', name: 'Lavender' }, { hex: '#fde68a', name: 'Sunflower' },
  { hex: '#bbe5c8', name: 'Fern' }, { hex: '#bfd7f5', name: 'Cornflower' }, { hex: '#f7c3b8', name: 'Coral' }
];

/* ---------------- sizes, before the cards are on the page ---------------- */
let ctx2d = null;
const mctx = () => ctx2d || (ctx2d = document.createElement('canvas').getContext('2d'));
// (as the page sets them: see .mcard in app.css)
const UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const fontOf = (card) =>
  card.kind === 'root' ? "600 19px 'TN Literata', Georgia, serif" : card.kind === 'heading' ? `650 15px ${UI}` : card.kind === 'code' ? '12.5px ui-monospace, Menlo, Consolas, monospace' : card.kind === 'more' ? `italic 14px ${UI}` : `14px ${UI}`;
const lineH = (card) => (card.kind === 'root' ? 25 : 20);
/** a card's words, without Markdown's marks (@Millie as Millie) */
export function plainText(t) {
  return String(t || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (m, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(^|[\s(])@([\p{L}][\p{L}\p{N}_'’.-]*)/gu, (m, s, n) => s + (cleanName(n) ? displayName(cleanName(n)) + n.slice(cleanName(n).length) : '@' + n));
}
function wrap(text, font, max) {
  const c = mctx();
  c.font = font;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? line + ' ' + word : word;
      if (c.measureText(next).width <= max || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}
const clip = (t, n = 320) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t);
/** how big a card will be: {w, h} */
export function estimate(card) {
  const max = card.kind === 'root' ? ROOT_MAX : CARD_MAX;
  const font = fontOf(card);
  const lines = wrap(clip(plainText(card.text)), font, max - (card.task && card.task.checkable ? 22 : 0));
  const c = mctx();
  c.font = font;
  const w = Math.max(...lines.map((l) => c.measureText(l).width), 40) + (card.task && card.task.checkable ? 22 : 0);
  let hgt = lines.length * lineH(card) + PAD_Y * 2;
  if (card.caption) hgt += 18;
  return { w: Math.ceil(Math.min(max, w) + PAD_X * 2 + 3), h: Math.ceil(hgt + 3) };
}

/* ---------------- the canvas ---------------- */
export class MapCanvas {
  /** o: {key (where the layout is kept), cards: [{key, kind, text, line, task, listColour, branch, caption, hide}],
      links: [[from, to]], layout(sizeOf) → Map key → {x, y} (where the cards go, unless moved: sizeOf(card) → {w, h}),
      onOpen(card), onToggle(card), empty, fileName} */
  constructor(o) {
    this.o = o;
    this.view = { panX: 0, panY: 0, zoom: 1 };
    this.saved = { cards: {}, links: [], hidden: [] };
    this.mtime = null; // (the layout file's, when it was last read or written here)
    this.mine = { cards: new Set(), links: false, hidden: false, all: false }; // (what was changed here since)
    this.sel = new Set();
    this.selLink = null;
    this.els = new Map();
    this.sizes = new Map();
    this.auto = new Map(); // (where each card goes unless it has been moved)
    this.pointers = new Map();
    this.g = null;
    this.path = o.key ? mapFile(o.key) : null; // (no key: a map that isn't kept, of a note not saved yet)
    this.saveSoon = debounce(() => this.save(), 700);
    this.viewSoon = debounce(() => this.keepView(), 400);
    this.build();
  }

  build() {
    this.world = h('div.mworld');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'mlinks');
    this.cardsLayer = h('div.mcards');
    this.temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.temp.setAttribute('class', 'mtemp');
    this.svg.append(this.temp);
    this.world.append(this.svg, this.cardsLayer);
    this.marquee = h('div.mmarquee', { hidden: true });
    this.live = h('div.sr-only', { 'aria-live': 'polite' });
    this.area = h('div.marea', { tabindex: '0', 'aria-label': 'Mind map. Arrow keys choose a card, Enter opens it, Space ticks it off, Delete takes it off the map; or drag the cards to arrange them' }, this.world, this.marquee, this.live);
    this.zoomLabel = h('span.mzoom', '100%');
    this.colourBtn = btn('Colour', 'highlighter', () => this.colourMenu(), 'btn small', { disabled: true });
    this.hiddenBtn = btn('Show', 'eye', () => this.showHidden(), 'btn small', { hidden: true });
    const exportBtn = btn('Export', 'download', () => menu(exportBtn, [{ label: 'Picture (PNG)', icon: 'image', onClick: () => this.exportPNG() }, { label: 'Drawing (SVG)', icon: 'download', onClick: () => this.exportSVG() }], { align: 'right' }), 'btn small');
    this.bar = h(
      'div.mbar',
      iconBtn('scan', 'Fit it all in (F)', () => this.fit()),
      iconBtn('zoom-out', 'Zoom out (−)', () => this.zoomBy(1 / 1.25)),
      this.zoomLabel,
      iconBtn('zoom-in', 'Zoom in (+)', () => this.zoomBy(1.25)),
      h('span.msep'),
      this.colourBtn,
      this.hiddenBtn,
      btn('Arrange again', 'refresh-cw', () => this.rearrange(), 'btn small'),
      exportBtn
    );
    this.hint = h('div.mhint', 'Drag cards to arrange them; double-click one to open it. Drag from the dot on a card to join it to another. Arrow keys choose a card; Delete takes it off the map (not out of the note).');
    this.el = h('section.mapview', this.bar, this.area, this.hint);
    const a = this.area;
    a.addEventListener('pointerdown', (e) => this.down(e));
    a.addEventListener('pointermove', (e) => this.move(e));
    a.addEventListener('pointerup', (e) => this.up(e));
    a.addEventListener('pointercancel', (e) => this.cancel(e));
    a.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    a.addEventListener('keydown', (e) => this.key(e));
    // (a card that changes size — when the note's typeface arrives, say — and those round it make room)
    this.relayoutSoon = debounce(() => this.place(), 60);
    this.ro = new ResizeObserver((entries) => {
      let changed = false, much = false;
      for (const en of entries) {
        const k = en.target.dataset.key;
        const r = { w: en.target.offsetWidth, h: en.target.offsetHeight };
        if (!r.w) continue;
        const s = this.sizes.get(k);
        if (!s || s.w !== r.w || s.h !== r.h) {
          if (!s || Math.abs(s.w - r.w) > 3 || Math.abs(s.h - r.h) > 3) much = true;
          this.sizes.set(k, r);
          changed = true;
        }
      }
      if (much) this.relayoutSoon();
      else if (changed) this.drawLinks();
    });
  }

  /* ---------------- the layout kept in the folder ---------------- */
  /** (call once the map is on the page) */
  async mount() {
    try {
      if (this.path && (await fsx.exists(this.path))) {
        const { raw, mtime } = await fsx.read(this.path);
        this.mtime = mtime;
        this.saved = readLayout(raw);
      }
    } catch (e) {
      /* (no layout yet, or one that can't be read: start again) */
    }
    if (this.dead) return;
    this.render();
    // (where you were looking is kept on this computer only: screens differ)
    let v = null;
    try {
      if (this.o.key) v = JSON.parse(localStorage.getItem(this.viewKey()) || 'null');
    } catch (e) {
      /* (none) */
    }
    if (v && v.zoom > 0) {
      this.view = { panX: +v.panX || 0, panY: +v.panY || 0, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +v.zoom)) };
      this.applyView();
    } else requestAnimationFrame(() => this.fit());
    this.area.focus({ preventScroll: true });
  }
  viewKey() {
    return 'timnote.mapview.' + this.o.key;
  }
  keepView() {
    if (!this.o.key) return;
    try {
      localStorage.setItem(this.viewKey(), JSON.stringify(this.view));
    } catch (e) {
      /* (private browsing) */
    }
  }
  layout() {
    return { app: 'TimNote', kind: 'map', version: 1, cards: this.saved.cards, links: this.saved.links, hidden: this.saved.hidden };
  }
  /** the map of a note that has moved: its layout has moved with it */
  rekey(key) {
    this.o.key = key;
    this.path = key ? mapFile(key) : null;
  }
  /** the layout saved to the folder. If it was changed on another computer meanwhile, theirs is kept, with what was
      changed here on top */
  async save() {
    if ((this.dead && !this.flushing) || !this.path) return;
    const path = this.path;
    try {
      await fsx.exclusive(path, async () => {
        for (let tries = 0; ; tries++) {
          const st = await fsx.stat(path);
          if (st && st.mtime !== this.mtime) {
            const { raw } = await fsx.read(path);
            try {
              this.merge(readLayout(raw));
            } catch (e) {
              /* (theirs can't be read: this one takes its place) */
            }
          }
          const text = JSON.stringify(this.layout(), null, 1) + '\n';
          try {
            const r = await fsx.write(path, text, { create: true, expect: st ? st.mtime : null });
            this.mtime = r.mtime;
            this.mine = { cards: new Set(), links: false, hidden: false, all: false };
            return;
          } catch (e) {
            if (e.name !== 'ConflictError' || tries > 2) throw e;
          }
        }
      });
    } catch (e) {
      toast('The map’s layout couldn’t be saved: ' + e.message, 'warn', 6000);
    }
  }
  merge(theirs) {
    const m = this.mine;
    let cards = theirs.cards;
    if (m.all) cards = this.saved.cards;
    else {
      cards = Object.assign({}, theirs.cards);
      for (const k of m.cards) {
        if (this.saved.cards[k]) cards[k] = this.saved.cards[k];
        else delete cards[k];
      }
    }
    this.saved = { cards, links: m.links ? this.saved.links : theirs.links, hidden: m.hidden ? this.saved.hidden : theirs.hidden };
    if (!this.dead) this.render();
  }

  /** new cards (the note or the lists changed), keeping where everything is */
  setItems(o) {
    Object.assign(this.o, o);
    this.render();
  }

  /* ---------------- drawing ---------------- */
  posOf(key) {
    const s = this.saved.cards[key];
    if (s && s.x != null) return { x: s.x, y: s.y };
    return this.auto.get(key) || { x: 0, y: 0 };
  }
  cards() {
    const hidden = new Set(this.saved.hidden || []);
    return (this.o.cards || []).filter((c) => !hidden.has(c.key));
  }
  render() {
    const keep = new Set();
    for (const c of this.cards()) {
      keep.add(c.key);
      let el = this.els.get(c.key);
      if (!el) {
        el = h('div.mcard', { dataset: { key: c.key } });
        this.cardsLayer.append(el);
        this.els.set(c.key, el);
        this.ro.observe(el);
      }
      this.fill(el, c);
    }
    for (const [k, el] of this.els) {
      if (!keep.has(k)) {
        this.ro.unobserve(el);
        el.remove();
        this.els.delete(k);
        this.sel.delete(k);
      }
    }
    // each card's size as it is on the page (or, if it can't be seen yet, as it will be), then where they go
    for (const c of this.cards()) {
      const el = this.els.get(c.key);
      const w = el.offsetWidth;
      this.sizes.set(c.key, w ? { w, h: el.offsetHeight } : estimate(c));
    }
    this.place(false);
    const nh = (this.saved.hidden || []).filter((k) => (this.o.cards || []).some((c) => c.key === k)).length;
    this.hiddenBtn.hidden = !nh;
    this.hiddenBtn.querySelector('span').textContent = `Show ${nh} taken off`;
    this.drawLinks();
    this.selUI();
    if (!(this.o.cards || []).length && this.o.empty) {
      if (!this.emptyEl) this.area.append((this.emptyEl = h('div.mempty', this.o.empty)));
    } else if (this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }
  }
  /** where the cards go (those not moved by hand), from their sizes */
  place(links = true) {
    if (this.dead) return;
    const size = (n) => this.sizes.get(n.key) || estimate(n);
    this.auto = this.o.layout ? this.o.layout(size) : this.o.positions || new Map();
    for (const [k, el] of this.els) {
      const p = this.posOf(k);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }
    if (links) this.drawLinks();
  }
  fill(el, c) {
    const t = c.task;
    const cls = ['mcard', 'k-' + c.kind];
    // (an item on a list: its list's colour at its edge; a list: in its colour)
    if (t) cls.push('task', 'hl-' + (t.done ? 'done' : c.listColour || 'yellow'));
    if (t && t.checkable) cls.push('checkable');
    else if (c.listColour) cls.push('list', 'hl-' + c.listColour);
    if (t && t.done) cls.push('done');
    if (this.sel.has(c.key)) cls.push('selected');
    el.className = cls.join(' ');
    const saved = (this.saved.cards[c.key] || {}).color;
    const colour = /^#[0-9a-f]{3,8}$/i.test(saved || '') ? saved : ''; // (a colour, and nothing else, from the file)
    el.style.background = colour;
    el.classList.toggle('coloured', !!colour);
    el.style.setProperty('--branch', branchColour(c));
    el.title = c.kind === 'root' ? '' : plainText(c.text).slice(0, 600);
    const kids = [];
    if (t && t.checkable) kids.push(h('span.mbox' + (t.done ? '.on' : ''), { role: 'checkbox', 'aria-checked': String(!!t.done), title: t.done ? 'Done: click to undo' : 'Tick off', html: t.done ? icon('check') : '' }));
    kids.push(h('div.mtext', c.kind === 'root' ? c.text : inline(clip(c.text), { hide: c.hide })));
    if (c.caption) kids.push(h('div.mcap', c.caption));
    for (const side of ['t', 'r', 'b', 'l']) kids.push(h('i.mh', { dataset: { side }, title: 'Drag to another card to join them' }));
    el.replaceChildren(...kids);
  }
  boxOf(key) {
    const c = this.els.get(key);
    if (!c) return null;
    const p = this.posOf(key);
    const s = this.sizes.get(key) || { w: 120, h: 40 };
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  }
  drawLinks() {
    for (const p of Array.from(this.svg.querySelectorAll('.mlink'))) p.remove();
    const frag = document.createDocumentFragment();
    const mk = (cls, d, colour) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', cls);
      p.setAttribute('d', d);
      if (colour) p.style.stroke = colour;
      return p;
    };
    // the note's own: from each card to the one it is under
    const byKey = new Map((this.o.cards || []).map((c) => [c.key, c]));
    for (const [a, b] of this.o.links || []) {
      const A = this.boxOf(a), B = this.boxOf(b);
      if (!A || !B) continue;
      const right = B.x + B.w / 2 >= A.x + A.w / 2;
      const s = { x: right ? A.x + A.w : A.x, y: A.y + A.h / 2 };
      const e = { x: right ? B.x : B.x + B.w, y: B.y + B.h / 2 };
      const k = Math.max(30, Math.abs(e.x - s.x) / 2);
      const d = `M${f1(s.x)} ${f1(s.y)}C${f1(s.x + (right ? k : -k))} ${f1(s.y)} ${f1(e.x - (right ? k : -k))} ${f1(e.y)} ${f1(e.x)} ${f1(e.y)}`;
      const child = byKey.get(b);
      frag.append(mk('mlink auto', d, child ? branchColour(child) : null));
    }
    // the ones drawn here
    (this.saved.links || []).forEach((l, i) => {
      const A = this.boxOf(l.from), B = this.boxOf(l.to);
      if (!A || !B) return;
      const ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
      const dx = cb.x - ca.x, dy = cb.y - ca.y;
      const ta = exitAt(A, dx, dy, 6), tb = exitAt(B, -dx, -dy, 9);
      if (ta + tb >= 1) return;
      const s = { x: ca.x + dx * ta, y: ca.y + dy * ta }, e = { x: cb.x - dx * tb, y: cb.y - dy * tb };
      const d = `M${f1(s.x)} ${f1(s.y)}L${f1(e.x)} ${f1(e.y)}`;
      const hit = mk('mlink hit', d);
      hit.dataset.i = String(i);
      const line = mk('mlink user' + (this.selLink === i ? ' selected' : ''), d);
      const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const head = mk('mlink head' + (this.selLink === i ? ' selected' : ''), `M${f1(e.x + ux * 3)} ${f1(e.y + uy * 3)}L${f1(e.x - ux * 9 - uy * 5)} ${f1(e.y - uy * 9 + ux * 5)}L${f1(e.x - ux * 9 + uy * 5)} ${f1(e.y - uy * 9 - ux * 5)}Z`);
      frag.append(line, head, hit);
    });
    this.svg.insertBefore(frag, this.temp);
  }

  /* ---------------- the view ---------------- */
  applyView() {
    const v = this.view;
    this.world.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
    this.zoomLabel.textContent = Math.round(v.zoom * 100) + '%';
    this.area.style.backgroundSize = `${24 * v.zoom}px ${24 * v.zoom}px`;
    this.area.style.backgroundPosition = `${v.panX}px ${v.panY}px`;
  }
  toWorld(cx, cy) {
    const r = this.area.getBoundingClientRect(), v = this.view;
    return { x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom };
  }
  zoomAt(z, sx, sy) {
    const v = this.view;
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const wx = (sx - v.panX) / v.zoom, wy = (sy - v.panY) / v.zoom;
    v.zoom = z;
    v.panX = sx - wx * z;
    v.panY = sy - wy * z;
    this.applyView();
    this.viewSoon();
  }
  zoomBy(f) {
    const r = this.area.getBoundingClientRect();
    this.zoomAt(this.view.zoom * f, r.width / 2, r.height / 2);
  }
  bounds() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const grow = (b) => {
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
    };
    for (const c of this.cards()) {
      const b = this.boxOf(c.key);
      if (b) grow(b);
    }
    return x1 === Infinity ? null : { x1, y1, x2, y2 };
  }
  fit() {
    const b = this.bounds();
    const r = this.area.getBoundingClientRect();
    if (!b || !r.width) return;
    const pad = 50;
    const z = Math.max(MIN_ZOOM, Math.min(1.2, Math.min(r.width / (b.x2 - b.x1 + pad * 2), r.height / (b.y2 - b.y1 + pad * 2))));
    this.view = { zoom: z, panX: (r.width - (b.x2 - b.x1) * z) / 2 - b.x1 * z, panY: (r.height - (b.y2 - b.y1) * z) / 2 - b.y1 * z };
    this.applyView();
    this.viewSoon();
  }
  wheel(e) {
    e.preventDefault();
    const r = this.area.getBoundingClientRect();
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (e.ctrlKey) return this.zoomAt(this.view.zoom * Math.exp(-dy * 0.01), sx, sy);
    if (e.shiftKey || Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.view.panX -= e.shiftKey && !dx ? dy : dx;
      this.applyView();
      return this.viewSoon();
    }
    this.zoomAt(this.view.zoom * Math.exp(-dy * 0.0012), sx, sy);
  }

  /* ---------------- choosing ---------------- */
  selUI() {
    for (const [k, el] of this.els) el.classList.toggle('selected', this.sel.has(k));
    this.colourBtn.disabled = !this.sel.size;
  }
  select(keys, add = false) {
    if (!add) this.sel.clear();
    for (const k of keys) this.sel.add(k);
    this.selLink = null;
    this.selUI();
    this.drawLinks();
  }
  colourMenu() {
    if (!this.sel.size) return;
    menu(this.colourBtn, CARD_COLOURS.map((c) => ({
      label: c.name,
      icon: c.hex ? null : 'refresh-cw',
      onClick: () => {
        for (const k of this.sel) {
          this.mine.cards.add(k);
          const s = (this.saved.cards[k] = Object.assign({}, this.saved.cards[k] || {}));
          if (c.hex) s.color = c.hex;
          else delete s.color;
          if (!Object.keys(s).length) delete this.saved.cards[k];
        }
        this.render();
        this.saveSoon();
      }
    })));
    // (a swatch of each colour beside its name)
    const items = document.querySelectorAll('.menu .menu-item');
    CARD_COLOURS.forEach((c, i) => {
      const it = items[i];
      if (it && c.hex) it.querySelector('.ic-space').replaceWith(h('span.msw', { style: { background: c.hex } }));
    });
  }
  hideSelected() {
    if (!this.sel.size) return;
    const n = this.sel.size;
    const before = { hidden: (this.saved.hidden || []).slice(), links: (this.saved.links || []).slice() };
    this.saved.hidden = Array.from(new Set((this.saved.hidden || []).concat(Array.from(this.sel))));
    this.saved.links = (this.saved.links || []).filter((l) => !this.sel.has(l.from) && !this.sel.has(l.to));
    this.mine.hidden = this.mine.links = true;
    this.sel.clear();
    this.render();
    this.saveSoon();
    // (Undo puts back just those cards, and the lines drawn to them)
    toast(`${n === 1 ? 'The card is' : n + ' cards are'} off the map (the note isn’t changed).`, '', 5000, {
      label: 'Undo',
      run: () => {
        if (this.dead) return;
        this.saved.hidden = before.hidden;
        this.saved.links = before.links;
        this.mine.hidden = this.mine.links = true;
        this.render();
        this.saveSoon();
      }
    });
  }
  showHidden() {
    this.saved.hidden = [];
    this.mine.hidden = true;
    this.render();
    this.saveSoon();
  }
  rearrange() {
    this.mine.all = true;
    this.saved.cards = Object.fromEntries(Object.entries(this.saved.cards).filter(([, v]) => v && v.color).map(([k, v]) => [k, { color: v.color }]));
    this.render();
    this.fit();
    this.saveSoon();
  }
  /** the keyboard: the arrows choose the card that way (the one in the middle first) */
  moveSel(key) {
    const cards = this.cards();
    if (!cards.length) return;
    const last = this.sel.size ? Array.from(this.sel)[this.sel.size - 1] : null;
    const cur = last && this.boxOf(last);
    let pick = null;
    if (!cur) pick = cards.find((c) => c.kind === 'root') || cards[0];
    else {
      const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
      const [dx, dy] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
      let best = Infinity;
      for (const c of cards) {
        const b = this.boxOf(c.key);
        if (!b || c.key === last) continue;
        const vx = b.x + b.w / 2 - cx, vy = b.y + b.h / 2 - cy;
        const along = vx * dx + vy * dy;
        if (along <= 4) continue;
        const score = along + Math.abs(vx * dy - vy * dx) * 2;
        if (score < best) {
          best = score;
          pick = c;
        }
      }
    }
    if (!pick) return;
    this.select([pick.key]);
    this.reveal(pick.key);
    this.say(plainText(pick.text).slice(0, 200) + (pick.task ? (pick.task.done ? ', done' : pick.task.checkable ? ', not done: Space ticks it off' : '') : ''));
  }
  /** a card brought into view, if it is off the edge */
  reveal(key) {
    const b = this.boxOf(key);
    if (!b) return;
    const r = this.area.getBoundingClientRect(), v = this.view, m = 30;
    const sx = b.x * v.zoom + v.panX, sy = b.y * v.zoom + v.panY, sw = b.w * v.zoom, sh = b.h * v.zoom;
    let px = v.panX, py = v.panY;
    if (sx < m) px += m - sx;
    else if (sx + sw > r.width - m) px -= sx + sw - (r.width - m);
    if (sy < m) py += m - sy;
    else if (sy + sh > r.height - m) py -= sy + sh - (r.height - m);
    if (px !== v.panX || py !== v.panY) {
      v.panX = px;
      v.panY = py;
      this.applyView();
      this.viewSoon();
    }
  }
  /** (for screen readers: the card chosen with the keyboard) */
  say(text) {
    this.live.textContent = text;
  }
  open(key) {
    const c = (this.o.cards || []).find((x) => x.key === key);
    if (c && this.o.onOpen) this.o.onOpen(c);
  }

  /* ---------------- the pointer ---------------- */
  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [p, q] = Array.from(this.pointers.values());
      this.g = { type: 'pinch', d: Math.hypot(q.x - p.x, q.y - p.y) || 1, zoom: this.view.zoom, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, panX: this.view.panX, panY: this.view.panY };
      return;
    }
    if (this.pointers.size > 2) return;
    this.area.focus({ preventScroll: true });
    try {
      this.area.setPointerCapture(e.pointerId);
    } catch (err) {
      /* (not every browser) */
    }
    const t = e.target;
    const base = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, add: e.shiftKey || e.metaKey || e.ctrlKey, kind: e.pointerType };
    if (e.button === 1) return (this.g = Object.assign(base, { type: 'pan', panX: this.view.panX, panY: this.view.panY }));
    const box = t.closest('.mbox');
    if (box) return (this.g = Object.assign(base, { type: 'box', key: box.closest('.mcard').dataset.key }));
    const hnd = t.closest('.mh');
    if (hnd) return (this.g = Object.assign(base, { type: 'connect', from: hnd.parentElement.dataset.key, target: null }));
    const hit = t.closest('.mlink.hit');
    if (hit) {
      this.selLink = +hit.dataset.i;
      this.sel.clear();
      this.selUI();
      this.drawLinks();
      return (this.g = Object.assign(base, { type: 'none' }));
    }
    const card = t.closest('.mcard');
    if (card) {
      const key = card.dataset.key;
      if (base.add) {
        if (this.sel.has(key)) this.sel.delete(key);
        else this.sel.add(key);
        this.selLink = null;
        this.selUI();
      } else if (!this.sel.has(key)) this.select([key]);
      return (this.g = Object.assign(base, { type: 'press-card', key }));
    }
    if (base.add) return (this.g = Object.assign(base, { type: 'marquee', start: new Set(this.sel) }));
    this.g = Object.assign(base, { type: 'pan', panX: this.view.panX, panY: this.view.panY });
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = Array.from(this.pointers.values());
      const r = this.area.getBoundingClientRect();
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (g.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / g.d));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const wx = (g.mid.x - r.left - g.panX) / g.zoom, wy = (g.mid.y - r.top - g.panY) / g.zoom;
      this.view = { zoom: z, panX: mid.x - r.left - wx * z, panY: mid.y - r.top - wy * z };
      this.applyView();
      return;
    }
    if (e.pointerId !== g.id) return;
    g.x = e.clientX;
    g.y = e.clientY;
    if (!g.moved) {
      if (Math.hypot(g.x - g.sx, g.y - g.sy) < (g.kind === 'touch' ? 8 : 4)) return;
      g.moved = true;
      this.begin(g);
    }
    e.preventDefault();
    if (!this.frame) this.frame = requestAnimationFrame(() => this.step());
  }
  begin(g) {
    if (g.type === 'press-card') {
      g.type = 'drag';
      const keys = this.sel.has(g.key) ? Array.from(this.sel) : [g.key];
      g.items = keys.map((k) => ({ key: k, p: Object.assign({}, this.posOf(k)) }));
      for (const it of g.items) {
        const el = this.els.get(it.key);
        if (el) el.classList.add('dragging');
      }
    } else if (g.type === 'pan') this.area.classList.add('panning');
    else if (g.type === 'marquee') this.marquee.hidden = false;
  }
  step() {
    this.frame = 0;
    const g = this.g;
    if (!g || !g.moved) return;
    const z = this.view.zoom, dx = (g.x - g.sx) / z, dy = (g.y - g.sy) / z;
    const setCard = (k, x, y) => {
      this.mine.cards.add(k);
      const s = (this.saved.cards[k] = Object.assign(this.saved.cards[k] || {}, { x: Math.round(x), y: Math.round(y) }));
      const el = this.els.get(k);
      if (el) {
        el.style.left = s.x + 'px';
        el.style.top = s.y + 'px';
      }
    };
    if (g.type === 'drag') {
      for (const it of g.items) setCard(it.key, it.p.x + dx, it.p.y + dy);
      this.drawLinks();
    } else if (g.type === 'pan') {
      this.view.panX = g.panX + (g.x - g.sx);
      this.view.panY = g.panY + (g.y - g.sy);
      this.applyView();
    } else if (g.type === 'marquee') {
      const r = this.area.getBoundingClientRect();
      const x1 = Math.min(g.sx, g.x), y1 = Math.min(g.sy, g.y), x2 = Math.max(g.sx, g.x), y2 = Math.max(g.sy, g.y);
      Object.assign(this.marquee.style, { left: x1 - r.left + 'px', top: y1 - r.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const a = this.toWorld(x1, y1), b = this.toWorld(x2, y2);
      this.sel = new Set(g.start);
      for (const c of this.cards()) {
        const cb = this.boxOf(c.key);
        if (cb && cb.x < b.x && cb.x + cb.w > a.x && cb.y < b.y && cb.y + cb.h > a.y) this.sel.add(c.key);
      }
      this.selUI();
    } else if (g.type === 'connect') {
      const A = this.boxOf(g.from);
      const el = document.elementFromPoint(g.x, g.y);
      const over = el && el.closest('.mcard');
      const target = over && over.dataset.key !== g.from ? over.dataset.key : null;
      if (target !== g.target) {
        if (g.target && this.els.get(g.target)) this.els.get(g.target).classList.remove('target');
        g.target = target;
        if (target) this.els.get(target).classList.add('target');
      }
      const p = this.toWorld(g.x, g.y);
      this.temp.setAttribute('d', `M${f1(A.x + A.w / 2)} ${f1(A.y + A.h / 2)}L${f1(p.x)} ${f1(p.y)}`);
    }
  }
  up(e) {
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') {
      if (this.pointers.size < 2) {
        this.g = null;
        this.viewSoon();
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.step();
    }
    this.g = null;
    this.area.classList.remove('panning');
    this.marquee.hidden = true;
    if (!g.moved) {
      if (g.type === 'pan' && !g.add) {
        this.sel.clear();
        this.selLink = null;
        this.selUI();
        this.drawLinks();
      } else if (g.type === 'box') {
        const c = (this.o.cards || []).find((x) => x.key === g.key);
        if (c && this.o.onToggle) this.o.onToggle(c);
      } else if (g.type === 'press-card') {
        if (!g.add) this.select([g.key]);
        // (a second click or tap on the same card, soon after: open it)
        const now = Date.now();
        if (this.lastTap && this.lastTap.key === g.key && now - this.lastTap.at < 450) {
          this.lastTap = null;
          this.open(g.key);
        } else this.lastTap = { key: g.key, at: now };
      } else if (g.type === 'connect') toast('Drag from the dot to another card to join them.', '', 3000);
      return;
    }
    if (g.type === 'drag') for (const it of g.items) this.els.get(it.key) && this.els.get(it.key).classList.remove('dragging');
    if (g.type === 'connect') {
      this.temp.setAttribute('d', '');
      if (g.target) {
        this.els.get(g.target) && this.els.get(g.target).classList.remove('target');
        const dup = (this.saved.links || []).some((l) => (l.from === g.from && l.to === g.target) || (l.from === g.target && l.to === g.from));
        if (!dup) {
          this.saved.links = (this.saved.links || []).concat([{ from: g.from, to: g.target }]);
          this.mine.links = true;
          this.drawLinks();
        }
      }
    }
    if (g.type === 'pan') this.viewSoon();
    else if (g.type === 'drag' || g.type === 'connect') this.saveSoon();
  }
  cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.g && (this.g.type === 'pinch' || e.pointerId === this.g.id)) {
      this.g = null;
      this.temp.setAttribute('d', '');
      this.marquee.hidden = true;
    }
  }
  key(e) {
    if (e.target !== this.area) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (this.selLink != null) {
        this.saved.links.splice(this.selLink, 1);
        this.mine.links = true;
        this.selLink = null;
        this.drawLinks();
        this.saveSoon();
      } else this.hideSelected();
    } else if (e.key === 'f' || e.key === 'F') this.fit();
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.25);
    else if (e.key === 'Escape') this.select([]);
    else if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && !mod) {
      e.preventDefault();
      this.moveSel(e.key);
    } else if (e.key === ' ' && this.sel.size === 1) {
      e.preventDefault();
      const c = (this.o.cards || []).find((x) => x.key === Array.from(this.sel)[0]);
      if (c && c.task && c.task.checkable && this.o.onToggle) this.o.onToggle(c);
    }
    else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.select(this.cards().map((c) => c.key));
    } else if (e.key === 'Enter' && this.sel.size === 1) this.open(Array.from(this.sel)[0]);
  }

  /* ---------------- pictures of it ---------------- */
  svgText() {
    const b = this.bounds();
    if (!b) return null;
    const pad = 40, W = b.x2 - b.x1 + pad * 2, H = b.y2 - b.y1 + pad * 2;
    const ox = pad - b.x1, oy = pad - b.y1;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${f1(W)}" height="${f1(H)}" viewBox="0 0 ${f1(W)} ${f1(H)}"><rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${f1(ox)} ${f1(oy)})">`;
    for (const p of this.svg.querySelectorAll('.mlink:not(.hit)')) {
      const head = p.classList.contains('head');
      const stroke = getComputedStyle(p).stroke || '#1d2a3a';
      out += `<path d="${p.getAttribute('d')}" fill="${head ? stroke : 'none'}" stroke="${stroke}" stroke-width="${p.classList.contains('auto') ? 2 : 1.6}" stroke-linecap="round"/>`;
    }
    for (const c of this.cards()) {
      const cb = this.boxOf(c.key);
      if (!cb) continue;
      const el = this.els.get(c.key);
      const cs = getComputedStyle(el);
      const font = fontOf(c);
      const lines = wrap(clip(plainText(c.text)), font, (c.kind === 'root' ? ROOT_MAX : CARD_MAX) - (c.task && c.task.checkable ? 22 : 0));
      out += `<rect x="${f1(cb.x)}" y="${f1(cb.y)}" width="${f1(cb.w)}" height="${f1(cb.h)}" rx="10" fill="${cs.backgroundColor}" stroke="${cs.borderTopColor}" stroke-width="1.5"/>`;
      if (c.task) out += `<rect x="${f1(cb.x + 0.75)}" y="${f1(cb.y + 6)}" width="4" height="${f1(cb.h - 12)}" rx="2" fill="${cs.getPropertyValue('--flag').trim() || '#f2c200'}"/>`;
      const tx = cb.x + PAD_X + (c.task && c.task.checkable ? 22 : 0);
      const family = c.kind === 'root' ? 'Georgia, serif' : c.kind === 'code' ? 'Menlo, Consolas, monospace' : 'system-ui, sans-serif';
      const size = c.kind === 'root' ? 19 : c.kind === 'heading' ? 15 : c.kind === 'code' ? 12.5 : 14;
      const root = c.kind === 'root';
      const x = root ? cb.x + cb.w / 2 : tx; // (the middle card's words are centred)
      lines.forEach((l, i) => {
        out += `<text x="${f1(x)}" y="${f1(cb.y + PAD_Y + 2 + (i + 0.78) * lineH(c))}" font-family="${family}" font-size="${size}" font-weight="${root || c.kind === 'heading' ? 600 : 400}" fill="${cs.color}"${c.task && c.task.done ? ' text-decoration="line-through"' : ''}${root ? ' text-anchor="middle"' : ''}>${esc(l)}</text>`;
      });
      if (c.caption) out += `<text x="${f1(tx)}" y="${f1(cb.y + PAD_Y + 2 + lines.length * lineH(c) + 13)}" font-family="system-ui, sans-serif" font-size="11.5" fill="#677385">${esc(c.caption)}</text>`;
    }
    return { svg: out + '</g></svg>', W, H };
  }
  exportSVG() {
    const s = this.svgText();
    if (s) download(`${this.o.fileName || 'Mind map'}.svg`, s.svg, 'image/svg+xml');
  }
  exportPNG() {
    const s = this.svgText();
    if (!s) return;
    const scale = Math.min(2, 8000 / Math.max(s.W, s.H));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(s.W * scale);
      c.height = Math.round(s.H * scale);
      const x = c.getContext('2d');
      x.scale(scale, scale);
      x.drawImage(img, 0, 0);
      c.toBlob((b) => b && download(`${this.o.fileName || 'Mind map'}.png`, b));
    };
    img.onerror = () => toast('The picture couldn’t be made.', 'bad');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.svg);
  }
  destroy() {
    this.dead = true;
    this.relayoutSoon.cancel();
    if (this.saveSoon.pending()) {
      this.flushing = true;
      this.saveSoon.flush();
    }
    this.viewSoon.flush();
    this.ro.disconnect();
  }
}

/** where a map's layout is kept: key 'note:<path>' or 'lists' */
/** (the characters a file's name can't have, written as %xx, so that every map has a file of its own) */
export const mapFile = (key) => '.timnote/maps/' + String(key).replace(/[%\\/:*?"<>|\x00-\x1f]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) + '.json';
function readLayout(raw) {
  const j = JSON.parse(raw);
  if (!j || typeof j !== 'object') return { cards: {}, links: [], hidden: [] };
  return { cards: obj(j.cards), links: Array.isArray(j.links) ? j.links.filter((l) => l && typeof l.from === 'string' && typeof l.to === 'string') : [], hidden: Array.isArray(j.hidden) ? j.hidden.filter((k) => typeof k === 'string') : [] };
}

const f1 = (n) => Math.round(n * 10) / 10;
const branchColour = (c) => c.edge || (c.branch != null ? BRANCH[c.branch % BRANCH.length] : 'var(--rule-2)');
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
function exitAt(b, dx, dy, pad) {
  const tx = dx ? (b.w / 2 + pad) / Math.abs(dx) : Infinity;
  const ty = dy ? (b.h / 2 + pad) / Math.abs(dy) : Infinity;
  return Math.min(tx, ty);
}

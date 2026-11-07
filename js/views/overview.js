/* =====================================================================
   The lists, side by side: each list a card showing what is on it, to
   take in at a glance and swipe across. It is the page TimNote opens on.
   Or all of them as a mind map. Tick things off here, add to a list,
   drag an item onto another list to move it there, or onto a board in
   the sidebar.
   ===================================================================== */
import { h, iconEl, iconBtn, toast, debounce, plural } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { on } from '../bus.js';
import { todayIso, addDays, relDay } from '../dates.js';
import { app } from '../app.js';
import { itemRow, byWhen, moveItem, findItem, tickItem } from './items.js';
import { dropTarget } from '../drag.js';
import { MapCanvas } from '../canvas.js';
import { itemsTree, treeLayout } from '../mapdata.js';

const SHOW = 60; // (the most items on a card: the rest are on the list's own page)
const SOON = ':soon';

/** what is on the lists now: [{list, items (not done, in order), done (how many are)}], and what is due soon */
export function listsNow() {
  const t = todayIso();
  const week = addDays(t, 7);
  const lists = [];
  const soon = [];
  for (const l of S.shared.lists) {
    const all = lib.items(l.id);
    const open = all.filter((it) => !it.task.done);
    lists.push({ list: l, items: l.done ? byWhen(open) : open, done: all.length - open.length });
    for (const it of open) if (it.task.due && it.task.due <= week) soon.push(it);
  }
  return { lists, soon: byWhen(soon) };
}

export class OverviewView {
  constructor() {
    this.kind = 'lists';
    this.pending = new Map();
    this.tiles = new Map(); // id → {el, ul, count, foot, list}
    this.el = h('section.overview');
    this.build();
    this.offs = [on('notes', debounce(() => this.refresh(), 100)), on('settings', debounce(() => this.refresh(true), 60))];
  }
  hash() {
    return '#/lists';
  }
  get mode() {
    return S.device.overview === 'map' ? 'map' : 'tiles';
  }

  build() {
    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    this.sub = h('p.page-sub');
    this.tilesTab = h('button.seg', { type: 'button', onclick: () => this.setMode('tiles') }, iconEl('layout-grid'), h('span', 'Cards'));
    this.mapTab = h('button.seg', { type: 'button', onclick: () => this.setMode('map') }, iconEl('network'), h('span', 'Mind map'));
    this.prev = iconBtn('chevron-left', 'The lists before', () => this.step(-1), 'tile-nav');
    this.next = iconBtn('chevron-right', 'The next lists', () => this.step(1), 'tile-nav');
    this.head = h(
      'header.page-head',
      burger,
      h('div.page-title', h('h1', 'Lists'), this.sub),
      h('div.page-tools', this.prev, this.next, h('div.segs', { role: 'group', 'aria-label': 'Show the lists as' }, this.tilesTab, this.mapTab), iconBtn('settings', 'Change the lists and their words', () => app.settings('lists')))
    );
    this.row = h('div.tiles', { 'aria-label': 'Your lists' });
    this.row.addEventListener('scroll', debounce(() => this.navState(), 60));
    // (the wheel, over the gaps between the cards, moves along the row)
    this.row.addEventListener(
      'wheel',
      (e) => {
        if (e.target.closest('.tile-scroll') || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.ctrlKey) return;
        this.row.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false }
    );
    this.ro = new ResizeObserver(() => this.navState());
    this.ro.observe(this.row);
    this.mapHost = h('div.map-host');
    this.el.append(this.head, this.row, this.mapHost);
    this.show();
  }
  setMode(m) {
    S.device.overview = m;
    S.saveDevice();
    this.show();
  }
  show() {
    const m = this.mode;
    this.tilesTab.setAttribute('aria-pressed', String(m === 'tiles'));
    this.mapTab.setAttribute('aria-pressed', String(m === 'map'));
    this.row.hidden = m !== 'tiles';
    this.mapHost.hidden = m !== 'map';
    this.prev.hidden = this.next.hidden = m !== 'tiles';
    this.refresh();
  }
  refresh(rebuild = false) {
    const now = listsNow();
    const open = now.lists.reduce((a, x) => a + (x.list.done ? x.items.length : 0), 0);
    const overdue = now.soon.filter((it) => it.task.due < todayIso()).length;
    this.sub.textContent = open ? `${plural(open, 'thing')} still to do${now.soon.length ? `, ${now.soon.length} due in the next week` : ''}${overdue ? ` (${overdue} overdue)` : ''}.` : 'Nothing left to do.';
    if (this.mode === 'map') this.renderMap(now);
    else this.renderTiles(now, rebuild);
  }

  /* ---------------- the cards ---------------- */
  renderTiles(now, rebuild) {
    const want = [];
    if (now.soon.length) want.push({ id: SOON, soon: true, items: now.soon });
    for (const x of now.lists) want.push({ id: x.list.id, list: x.list, items: x.items, done: x.done });
    const ids = new Set(want.map((w) => w.id));
    for (const [id, t] of this.tiles) {
      if (!ids.has(id) || (rebuild && id !== SOON)) {
        t.el.remove();
        this.tiles.delete(id);
      }
    }
    want.forEach((w, i) => {
      let t = this.tiles.get(w.id);
      if (!t) {
        t = this.makeTile(w);
        this.tiles.set(w.id, t);
      }
      this.fillTile(t, w);
      if (this.row.children[i] !== t.el) this.row.insertBefore(t.el, this.row.children[i] || null);
    });
    this.navState();
  }
  makeTile(w) {
    const el = h('section.tile' + (w.soon ? '.soon' : `.hl-${w.list.color || 'yellow'}`), { dataset: { list: w.id } });
    const title = w.soon
      ? h('h2.tile-title', iconEl('clock'), h('span', 'Coming up'))
      : h('h2.tile-title', h('a', { href: '#/list/' + encodeURIComponent(w.list.id), title: `Open ${w.list.name}: everything on it, by date, note or person` }, h(`mark.hl.hl-${w.list.color || 'yellow'}`, w.list.name)));
    const count = h('span.tile-count');
    const ul = h('ul.tile-items');
    const more = h('div.tile-more');
    const foot = h('footer.tile-foot');
    el.setAttribute('aria-label', w.soon ? 'Coming up' : w.list.name);
    el.append(h('header.tile-head', title, count), h('div.tile-scroll', ul, more), foot);
    const t = { el, ul, count, more, foot, list: w.list, soon: !!w.soon };
    if (w.soon) foot.append(h('span.hint', 'From all the lists, by date due.'));
    else {
      const input = h('input.tile-input', { type: 'text', placeholder: `Add to ${w.list.name}…`, 'aria-label': `Add to ${w.list.name}`, enterkeyhint: 'done' });
      const form = h('form.tile-add', h('span.tile-plus', { 'aria-hidden': 'true' }, iconEl('plus', 'small')), input);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.disabled = true;
        try {
          await lib.addItem(S.listById(w.list.id) || w.list, text);
          input.value = '';
          toast(`Added to ${w.list.name}, in today’s daily note.`, 'ok', 2500);
        } catch (err) {
          toast('It couldn’t be added: ' + err.message, 'bad', 8000);
        } finally {
          input.disabled = false;
          input.focus();
        }
      });
      t.form = form;
      t.doneLink = h('a.tile-done', { href: '#/list/' + encodeURIComponent(w.list.id), title: 'See what is done, on the list’s page', hidden: true });
      foot.append(form, t.doneLink);
      // an item dragged here from another list moves to this one
      dropTarget(el, {
        accept: (p) => p.kind === 'item' && p.list !== w.list.id,
        drop: (p) => {
          const it = findItem(p);
          if (!it) return toast('That item has changed since: open its note to move it.', 'warn');
          moveItem(it, w.list.id);
        }
      });
    }
    return t;
  }
  fillTile(t, w) {
    const rows = [];
    if (w.soon) {
      const today = todayIso();
      const groups = [['Overdue', (d) => d < today, 'overdue'], ['Today', (d) => d === today], ['Tomorrow', (d) => d === addDays(today, 1)], ['This week', (d) => d > addDays(today, 1)]];
      for (const [label, test, cls] of groups) {
        const its = w.items.filter((it) => test(it.task.due));
        if (!its.length) continue;
        rows.push(h('li.tile-sub' + (cls ? '.' + cls : ''), label));
        for (const it of its) rows.push(itemRow(it, { pending: this.pending, list: true }));
      }
      t.count.textContent = String(w.items.length);
      t.count.title = plural(w.items.length, 'item') + ' due in the next week, or overdue';
    } else {
      for (const it of w.items.slice(0, SHOW)) rows.push(itemRow(it, { pending: this.pending }));
      t.count.textContent = String(w.items.length);
      t.count.title = w.list.done ? plural(w.items.length, 'thing') + ' still to do' : plural(w.items.length, 'item');
      if (!w.items.length) {
        const word = ((w.list.triggers || [])[0] || 'TO DO:').trim();
        rows.push(h('li.tile-empty', h('p', w.list.done && w.done ? 'All done.' : 'Nothing here yet.'), h('p.hint', 'Write ', h(`mark.hl.hl-${w.list.color || 'yellow'}`, word), ' in any note, or add one below.')));
      }
    }
    t.ul.replaceChildren(...rows);
    t.more.replaceChildren();
    if (!w.soon && w.items.length > SHOW) t.more.append(h('a', { href: '#/list/' + encodeURIComponent(w.list.id) }, `and ${w.items.length - SHOW} more on ${w.list.name}`));
    // (the foot is left as it is, so that typing in its box isn't interrupted)
    if (t.doneLink) {
      t.doneLink.hidden = !w.done;
      t.doneLink.textContent = `${w.done} done`;
    }
  }
  step(dir) {
    const first = this.row.querySelector('.tile');
    const w = first ? first.getBoundingClientRect().width + 16 : 320;
    this.row.scrollBy({ left: dir * w, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  navState() {
    const r = this.row;
    const more = r.scrollWidth > r.clientWidth + 4;
    this.prev.disabled = !more || r.scrollLeft <= 2;
    this.next.disabled = !more || r.scrollLeft + r.clientWidth >= r.scrollWidth - 2;
    this.prev.classList.toggle('off', !more);
    this.next.classList.toggle('off', !more);
  }

  /* ---------------- the mind map ---------------- */
  renderMap(now) {
    const groups = now.lists.filter((x) => x.items.length).map((x) => ({ key: x.list.id, title: x.list.name, color: x.list.color || 'yellow', items: x.items }));
    const tree = itemsTree('Lists', groups, { max: 30 });
    const cards = tree.nodes.map((n) => {
      const colour = n.kind === 'heading' || n.kind === 'more' ? n.group.color : n.task ? (S.listById(n.task.list) || {}).color || 'yellow' : null;
      let caption = null;
      if (n.task) caption = (n.task.due ? relDay(n.task.due) + ', ' : '') + n.note.title;
      else if (n.kind === 'heading') caption = plural(n.group.items.length, 'item');
      return { key: n.key, kind: n.kind, text: n.text, line: n.task ? n.task.line : null, task: n.task, note: n.note, group: n.group, listColour: colour, edge: colour ? `var(--flag-${colour})` : null, caption, hide: n.task ? n.task.dueText : '' };
    });
    const items = { cards, links: tree.links, layout: (size) => treeLayout(tree.root, size) };
    if (this.map) return this.map.setItems(items);
    this.map = new MapCanvas(
      Object.assign(items, {
        key: 'lists',
        fileName: 'Lists',
        empty: 'Nothing on any list yet. Write “TO DO:” in a note, and it appears here.',
        onOpen: (c) => {
          if (c.note) app.openNote(c.note.path, c.line);
          else if (c.group) app.navigate('#/list/' + encodeURIComponent(c.group.key));
        },
        onToggle: (c) => c.note && c.task && tickItem({ task: c.task, note: c.note }, !c.task.done)
      })
    );
    this.mapHost.replaceChildren(this.map.el);
    this.map.mount();
  }

  destroy() {
    for (const off of this.offs) off();
    this.ro.disconnect();
    if (this.map) this.map.destroy();
  }
}

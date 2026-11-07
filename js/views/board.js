/* =====================================================================
   A board (kanban): columns of cards, kept as a Markdown file in the
   Boards folder, so it is the same on every computer. A card is a line
   of text, a note, or an item on one of the lists (in its note). Drag
   cards between columns; drag items and notes on from the tray beside
   the board (or onto the board's name in the sidebar, from anywhere).
   Clicking a note or an item opens it where it is.

   Every change is made to the file as it is at that moment, so a change
   made on another computer meanwhile is kept.
   ===================================================================== */
import { h, iconEl, iconBtn, btn, menu, toast, debounce, plural, confirmDialog, promptDialog } from '../util.js';
import * as lib from '../library.js';
import * as fsx from '../fsx.js';
import * as S from '../settings.js';
import { on } from '../bus.js';
import { fromIso, fmtDayMonth, fmtShort, DAYS, todayIso, relDay, daysBetween } from '../dates.js';
import { cardKind, noteCard, itemCard, noteRef, ops } from '../boards.js';
import { inline } from '../inline.js';
import { app } from '../app.js';
import { draggable, dropTarget, dragging, itemPayload, notePayload } from '../drag.js';
import { tickItem, byWhen } from './items.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** the note a card's [[link]] is to (by its file's name, or its title) */
export function noteByRef(ref) {
  const r = norm(ref);
  if (!r) return null;
  for (const n of lib.notes.values()) if (norm(n.name.replace(/\.[^.]+$/, '')) === r) return n;
  return lib.byTitle(ref);
}
/** the item a card is, in its note now: {task, note} or null. (If the note has the same words on two lines, the one
    still to do.) */
export function itemByCard(k) {
  const note = noteByRef(k.ref);
  if (!note) return null;
  let same = note.tasks.filter((x) => x.text === k.text);
  if (!same.length) same = note.tasks.filter((x) => norm(x.text) === norm(k.text));
  const t = same.find((x) => !x.done) || same[same.length - 1];
  return t ? { task: t, note } : null;
}
/** a card's text for something dragged on: a note, or an item */
export const cardFor = (p) => (p.kind === 'note' ? noteCard(noteRef(p.path)) : itemCard(p.text, noteRef(p.path)));
const onBoard = (b, text) => b.columns.some((c) => c.cards.some((x) => norm(x.text) === norm(text)));

/** something dragged onto a board's name: it goes at the end of the board's first column */
export async function addToBoard(entry, p) {
  const text = cardFor(p);
  let first = '', already = false;
  try {
    await lib.changeBoard(entry.path, (b) => {
      if (onBoard(b, text)) {
        already = true;
        return false;
      }
      if (!b.columns.length) b.columns.push({ title: 'To do', notes: [], cards: [] });
      first = b.columns[0].title;
      return ops.addCard(b, { column: first, text });
    });
    if (already) toast(`That is on ${entry.name} already.`, 'warn', 3000);
    else toast(`Added to ${entry.name}, in “${first}”.`, 'ok', 3500, { label: 'Open it', run: () => app.navigate(app.boardHash(entry)) });
  } catch (e) {
    toast('It couldn’t be added to the board: ' + e.message, 'bad', 8000);
  }
}
/** ask for a name, make the board, open it */
export async function newBoard() {
  const name = await promptDialog('A new board', 'What is it for?', '', 'Make the board', 'It starts with three columns: To do, Doing and Done. It is kept as a file in the Boards folder, so every computer has it.');
  if (name == null) return;
  const clean = name.trim();
  if (!clean) return;
  const same = lib.boards.find((b) => b.path.toLowerCase() === lib.boardPath(clean).toLowerCase());
  if (same) return app.navigate(app.boardHash(same));
  try {
    const b = await lib.createBoard(clean);
    app.navigate(app.boardHash(b));
  } catch (e) {
    toast(e.name === 'ExistsError' ? `There is a file called “${clean}” in the ${lib.boardsFolder()} folder already: choose another name.` : 'The board couldn’t be made: ' + e.message, 'bad', 8000);
  }
}

let views = 0;
export class BoardView {
  constructor(key) {
    this.kind = 'board';
    this.id = 'board-view-' + ++views;
    const entry = lib.findBoard(key);
    this.key = key;
    this.name = entry ? entry.name : key;
    this.path = entry ? entry.path : lib.boardPath(key);
    this.board = null;
    this.busy = 0;
    this.trayFilter = '';
    this.el = h('section.board-view');
    this.build();
    const soon = debounce(() => this.renderCols(), 120);
    this.offs = [
      on('boards', (d) => {
        if (d.moved && d.moved[0] === this.path) {
          this.path = d.moved[1];
          const b = lib.boards.find((x) => x.path === this.path);
          if (b) this.name = b.name;
          if (app.view === this) history.replaceState(null, '', this.hash());
          this.renderHead();
        }
        // (changed elsewhere: on another computer, or by something dropped on its name in the sidebar)
        if (d.changed && d.changed.includes(this.path) && d.by !== this.id && !this.busy) this.load();
      }),
      on('notes', () => {
        soon();
        this.traySoon();
      })
    ];
    this.onDragEnd = () => this.later && this.renderCols();
    document.addEventListener('dragend', this.onDragEnd);
    this.load();
  }
  hash() {
    const b = lib.boards.find((x) => x.path === this.path);
    return app.boardHash(b || this.key);
  }

  build() {
    this.titleEl = h('h1');
    this.subEl = h('p.page-sub');
    this.trayBtn = h('button.btn.small.tray-btn', { type: 'button', title: 'Show or hide the lists and notes to drag on', onclick: () => this.toggleTray() }, iconEl('panel-right-open'), h('span', 'Add from lists'));
    const more = iconBtn('ellipsis', 'More', () =>
      menu(more, [
        { label: 'Add a column', icon: 'columns-3', onClick: () => this.addColumn() },
        { label: 'Rename the board…', icon: 'pencil', onClick: () => this.rename() },
        { label: 'Edit the board as text', icon: 'file-text', hint: 'its file', onClick: () => app.openNote(this.path) },
        '-',
        { label: 'Delete the board…', icon: 'trash-2', danger: true, onClick: () => this.remove() }
      ], { align: 'right' })
    );
    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    this.head = h('header.page-head', burger, h('div.page-title', this.titleEl, this.subEl), h('div.page-tools', this.trayBtn, more));
    this.cols = h('div.bcols');
    this.tray = h('aside.btray', { 'aria-label': 'Lists and notes to add to the board' });
    this.wrap = h('div.board-wrap', this.cols, this.tray);
    this.el.append(this.head, this.wrap);
    this.traySoon = debounce(() => this.renderTray(), 150);
    this.setTray(S.device.boardTray !== false && innerWidth > 860);
    this.renderHead();
  }
  renderHead() {
    this.titleEl.replaceChildren(iconEl('square-kanban'), h('span', this.name));
    const n = this.board ? this.board.columns.reduce((a, c) => a + c.cards.length, 0) : 0;
    this.subEl.textContent = this.board ? `${plural(n, 'card')}, kept in ${this.path}` : this.path;
  }

  async load() {
    try {
      const r = await lib.readBoard(this.path);
      if (this.dead) return;
      this.board = r.board;
      this.readOnly = !r.utf8;
      this.renderHead();
      this.renderCols();
      this.renderTray();
    } catch (e) {
      if (this.dead) return;
      if (e.name === 'NotFoundError' || /not found|could not be found/i.test(e.message)) return this.showMissing();
      this.cols.replaceChildren(h('div.empty-page', h('h2', 'The board couldn’t be read'), h('p', e.message)));
    }
  }
  showMissing() {
    this.board = null;
    this.renderHead();
    this.cols.replaceChildren(
      h(
        'div.empty-page',
        h('h2', `There’s no board called “${this.name}”`),
        h('p', 'It may have been renamed or deleted, perhaps on another computer.'),
        h('div.btn-row', btn('Make it', 'plus', async () => {
          try {
            await lib.createBoard(this.name);
            this.load();
          } catch (e) {
            toast(e.message, 'bad');
          }
        }, 'btn primary'), btn('Back to the lists', 'arrow-left', () => app.navigate('#/lists'), 'btn'))
      )
    );
  }

  /** a change: shown at once, then made to the file as it is now. → true if it was made */
  async change(fn) {
    if (this.readOnly) {
      toast(lib.notUtf8.replace('note’s', 'board’s'), 'warn', 8000);
      this.renderCols();
      return false;
    }
    if (this.board) {
      fn(this.board);
      this.renderCols();
    }
    return this.persist(fn);
  }
  /** the change made to the file; when nothing else is under way, the board as the file has it now is shown */
  async persist(fn) {
    this.busy++;
    let r = null;
    try {
      r = await lib.changeBoard(this.path, fn, { by: this.id });
      if (!r.changed) toast('The board had changed (on another computer, perhaps): it shows what is there now.', 'warn', 6000);
    } catch (e) {
      toast('The board couldn’t be saved: ' + e.message, 'bad', 8000);
    } finally {
      this.busy--;
    }
    this.fresh = r ? r.board : null;
    if (!r) this.stale = true;
    await this.settle();
    return !!(r && r.changed);
  }
  async settle() {
    if (this.busy || this.dead || this.editing) return;
    if (this.stale) {
      this.stale = false;
      this.fresh = null;
      return this.load();
    }
    if (this.fresh) this.board = this.fresh;
    this.fresh = null;
    this.renderHead();
    this.renderCols();
  }

  /* ---------------- the columns ---------------- */
  renderCols() {
    if (!this.board || this.dead) return;
    // (not while something is being dragged, or a card is being written: afterwards)
    if (dragging() || this.editing) {
      this.later = true;
      return;
    }
    this.later = false;
    const left = this.cols.scrollLeft;
    const tops = new Map(Array.from(this.cols.querySelectorAll('.bcol')).map((c) => [c.dataset.col, c.querySelector('.bcards').scrollTop]));
    const cols = this.board.columns.map((c, i) => this.column(c, i));
    const add = h('button.bcol-new', { type: 'button', onclick: () => this.addColumn() }, iconEl('plus'), h('span', 'Add a column'));
    this.cols.replaceChildren(...cols, add);
    this.cols.scrollLeft = left;
    for (const c of this.cols.querySelectorAll('.bcol')) if (tops.has(c.dataset.col)) c.querySelector('.bcards').scrollTop = tops.get(c.dataset.col);
    if (!this.board.columns.length) this.cols.prepend(h('p.hint.bempty', 'This board has no columns. Add one to start.'));
  }
  column(c, ci) {
    const title = h('h2.bcol-title', { title: 'Double-click to rename' }, c.title);
    title.addEventListener('dblclick', () => this.renameColumn(c.title));
    const m = iconBtn('ellipsis', 'The column', () =>
      menu(m, [
        { label: 'Add a card', icon: 'plus', onClick: () => this.openAdd(c.title) },
        { label: 'Rename…', icon: 'pencil', onClick: () => this.renameColumn(c.title) },
        { label: 'Move left', icon: 'chevron-left', disabled: ci === 0, onClick: () => this.change((b) => ops.moveColumn(b, { title: c.title, by: -1 })) },
        { label: 'Move right', icon: 'chevron-right', disabled: ci === this.board.columns.length - 1, onClick: () => this.change((b) => ops.moveColumn(b, { title: c.title, by: 1 })) },
        '-',
        { label: 'Delete the column…', icon: 'trash-2', danger: true, onClick: () => this.deleteColumn(c) }
      ], { align: 'right' }), 'small');
    const cards = h('div.bcards', { dataset: { col: c.title } }, c.cards.map((card, i) => this.card(c, card, i)));
    if (!c.cards.length) cards.append(h('p.bcards-empty', 'Drag cards here'));
    const marker = h('div.bdrop');
    dropTarget(cards, {
      accept: (p) => p.kind === 'item' || p.kind === 'note' || (p.kind === 'card' && p.path === this.path),
      over: (e) => {
        if (!e) return marker.remove();
        const i = this.indexAt(cards, e.clientY);
        const els = Array.from(cards.querySelectorAll('.bcard'));
        if (els[i]) cards.insertBefore(marker, els[i]);
        else cards.append(marker);
      },
      drop: (p, e) => this.dropOn(c.title, this.indexAt(cards, e.clientY), p)
    });
    const addBtn = h('button.badd', { type: 'button' }, iconEl('plus', 'small'), h('span', 'Add a card'));
    // (on press, not click: a box open in another column closes as the pointer goes down, which redraws the columns)
    addBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.openAdd(c.title);
    });
    addBtn.addEventListener('click', (e) => e.detail === 0 && this.openAdd(c.title)); // (the keyboard)
    const foot = h('div.bcol-foot', addBtn);
    return h('section.bcol', { dataset: { col: c.title } }, h('header.bcol-head', title, h('span.count', String(c.cards.length)), m), cards, foot);
  }
  indexAt(cards, y) {
    const els = Array.from(cards.querySelectorAll('.bcard'));
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return els.length;
  }
  dropOn(column, index, p) {
    if (p.kind === 'card') {
      if (p.column === column && (index === p.index || index === p.index + 1)) return; // (where it was)
      return this.change((b) => ops.moveCard(b, { from: p.column, text: p.text, hint: p.index, to: column, index }));
    }
    const text = cardFor(p);
    if (this.board && onBoard(this.board, text)) return toast('That is on the board already.', 'warn', 3000);
    return this.change((b) => !onBoard(b, text) && ops.addCard(b, { column, text, index }));
  }

  /* ---------------- a card ---------------- */
  card(col, card, i) {
    const k = cardKind(card.text);
    const el = h('div.bcard', { tabindex: '0', dataset: { kind: k.kind } });
    if (card.done) el.classList.add('done');
    const body = h('div.bcard-body');
    let open = null; // (what clicking it does)
    if (k.kind === 'note') {
      const n = noteByRef(k.ref);
      el.classList.add('is-note');
      if (n) {
        const d = fromIso(n.date);
        body.append(
          h('span.sb-day', d ? h('b', String(d.getDate())) : '', d ? h('small', DAYS[d.getDay()].slice(0, 3)) : ''),
          h('span.bnote', h('span.bnote-title', n.title), h('span.bnote-meta', (n.dir ? n.dir + ', ' : '') + (d ? fmtShort(n.date, true) : '') + (n.open ? `, ${n.open} to do` : '')))
        );
        open = () => app.openNote(n.path);
      } else body.append(iconEl('triangle-alert', 'small'), h('span.bnote-missing', k.ref, h('span.hint', ' (no such note now)')));
    } else if (k.kind === 'item') {
      const it = itemByCard(k);
      el.classList.add('is-item');
      const list = it ? S.listById(it.task.list) : null;
      if (list) el.classList.add('hl-' + (it.task.done ? 'done' : list.color || 'yellow'));
      if (it && it.task.checkable) {
        const cb = h('input.item-box', { type: 'checkbox', checked: it.task.done, 'aria-label': it.task.done ? 'Done: untick to undo' : 'Tick off, in its note' });
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', async () => {
          cb.disabled = true;
          el.classList.toggle('item-done', cb.checked);
          if (!(await tickItem(it, cb.checked))) {
            cb.checked = !cb.checked;
            el.classList.toggle('item-done', cb.checked);
          }
          cb.disabled = false;
        });
        body.append(cb);
      }
      if (it && it.task.done) el.classList.add('item-done');
      const meta = h('span.bitem-meta');
      if (it && it.task.due) {
        const n = daysBetween(todayIso(), it.task.due);
        meta.append(h('span.due' + (n < 0 && !it.task.done ? '.overdue' : n === 0 ? '.today' : ''), { title: fmtShort(it.task.due, true) }, iconEl('clock', 'small'), relDay(it.task.due)));
      }
      meta.append(h('span', it ? `from ${it.note.title}` : `from ${k.ref} (not found there now)`));
      body.append(h('span.bitem', h('span.bitem-text', ...inline(k.text, { hide: it && it.task.dueText, marks: false })), meta));
      if (it) open = () => app.openNote(it.note.path, it.task.line);
      else {
        const n = noteByRef(k.ref);
        if (n) open = () => app.openNote(n.path);
      }
    } else {
      body.append(h('span.bplain', ...inline(k.text, { marks: true })));
      open = () => this.edit(col, card, i, el);
    }
    // (lines written under a card in its file, shown under it)
    const more = (card.sub || []).map((l) => l.replace(/\r$/, '').trim()).filter(Boolean);
    if (more.length) {
      const subs = more.slice(0, 4).map((l) => h('span.bsub-line', ...inline(l.replace(/^(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/, ''), { marks: true })));
      if (more.length > 4) subs.push(h('span.hint', `and ${more.length - 4} more lines`));
      body.append(h('span.bsub', subs));
    }
    const m = iconBtn('ellipsis', 'The card', (e) => {
      e.stopPropagation();
      this.cardMenu(m, col, card, i, el, open, k);
    }, 'bcard-menu small');
    el.append(body, m);
    el.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, textarea')) return;
      if (e.target.closest('.wikilink')) {
        const n = noteByRef(e.target.closest('.wikilink').dataset.wiki);
        if (n) return app.openNote(n.path);
      }
      if (e.target.closest('.person')) return app.navigate(app.tagHash('@' + e.target.closest('.person').dataset.person));
      if (open) open();
    });
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' && open) {
        e.preventDefault();
        open();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        this.deleteCard(col, card, i);
      }
    });
    draggable(el, () => ({ kind: 'card', path: this.path, column: col.title, text: card.text, index: i }), () => k.text || k.ref);
    return el;
  }
  cardMenu(anchor, col, card, i, el, open, k) {
    const others = this.board.columns.filter((c) => c.title !== col.title);
    menu(anchor, [
      open && k.kind !== 'plain' ? { label: k.kind === 'note' ? 'Open the note' : 'Open it, in its note', icon: 'external-link', onClick: open } : null,
      k.kind === 'plain' ? { label: 'Change the words', icon: 'pencil', onClick: () => this.edit(col, card, i, el) } : null,
      { label: card.done ? 'Mark as not done' : 'Mark as done', icon: 'check', hint: 'on the board', onClick: () => this.change((b) => ops.setDone(b, { column: col.title, text: card.text, hint: i, done: !card.done })) },
      others.length ? { heading: 'Move to' } : null,
      ...others.map((c) => ({ label: c.title, icon: 'arrow-right-left', onClick: () => this.change((b) => ops.moveCard(b, { from: col.title, text: card.text, hint: i, to: c.title })) })),
      '-',
      { label: 'Take off the board', icon: 'trash-2', danger: true, hint: k.kind === 'plain' ? '' : 'not out of its note', onClick: () => this.deleteCard(col, card, i) }
    ], { align: 'right' });
  }
  async deleteCard(col, card, i) {
    const ok = await this.change((b) => ops.deleteCard(b, { column: col.title, text: card.text, hint: i }));
    if (ok) toast('Taken off the board.', 'ok', 5000, { label: 'Undo', run: () => this.change((b) => ops.addCard(b, { column: col.title, text: card.text, index: i, done: card.done })) });
  }
  edit(col, card, i, el) {
    if (this.editing) return;
    if (this.readOnly) return toast(lib.notUtf8.replace('note’s', 'board’s'), 'warn', 8000);
    this.editing = true;
    const ta = h('textarea.bcard-edit', { rows: 2, 'aria-label': 'The card’s words' });
    ta.value = card.text;
    el.replaceChildren(ta);
    el.draggable = false;
    ta.focus();
    ta.select();
    let over = false;
    const finish = async (save) => {
      if (over) return;
      over = true;
      this.editing = false;
      const v = ta.value.replace(/\s*\n\s*/g, ' ').trim();
      if (save && v && v !== card.text) await this.change((b) => ops.editCard(b, { column: col.title, text: card.text, hint: i, to: v }));
      else {
        this.renderCols();
        this.settle();
      }
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    ta.addEventListener('blur', () => finish(true));
  }
  /** a box at the foot of a column for a new card (it stays open for the next one) */
  openAdd(title) {
    if (this.readOnly) return toast(lib.notUtf8.replace('note’s', 'board’s'), 'warn', 8000);
    // (one box at a time: one open in another column is finished first)
    if (this.adding && this.adding.title !== title) this.adding.finish();
    const col = Array.from(this.cols.querySelectorAll('.bcol')).find((c) => c.dataset.col === title);
    if (!col) return;
    const foot = col.querySelector('.bcol-foot');
    if (foot.querySelector('textarea')) return foot.querySelector('textarea').focus();
    this.editing = true;
    const ta = h('textarea.bcard-edit', { rows: 2, placeholder: 'What is it? (Enter to add)', 'aria-label': 'A new card' });
    foot.replaceChildren(ta);
    ta.focus();
    let over = false;
    const close = () => {
      if (over) return;
      over = true;
      this.editing = false;
      this.adding = null;
      this.renderCols();
      this.settle();
    };
    const finish = () => {
      const v = ta.value.replace(/\s*\n\s*/g, ' ').trim();
      if (v && !over) {
        ops.addCard(this.board, { column: title, text: v });
        this.persist((b) => ops.addCard(b, { column: title, text: v }));
      }
      close();
    };
    this.adding = { title, finish };
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const v = ta.value.replace(/\s*\n\s*/g, ' ').trim();
        if (!v) return close();
        ta.value = '';
        // (shown in the column at once; the box stays for another)
        const c = this.board.columns.find((x) => x.title === title);
        if (c) {
          ops.addCard(this.board, { column: title, text: v });
          const cards = col.querySelector('.bcards');
          const empty = cards.querySelector('.bcards-empty');
          if (empty) empty.remove();
          cards.append(this.card(c, c.cards[c.cards.length - 1], c.cards.length - 1));
          cards.scrollTop = cards.scrollHeight;
        }
        this.persist((b) => ops.addCard(b, { column: title, text: v }));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    ta.addEventListener('blur', finish);
  }

  /* ---------------- columns ---------------- */
  async addColumn() {
    const t = await promptDialog('A new column', 'Its name', '', 'Add it');
    if (!t || !t.trim()) return;
    if (this.board && this.board.columns.some((c) => c.title === t.trim())) return toast('There is a column with that name already.', 'warn');
    await this.change((b) => ops.addColumn(b, { title: t.trim() }));
    this.cols.scrollLeft = this.cols.scrollWidth;
  }
  async renameColumn(title) {
    const t = await promptDialog('Rename the column', 'Its name', title, 'Rename');
    if (!t || !t.trim() || t.trim() === title) return;
    if (this.board.columns.some((c) => c.title === t.trim())) return toast('There is a column with that name already.', 'warn');
    this.change((b) => ops.renameColumn(b, { title, to: t.trim() }));
  }
  async deleteColumn(c) {
    if (c.cards.length && !(await confirmDialog('Delete the column?', `“${c.title}” and its ${plural(c.cards.length, 'card')} will be taken off the board. (Notes and items stay as they are in their notes.)`, 'Delete it', true))) return;
    this.change((b) => ops.deleteColumn(b, { title: c.title }));
  }

  /* ---------------- the board itself ---------------- */
  async rename() {
    const t = await promptDialog('Rename the board', 'Its name', this.name, 'Rename', 'Its file is renamed too.');
    if (!t || !t.trim() || t.trim() === this.name) return;
    const to = lib.boardPath(t.trim(), this.path.includes('/') ? this.path.slice(0, this.path.lastIndexOf('/')) : '');
    if (to.toLowerCase() !== this.path.toLowerCase() && (await fsx.exists(to))) return toast('There is a file with that name there already.', 'warn');
    try {
      const b = await lib.renameBoard(this.path, t.trim());
      this.path = b.path;
      this.name = b.name;
      this.key = lib.boardKey(b);
      history.replaceState(null, '', this.hash());
      this.renderHead();
      app.sidebar.setActive({ name: 'board', arg: this.key });
    } catch (e) {
      toast('The board couldn’t be renamed: ' + e.message, 'bad', 8000);
    }
  }
  async remove() {
    if (!(await confirmDialog('Delete the board?', `“${this.name}” will be deleted from the Boards folder. The notes and items on it stay as they are. (Dropbox keeps deleted files for a while, if you need it back.)`, 'Delete it', true))) return;
    try {
      await lib.deleteBoard(this.path);
      toast('Deleted.', 'ok');
      app.navigate('#/lists', { replace: true });
    } catch (e) {
      toast('It couldn’t be deleted: ' + e.message, 'bad');
    }
  }

  /* ---------------- the tray: lists and notes, to drag on ---------------- */
  toggleTray() {
    this.setTray(this.tray.hidden);
    S.device.boardTray = !this.tray.hidden;
    S.saveDevice();
  }
  setTray(show) {
    this.tray.hidden = !show;
    this.trayBtn.setAttribute('aria-pressed', String(!!show));
    this.trayBtn.replaceChildren(iconEl(show ? 'panel-right-close' : 'panel-right-open'), h('span', show ? 'Hide the lists' : 'Add from lists'));
    if (show) this.renderTray();
  }
  renderTray() {
    if (this.tray.hidden || this.dead) return;
    const keep = document.activeElement && document.activeElement.classList.contains('btray-find');
    const scroll = this.tray.querySelector('.btray-scroll') ? this.tray.querySelector('.btray-scroll').scrollTop : 0;
    const find = h('input.input.small.btray-find', { type: 'search', placeholder: 'Find a note or an item', value: this.trayFilter, 'aria-label': 'Find a note or an item' });
    find.addEventListener('input', debounce(() => {
      this.trayFilter = find.value;
      this.renderTray();
    }, 150));
    const q = lib.fold(this.trayFilter).trim();
    const words = q ? q.split(/\s+/) : [];
    const hit = (s) => words.every((w) => lib.fold(s).includes(w));
    const box = h('div.btray-scroll');
    const add = (p) => {
      const col = this.board && this.board.columns[0];
      if (!col) return toast('Add a column first.', 'warn');
      this.dropOn(col.title, col.cards.length, p);
    };
    const row = (payload, kids, title) => {
      const r = h('li.btray-row', h('span.grip', { 'aria-hidden': 'true' }, iconEl('grip-vertical', 'small')), h('span.btray-main', kids), h('button.icon-btn.small.btray-add', { type: 'button', title: 'Add to the first column', 'aria-label': 'Add to the board', onclick: () => add(payload) }, iconEl('plus', 'small')));
      if (this.board && onBoard(this.board, cardFor(payload))) r.classList.add('on-board');
      draggable(r, payload, title);
      return r;
    };
    for (const l of S.shared.lists) {
      let its = lib.items(l.id).filter((it) => !it.task.done);
      if (l.done) its = byWhen(its);
      if (q) its = its.filter((it) => hit(it.task.text + ' ' + it.note.title));
      if (!its.length) continue;
      box.append(
        h(
          'section.btray-sec',
          h('h3', h(`span.swatch.hl-${l.color || 'yellow'}`), l.name, h('span.n', String(its.length))),
          h('ul', its.slice(0, q ? 60 : 25).map((it) => row(itemPayload(it.task, it.note), [h('span.btray-text', ...inline(it.task.text, { hide: it.task.dueText, marks: false })), h('span.btray-src', it.note.title)], it.task.text)))
        )
      );
    }
    let notes = lib.all();
    if (q) notes = notes.filter((n) => words.every((w) => n.lc.includes(w)));
    if (notes.length) {
      box.append(
        h(
          'section.btray-sec',
          h('h3', iconEl('file-text', 'small'), q ? 'Notes' : 'Recent notes', h('span.n', String(notes.length))),
          h('ul', notes.slice(0, q ? 60 : 30).map((n) => row(notePayload(n), [h('span.btray-text', n.title), h('span.btray-src', fmtDayMonth(n.date) + (n.dir ? ', ' + n.dir : ''))], n.title)))
        )
      );
    }
    if (!box.childNodes.length) box.append(h('p.hint', q ? 'Nothing matches.' : 'Nothing on the lists, and no notes yet.'));
    this.tray.replaceChildren(
      h('header.btray-head', h('h2', 'Drag onto the board'), iconBtn('x', 'Hide', () => this.toggleTray(), 'small')),
      h('p.hint.btray-hint', 'Items from your lists and notes. Drag one to a column, or press + to add it to the first.'),
      find,
      box
    );
    box.scrollTop = scroll;
    if (keep) {
      find.focus();
      find.setSelectionRange(find.value.length, find.value.length);
    }
  }

  destroy() {
    this.dead = true;
    for (const off of this.offs) off();
    document.removeEventListener('dragend', this.onDragEnd);
  }
}

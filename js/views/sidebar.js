/* The sidebar: the folder, search, new note, the lists with how much is on them, and the notes, newest first. */
import { h, icon, iconEl, iconBtn, menu, toast, debounce, keyLabel, plural } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import * as fsx from '../fsx.js';
import { on } from '../bus.js';
import { MONTHS, DAYS, fromIso, todayIso } from '../dates.js';
import { app } from '../app.js';

const PAGE = 300;

export class Sidebar {
  constructor() {
    this.el = h('aside#sidebar', { 'aria-label': 'Notes and lists' });
    this.active = {};
    this.filter = '';
    this.limit = PAGE;
    const re = debounce(() => this.render(), 120);
    on('notes', re);
    on('settings', re);
    this.render();
  }

  render() {
    const el = this.el;
    const keepFocus = document.activeElement && document.activeElement.classList.contains('sb-filter');
    const caret = keepFocus ? document.activeElement.selectionStart : 0;
    const scroll = el.querySelector('.sb-scroll') ? el.querySelector('.sb-scroll').scrollTop : 0;
    el.replaceChildren();
    const head = h(
      'div.sb-head',
      h('a.brand', { href: '#/', title: 'TimNote' }, h('span.brand-mark', { html: MARK }), h('span.brand-name', 'TimNote')),
      iconBtn('settings', 'Settings', () => app.settings())
    );
    el.append(head);
    if (!app.connected) return;

    const info = fsx.info();
    const folderBtn = h('button.sb-folder', { type: 'button', title: 'Your notes folder' }, iconEl(info.mode === 'browser' ? 'hard-drive' : 'folder'), h('span', info.name || 'Notes'), iconEl('chevron-down', 'small'));
    folderBtn.addEventListener('click', async () => {
      const recent = (await fsx.recent()).filter((r) => r.name !== info.name);
      menu(folderBtn, [
        { label: 'Look through the folder again', icon: 'refresh-cw', onClick: async () => (await app.rescan(), toast('Up to date.', 'ok', 2000)) },
        { label: 'Choose another folder…', icon: 'folder-open', onClick: () => app.changeFolder() },
        recent.length ? '-' : null,
        recent.length ? { heading: 'Recent folders' } : null,
        ...recent.map((r) => ({
          label: r.name,
          icon: 'folder',
          onClick: async () => {
            if (await fsx.openRecent(r)) {
              lib.notes.clear();
              await app.connect();
              app.navigate('#/', { replace: true });
            }
          }
        })),
        '-',
        { label: 'Settings', icon: 'settings', onClick: () => app.settings() }
      ]);
    });

    const filter = h('input.sb-filter', { type: 'search', placeholder: 'Filter notes', value: this.filter, 'aria-label': 'Filter the notes', spellcheck: false });
    filter.addEventListener('input', () => {
      this.filter = filter.value;
      this.renderNotes();
    });
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        app.navigate('#/search/' + encodeURIComponent(filter.value));
      } else if (e.key === 'Escape') {
        filter.value = '';
        this.filter = '';
        this.renderNotes();
      }
    });
    const search = h('div.sb-search', iconEl('search'), filter, h('button.sb-k', { type: 'button', title: 'Find a note or a command', onclick: () => app.palette() }, keyLabel('Ctrl+K')));

    const newBtn = h('button.btn.primary.sb-new', { type: 'button' }, iconEl('plus'), h('span', 'New note'));
    newBtn.addEventListener('click', () => this.newMenu(newBtn));
    const todayBtn = h('button.btn.sb-today', { type: 'button', title: 'Today’s daily note', onclick: () => app.today() }, iconEl('calendar-days'), h('span', 'Today'));
    const actions = h('div.sb-actions', newBtn, todayBtn);

    const counts = lib.counts();
    const lists = h('nav.sb-lists', { 'aria-label': 'Lists' });
    for (const l of S.shared.lists) {
      const c = counts[l.id] || { open: 0, all: 0 };
      const n = l.done ? c.open : c.all;
      lists.append(
        h('a.sb-list', { href: '#/list/' + encodeURIComponent(l.id), dataset: { id: l.id } }, h(`span.swatch.hl-${l.color || 'yellow'}`), h('span.sb-list-name', l.name), n ? h('span.count', String(n)) : null)
      );
    }
    lists.append(h('a.sb-list.sb-cal', { href: '#/calendar/', dataset: { id: 'calendar' } }, iconEl('calendar'), h('span.sb-list-name', 'Calendar')));

    this.notesBox = h('div.sb-notes', { role: 'list' });
    const scrollBox = h('div.sb-scroll', lists, this.notesBox);
    const foot = h('div.sb-foot');
    if (info.mode === 'browser') foot.append(h('div.sb-warn', iconEl('triangle-alert'), h('span', 'Notes are kept in this browser only: they aren’t synced. Choose a folder in Settings.')));
    const conflicts = lib.all({ archived: true }).filter((n) => n.conflict);
    if (conflicts.length) {
      const b = h('button.sb-warn.sb-conflicts', { type: 'button' }, iconEl('triangle-alert'), h('span', `${plural(conflicts.length, 'conflicted copy', 'conflicted copies')} from Dropbox`));
      b.addEventListener('click', () =>
        menu(b, [{ heading: 'Changed in two places at once: open each, keep what you need, then delete the copy' }, ...conflicts.map((n) => ({ label: n.name, icon: 'file-text', onClick: () => app.openNote(n.path) }))])
      );
      foot.append(b);
    }
    const total = lib.all({ archived: true }).length;
    const archived = lib.all({ archived: true }).filter((n) => n.archived).length;
    foot.append(
      h(
        'div.sb-count',
        h('span', plural(total, 'note')),
        archived ? h('button.linkish', { type: 'button', onclick: () => ((S.device.showArchive = !S.device.showArchive), S.saveDevice(), this.render()) }, S.device.showArchive ? 'Hide the archive' : `Show the archive (${archived})`) : null
      )
    );
    el.append(folderBtn, search, actions, scrollBox, foot);
    this.renderNotes();
    this.setActive(this.active);
    scrollBox.scrollTop = scroll;
    if (keepFocus) {
      filter.focus();
      filter.setSelectionRange(caret, caret);
    }
  }

  renderNotes() {
    const box = this.notesBox;
    if (!box) return;
    box.replaceChildren();
    const q = lib.fold(this.filter).trim();
    let list = lib.all({ archived: S.device.showArchive });
    if (q) {
      const words = q.split(/\s+/);
      list = list.filter((n) => words.every((w) => n.lc.includes(w)));
      box.append(h('div.sb-group', list.length ? `${plural(list.length, 'match', 'matches')}` : 'Nothing matches'));
      for (const n of list.slice(0, 200)) box.append(this.item(n));
      return;
    }
    const pinned = S.shared.pinned.map((p) => lib.get(p)).filter(Boolean);
    if (pinned.length) {
      box.append(h('div.sb-group', iconEl('pin', 'small'), 'Pinned'));
      for (const n of pinned) box.append(this.item(n, true));
    }
    if (!list.length) {
      box.append(h('div.sb-empty', 'No notes yet. Press ', h('b', 'New note'), ' or ', h('b', 'Today'), ' to start one.'));
      return;
    }
    let month = '';
    for (const n of list.slice(0, this.limit)) {
      const d = fromIso(n.date);
      const m = d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Undated';
      if (m !== month) {
        month = m;
        box.append(h('div.sb-group', m));
      }
      box.append(this.item(n));
    }
    if (list.length > this.limit) box.append(h('button.btn.small.sb-more', { type: 'button', onclick: () => ((this.limit += PAGE * 3), this.renderNotes()) }, `Show more (${list.length - this.limit} older)`));
  }

  item(n, pinned = false) {
    const d = fromIso(n.date);
    const today = n.date === todayIso();
    const a = h(
      'a.sb-note' + (n.archived ? '.archived' : '') + (n.conflict ? '.conflict' : ''),
      { href: app.noteHash(n.path), role: 'listitem', dataset: { path: n.path }, title: n.path },
      h('span.sb-day' + (today ? '.today' : ''), d ? h('b', String(d.getDate())) : '', d ? h('small', DAYS[d.getDay()].slice(0, 3)) : ''),
      h('span.sb-title', h('span.sb-t', n.title || n.name), n.dir ? h('span.sb-dir', n.dir) : null),
      n.open ? h('span.sb-open', { title: plural(n.open, 'item') + ' still to do' }, String(n.open)) : null
    );
    if (pinned) a.classList.add('pinned');
    return a;
  }

  newMenu(anchor) {
    const items = lib.templates.map((t) => ({
      label: t.name,
      icon: TEMPLATE_ICONS[t.name.toLowerCase()] || 'file-text',
      onClick: () => (t.name.toLowerCase() === 'daily note' ? app.today() : app.newNote(t.name))
    }));
    menu(anchor, [{ label: 'Blank note', icon: 'file-plus', hint: keyLabel('Alt+N'), onClick: () => app.newNote('Blank') }, '-', { heading: 'From a template' }, ...items, '-', { label: 'Choose the folder and date…', icon: 'folder-input', onClick: () => app.newNoteDialog() }]);
  }

  setActive(r) {
    this.active = r || {};
    for (const a of this.el.querySelectorAll('.active')) a.classList.remove('active');
    if (!r) return;
    if (r.name === 'note') {
      const a = Array.from(this.el.querySelectorAll('.sb-note')).find((x) => x.dataset.path === r.arg);
      if (a) a.classList.add('active');
    } else if (r.name === 'list') {
      const a = this.el.querySelector(`.sb-list[data-id="${CSS.escape(r.arg)}"]`);
      if (a) a.classList.add('active');
    } else if (r.name === 'calendar') {
      const a = this.el.querySelector('.sb-cal');
      if (a) a.classList.add('active');
    }
  }
}

export const TEMPLATE_ICONS = { 'meeting notes': 'messages-square', 'daily note': 'calendar-days', supervision: 'notebook-pen', 'one to one': 'user', 'phone call': 'bell', 'seminar or lecture': 'book-open', idea: 'lightbulb', 'week plan': 'list-checks' };

/* the mark: a page with its margin, and one line highlighted */
export const MARK = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect x="5" y="3" width="22" height="26" rx="3" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.6"/><path d="M10.5 3v26" stroke="var(--margin)" stroke-width="1.6"/><rect x="12.5" y="12" width="12" height="5" rx="1.6" fill="var(--hl-yellow)"/><path d="M14 9h9M14 14.5h8M14 20h9M14 24.5h6" stroke="var(--ink)" stroke-width="1.5" stroke-linecap="round"/></svg>`;

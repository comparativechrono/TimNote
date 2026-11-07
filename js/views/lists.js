/* A list's page: everything on it from all the notes, by date due, by note, by person or by tag. Ticking an item
   off changes the line in its note's file; clicking it opens the note at that line. */
import { h, icon, iconEl, iconBtn, btn, menu, toast, copyText, download, debounce, plural } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { on } from '../bus.js';
import { todayIso, addDays, relDay, fmtShort, fmtDayMonth, daysBetween, fromIso } from '../dates.js';
import { app } from '../app.js';
import { toICS } from '../ics.js';

const GROUPS = { due: 'Date due', note: 'Note', person: 'Person', tag: 'Tag', none: 'Newest first' };

export class ListView {
  constructor(id) {
    this.kind = 'list';
    this.id = id;
    this.list = S.listById(id);
    this.filter = '';
    this.pending = new Map(); // (items ticked here, until the notes catch up)
    this.el = h('section.list-view');
    this.offs = [on('notes', debounce(() => this.render(), 80)), on('settings', () => ((this.list = S.listById(this.id)), this.render()))];
    this.render();
  }
  hash() {
    return '#/list/' + encodeURIComponent(this.id);
  }
  get group() {
    return S.device.listGroup[this.id] || (this.list && this.list.done ? 'due' : 'note');
  }
  set group(g) {
    S.device.listGroup[this.id] = g;
    S.saveDevice();
  }
  get showDone() {
    return !!S.device.listShowDone[this.id];
  }

  render() {
    const l = this.list;
    if (!l) {
      this.el.replaceChildren(h('div.empty-page', h('h1', 'There’s no such list'), h('p', 'It may have been removed in Settings.')));
      return;
    }
    const scroll = this.el.querySelector('.list-scroll') ? this.el.querySelector('.list-scroll').scrollTop : 0;
    const focusAdd = document.activeElement && document.activeElement.classList.contains('qa-text');
    const all = lib.items(l.id);
    const q = lib.fold(this.filter).trim();
    const match = (it) => !q || q.split(/\s+/).every((w) => lib.fold(it.task.text + ' ' + it.note.title).includes(w));
    const items = all.filter(match);
    const open = items.filter((it) => !this.isDone(it));
    const done = items.filter((it) => this.isDone(it));

    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    const groupSel = h('select.input.small', { 'aria-label': 'Group by' }, Object.entries(GROUPS).map(([k, v]) => h('option', { value: k, selected: k === this.group }, v)));
    groupSel.addEventListener('change', () => ((this.group = groupSel.value), this.render()));
    const filter = h('input.input.small.list-filter', { type: 'search', placeholder: 'Filter', value: this.filter, 'aria-label': 'Filter the list' });
    filter.addEventListener('input', debounce(() => ((this.filter = filter.value), this.render(), this.el.querySelector('.list-filter').focus()), 200));
    const more = iconBtn('ellipsis', 'More', () =>
      menu(more, [
        { label: 'Copy the list', icon: 'copy', onClick: () => this.copy(open) },
        { label: 'Save the list as a note', icon: 'file-plus', onClick: () => this.snapshot(open) },
        { label: 'Dated items to a calendar (.ics)', icon: 'calendar-days', onClick: () => this.ics(open) },
        '-',
        { label: 'Change the lists and their words…', icon: 'settings', onClick: () => app.settings('lists') }
      ], { align: 'right' })
    );
    const words = l.triggers || [];
    const head = h(
      'header.page-head',
      burger,
      h(
        'div.page-title',
        h('h1', h(`span.swatch.big.hl-${l.color || 'yellow'}`), l.name),
        h('p.page-sub', l.done ? `${open.length} still to do${done.length ? `, ${done.length} done` : ''}.` : `${plural(items.length, 'item')}.`, h('span.words', ' Lines with ', words.map((w, i) => [i ? (i === words.length - 1 ? ' or ' : ', ') : '', h('code', w)]), ' come here.'))
      ),
      h('div.page-tools', filter, h('label.inline', h('span', 'Group'), groupSel), more)
    );

    // adding to the list
    const text = h('input.input.qa-text', { type: 'text', placeholder: `Add to ${l.name}…`, 'aria-label': `Add to ${l.name}` });
    const due = h('input.input.qa-due', { type: 'date', 'aria-label': 'Date due (optional)', title: 'Date due (optional)' });
    const add = h('form.quick-add', h('span.qa-icon', { html: icon('plus') }), text, due, h('button.btn.primary.small', { type: 'submit' }, 'Add'), h('span.qa-hint', 'It goes in today’s daily note.'));
    add.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = text.value.trim();
      if (!t) return;
      try {
        await lib.addItem(l, t, due.value || '');
        text.value = '';
        due.value = '';
        toast(`Added to ${l.name}, in today’s daily note.`, 'ok', 2500);
      } catch (err) {
        toast('It couldn’t be added: ' + err.message, 'bad', 8000);
      }
    });

    const box = h('div.list-scroll');
    if (!all.length) {
      box.append(
        h(
          'div.list-empty',
          h('p', `Nothing on ${l.name} yet.`),
          h('p.hint', 'Write a line like this in any note, and it appears here:'),
          h('p.example', h(`mark.hl.hl-${l.color || 'yellow'}`, (l.triggers[0] || 'TO DO:').trim()), ' ', l.id === 'todo' ? 'send the figures to Sarah by Friday' : 'something to remember'),
          l.done ? h('p.hint', `When it’s done, tick it here, or change the word to `, h('code', l.done), '.') : null
        )
      );
    } else {
      for (const [title, list, cls] of this.groups(open)) {
        if (!list.length) continue;
        box.append(h('section.group' + (cls ? '.' + cls : ''), h('h2', title, h('span.n', String(list.length))), h('ul.items', list.map((it) => this.row(it)))));
      }
      if (!open.length && l.done) box.append(h('p.list-clear', q ? 'Nothing to do matches.' : 'Nothing left to do on this list.'));
      if (done.length) {
        const det = h('details.group.done-group', { open: this.showDone }, h('summary', h('h2', 'Done', h('span.n', String(done.length)))), h('ul.items', done.slice(0, 300).map((it) => this.row(it))));
        det.addEventListener('toggle', () => {
          S.device.listShowDone[this.id] = det.open;
          S.saveDevice();
        });
        box.append(det);
      }
    }
    this.el.replaceChildren(head, add, box);
    box.scrollTop = scroll;
    if (focusAdd) text.focus();
  }

  isDone(it) {
    const k = it.note.path + '\n' + it.task.raw;
    return this.pending.has(k) ? this.pending.get(k) : it.task.done;
  }

  groups(items) {
    const g = this.group;
    const out = [];
    if (g === 'due') {
      const t = todayIso();
      const end = addDays(t, 7 - ((fromIso(t).getDay() + 6) % 7) - 1); // (Sunday)
      const b = { over: [], today: [], tomorrow: [], week: [], later: [], none: [] };
      for (const it of items) {
        const d = it.task.due;
        if (!d) b.none.push(it);
        else if (d < t) b.over.push(it);
        else if (d === t) b.today.push(it);
        else if (d === addDays(t, 1)) b.tomorrow.push(it);
        else if (d <= end) b.week.push(it);
        else b.later.push(it);
      }
      const byDue = (a, c) => (a.task.due < c.task.due ? -1 : a.task.due > c.task.due ? 1 : 0) || (c.task.priority - a.task.priority);
      out.push(['Overdue', b.over.sort(byDue), 'overdue'], ['Today', b.today.sort(byDue)], ['Tomorrow', b.tomorrow.sort(byDue)], ['Later this week', b.week.sort(byDue)], ['Later', b.later.sort(byDue)], ['No date', b.none.sort((a, c) => c.task.priority - a.task.priority)]);
    } else if (g === 'note') {
      const m = new Map();
      for (const it of items) {
        if (!m.has(it.note.path)) m.set(it.note.path, []);
        m.get(it.note.path).push(it);
      }
      for (const list of m.values()) out.push([`${list[0].note.title}, ${fmtDayMonth(list[0].note.date)}`, list, 'by-note']);
    } else if (g === 'person') {
      const m = new Map();
      for (const it of items) {
        const ps = it.task.people.length ? it.task.people : [''];
        for (const p of ps) {
          if (!m.has(p)) m.set(p, []);
          m.get(p).push(it);
        }
      }
      const keys = Array.from(m.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
      for (const k of keys) out.push([k ? '@' + k : 'No one named', m.get(k)]);
    } else if (g === 'tag') {
      const m = new Map();
      for (const it of items) {
        const ts = it.task.tags.length ? it.task.tags : [''];
        for (const t of ts) {
          if (!m.has(t)) m.set(t, []);
          m.get(t).push(it);
        }
      }
      const keys = Array.from(m.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
      for (const k of keys) out.push([k ? '#' + k : 'No tag', m.get(k)]);
    } else out.push(['', items]);
    return out;
  }

  row(it) {
    const { task, note } = it;
    const l = this.list;
    const done = this.isDone(it);
    const li = h('li.item' + (done ? '.done' : '') + (task.priority ? '.priority' : ''));
    if (task.checkable) {
      const cb = h('input.item-box', { type: 'checkbox', checked: done, 'aria-label': done ? 'Done: untick to undo' : 'Tick off' });
      cb.addEventListener('change', () => this.toggle(it, cb.checked, li));
      li.append(cb);
    } else li.append(h('span.item-dot', { 'aria-hidden': 'true' }, h(`span.swatch.hl-${l.color || 'yellow'}`)));
    const text = h('a.item-text', { href: app.noteHash(note.path, task.line), title: 'Open the note at this line' }, ...richText(task));
    const meta = h('span.item-meta');
    if (task.due) {
      const n = daysBetween(todayIso(), task.due);
      meta.append(h('span.due' + (n < 0 && !done ? '.overdue' : n === 0 ? '.today' : ''), { title: fmtShort(task.due, true) }, iconEl('clock', 'small'), relDay(task.due)));
    }
    if (this.group !== 'note') meta.append(h('a.item-src', { href: app.noteHash(note.path, task.line), title: note.path }, `${note.title}, ${fmtDayMonth(note.date)}`));
    li.append(h('div.item-main', text, meta));
    return li;
  }

  async toggle(it, done, li) {
    const k = it.note.path + '\n' + it.task.raw;
    this.pending.set(k, done);
    li.classList.toggle('done', done);
    try {
      await lib.toggle(it.note, it.task, done);
      if (done) toast('Ticked off.', 'ok', 4000, { label: 'Undo', run: () => this.untick(it) });
    } catch (e) {
      li.classList.toggle('done', !done);
      const cb = li.querySelector('input');
      if (cb) cb.checked = !done;
      toast(e.name === 'ConflictError' ? 'The note was changed elsewhere just then: try again.' : e.message, 'bad', 8000);
    } finally {
      setTimeout(() => {
        this.pending.delete(k);
        this.render();
      }, 600);
    }
  }
  async untick(it) {
    // (the item as it is now, ticked)
    const n = lib.get(it.note.path);
    const t = n && n.tasks.find((x) => x.line === it.task.line && x.list === it.task.list);
    if (!t) return toast('The note has changed: open it to undo that.', 'warn');
    try {
      await lib.toggle(n, t, false);
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  listText(items) {
    const l = this.list;
    return `# ${l.name}, ${fmtShort(todayIso(), true)}\n\n` + items.map(({ task, note }) => `- [ ] ${task.text}  (from [[${note.title}]])`).join('\n') + '\n';
  }
  copy(items) {
    copyText(this.listText(items)).then((ok) => toast(ok ? 'Copied.' : 'It couldn’t be copied.', ok ? 'ok' : 'bad', 2000));
  }
  async snapshot(items) {
    try {
      const text = this.listText(items).replace(/- \[ \] /g, '- ');
      const n = await lib.createNote({ folder: '', date: todayIso(), title: `${this.list.name} list`, text });
      toast('Saved as a note. (Its lines aren’t list lines, so they won’t be counted twice.)', 'ok', 6000, { label: 'Open it', run: () => app.openNote(n.path) });
    } catch (e) {
      toast('It couldn’t be saved: ' + e.message, 'bad');
    }
  }
  ics(items) {
    const dated = items.filter((it) => it.task.due);
    if (!dated.length) return toast('Nothing on this list has a date.', 'warn');
    download(`${this.list.name}.ics`, toICS(dated), 'text/calendar;charset=utf-8');
  }
  destroy() {
    for (const off of this.offs) off();
  }
}

/** an item's text, with its dates, people and tags shown as such */
export function richText(task) {
  const out = [];
  const re = /(@[\p{L}\p{N}][\p{L}\p{N}_'’./-]*|#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*|\[\[[^\]]+\]\])/gu;
  let at = 0;
  const text = task.text;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const s = m[0];
    if (s.startsWith('#')) out.push(h('span.tag', s));
    else if (s.startsWith('[[')) out.push(h('span.wikilink', s.slice(2, -2)));
    else if (task.dueText && task.dueText.includes(s)) {
      if (!task.dueText.startsWith('@')) out.push(h('span.when', s)); // (an @date is shown as the date beside it)
    }
    else out.push(h('span.person', s));
    at = m.index + s.length;
  }
  if (at < text.length) out.push(text.slice(at));
  if (typeof out[out.length - 1] === 'string') out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '');
  return out;
}

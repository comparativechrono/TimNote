/* The calendar: each day's notes (the date in their names) and what is due that day. */
import { h, icon, iconEl, iconBtn, btn, plural } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { on } from '../bus.js';
import { todayIso, fromIso, monthGrid, monthTitle, fmtLong, iso, DAYS } from '../dates.js';
import { app } from '../app.js';
import { richText } from './lists.js';

export class CalendarView {
  constructor(arg) {
    this.kind = 'calendar';
    const m = /^(\d{4})-(\d{2})$/.exec(arg || '');
    const t = fromIso(todayIso());
    this.y = m ? +m[1] : t.getFullYear();
    this.m = m ? +m[2] - 1 : t.getMonth();
    this.day = m ? null : todayIso();
    this.el = h('section.calendar-view');
    this.offs = [on('notes', () => this.render())];
    this.render();
  }
  hash() {
    return `#/calendar/${this.y}-${String(this.m + 1).padStart(2, '0')}`;
  }
  go(dy) {
    const d = new Date(this.y, this.m + dy, 1);
    this.y = d.getFullYear();
    this.m = d.getMonth();
    history.replaceState(null, '', this.hash());
    this.render();
  }

  render() {
    const byDay = new Map();
    const add = (d, k, v) => {
      if (!byDay.has(d)) byDay.set(d, { notes: [], due: [] });
      byDay.get(d)[k].push(v);
    };
    for (const n of lib.all()) add(n.date, 'notes', n);
    for (const l of S.shared.lists) {
      if (!l.done) continue;
      for (const it of lib.items(l.id)) if (it.task.due && !it.task.done) add(it.task.due, 'due', Object.assign({ list: l }, it));
    }
    const t = todayIso();
    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    const head = h(
      'header.page-head',
      burger,
      h('div.page-title', h('h1', monthTitle(this.y, this.m))),
      h('div.page-tools', iconBtn('chevron-left', 'The month before', () => this.go(-1)), btn('This month', null, () => {
        const d = fromIso(t);
        this.y = d.getFullYear();
        this.m = d.getMonth();
        this.day = t;
        history.replaceState(null, '', this.hash());
        this.render();
      }, 'btn small'), iconBtn('chevron-right', 'The month after', () => this.go(1)))
    );
    const grid = h('div.cal-grid', { role: 'grid' });
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.append(h('div.cal-wd', { role: 'columnheader' }, d));
    for (const week of monthGrid(this.y, this.m)) {
      for (const d of week) {
        const date = fromIso(d);
        const info = byDay.get(d) || { notes: [], due: [] };
        const cell = h('div.cal-day' + (date.getMonth() !== this.m ? '.other' : '') + (d === t ? '.today' : '') + (d === this.day ? '.sel' : '') + (d < t ? '.past' : ''), { role: 'gridcell', tabindex: '0', 'aria-label': `${fmtLong(d)}: ${plural(info.notes.length, 'note')}, ${plural(info.due.length, 'item')} due` });
        cell.append(h('span.cal-num', String(date.getDate())));
        const list = h('div.cal-notes');
        for (const n of info.notes.slice(0, 3)) list.append(h('a.cal-note', { href: app.noteHash(n.path), title: n.title }, n.title));
        if (info.notes.length > 3) list.append(h('span.cal-more', `and ${info.notes.length - 3} more`));
        cell.append(list);
        if (info.due.length) {
          const colours = Array.from(new Set(info.due.map((x) => x.list.color || 'yellow')));
          cell.append(h('div.cal-due' + (d < t ? '.overdue' : ''), colours.map((c) => h(`span.swatch.hl-${c}`)), h('span', `${info.due.length} due`)));
        }
        cell.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          this.day = d;
          this.render();
        });
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.day = d;
            this.render();
          }
        });
        grid.append(cell);
      }
    }
    const side = h('aside.cal-side');
    if (this.day) {
      const info = byDay.get(this.day) || { notes: [], due: [] };
      side.append(h('h2', fmtLong(this.day)));
      side.append(
        h('div.cal-side-btns', btn('New note on this day', 'file-plus', () => app.newNote('Blank', { date: this.day }), 'btn small primary'), btn(this.day === t ? 'Today’s note' : 'Daily note', 'calendar-days', () => app.navigate('#/today?date=' + this.day), 'btn small'))
      );
      side.append(h('h3', info.notes.length ? plural(info.notes.length, 'note') : 'No notes'));
      if (info.notes.length) side.append(h('ul.cal-list', info.notes.map((n) => h('li', h('a', { href: app.noteHash(n.path) }, n.title), n.dir ? h('span.hint', ' ' + n.dir) : null))));
      if (info.due.length) {
        side.append(h('h3', 'Due'));
        side.append(h('ul.cal-list', info.due.map((it) => h('li', h(`span.swatch.hl-${it.list.color || 'yellow'}`), ' ', h('a', { href: app.noteHash(it.note.path, it.task.line) }, ...richText(it.task)), h('span.hint', ' from ' + it.note.title)))));
      }
    } else side.append(h('p.hint', 'Choose a day to see its notes and what is due.'));
    this.el.replaceChildren(head, h('div.cal-wrap', grid, side));
  }
  destroy() {
    for (const off of this.offs) off();
  }
}

/* Items on lists, wherever they are shown (the lists' tiles, a person's page, a board's tray): one as a row, ticking
   one off (with Undo), and moving one to another list (with Undo). */
import { h, iconEl, toast } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { todayIso, relDay, fmtShort, fmtDayMonth, daysBetween } from '../dates.js';
import { inline } from '../inline.js';
import { draggable, itemPayload } from '../drag.js';
import { app } from '../app.js';

/** tick an item off (or not), in its note. → true if it was */
export async function tickItem(it, done) {
  try {
    const res = await lib.toggle(it.note, it.task, done);
    if (done) {
      toast('Ticked off.', 'ok', 4000, {
        label: 'Undo',
        run: async () => {
          const n = res && lib.get(res.note.path);
          if (!n || res.line == null) return toast('The note has changed: open it to undo that.', 'warn');
          try {
            await lib.toggle(n, { line: res.line, raw: res.raw, list: it.task.list }, false);
          } catch (e) {
            toast(e.message, 'bad', 8000);
          }
        }
      });
    }
    return true;
  } catch (e) {
    toast(e.name === 'ConflictError' ? 'The note was changed elsewhere just then: try again.' : e.message, 'bad', 9000);
    return false;
  }
}

/** move an item to another list (its word in its note changes). → true if it was */
export async function moveItem(it, toListId) {
  const to = S.listById(toListId);
  if (!to || to.id === it.task.list) return false;
  try {
    const res = await lib.retag(it.note, it.task, to.id);
    toast(`Moved to ${to.name}.`, 'ok', 5000, {
      label: 'Undo',
      run: () => lib.replaceLine(res.note.path, res.line, res.raw, it.task.raw).catch((e) => toast(e.message, 'bad', 8000))
    });
    return true;
  } catch (e) {
    toast(e.name === 'ConflictError' ? 'The note was changed elsewhere just then: try again.' : e.message, 'bad', 9000);
    return false;
  }
}

/** the item for a dragged payload ({path, line, raw, list}), as it is now: {task, note} or null */
export function findItem(p) {
  const note = lib.get(p.path);
  if (!note) return null;
  const task = note.tasks.find((t) => t.line === p.line && t.raw === p.raw) || note.tasks.find((t) => t.raw === p.raw && t.list === p.list);
  return task ? { task, note } : null;
}

/** an item as a row. o: {list: show its list's colour, note: show its note (true), pending: Map of ticks not yet saved,
    drag: draggable (true)} */
export function itemRow(it, o = {}) {
  const { task, note } = it;
  const list = S.listById(task.list) || { color: 'yellow', name: '' };
  const key = note.path + '\n' + task.raw;
  const done = o.pending && o.pending.has(key) ? o.pending.get(key) : task.done;
  const li = h('li.irow' + (done ? '.done' : '') + (task.priority ? '.priority' : ''), { dataset: { list: task.list } });
  if (task.checkable) {
    const cb = h('input.item-box', { type: 'checkbox', checked: done, 'aria-label': done ? 'Done: untick to undo' : 'Tick off' });
    cb.addEventListener('change', async () => {
      const want = cb.checked;
      if (o.pending) o.pending.set(key, want);
      li.classList.toggle('done', want);
      cb.disabled = true;
      const ok = await tickItem(it, want);
      if (!ok) {
        cb.checked = !want;
        li.classList.toggle('done', !want);
      }
      setTimeout(() => {
        if (o.pending) o.pending.delete(key);
        cb.disabled = false;
      }, 700);
    });
    li.append(cb);
  } else li.append(h('span.item-dot', { 'aria-hidden': 'true' }, h(`span.swatch.hl-${list.color || 'yellow'}`)));
  const text = h('a.irow-text', { href: app.noteHash(note.path, task.line), title: 'Open the note at this line', draggable: 'false' }, ...inline(task.text, { hide: task.dueText, marks: false }));
  const meta = h('span.irow-meta');
  if (o.list) meta.append(h('span.irow-list', h(`span.swatch.hl-${list.color || 'yellow'}`), list.name));
  if (task.due) {
    const n = daysBetween(todayIso(), task.due);
    meta.append(h('span.due' + (n < 0 && !done ? '.overdue' : n === 0 ? '.today' : ''), { title: fmtShort(task.due, true) }, iconEl('clock', 'small'), relDay(task.due)));
  }
  if (o.note !== false) meta.append(h('span.irow-src', { title: note.path }, note.title + (note.dated ? ', ' + fmtDayMonth(note.date) : '')));
  li.append(h('div.irow-main', text, meta.childNodes.length ? meta : null));
  if (o.drag !== false) draggable(li, () => itemPayload(task, note), task.text);
  return li;
}

/** items in the order to do them: overdue and dated first (soonest first), then the rest (newest notes first);
    within each, the urgent first */
export function byWhen(items) {
  const dated = items.filter((it) => it.task.due).sort((a, b) => (a.task.due < b.task.due ? -1 : a.task.due > b.task.due ? 1 : b.task.priority - a.task.priority));
  const rest = items.filter((it) => !it.task.due);
  rest.sort((a, b) => b.task.priority - a.task.priority);
  return dated.concat(rest);
}

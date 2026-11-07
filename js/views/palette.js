/* Ctrl+K: find a note by its title, or do something, by typing a few letters. */
import { h, iconEl, keyLabel, dialogOpen } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { fuzzy } from '../search.js';
import { fmtShort } from '../dates.js';
import { app, applyLook } from '../app.js';
import { TEMPLATE_ICONS } from './sidebar.js';

function commands() {
  const out = [
    { label: 'New note', icon: 'file-plus', key: 'Alt+N', run: () => app.newNote('Blank') },
    { label: 'New note in a folder, or on another day…', icon: 'folder-input', run: () => app.newNoteDialog() },
    { label: 'Today’s note', icon: 'calendar-days', run: () => app.today() },
    { label: 'Search all notes', icon: 'search', key: 'Ctrl+Shift+F', run: () => app.navigate('#/search/') },
    { label: 'Calendar', icon: 'calendar', key: 'Alt+C', run: () => app.navigate('#/calendar/') },
    { label: 'Settings', icon: 'settings', run: () => app.settings() },
    { label: 'Look through the folder again', icon: 'refresh-cw', run: () => app.rescan() },
    { label: 'Dark or light', icon: 'moon', run: () => ((S.device.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'), S.saveDevice(), applyLook()) },
    { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => app.settings('keys') }
  ];
  for (const l of S.shared.lists) out.splice(3, 0, { label: `List: ${l.name}`, icon: 'list-checks', key: l.id === (S.shared.lists[0] || {}).id ? 'Alt+L' : '', run: () => app.navigate('#/list/' + encodeURIComponent(l.id)) });
  for (const t of lib.templates) out.push({ label: `New: ${t.name}`, icon: TEMPLATE_ICONS[t.name.toLowerCase()] || 'file-text', run: () => (t.name.toLowerCase() === 'daily note' ? app.today() : app.newNote(t.name)) });
  if (app.view && app.view.kind === 'note') {
    const v = app.view;
    out.push(
      { label: 'This note: write or read', icon: 'book-open', key: 'Ctrl+E', run: () => v.setMode(v.mode === 'write' ? 'read' : 'write') },
      { label: 'This note: dictate', icon: 'mic', key: 'F9', run: () => v.dictate() },
      { label: 'This note: the AI', icon: 'sparkles', run: () => v.toggleAI() },
      { label: 'This note: copy as formatted text', icon: 'copy', run: () => v.copyFormatted() },
      { label: 'This note: print, or save as PDF', icon: 'printer', run: () => v.print() }
    );
  }
  return out;
}

export function openPalette() {
  if (!app.connected || dialogOpen() || document.querySelector('.palette-back')) return;
  const prev = document.activeElement;
  const input = h('input.pal-input', { type: 'text', placeholder: 'Find a note, or type a command', 'aria-label': 'Find a note or a command', spellcheck: false, autocomplete: 'off' });
  const list = h('ul.pal-list', { role: 'listbox' });
  const box = h('div.palette', { role: 'dialog', 'aria-label': 'Find' }, h('div.pal-top', iconEl('search'), input, h('kbd', 'Esc')), list);
  const back = h('div.palette-back', box);
  let items = [], sel = 0;
  const close = () => {
    back.remove();
    if (prev && prev.isConnected) prev.focus({ preventScroll: true });
  };
  const update = () => {
    const q = input.value;
    const cmds = commands().map((c) => ({ c, s: fuzzy(c.label, q) * (q ? 1 : 0.5) })).filter((x) => x.s > 0);
    const notes = lib.all({ archived: true }).map((n) => ({ n, s: q ? Math.max(fuzzy(n.title, q), fuzzy(n.name, q) * 0.9) : 1 })).filter((x) => x.s > 0);
    if (!q) {
      items = cmds.slice(0, 6).map((x) => ({ type: 'cmd', ...x })).concat(notes.slice(0, 12).map((x) => ({ type: 'note', ...x })));
    } else {
      const all = cmds.map((x) => ({ type: 'cmd', ...x, s: x.s + 5 })).concat(notes.map((x) => ({ type: 'note', ...x })));
      all.sort((a, b) => b.s - a.s);
      items = all.slice(0, 40);
      if (q.trim()) items.push({ type: 'search', q });
    }
    sel = 0;
    draw();
  };
  const draw = () => {
    list.replaceChildren(
      ...items.map((it, i) => {
        let li;
        if (it.type === 'cmd') li = h('li.pal-item', { role: 'option' }, iconEl(it.c.icon), h('span.pal-label', it.c.label), it.c.key ? h('kbd', keyLabel(it.c.key)) : null);
        else if (it.type === 'note') li = h('li.pal-item', { role: 'option' }, iconEl('file-text'), h('span.pal-label', it.n.title), h('span.pal-hint', `${fmtShort(it.n.date, true)}${it.n.dir ? '  ' + it.n.dir : ''}`));
        else li = h('li.pal-item', { role: 'option' }, iconEl('search'), h('span.pal-label', `Search the notes for “${it.q}”`));
        if (i === sel) li.classList.add('sel');
        li.setAttribute('aria-selected', String(i === sel));
        li.addEventListener('mousemove', () => {
          if (sel !== i) {
            sel = i;
            draw();
          }
        });
        li.addEventListener('click', () => go(i));
        return li;
      })
    );
    const s = list.children[sel];
    if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const go = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    if (it.type === 'cmd') it.c.run();
    else if (it.type === 'note') app.openNote(it.n.path);
    else app.navigate('#/search/' + encodeURIComponent(it.q));
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(items.length - 1, sel + 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  back.addEventListener('mousedown', (e) => e.target === back && close());
  document.body.append(back);
  update();
  input.focus();
}

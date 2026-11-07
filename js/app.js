/* =====================================================================
   TimNote: the app. Opens the folder (or asks for it), keeps the notes
   up to date, and shows a page for each address:
     #/note/<path>        a note           #/list/<id>        a list
     #/new/<template>     a new note       #/calendar/<y-m>   the calendar
     #/today              today's note     #/search/<words>   search
   ===================================================================== */
import { h, toast, keyLabel, dialogOpen, modal, btn, confirmDialog } from './util.js';
import * as fsx from './fsx.js';
import * as lib from './library.js';
import * as S from './settings.js';
import * as ai from './ai.js';
import * as rec from './recovery.js';
import { on, emit } from './bus.js';
import { todayIso } from './dates.js';
import { Sidebar } from './views/sidebar.js';
import { NoteView } from './views/note.js';
import { ListView } from './views/lists.js';
import { CalendarView } from './views/calendar.js';
import { SearchView } from './views/search.js';
import { welcome, reconnectScreen, unsupported } from './views/welcome.js';
import { openPalette } from './views/palette.js';
import { openSettings } from './views/settings.js';
import { newNoteDialog } from './views/newnote.js';

export const app = {
  view: null,
  sidebar: null,
  connected: false,
  navigate(hash, { replace = false } = {}) {
    if (location.hash === hash) return route();
    if (replace) {
      history.replaceState(null, '', hash);
      route();
    } else location.hash = hash;
  },
  noteHash: (path, line) => '#/note/' + encodeURIComponent(path) + (line != null ? '?line=' + line : ''),
  openNote(path, line) {
    app.navigate(app.noteHash(path, line));
  },
  newNote(template = 'Blank', opts = {}) {
    const q = new URLSearchParams();
    if (opts.date) q.set('date', opts.date);
    if (opts.folder != null) q.set('folder', opts.folder);
    if (opts.title) q.set('title', opts.title);
    const qs = q.toString();
    app.navigate('#/new/' + encodeURIComponent(template) + (qs ? '?' + qs : ''));
  },
  newNoteDialog: (o) => newNoteDialog(o),
  palette: () => openPalette(),
  settings: (section) => openSettings(section),
  async today() {
    app.navigate('#/today');
  },
  async rescan() {
    if (!app.connected) return;
    try {
      const changedSettings = await lib.loadShared();
      if (changedSettings) lib.reindex();
      await lib.scan();
    } catch (e) {
      console.warn('[TimNote] rescan', e);
    }
  },
  async connect() {
    document.body.classList.add('loading');
    try {
      await lib.loadShared();
      await ai.loadFolderKeys();
      await lib.scan();
      const seeded = await lib.seedTemplates();
      app.connected = true;
      document.body.classList.remove('no-folder');
      app.sidebar.render();
      if (seeded) toast(`Added a Templates folder to your notes folder, with ${seeded} templates to change as you like.`, 'ok', 8000);
      if (lib.truncated) toast('There are a great many files in this folder: TimNote has read the first 20,000. Choose a folder just for notes.', 'warn', 12000);
      offerRecovery();
    } finally {
      document.body.classList.remove('loading');
    }
  },
  changeFolder: () => app.switchFolder(() => fsx.pick()),
  /** open another folder (choose(): asks for it, → true if one was opened): the page open now is saved and closed
      first, so that nothing of this folder is saved into the other */
  async switchFolder(choose) {
    if (!(await leaveView())) return false;
    if (app.view && app.view.destroy) app.view.destroy();
    app.view = null;
    document.getElementById('main').replaceChildren();
    let ok = false;
    try {
      ok = await choose();
    } catch (e) {
      toast('The folder couldn’t be opened: ' + e.message, 'bad', 8000);
    }
    if (!ok) {
      route();
      return false;
    }
    lib.notes.clear();
    await app.connect();
    app.navigate('#/', { replace: true });
    return true;
  }
};

/* ---------------- the pages ---------------- */
let seq = 0;
async function leaveView() {
  if (app.view && app.view.leave) {
    const ok = await app.view.leave();
    if (ok === false) return false;
  }
  return true;
}
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/');
  return { name: parts[0] || '', arg: decodeURIComponent(parts.slice(1).join('/') || ''), q: new URLSearchParams(qs || '') };
}
async function route() {
  const my = ++seq;
  const main = document.getElementById('main');
  if (!app.connected) return;
  const r = parseHash();
  // the same note, at another line: no need to open it again
  if (r.name === 'note' && app.view && app.view.kind === 'note' && app.view.path === r.arg) {
    if (r.q.has('line')) app.view.goToLine(+r.q.get('line'));
    app.sidebar.setActive(r);
    return;
  }
  if (!(await leaveView())) {
    if (app.view && app.view.hash) history.replaceState(null, '', app.view.hash());
    app.pendingRestore = null;
    return;
  }
  if (my !== seq) return;
  if (app.view && app.view.destroy) app.view.destroy();
  app.view = null;
  main.replaceChildren();
  let v = null;
  try {
    if (r.name === 'note') {
      if (!lib.get(r.arg) && !(await fsx.exists(r.arg))) {
        toast('That note isn’t in the folder any more.', 'warn');
        return app.navigate('#/', { replace: true });
      }
      v = new NoteView({ path: r.arg, line: r.q.has('line') ? +r.q.get('line') : null });
      S.device.lastPath = r.arg;
      S.saveDevice();
    } else if (r.name === 'new') {
      v = new NoteView({ draft: { template: r.arg || 'Blank', date: r.q.get('date') || todayIso(), folder: r.q.get('folder'), title: r.q.get('title') } });
    } else if (r.name === 'today') {
      const d = await lib.daily(r.q.get('date') || todayIso());
      if (my !== seq) return;
      history.replaceState(null, '', app.noteHash(d.note.path));
      v = new NoteView({ path: d.note.path, cursor: d.created ? d.cursor : null });
    } else if (r.name === 'list') {
      v = new ListView(r.arg || (S.shared.lists[0] && S.shared.lists[0].id));
    } else if (r.name === 'calendar') {
      v = new CalendarView(r.arg);
    } else if (r.name === 'search') {
      v = new SearchView(r.arg);
    } else {
      // home: the last note, or To do
      const last = S.device.lastPath && lib.get(S.device.lastPath);
      return app.navigate(last ? app.noteHash(last.path) : '#/list/' + ((S.shared.lists[0] && S.shared.lists[0].id) || 'todo'), { replace: true });
    }
  } catch (e) {
    console.error(e);
    toast('That page couldn’t be opened: ' + e.message, 'bad', 8000);
    return;
  }
  if (my !== seq) {
    if (v && v.destroy) v.destroy();
    return;
  }
  app.view = v;
  main.append(v.el);
  if (v.mounted) v.mounted();
  app.sidebar.setActive(r);
  document.body.classList.remove('sidebar-open');
}

/* ---------------- unsaved changes from before ---------------- */
async function offerRecovery() {
  const list = (await rec.list()).filter((r) => !r.folder || r.folder === fsx.info().name);
  const keep = [];
  for (const r of list) {
    if (r.path) {
      const n = lib.get(r.path);
      if (n && n.text === r.text) {
        rec.clear(r.id);
        continue;
      }
    }
    if (!r.text || !r.text.trim()) {
      rec.clear(r.id);
      continue;
    }
    keep.push(r);
  }
  if (!keep.length) return;
  toast(`There are unsaved changes from before in ${keep.length === 1 ? 'a note' : keep.length + ' notes'}.`, 'warn', 0, { label: 'Show', run: () => recoveryDialog(keep) });
}
function recoveryDialog(list) {
  const rows = list.map((r) => {
    const n = r.path && lib.get(r.path);
    const name = n ? n.title : r.title || 'A new note';
    const row = h(
      'li.rec-row',
      h('div', h('b', name), h('div.hint', `${new Date(r.at).toLocaleString('en-GB')}${n && n.mtime > (r.base || 0) ? ' — the file has changed since' : ''}`)),
      btn('Copy text', 'copy', () => navigator.clipboard.writeText(r.text).then(() => toast('Copied.', 'ok')), 'btn small'),
      btn('As a new note', 'file-plus', async () => {
        try {
          const made = await lib.createNote({ folder: n ? n.dir : '', date: todayIso(), title: `${name} (recovered)`, text: r.text });
          rec.clear(r.id);
          row.remove();
          toast('Saved as a new note, beside the original.', 'ok', 5000, { label: 'Open it', run: () => app.openNote(made.path) });
        } catch (e) {
          toast(e.message, 'bad');
        }
      }, 'btn small'),
      btn('Restore', 'history', async () => {
        if (n && n.mtime > (r.base || 0) && !(await confirmDialog('The note has changed since', 'Its file has been saved since this was typed (perhaps on another computer). Restoring puts this text in place of what is there now (Ctrl+Z undoes it). Or keep both: choose “As a new note”.', 'Restore'))) return;
        m.close();
        // (the note applies it when it opens; the copy goes once it is saved)
        app.pendingRestore = { path: n ? n.path : null, text: r.text, id: r.id };
        if (n) app.openNote(n.path);
        else app.newNote('Blank', { title: r.title || '' });
      }, 'btn small primary'),
      btn('Discard', 'trash-2', () => {
        rec.clear(r.id);
        row.remove();
      }, 'btn small')
    );
    return row;
  });
  const m = modal({ title: 'Unsaved changes from before', body: h('div', h('p.hint', 'These were typed but not saved to the folder (the browser closed, or the folder couldn’t be reached).'), h('ul.rec-list', rows)), actions: [{ label: 'Close' }] });
}

/* ---------------- how it looks ---------------- */
export function applyLook() {
  const d = S.device;
  const root = document.documentElement;
  const dark = d.theme === 'dark' || (d.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.font = d.font;
  root.style.setProperty('--note-size', (+d.size || 17) + 'px');
  root.dataset.width = d.width;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#141a20' : '#1d2a3a');
}

/* ---------------- keys ---------------- */
function keys(e) {
  if (dialogOpen()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  } else if (mod && e.shiftKey && e.code === 'KeyF') {
    e.preventDefault();
    app.navigate('#/search/');
  } else if (e.altKey && !mod && e.code === 'KeyN') {
    e.preventDefault();
    newNoteDialog();
  } else if (e.altKey && !mod && e.code === 'KeyL') {
    e.preventDefault();
    app.navigate('#/list/' + ((S.shared.lists[0] && S.shared.lists[0].id) || 'todo'));
  } else if (e.altKey && !mod && e.code === 'KeyC') {
    e.preventDefault();
    app.navigate('#/calendar/');
  } else if (e.key === 'F9' && !(app.view && app.view.kind === 'note')) {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'))) {
      e.preventDefault();
      import('./dictation.js').then((d) => d.toggle(d.boxTarget(el)));
    }
  }
}
export const SHORTCUTS = [
  ['Ctrl+K', 'Find a note, or a command'],
  ['Ctrl+Shift+F', 'Search all the notes'],
  ['Alt+N', 'New note'],
  ['Alt+L', 'The To do list'],
  ['Alt+C', 'The calendar'],
  ['Ctrl+E', 'Write or read the note'],
  ['Ctrl+S', 'Save now (it saves as you type anyway)'],
  ['F9', 'Start or stop dictation'],
  ['Ctrl+Enter', 'Tick off the line the cursor is on'],
  ['Alt+T', 'Put the To do word on the line (or take it off)'],
  ['Alt+D', 'Today’s date'],
  ['Ctrl+B / Ctrl+I', 'Bold, italic'],
  ['Ctrl+F', 'Find in the note'],
  ['Ctrl+click', 'Open a link, or a [[note]]']
].map(([k, v]) => [keyLabel(k), v]);

/* ---------------- starting ---------------- */
export async function start() {
  window.TimNote = app; // (for the curious, in the browser's developer tools)
  applyLook();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook);
  on('settings', (d) => {
    if (d.scope === 'device') applyLook();
    if (d.scope === 'shared' && d.save) {
      lib.saveShared();
      lib.reindex();
    }
  });
  on('error', (d) => toast(d.message, 'bad', 9000));
  const shell = document.getElementById('app');
  app.sidebar = new Sidebar();
  shell.replaceChildren(app.sidebar.el, h('main#main', { tabindex: '-1' }));
  window.addEventListener('hashchange', route);
  // (on a small screen the sidebar slides over the page: a tap on the page closes it)
  document.getElementById('main').addEventListener('click', (e) => {
    if (document.body.classList.contains('sidebar-open') && !e.target.closest('.burger')) document.body.classList.remove('sidebar-open');
  });
  document.addEventListener('keydown', keys);
  fsx.onPermissionLost(() => permissionBanner());
  registerWorker();

  const main = document.getElementById('main');
  document.body.classList.add('no-folder');
  if (!fsx.supported() && !fsx.browserStorageSupported()) return main.replaceChildren(unsupported());
  const r = await fsx.restore();
  if (r.state === 'granted') {
    await app.connect();
    route();
  } else if (r.state === 'prompt') {
    main.replaceChildren(reconnectScreen(r.name, async () => {
      if (await fsx.reconnect()) {
        await app.connect();
        route();
      } else toast('TimNote wasn’t allowed to open the folder.', 'warn');
    }));
  } else main.replaceChildren(welcome());

  // keep up with other computers: look through the folder again when TimNote comes back into view, and now and then
  let last = Date.now();
  const again = () => {
    if (!app.connected || document.visibilityState !== 'visible' || Date.now() - last < 4000) return;
    last = Date.now();
    app.rescan().then(() => app.view && app.view.checkDisk && app.view.checkDisk());
  };
  window.addEventListener('focus', again);
  document.addEventListener('visibilitychange', again);
  setInterval(again, 90000);
}

let banner = null;
function permissionBanner() {
  if (banner) return;
  banner = h(
    'div.perm-banner',
    { role: 'alert' },
    h('span', 'TimNote has lost permission to use your notes folder, so changes can’t be saved.'),
    h('button.btn.primary.small', {
      type: 'button',
      onclick: async () => {
        if (await fsx.reconnect()) {
          banner.remove();
          banner = null;
          toast('Connected again.', 'ok');
          emit('reconnected');
        }
      }
    }, 'Allow again')
  );
  document.body.prepend(banner);
}

function registerWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version of TimNote is ready.', 'ok', 0, { label: 'Reload', run: () => location.reload() });
      });
    });
  }).catch(() => {});
}

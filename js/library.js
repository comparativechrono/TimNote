/* =====================================================================
   The notes: every note file in the folder, read into memory so that
   they can be listed, searched and have their lists pulled out. The
   folder is looked through again when TimNote comes back into view (and
   every couple of minutes), so notes written on another computer appear.

   Templates are the files in the Templates folder. Boards are files with
   "kanban-plugin:" at their top (new ones go in the Boards folder): they
   are not notes. The shared settings are .timnote/settings.json.
   ===================================================================== */
import * as fsx from './fsx.js';
import * as S from './settings.js';
import { parse, toggleAt, retagAt, newItemLine } from './tasks.js';
import { peopleIn, displayName } from './people.js';
import { NEW_BOARD, parseBoard, serializeBoard, isBoardText, noteRef, relinkCard } from './boards.js';
import { parseName, splitPath, joinPath, decodeText, decodeBytes, encodeText, isConflictCopy, fileName, freeName, cleanFolder } from './notes.js';
import { BUILTIN, parseTemplate, templateFile, fill } from './templates.js';
import { iso, todayIso } from './dates.js';
import { emit } from './bus.js';

export const notes = new Map(); // path → note
export let templates = []; // [{name, path, folder, title, format, body, builtin}]
export let folders = []; // every folder's path
export let boards = []; // [{path, name, mtime, size}]
export let truncated = false;
export const hooks = { applyToOpen: null, isDirty: null };
let ready = false;
let scanning = null;
// (when each note was last changed here: a scan that began before then has an older picture of it)
const touched = new Map();
const touch = (p) => touched.set(p, Date.now());
let sharedStamp = null;

export const isReady = () => ready;
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------------- one note ---------------- */
function make(path, raw, mtime, size, utf8 = true) {
  const { dir, name } = splitPath(path);
  const pn = parseName(name);
  const d = decodeText(raw);
  const n = { path, dir, name, ext: pn.ext, title: pn.title || (pn.date ? 'Untitled' : name), date: pn.date || iso(new Date(mtime || Date.now())), dated: !!pn.date, mtime, size, text: d.text, eol: d.eol, bom: d.bom, utf8 };
  classify(n);
  index(n);
  return n;
}
function classify(n) {
  const top = (n.dir.split('/')[0] || '').toLowerCase();
  const arch = (S.shared.archiveFolder || '').toLowerCase();
  n.archived = !!arch && !!n.dir && top === arch;
  n.conflict = isConflictCopy(n.name);
}
const TAG_RE = /(?:^|[\s(\[,;])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;
function index(n) {
  n.tasks = parse(n.text, S.lists(), n.date).tasks;
  n.open = n.tasks.filter((t) => !t.done && t.checkable).length;
  n.lc = fold(n.title + '\n' + n.text);
  n.people = peopleIn(n.text); // [{key, name}]
  const tags = new Set();
  for (const x of n.text.matchAll(TAG_RE)) tags.add(x[1].toLowerCase());
  n.tags = Array.from(tags);
}
export function reindex() {
  for (const n of notes.values()) {
    classify(n);
    index(n);
  }
  emit('notes', { reindexed: true });
}

/* ---------------- looking through the folder ---------------- */
export const isTemplate = (p) => isTemplatePath(p);
const isTemplatePath = (p) => {
  const t = (S.shared.templatesFolder || 'Templates').toLowerCase();
  return p.includes('/') && p.split('/')[0].toLowerCase() === t;
};
export const boardsFolder = () => cleanFolder(S.shared.boardsFolder || 'Boards') || 'Boards';
/** a board that is known (a file with kanban-plugin at its top) */
export const isBoard = (p) => boards.some((b) => b.path === p);

/** read the folder (only the files that have changed since the last time are read again). → {changed: [paths]} */
export function scan() {
  if (scanning) return scanning;
  scanning = (async () => {
    const began = Date.now();
    const res = await fsx.scan();
    const fresh = (p) => (touched.get(p) || 0) >= began;
    truncated = res.truncated;
    folders = res.dirs;
    const seen = new Set();
    const changed = [];
    const tpl = [];
    const brd = []; // (the boards found)
    const toRead = [];
    const known = new Map(boards.map((b) => [b.path, b]));
    for (const f of res.files) {
      if (isTemplatePath(f.path)) {
        tpl.push(f);
        continue;
      }
      if (fresh(f.path)) {
        // (saved here since the scan began: what is known here is newer)
        if (!known.has(f.path)) seen.add(f.path);
        continue;
      }
      const ob = known.get(f.path);
      if (ob) {
        if (ob.mtime === f.mtime && ob.size === f.size) brd.push(ob);
        else toRead.push(f); // (still a board? read it again)
        continue;
      }
      seen.add(f.path);
      const old = notes.get(f.path);
      if (old && old.mtime === f.mtime && old.size === f.size) continue;
      toRead.push(f);
    }
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(16, toRead.length) }, async () => {
        while (i < toRead.length) {
          const f = toRead[i++];
          try {
            const d = decodeBytes(await f.file.arrayBuffer());
            if (fresh(f.path)) continue;
            if (d.utf8 && isBoardText(decodeText(d.raw).text)) {
              // a board, not a note
              brd.push({ path: f.path, name: boardName(f.path), mtime: f.mtime, size: f.size });
              seen.delete(f.path);
              continue;
            }
            seen.add(f.path);
            const had = notes.has(f.path);
            notes.set(f.path, make(f.path, d.raw, f.mtime, f.size, d.utf8));
            if (had) changed.push(f.path);
          } catch (e) {
            /* (being written as we read: next time) */
            if (known.has(f.path)) brd.push(known.get(f.path));
            else if (!notes.has(f.path)) seen.delete(f.path);
          }
        }
      })
    );
    const gone = [];
    for (const p of Array.from(notes.keys())) {
      if (!seen.has(p) && !fresh(p)) {
        notes.delete(p);
        gone.push(p);
      }
    }
    await readTemplates(tpl);
    setBoards(brd, fresh);
    const first = !ready;
    ready = true;
    if (first || toRead.length || gone.length) emit('notes', { changed, gone });
    if (changed.length) emit('disk', { changed });
    return { changed, gone };
  })().finally(() => (scanning = null));
  return scanning;
}

async function readTemplates(files) {
  const out = [];
  for (const f of files) {
    try {
      const t = parseTemplate(decodeText(decodeBytes(await f.file.arrayBuffer()).raw).text);
      const { name } = splitPath(f.path);
      out.push({ name: name.replace(/\.(md|markdown|txt)$/i, ''), path: f.path, folder: t.folder, title: t.title, format: t.format || (/\.txt$/i.test(name) ? 'txt' : ''), body: t.body, builtin: false });
    } catch (e) {
      /* (next time) */
    }
  }
  out.sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  templates = out.length ? out : BUILTIN.map((t) => Object.assign({ path: '', format: '', builtin: true }, t));
}
const order = (name) => {
  const i = BUILTIN.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  return i < 0 ? 99 : i;
};

/** the first time a folder is opened: a Templates folder with the built-in templates, to change as you like */
export async function seedTemplates() {
  const dir = S.shared.templatesFolder || 'Templates';
  if (folders.some((f) => f.toLowerCase() === dir.toLowerCase())) return 0;
  return restoreTemplates();
}
/** write any built-in template that isn't in the Templates folder. → how many were written */
export async function restoreTemplates() {
  const dir = S.shared.templatesFolder || 'Templates';
  let n = 0;
  for (const t of BUILTIN) {
    const path = joinPath(dir, t.name + '.md');
    if (await fsx.exists(path)) continue;
    await fsx.write(path, templateFile(t), { create: true });
    n++;
  }
  await scan();
  return n;
}
export function template(name) {
  return templates.find((t) => t.name.toLowerCase() === String(name).toLowerCase()) || BUILTIN.map((t) => Object.assign({ path: '', format: '', builtin: true }, t)).find((t) => t.name.toLowerCase() === String(name).toLowerCase()) || null;
}

/* ---------------- boards ---------------- */
const boardName = (p) => splitPath(p).name.replace(/\.(md|markdown|txt)$/i, '');
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path);
function setBoards(found, fresh) {
  const before = new Map(boards.map((b) => [b.path, b]));
  const m = new Map();
  for (const b of found) if (!fresh(b.path)) m.set(b.path, b);
  // (made, changed, moved or deleted here since the scan began: as it is here)
  for (const b of boards) if (fresh(b.path)) m.set(b.path, b);
  const next = Array.from(m.values()).sort(byName);
  const changed = next.filter((b) => before.has(b.path) && before.get(b.path).mtime !== b.mtime).map((b) => b.path);
  const listChanged = next.length !== boards.length || next.some((b, i) => !boards[i] || boards[i].path !== b.path);
  boards = next;
  if (changed.length || listChanged) emit('boards', { changed, list: listChanged });
}
const safeName = (name) => String(name).trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '');
export const boardPath = (name, dir = boardsFolder()) => joinPath(dir, safeName(name) + '.md');
/** what a board's address says: its name, for one in the Boards folder; its place in the folder, for any other */
export const boardKey = (b) => (b.path.toLowerCase() === boardPath(b.name).toLowerCase() ? b.name : b.path.replace(/\.(md|markdown|txt)$/i, ''));
export function findBoard(key) {
  const k = String(key).toLowerCase();
  return boards.find((b) => boardKey(b).toLowerCase() === k) || boards.find((b) => b.name.toLowerCase() === k) || null;
}
export const boardByName = (name) => boards.find((b) => b.name.toLowerCase() === String(name).toLowerCase()) || null;
/** a new board's file. → the board's entry */
export async function createBoard(name, columns) {
  const path = boardPath(name);
  const r = await fsx.create(path, NEW_BOARD(columns));
  touch(path);
  const b = { path, name: boardName(path), mtime: r.mtime, size: r.size };
  boards = boards.filter((x) => x.path !== path).concat([b]).sort(byName);
  if (!folders.includes(boardsFolder())) folders = folders.concat([boardsFolder()]).sort((a, c) => a.localeCompare(c));
  emit('boards', { changed: [], list: true, local: true });
  return b;
}
/** a board, read from its file now. → {board, text, mtime, utf8} */
export async function readBoard(path) {
  const { raw, mtime, utf8 } = await fsx.read(path);
  const text = decodeText(raw).text;
  return { board: parseBoard(text), text, mtime, utf8 };
}
/** a change to a board (fn(board) → false if it can't be made), made on its file as it is now. → {board, changed}.
    opts.by: who made it (so that a page can tell its own changes from others') */
export async function changeBoard(path, fn, opts = {}) {
  return fsx.exclusive(path, async () => {
    for (let tries = 0; ; tries++) {
      const { raw, mtime, utf8 } = await fsx.read(path);
      if (!utf8) throw new Error(notUtf8);
      const d = decodeText(raw);
      // (only ever a board: a file that has lost its kanban-plugin line is a note again, and left alone)
      if (!isBoardText(d.text)) throw new Error('This file isn’t a board now (it has no “kanban-plugin:” line at its top), so TimNote won’t change it as one.');
      const board = parseBoard(d.text);
      if (fn(board) === false) return { board, changed: false };
      const next = serializeBoard(board);
      if (next === d.text) return { board, changed: true };
      try {
        const r = await fsx.write(path, encodeText(next, d.eol, d.bom), { expect: mtime });
        touch(path);
        const b = boards.find((x) => x.path === path);
        if (b) Object.assign(b, { mtime: r.mtime, size: r.size });
        emit('boards', { changed: [path], local: true, by: opts.by || null });
        return { board, changed: true };
      } catch (e) {
        // (written on another computer between reading and writing: made again on that)
        if (e.name !== 'ConflictError' || tries > 2) throw e;
      }
    }
  });
}
/** a board renamed (its file, in the same folder) */
export async function renameBoard(path, name) {
  const to = boardPath(name, splitPath(path).dir);
  if (to === path) return boards.find((b) => b.path === path);
  const r = await fsx.exclusive(path, () => fsx.move(path, to));
  touch(path);
  touch(to);
  boards = boards.filter((b) => b.path !== path).concat([{ path: to, name: boardName(to), mtime: r.mtime, size: r.size }]).sort(byName);
  emit('boards', { changed: [], list: true, local: true, moved: [path, to] });
  return boards.find((b) => b.path === to);
}
/** a note renamed: the cards on boards that link to it follow it. → how many boards were changed */
export async function relinkBoards(from, to) {
  const a = noteRef(from), z = noteRef(to);
  if (a === z) return 0;
  let n = 0;
  for (const b of boards.slice()) {
    try {
      const r = await changeBoard(b.path, (board) => {
        let any = false;
        for (const c of board.columns) {
          for (const card of c.cards) {
            const t = relinkCard(card.text, a, z);
            if (t != null) {
              Object.assign(card, { text: t, raw: null });
              any = true;
            }
          }
        }
        return any;
      });
      if (r.changed) n++;
    } catch (e) {
      /* (that board is left as it was) */
    }
  }
  return n;
}
export async function deleteBoard(path) {
  await fsx.exclusive(path, () => fsx.remove(path));
  touch(path);
  boards = boards.filter((b) => b.path !== path);
  emit('boards', { changed: [], list: true, local: true });
}

/* ---------------- the shared settings file ---------------- */
const SETTINGS = '.timnote/settings.json';
let sharedBase = '{}'; // (the settings as last read from or written to the folder: what changed here is what differs)
export async function loadShared() {
  try {
    const st = await fsx.stat(SETTINGS);
    if (!st) {
      S.loadShared({});
      sharedStamp = null;
      sharedBase = JSON.stringify(S.shared);
      return;
    }
    if (st.mtime === sharedStamp) return false;
    const { raw, mtime } = await fsx.read(SETTINGS);
    S.loadShared(JSON.parse(raw.replace(/^\ufeff/, '')));
    sharedStamp = mtime;
    sharedBase = JSON.stringify(S.shared);
    return true;
  } catch (e) {
    console.warn('[TimNote] settings', e);
    S.loadShared({});
    return false;
  }
}
/** theirs, with what was changed here (since the file was last read) put on top: key by key, and inside "ai" */
export function mergeShared(base, mine, theirs) {
  const out = Object.assign({}, theirs);
  for (const k of Object.keys(mine)) {
    const a = mine[k], b = base ? base[k] : undefined;
    if (k === 'ai' && a && typeof a === 'object') {
      out.ai = Object.assign({}, (theirs && theirs.ai) || {});
      for (const j of Object.keys(a)) if (JSON.stringify(a[j]) !== JSON.stringify(b && b[j])) out.ai[j] = a[j];
    } else if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = a;
    else if (!(k in out)) out[k] = a;
  }
  return out;
}
let saveTimer = null;
export function saveShared() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fsx.exclusive(SETTINGS, async () => {
      const text = () => JSON.stringify(S.shared, null, 2) + '\n';
      let r;
      try {
        r = sharedStamp == null ? await fsx.create(SETTINGS, text()) : await fsx.write(SETTINGS, text(), { expect: sharedStamp });
      } catch (e) {
        if (e.name !== 'ConflictError' && e.name !== 'ExistsError') throw e;
        // (changed on another computer meanwhile: theirs, with this computer's changes on top)
        const { raw, mtime } = await fsx.read(SETTINGS);
        const merged = mergeShared(JSON.parse(sharedBase), JSON.parse(JSON.stringify(S.shared)), JSON.parse(raw.replace(/^\ufeff/, '')));
        S.loadShared(merged);
        reindex();
        r = await fsx.write(SETTINGS, text(), { expect: mtime });
      }
      sharedStamp = r.mtime;
      sharedBase = JSON.stringify(S.shared);
    }).catch((e) => emit('error', { message: 'The settings couldn’t be saved to the notes folder: ' + e.message }));
  }, 600);
}

/* ---------------- notes in order, and what is in them ---------------- */
export function all({ archived = false } = {}) {
  return Array.from(notes.values())
    .filter((n) => archived || !n.archived)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.mtime - a.mtime));
}
export const get = (path) => notes.get(path) || null;
export function byTitle(title) {
  const t = fold(title).trim();
  if (!t) return null;
  const list = all({ archived: true });
  return list.find((n) => fold(n.title) === t) || list.find((n) => fold(n.name.replace(/\.[^.]+$/, '')) === t) || null;
}
/** every item on a list, newest notes first: [{task, note}] */
export function items(listId) {
  const out = [];
  for (const n of all()) {
    if (n.conflict) continue;
    for (const t of n.tasks) if (t.list === listId) out.push({ task: t, note: n });
  }
  return out;
}
export function counts() {
  const c = {};
  for (const n of notes.values()) {
    if (n.archived || n.conflict) continue;
    for (const t of n.tasks) {
      if (!c[t.list]) c[t.list] = { open: 0, all: 0 };
      c[t.list].all++;
      if (!t.done) c[t.list].open++;
    }
  }
  return c;
}
let peopleCache = null, tagsCache = null;
import { on } from './bus.js';
on('notes', () => {
  peopleCache = null;
  tagsCache = null;
});
/** everyone mentioned (@Millie) in the notes: Map key → {key, name, notes: [note] (newest first), open: items still
    to do that mention them}. name: the way they are written most */
export function peopleIndex() {
  if (!peopleCache) {
    const m = new Map();
    for (const n of all({ archived: true })) {
      if (n.conflict) continue;
      for (const p of n.people || []) {
        let e = m.get(p.key);
        if (!e) m.set(p.key, (e = { key: p.key, names: new Map(), notes: [], open: 0 }));
        e.names.set(p.name, (e.names.get(p.name) || 0) + 1);
        e.notes.push(n);
      }
      if (n.archived) continue;
      for (const t of n.tasks) {
        if (t.done || !t.checkable) continue;
        for (const name of t.people || []) {
          const e = m.get(String(name).toLowerCase());
          if (e) e.open++;
        }
      }
    }
    for (const e of m.values()) e.name = Array.from(e.names.entries()).sort((a, b) => b[1] - a[1])[0][0];
    peopleCache = m;
  }
  return peopleCache;
}
/** people's names for typing @ (as they are written), the most mentioned first */
export function people() {
  return Array.from(peopleIndex().values())
    .sort((a, b) => b.notes.length - a.notes.length || a.name.localeCompare(b.name))
    .map((e) => e.name);
}
export const personName = (key) => {
  const e = peopleIndex().get(String(key).toLowerCase());
  return e ? displayName(e.name) : displayName(key);
};
/** every #tag in the notes: Map tag → {tag, notes: [note] (newest first)} */
export function tagIndex() {
  if (!tagsCache) {
    const m = new Map();
    for (const n of all({ archived: true })) {
      if (n.conflict) continue;
      for (const t of n.tags || []) {
        if (!m.has(t)) m.set(t, { tag: t, notes: [] });
        m.get(t).notes.push(n);
      }
    }
    tagsCache = m;
  }
  return tagsCache;
}
export function tags() {
  return Array.from(tagIndex().values())
    .sort((a, b) => b.notes.length - a.notes.length)
    .map((e) => e.tag);
}
/** the folders a note can go in (not the templates', attachments' or archive's) */
export function noteFolders() {
  const skip = [S.shared.templatesFolder, S.shared.attachmentsFolder, S.shared.archiveFolder].filter(Boolean).map((x) => x.toLowerCase());
  return folders.filter((f) => !skip.includes(f.split('/')[0].toLowerCase()));
}
export function takenPaths() {
  return new Set(Array.from(notes.keys()).map((p) => p.toLowerCase()));
}

/* ---------------- after a note is saved, made, moved or deleted here ---------------- */
export function update(path, text, mtime, size, extra = {}) {
  if (isTemplatePath(path)) {
    // (a template, changed: read the templates again)
    touch(path);
    scan();
    return null;
  }
  const b = boards.find((x) => x.path === path);
  if (isBoardText(text)) {
    // (a board, changed as text — or a note that has become one)
    touch(path);
    if (notes.has(path)) {
      notes.delete(path);
      emit('notes', { gone: [path], local: true });
    }
    if (b) Object.assign(b, { mtime, size });
    else boards = boards.concat([{ path, name: boardName(path), mtime, size }]).sort(byName);
    emit('boards', { changed: [path], list: !b, local: true });
    return null;
  }
  if (b) {
    // (a board that has lost its kanban-plugin line: a note again)
    boards = boards.filter((x) => x !== b);
    emit('boards', { changed: [], list: true, local: true });
  }
  const old = notes.get(path);
  const n = old || make(path, '', mtime, size);
  n.text = text;
  n.mtime = mtime;
  n.size = size;
  n.utf8 = true;
  if (extra.eol) n.eol = extra.eol;
  if (extra.bom != null) n.bom = extra.bom;
  classify(n);
  index(n);
  notes.set(path, n);
  touch(path);
  emit('notes', { changed: [path], local: true });
  return n;
}
export function added(path, text, mtime, size) {
  const n = make(path, text, mtime, size);
  notes.set(path, n);
  touch(path);
  const { dir } = splitPath(path);
  if (dir && !folders.includes(dir)) {
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!folders.includes(p)) folders.push(p);
    }
    folders.sort((a, b) => a.localeCompare(b));
  }
  emit('notes', { added: [path], local: true });
  return n;
}
export function removed(path) {
  notes.delete(path);
  touch(path);
  const i = S.shared.pinned.indexOf(path);
  if (i >= 0) {
    S.shared.pinned.splice(i, 1);
    saveShared();
  }
  emit('notes', { gone: [path], local: true });
}
export function moved(from, to, mtime) {
  const b = boards.find((x) => x.path === from);
  if (b) {
    // (a board's file, renamed as text)
    touch(from);
    touch(to);
    Object.assign(b, { path: to, name: boardName(to), mtime });
    boards = boards.slice().sort(byName);
    emit('boards', { changed: [], list: true, local: true, moved: [from, to] });
    return;
  }
  const n = notes.get(from);
  notes.delete(from);
  touch(from);
  if (n) added(to, encodeText(n.text, n.eol, n.bom), mtime, n.size);
  const i = S.shared.pinned.indexOf(from);
  if (i >= 0) {
    S.shared.pinned[i] = to;
    saveShared();
  }
  emit('notes', { moved: [from, to], local: true });
}

/* ---------------- making a note ---------------- */
/** a new note's path: its folder, date and title, made safe and not already taken */
export function newPath({ folder = '', date, title, ext = 'md' }) {
  return freeName(cleanFolder(folder), fileName(date || todayIso(), title, ext), takenPaths());
}
/** make a note's file. → the note */
export async function createNote({ folder = '', date, title, ext, text = '' }) {
  const taken = takenPaths();
  const name = fileName(date || todayIso(), title, ext || S.shared.format || 'md');
  const dir = cleanFolder(folder);
  for (let tries = 0; tries < 50; tries++) {
    const path = freeName(dir, name, taken);
    try {
      const r = await fsx.create(path, text);
      return added(path, text, r.mtime, r.size);
    } catch (e) {
      // (a file of that name that hasn't been read yet — made on another computer, perhaps: the next name)
      if (e.name !== 'ExistsError') throw e;
      taken.add(path.toLowerCase());
    }
  }
  throw new Error('No free name for the note was found.');
}

/** today's daily note (made from the Daily note template if it isn't there yet). → {note, created, cursor} */
export async function daily(date = todayIso(), { create = true } = {}) {
  const t = template('Daily note');
  const folder = cleanFolder((t && t.folder) || S.shared.dailyFolder || 'Daily');
  const title = (t && t.title) || 'Daily note';
  const ext = (t && t.format) || S.shared.format || 'md';
  const want = fileName(date, title, ext).toLowerCase();
  const found = all({ archived: true }).find((n) => n.date === date && n.dir.toLowerCase() === folder.toLowerCase() && n.name.toLowerCase() === want);
  if (found || !create) return { note: found || null, created: false };
  const f = fill(t ? t.body : '', { title, date });
  const note = await createNote({ folder, date, title, ext, text: f.text });
  return { note, created: true, cursor: f.cursor };
}

/** a line added to a list from the list's page: it goes in today's daily note (under "Plan" or "To do") */
export async function addItem(list, text, due) {
  const { note } = await daily();
  const line = newItemLine(list, text, due);
  const apply = (t) => insertLine(t, line);
  if (hooks.applyToOpen && (await hooks.applyToOpen(note.path, apply))) return note;
  return fsx.exclusive(note.path, async () => {
    const { raw, utf8, mtime } = await fsx.read(note.path);
    if (!utf8) throw new Error(notUtf8);
    const d = decodeText(raw);
    const next = apply(d.text);
    const r = await fsx.write(note.path, encodeText(next, d.eol, d.bom), { expect: mtime });
    return update(note.path, next, r.mtime, r.size, { eol: d.eol, bom: d.bom });
  });
}
export const notUtf8 = 'This note’s file isn’t UTF-8 text (it may have been saved by Notepad as “ANSI”), so TimNote won’t change it: that could spoil its accented letters and symbols. Open it in Notepad, choose Save as, and set Encoding to UTF-8.';
export function insertLine(text, line) {
  const lines = text.split('\n');
  const h = lines.findIndex((l) => /^#{1,6}\s+(plan|to ?do|tasks|inbox)\b/i.test(l));
  if (h < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', '- ' + line, '');
    return lines.join('\n');
  }
  let end = h + 1, last = -1;
  for (let i = h + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    end = i + 1;
    if (lines[i].trim()) last = i;
  }
  if (last >= 0 && /^\s*[-*+]\s*(\[ \]\s*)?$/.test(lines[last])) {
    lines[last] = '- ' + line; // (the template's empty item)
    return lines.join('\n');
  }
  if (last < 0) {
    lines.splice(h + 1, 0, '', '- ' + line);
    return lines.join('\n');
  }
  lines.splice(last + 1, 0, '- ' + line);
  return lines.join('\n');
}

/* ---------------- changing a line of a note from elsewhere (a list, a board, a map) ---------------- */
/** fn(text) → the new text, applied to the note: in the editor if it is open there (and saved), or to its file */
async function editNote(note, fn) {
  if (hooks.applyToOpen && (await hooks.applyToOpen(note.path, fn))) return lib_get(note.path) || note;
  return fsx.exclusive(note.path, async () => {
    const { raw, utf8, mtime } = await fsx.read(note.path);
    if (!utf8) throw new Error(notUtf8);
    const d = decodeText(raw);
    const next = fn(d.text);
    if (next === d.text) return note;
    const r = await fsx.write(note.path, encodeText(next, d.eol, d.bom), { expect: mtime });
    return update(note.path, next, r.mtime, r.size, { eol: d.eol, bom: d.bom }) || note;
  });
}
const lib_get = (p) => notes.get(p) || null;

/** tick an item off (done = true) or not, in its note. → {note, line, raw}: the line changed, as it is now (to undo
    exactly that) */
export async function toggle(note, task, done) {
  let at = null;
  note = await editNote(note, (text) => {
    const r = toggleAt(text, task, done, S.lists(), note.date);
    if (!r) throw new Error('That line has changed since the list was made. Open the note to tick it off there.');
    at = r;
    return r.text;
  });
  return { note, line: at.line, raw: at.raw };
}

/** an item moved to another list: its word changed ("TO DO:" → "WAITING FOR:"), in its note. → {note, line, raw} */
export async function retag(note, task, toListId) {
  const to = S.listById(toListId);
  if (!to) throw new Error('There’s no such list.');
  let at = null;
  note = await editNote(note, (text) => {
    const r = retagAt(text, task, to, S.lists(), note.date);
    if (!r) throw new Error('That line couldn’t be moved: it has changed since, or it is done. Open the note to change it there.');
    at = r;
    return r.text;
  });
  return { note, line: at.line, raw: at.raw };
}

/** a line of a note put back as it was (to undo): line `line` must be `from` (or, if it has moved, the only line that
    is) */
export async function replaceLine(path, line, from, to) {
  const note = notes.get(path);
  if (!note) throw new Error('That note isn’t in the folder any more.');
  return editNote(note, (text) => {
    const lines = text.split('\n');
    let at = line;
    if (lines[at] !== from) {
      const i = lines.indexOf(from);
      if (i < 0 || lines.indexOf(from, i + 1) >= 0) throw new Error('The note has changed since: open it to undo that.');
      at = i;
    }
    lines[at] = to;
    return lines.join('\n');
  });
}

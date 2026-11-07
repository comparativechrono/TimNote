/* =====================================================================
   The notes: every note file in the folder, read into memory so that
   they can be listed, searched and have their lists pulled out. The
   folder is looked through again when TimNote comes back into view (and
   every couple of minutes), so notes written on another computer appear.

   Templates are the files in the Templates folder; the shared settings
   are .timnote/settings.json.
   ===================================================================== */
import * as fsx from './fsx.js';
import * as S from './settings.js';
import { parse, toggleInText, newItemLine } from './tasks.js';
import { parseName, splitPath, joinPath, decodeText, encodeText, isConflictCopy, fileName, freeName, cleanFolder } from './notes.js';
import { BUILTIN, parseTemplate, templateFile, fill } from './templates.js';
import { iso, todayIso } from './dates.js';
import { emit } from './bus.js';

export const notes = new Map(); // path → note
export let templates = []; // [{name, path, folder, title, format, body, builtin}]
export let folders = []; // every folder's path
export let truncated = false;
export const hooks = { applyToOpen: null, isDirty: null };
let ready = false;
let scanning = null;
let sharedStamp = null;

export const isReady = () => ready;
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------------- one note ---------------- */
function make(path, raw, mtime, size) {
  const { dir, name } = splitPath(path);
  const pn = parseName(name);
  const d = decodeText(raw);
  const n = { path, dir, name, ext: pn.ext, title: pn.title || (pn.date ? 'Untitled' : name), date: pn.date || iso(new Date(mtime || Date.now())), dated: !!pn.date, mtime, size, text: d.text, eol: d.eol, bom: d.bom };
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
function index(n) {
  n.tasks = parse(n.text, S.lists(), n.date).tasks;
  n.open = n.tasks.filter((t) => !t.done && t.checkable).length;
  n.lc = fold(n.title + '\n' + n.text);
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

/** read the folder (only the files that have changed since the last time are read again). → {changed: [paths]} */
export function scan() {
  if (scanning) return scanning;
  scanning = (async () => {
    const res = await fsx.scan();
    truncated = res.truncated;
    folders = res.dirs;
    const seen = new Set();
    const changed = [];
    const tpl = [];
    const toRead = [];
    for (const f of res.files) {
      if (isTemplatePath(f.path)) {
        tpl.push(f);
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
            const raw = await f.file.text();
            const had = notes.has(f.path);
            notes.set(f.path, make(f.path, raw, f.mtime, f.size));
            if (had) changed.push(f.path);
          } catch (e) {
            /* (being written as we read: next time) */
            if (!notes.has(f.path)) seen.delete(f.path);
          }
        }
      })
    );
    const gone = [];
    for (const p of Array.from(notes.keys())) {
      if (!seen.has(p)) {
        notes.delete(p);
        gone.push(p);
      }
    }
    await readTemplates(tpl);
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
      const raw = await f.file.text();
      const t = parseTemplate(decodeText(raw).text);
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

/* ---------------- the shared settings file ---------------- */
const SETTINGS = '.timnote/settings.json';
export async function loadShared() {
  try {
    const st = await fsx.stat(SETTINGS);
    if (!st) {
      S.loadShared({});
      sharedStamp = null;
      return;
    }
    if (st.mtime === sharedStamp) return false;
    const { raw, mtime } = await fsx.read(SETTINGS);
    S.loadShared(JSON.parse(raw));
    sharedStamp = mtime;
    return true;
  } catch (e) {
    console.warn('[TimNote] settings', e);
    S.loadShared({});
    return false;
  }
}
let saveTimer = null;
export function saveShared() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await fsx.write(SETTINGS, JSON.stringify(S.shared, null, 2) + '\n', { create: true });
      sharedStamp = r.mtime;
    } catch (e) {
      emit('error', { message: 'The settings couldn’t be saved to the notes folder: ' + e.message });
    }
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
export function people() {
  if (!peopleCache) {
    const m = new Map();
    for (const n of notes.values()) for (const t of n.tasks) for (const p of t.people) m.set(p, (m.get(p) || 0) + 1);
    peopleCache = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }
  return peopleCache;
}
export function tags() {
  if (!tagsCache) {
    const m = new Map();
    const re = /(?:^|[\s(\[,;])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;
    for (const n of notes.values()) for (const x of n.text.matchAll(re)) m.set(x[1], (m.get(x[1]) || 0) + 1);
    tagsCache = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }
  return tagsCache;
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
    scan();
    return null;
  }
  const old = notes.get(path);
  const n = old || make(path, '', mtime, size);
  n.text = text;
  n.mtime = mtime;
  n.size = size;
  if (extra.eol) n.eol = extra.eol;
  if (extra.bom != null) n.bom = extra.bom;
  classify(n);
  index(n);
  notes.set(path, n);
  emit('notes', { changed: [path], local: true });
  return n;
}
export function added(path, text, mtime, size) {
  const n = make(path, text, mtime, size);
  notes.set(path, n);
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
  const i = S.shared.pinned.indexOf(path);
  if (i >= 0) {
    S.shared.pinned.splice(i, 1);
    saveShared();
  }
  emit('notes', { gone: [path], local: true });
}
export function moved(from, to, mtime) {
  const n = notes.get(from);
  notes.delete(from);
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
  const { raw, mtime } = await fsx.read(note.path);
  const d = decodeText(raw);
  const next = apply(d.text);
  const r = await fsx.write(note.path, encodeText(next, d.eol, d.bom), { expect: mtime });
  return update(note.path, next, r.mtime, r.size, { eol: d.eol, bom: d.bom });
}
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

/* ---------------- ticking items off from a list ---------------- */
/** tick an item off (done = true) or not, in its note's file. → the note */
export async function toggle(note, task, done) {
  const fn = (text) => {
    const next = toggleInText(text, task, done, S.lists(), note.date);
    if (next == null) throw new Error('That line has changed since the list was made. Open the note to tick it off there.');
    return next;
  };
  if (hooks.applyToOpen && (await hooks.applyToOpen(note.path, fn))) return note;
  const { raw, mtime } = await fsx.read(note.path);
  const d = decodeText(raw);
  const next = fn(d.text);
  if (next === d.text) return note;
  const r = await fsx.write(note.path, encodeText(next, d.eol, d.bom), { expect: mtime });
  return update(note.path, next, r.mtime, r.size, { eol: d.eol, bom: d.bom });
}

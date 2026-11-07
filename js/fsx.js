/* =====================================================================
   The notes folder, through the browser's File System Access API (Chrome
   and Edge on a computer). The folder chosen is remembered in this
   browser (IndexedDB keeps the browser's handle to it), so each computer
   is asked only once, then at most for permission again on a later visit
   (unless "Allow on every visit" is chosen).

   Writing is careful: a note is only saved over the file if the file is
   as it was when it was read (its time stamp); if it was changed
   elsewhere — on another computer, through Dropbox — the save stops with
   a ConflictError and the note asks what to do. The browser writes a new
   copy and swaps it in, so a file is never left half-written.

   "Browser storage" is the same thing in the browser's own private
   storage: for trying TimNote out, or a browser without folder access.
   It isn't synced and can't be seen in a file manager.
   ===================================================================== */
import { idbGet, idbSet, idbDel } from './idb.js';
import { splitPath, isNoteFile, decodeBytes } from './notes.js';

export class ConflictError extends Error {
  constructor(path, mtime) {
    super('The file has been changed somewhere else since it was opened.');
    this.name = 'ConflictError';
    this.path = path;
    this.mtime = mtime;
  }
}
export class ExistsError extends Error {
  constructor(path) {
    super(`There’s already a file called “${path}”.`);
    this.name = 'ExistsError';
    this.path = path;
  }
}

const SKIP = new Set(['node_modules', '$recycle.bin', 'system volume information', '__pycache__', '.git', '.timnote', '.trash']);
const MAX_DEPTH = 8;
const MAX_FILES = 20000;

let root = null;
let mode = null; // 'folder' | 'browser'
let rootName = '';
const dirs = new Map(); // folder path → handle
let onLost = null;

export const supported = () => typeof window.showDirectoryPicker === 'function';
export const browserStorageSupported = () => !!(navigator.storage && navigator.storage.getDirectory);
export const ready = () => !!root;
export const info = () => ({ mode, name: rootName });
export const onPermissionLost = (fn) => (onLost = fn);

function setRoot(h, m, name) {
  root = h;
  mode = m;
  rootName = name || h.name;
  dirs.clear();
}

/** what was remembered: → {state: 'none' | 'granted' | 'prompt', name, mode} */
export async function restore() {
  let saved = null;
  try {
    saved = await idbGet('root');
  } catch (e) {
    return { state: 'none' };
  }
  if (!saved) return { state: 'none' };
  if (saved.mode === 'browser') {
    if (!browserStorageSupported()) return { state: 'none' };
    await useBrowserStorage();
    return { state: 'granted', name: rootName, mode };
  }
  const h = saved.handle;
  if (!h || typeof h.queryPermission !== 'function') return { state: 'none' };
  let p = 'prompt';
  try {
    p = await h.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    return { state: 'none' };
  }
  if (p === 'granted') {
    setRoot(h, 'folder', h.name);
    return { state: 'granted', name: h.name, mode };
  }
  return { state: 'prompt', name: h.name, mode: 'folder' };
}

/** permission again for the remembered folder (must come from a click). → true if granted */
export async function reconnect() {
  const saved = await idbGet('root');
  if (!saved || !saved.handle) return false;
  const p = await saved.handle.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') return false;
  setRoot(saved.handle, 'folder', saved.handle.name);
  return true;
}

/** choose a folder (from a click). → true if one was chosen */
export async function pick() {
  let h;
  try {
    h = await window.showDirectoryPicker({ id: 'timnote', mode: 'readwrite', startIn: 'documents' });
  } catch (e) {
    if (e.name === 'AbortError') return false;
    throw e;
  }
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  await idbSet('root', { mode: 'folder', handle: h, name: h.name });
  await remember(h);
  setRoot(h, 'folder', h.name);
  return true;
}
async function remember(h) {
  try {
    const list = (await idbGet('recent')) || [];
    const out = [{ handle: h, name: h.name, at: Date.now() }];
    for (const r of list) {
      if (out.length >= 6) break;
      if (r && r.handle && !(await r.handle.isSameEntry(h))) out.push(r);
    }
    await idbSet('recent', out);
  } catch (e) {
    /* (the list of recent folders is a convenience) */
  }
}
export async function recent() {
  try {
    return ((await idbGet('recent')) || []).filter((r) => r && r.handle);
  } catch (e) {
    return [];
  }
}
/** open a folder from the recent list (from a click) */
export async function openRecent(r) {
  const p = (await r.handle.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : await r.handle.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') return false;
  await idbSet('root', { mode: 'folder', handle: r.handle, name: r.handle.name });
  await remember(r.handle);
  setRoot(r.handle, 'folder', r.handle.name);
  return true;
}

export async function useBrowserStorage() {
  const o = await navigator.storage.getDirectory();
  const h = await o.getDirectoryHandle('TimNote', { create: true });
  try {
    if (navigator.storage.persist) await navigator.storage.persist();
  } catch (e) {
    /* (may be refused: the notes stay unless the browser runs short of space) */
  }
  await idbSet('root', { mode: 'browser', name: 'Browser storage' });
  setRoot(h, 'browser', 'Browser storage');
}

export async function forget() {
  await idbDel('root');
  root = null;
  mode = null;
  rootName = '';
  dirs.clear();
}

/* ---------------- handles ---------------- */
function lost(e) {
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') && onLost) onLost(e);
  return e;
}
async function dirHandle(path, create = false) {
  if (!root) throw new Error('No notes folder is open.');
  if (!path) return root;
  if (dirs.has(path)) return dirs.get(path);
  let d = root, cur = '';
  for (const part of path.split('/')) {
    cur = cur ? cur + '/' + part : part;
    if (dirs.has(cur)) {
      d = dirs.get(cur);
      continue;
    }
    d = await d.getDirectoryHandle(part, { create });
    dirs.set(cur, d);
  }
  return d;
}
async function fileHandle(path, create = false) {
  const { dir, name } = splitPath(path);
  const d = await dirHandle(dir, create);
  return d.getFileHandle(name, { create });
}
/** run fn, and if a remembered folder handle has gone stale (renamed or deleted elsewhere), forget them and try once more */
async function retry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError') && dirs.size) {
      dirs.clear();
      try {
        return await fn();
      } catch (e2) {
        throw lost(e2);
      }
    }
    throw lost(e);
  }
}

/* ---------------- reading and writing ---------------- */
/** every note file in the folder. → {files: [{path, mtime, size, file}], dirs: [path], truncated} */
export async function scan() {
  const found = [];
  const folders = [];
  let truncated = false;
  dirs.clear();
  async function walk(d, prefix, depth) {
    for await (const [name, h] of d.entries()) {
      if (truncated) return;
      if (h.kind === 'directory') {
        if (name.startsWith('.') || depth >= MAX_DEPTH || SKIP.has(name.toLowerCase())) continue;
        const p = prefix ? prefix + '/' + name : name;
        dirs.set(p, h);
        folders.push(p);
        await walk(h, p, depth + 1);
      } else if (isNoteFile(name)) {
        found.push({ path: prefix ? prefix + '/' + name : name, handle: h });
        if (found.length >= MAX_FILES) truncated = true;
      }
    }
  }
  try {
    await walk(root, '', 0);
  } catch (e) {
    throw lost(e);
  }
  const files = [];
  await pool(found, 24, async (f) => {
    try {
      const file = await f.handle.getFile();
      files.push({ path: f.path, mtime: file.lastModified, size: file.size, file });
    } catch (e) {
      /* (a file that can't be read now — being synced, or online-only — is read next time) */
    }
  });
  folders.sort((a, b) => a.localeCompare(b));
  return { files, dirs: folders, truncated };
}
async function pool(items, n, fn) {
  let i = 0;
  const run = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

/** → {raw, utf8, mtime, size} (raw: the text, with a byte-order mark if the file has one; utf8: false if the file
    isn't UTF-8 text, when it must not be written back) */
export async function read(path) {
  return retry(async () => {
    const f = await (await fileHandle(path)).getFile();
    const d = decodeBytes(await f.arrayBuffer());
    return { raw: d.raw, utf8: d.utf8, mtime: f.lastModified, size: f.size };
  });
}
/* one change to a file at a time: exclusive(path, fn) runs fn after any earlier one for the same file has finished
   (so that, say, two items ticked quickly in one note are both kept) */
const locks = new Map();
export function exclusive(path, fn) {
  const key = String(path).toLowerCase();
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => locks.get(key) === tail && locks.delete(key));
  return run;
}
export async function readBlob(path) {
  return retry(async () => (await fileHandle(path)).getFile());
}
/** → {mtime, size} or null if there's no such file */
export async function stat(path) {
  try {
    return await retry(async () => {
      const f = await (await fileHandle(path)).getFile();
      return { mtime: f.lastModified, size: f.size };
    });
  } catch (e) {
    if (e.name === 'NotFoundError' || e.name === 'TypeError') return null;
    throw e;
  }
}
export async function exists(path) {
  return (await stat(path)) != null;
}

/** save text (or a Blob). expect: the time stamp the file had when it was read (the save stops with a
    ConflictError if it has changed); create: make the file (and its folders) if it isn't there. → {mtime, size} */
export async function write(path, data, { expect = null, create = false } = {}) {
  return retry(async () => {
    const fh = await fileHandle(path, create);
    if (expect != null) {
      const now = await fh.getFile();
      if (now.lastModified !== expect) throw new ConflictError(path, now.lastModified);
    }
    const w = await fh.createWritable();
    try {
      await w.write(data);
      await w.close();
    } catch (e) {
      try {
        await w.abort();
      } catch (e2) {
        /* (already closed) */
      }
      throw e;
    }
    const f = await fh.getFile();
    const len = typeof data === 'string' ? new TextEncoder().encode(data).length : data instanceof Blob ? data.size : data.byteLength;
    // (not the size written: changed elsewhere as it was saved. A time stamp of -1 makes the note look again)
    return { mtime: f.size === len ? f.lastModified : -1, size: f.size };
  });
}
/** a new file: stops with an ExistsError if there is one of that name already. → {mtime, size} */
export async function create(path, data) {
  if (await exists(path)) throw new ExistsError(path);
  return write(path, data, { create: true });
}
export async function remove(path) {
  return retry(async () => {
    const { dir, name } = splitPath(path);
    await (await dirHandle(dir)).removeEntry(name);
  });
}
/** move or rename a file: the new one is written first, then the old one taken away. expect: the time stamp the file
    had when it was last read or saved (a ConflictError if it has changed since). → {mtime, size} */
export async function move(from, to, { expect = null } = {}) {
  if (from === to) return stat(from);
  const caseOnly = from.toLowerCase() === to.toLowerCase();
  if (!caseOnly && (await exists(to))) throw new ExistsError(to);
  const blob = await readBlob(from);
  if (expect != null && blob.lastModified !== expect) throw new ConflictError(from, blob.lastModified);
  const data = await blob.arrayBuffer();
  if (caseOnly) {
    // (on Windows and macOS "a.md" and "A.md" are the same file: go through a third name)
    // (a note's name, so that if anything stops it half way the note is still listed, as "… (renaming).md")
    const tmp = /\.[^./]+$/.test(from) ? from.replace(/(\.[^./]+)$/, ' (renaming)$1') : from + ' (renaming)';
    await write(tmp, data, { create: true });
    await remove(from);
    const r = await write(to, data, { create: true });
    await remove(tmp);
    return r;
  }
  const r = await write(to, data, { create: true });
  await remove(from);
  return r;
}
export async function ensureFolder(path) {
  return retry(() => dirHandle(path, true));
}

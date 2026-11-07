/* A safety net: what is typed is copied into the browser's storage at once, and the copy is deleted when the note
   has been saved to the folder. If the browser closes or the folder can't be reached before a save, the copy is
   offered back the next time. */
import { idbGet, idbSet, idbDel, idbKeys } from './idb.js';

const P = 'rec:';
const key = (id) => P + id;
let timers = new Map();

/** keep a copy (after a moment's pause) of the text of a note (id: its path, or 'draft:…' for a new one) */
export function keep(id, rec) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      idbSet(key(id), Object.assign({ at: Date.now() }, rec)).catch(() => {});
    }, 400)
  );
}
/** keep a copy now (the page is closing) */
export function keepNow(id, rec) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  idbSet(key(id), Object.assign({ at: Date.now() }, rec)).catch(() => {});
}
export function clear(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  return idbDel(key(id)).catch(() => {});
}
export async function list() {
  try {
    const keys = (await idbKeys()).filter((k) => typeof k === 'string' && k.startsWith(P));
    const out = [];
    for (const k of keys) {
      const v = await idbGet(k);
      if (v) out.push(Object.assign({ id: k.slice(P.length) }, v));
    }
    return out.sort((a, b) => b.at - a.at);
  } catch (e) {
    return [];
  }
}
export const get = (id) => idbGet(key(id)).catch(() => null);

/* A tiny key-value store in IndexedDB: the folder TimNote was given (a handle the browser can keep between
   visits), and copies of unsaved typing, kept until they are saved to the folder. */
const DB = 'timnote';
const STORE = 'kv';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('The browser’s storage is busy in another tab.'));
    });
  }
  return dbp;
}
function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const req = fn(s);
        t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}
export const idbGet = (k) => tx('readonly', (s) => s.get(k));
export const idbSet = (k, v) => tx('readwrite', (s) => s.put(v, k));
export const idbDel = (k) => tx('readwrite', (s) => s.delete(k));
export const idbKeys = () => tx('readonly', (s) => s.getAllKeys());

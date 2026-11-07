/* Messages between the parts of the app: on('notes', fn), emit('notes', detail). */
const handlers = new Map();
export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  return () => handlers.get(name).delete(fn);
}
export function emit(name, detail) {
  for (const fn of Array.from(handlers.get(name) || [])) {
    try {
      fn(detail);
    } catch (e) {
      console.error(`[TimNote] ${name}:`, e);
    }
  }
}

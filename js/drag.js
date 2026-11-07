/* Dragging things about: an item on a list, a note, or a card on a board, onto a board, another list or a column.
   What is dragged travels as a little JSON of its own (and as plain text, for dropping into other programs). */
const MIME = 'application/x-timnote';
let current = null; // (what is being dragged now: dragover can't read the data, only its kinds)

/** make el draggable: payload() → {kind: 'item', path, line, raw, list, text} | {kind: 'note', path, title} |
    {kind: 'card', ...}; text: what other programs get */
export function draggable(el, payload, text = '') {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    const p = typeof payload === 'function' ? payload() : payload;
    if (!p) return e.preventDefault();
    current = p;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(MIME, JSON.stringify(p));
    e.dataTransfer.setData('text/plain', typeof text === 'function' ? text() : text || p.text || p.title || '');
    el.classList.add('dragging');
    document.body.classList.add('dragging-' + p.kind, 'dragging-any');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document.body.classList.remove('dragging-item', 'dragging-note', 'dragging-card', 'dragging-any');
    current = null;
  });
}

/** what is being dragged (in dragover), if it is one of TimNote's */
export const dragging = () => current;
// (if what was being dragged was taken off the page meanwhile, its own dragend may never come: these make sure)
function reset() {
  if (!current) return;
  current = null;
  document.body.classList.remove('dragging-item', 'dragging-note', 'dragging-card', 'dragging-any');
  for (const el of document.querySelectorAll('.dragging')) if (el.draggable) el.classList.remove('dragging');
}
document.addEventListener('dragend', reset, true);
document.addEventListener('drop', () => setTimeout(reset, 0), true);
document.addEventListener('pointerdown', reset, true);
/** what was dropped, or null */
export function dropped(e) {
  try {
    const raw = e.dataTransfer.getData(MIME);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}
/** make el a place things can be dropped: accept(payload) → true if it can be dropped here; drop(payload, e) */
export function dropTarget(el, { accept, drop, over }) {
  let depth = 0;
  const ok = (e) => {
    const p = current;
    if (!p && !Array.from(e.dataTransfer.types || []).includes(MIME)) return false;
    return !p || !accept || accept(p);
  };
  el.addEventListener('dragenter', (e) => {
    if (!ok(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('drop-here');
  });
  el.addEventListener('dragover', (e) => {
    if (!ok(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = current && current.kind === 'card' ? 'move' : 'copy';
    if (over) over(e, current);
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) {
      el.classList.remove('drop-here');
      if (over) over(null, current);
    }
  });
  el.addEventListener('drop', (e) => {
    depth = 0;
    el.classList.remove('drop-here');
    if (over) over(null, current);
    const p = dropped(e);
    if (!p || (accept && !accept(p))) return;
    e.preventDefault();
    e.stopPropagation();
    drop(p, e);
  });
}

/* the payloads */
export const itemPayload = (task, note) => ({ kind: 'item', path: note.path, line: task.line, raw: task.raw, list: task.list, text: task.text });
export const notePayload = (note) => ({ kind: 'note', path: note.path, title: note.title });

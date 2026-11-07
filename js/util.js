/* Small helpers used everywhere: building DOM, icons, toasts, dialogs and menus. */
import { ICONS } from '../vendor/icons.js';

/** h('button.btn.primary#go', {onclick, title}, 'Go', child, [more]) → element */
export function h(sel, ...args) {
  const m = /^([a-z][a-z0-9-]*)?([.#][^\s]*)?$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][^.#]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const a of args) add(el, a);
  return el;
}
function add(el, a) {
  if (a == null || a === false || a === true) return;
  if (Array.isArray(a)) return a.forEach((x) => add(el, x));
  if (a instanceof Node) return el.append(a);
  if (typeof a === 'object') return attrs(el, a);
  el.append(String(a));
}
function attrs(el, o) {
  for (const [k, v] of Object.entries(o)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

/** an icon as SVG markup (Lucide) */
export function icon(name, cls = '') {
  const inner = ICONS[name] || ICONS['circle-help'];
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}
/** an icon as an element */
export function iconEl(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}
/** a button with an icon and (optionally) a label */
export function btn(label, iconName, onclick, cls = '', attrsObj = {}) {
  const b = h('button' + (cls ? '.' + cls.split(/\s+/).join('.') : ''), Object.assign({ type: 'button', onclick }, attrsObj));
  if (iconName) b.append(iconEl(iconName));
  if (label) b.append(h('span', label));
  return b;
}
export function iconBtn(iconName, title, onclick, cls = '') {
  return h('button.icon-btn' + (cls ? '.' + cls.split(/\s+/).join('.') : ''), { type: 'button', title, 'aria-label': title, onclick, html: icon(iconName) });
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...a);
    }, ms);
  };
  d.cancel = () => clearTimeout(t);
  d.pending = () => t != null;
  d.flush = (...a) => {
    if (t != null) {
      clearTimeout(t);
      t = null;
      fn(...a);
    }
  };
  return d;
}
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

/** a short, plain message at the foot of the screen. kind: '' | 'ok' | 'warn' | 'bad'. action: {label, run} */
export function toast(msg, kind = '', ms = 4500, action = null) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div#toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = h('div.toast' + (kind ? '.' + kind : ''), h('span.msg', msg));
  const close = () => {
    t.classList.add('going');
    setTimeout(() => t.remove(), 180);
  };
  if (action) t.append(h('button.toast-act', { type: 'button', onclick: () => (close(), action.run()) }, action.label));
  t.append(h('button.toast-x', { type: 'button', 'aria-label': 'Dismiss', onclick: close, html: icon('x') }));
  box.append(t);
  if (ms) setTimeout(close, ms);
  return close;
}

/* ---------------- dialogs ---------------- */
let openDialogs = 0;
export const dialogOpen = () => openDialogs > 0;

/** a modal dialog. → {el, close} . actions: [{label, primary, danger, onClick(close) → false keeps it open}] */
export function modal({ title, body, actions = [], wide = false, onClose = null, cls = '' }) {
  const prevFocus = document.activeElement;
  const back = h('div.modal-back');
  const box = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const head = h('div.modal-head', h('h2', title || ''), iconBtn('x', 'Close', () => close()));
  const main = h('div.modal-body', body);
  box.append(head, main);
  if (actions.length) {
    const foot = h('div.modal-foot');
    for (const a of actions) {
      const b = h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), { type: a.submit ? 'submit' : 'button' }, a.label);
      b.addEventListener('click', async () => {
        const r = a.onClick ? await a.onClick(close) : undefined;
        if (r !== false) close();
      });
      if (a.left) b.classList.add('left');
      foot.append(b);
    }
    box.append(foot);
  }
  back.append(box);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    openDialogs--;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(result);
    if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = Array.from(box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) (last.focus(), e.preventDefault());
      else if (!e.shiftKey && document.activeElement === last) (first.focus(), e.preventDefault());
    }
  }
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  openDialogs++;
  setTimeout(() => {
    const auto = box.querySelector('[autofocus]') || box.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select') || box.querySelector('.modal-foot .primary') || box.querySelector('button');
    if (auto) auto.focus();
  }, 20);
  return { el: box, close };
}

/** → Promise<boolean> */
export function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let ok = false;
    modal({
      title,
      body: h('p.dialog-text', text),
      actions: [
        { label: 'Cancel' },
        { label: okLabel, primary: !danger, danger, onClick: () => (ok = true) }
      ],
      onClose: () => resolve(ok)
    });
  });
}

/** → Promise<string|null> */
export function promptDialog(title, label, value = '', okLabel = 'OK', hint = '') {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.input', { type: 'text', value, spellcheck: false, 'aria-label': label });
    const form = h('form.form', h('label.field', h('span.field-label', label), input, hint ? h('span.hint', hint) : null));
    let m;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      result = input.value;
      m.close();
    });
    m = modal({
      title,
      body: form,
      actions: [{ label: 'Cancel' }, { label: okLabel, primary: true, onClick: () => (result = input.value) }],
      onClose: () => resolve(result)
    });
    setTimeout(() => input.select(), 30);
  });
}

/* ---------------- menus ---------------- */
let menuOpen = null;
/** a dropdown menu beside anchor. items: [{label, icon, onClick, danger, disabled, checked, hint} | '-' ] */
export function menu(anchor, items, { align = 'left' } = {}) {
  if (menuOpen) menuOpen();
  const box = h('div.menu', { role: 'menu' });
  const btns = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') {
      box.append(h('div.menu-sep', { role: 'separator' }));
      continue;
    }
    if (it.heading) {
      box.append(h('div.menu-head', it.heading));
      continue;
    }
    const b = h('button.menu-item' + (it.danger ? '.danger' : '') + (it.checked ? '.checked' : ''), { type: 'button', role: 'menuitem', disabled: !!it.disabled });
    b.append(it.icon ? iconEl(it.icon) : h('span.ic-space'), h('span.menu-label', it.label));
    if (it.hint) b.append(h('span.menu-hint', it.hint));
    b.addEventListener('click', () => {
      close();
      if (it.onClick) it.onClick();
    });
    btns.push(b);
    box.append(b);
  }
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let left = align === 'right' ? r.right - bw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
  let top = r.bottom + 4;
  if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 4);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
  const onDoc = (e) => {
    if (!box.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      (btns[(i + 1) % btns.length] || btns[0]).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (btns[(i - 1 + btns.length) % btns.length] || btns[0]).focus();
    }
  };
  function close() {
    box.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    if (menuOpen === close) menuOpen = null;
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    const first = btns.find((b) => !b.disabled);
    if (first) first.focus();
  }, 0);
  menuOpen = close;
  return close;
}

/* ---------------- clipboard and downloads ---------------- */
export async function copyText(text, html = null) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}
export function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

/** a keyboard shortcut's label, for this computer */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const keyLabel = (k) => (isMac ? k.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : k);

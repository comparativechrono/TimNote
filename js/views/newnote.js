/* A new note, choosing its template, title, date, folder and kind of file. */
import { h, iconEl, modal, toast } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { fill } from '../templates.js';
import { cleanFolder, fileName, joinPath } from '../notes.js';
import { todayIso } from '../dates.js';
import { app } from '../app.js';
import { TEMPLATE_ICONS } from './sidebar.js';

export function newNoteDialog({ date = todayIso(), template = '' } = {}) {
  if (!app.connected) return;
  const tpls = [{ name: 'Blank', title: '', folder: S.shared.folder, body: '' }].concat(lib.templates);
  let chosen = tpls.find((t) => t.name === template) || tpls[0];
  const title = h('input.input', { type: 'text', placeholder: 'Title', value: chosen.title || '' });
  const dateIn = h('input.input', { type: 'date', value: date });
  const folders = lib.noteFolders();
  const folderSel = h('select.input', h('option', { value: '' }, '(the top of the notes folder)'), folders.map((f) => h('option', { value: f }, f)), h('option', { value: '\u0000new' }, 'A new folder…'));
  const fresh = h('input.input', { type: 'text', placeholder: 'Name of the new folder', hidden: true, spellcheck: false });
  folderSel.addEventListener('change', () => {
    fresh.hidden = folderSel.value !== '\u0000new';
    if (!fresh.hidden) fresh.focus();
    preview();
  });
  const fmt = h('select.input', h('option', { value: 'md' }, 'Markdown (.md)'), h('option', { value: 'txt' }, 'Plain text (.txt)'));
  const where = h('p.hint.where');
  const folderOf = () => cleanFolder(folderSel.value === '\u0000new' ? fresh.value : folderSel.value);
  const preview = () => (where.textContent = 'The file: ' + joinPath(folderOf(), fileName(dateIn.value || todayIso(), title.value, fmt.value)));
  const setFolder = (f) => {
    f = cleanFolder(f || '');
    if (f && !folders.includes(f)) {
      folderSel.value = '\u0000new';
      fresh.hidden = false;
      fresh.value = f;
    } else {
      folderSel.value = f;
      fresh.hidden = true;
    }
  };
  const pick = (t) => {
    chosen = t;
    for (const b of grid.children) b.setAttribute('aria-pressed', String(b.dataset.name === t.name));
    title.value = t.title || '';
    setFolder(t.folder != null ? t.folder : S.shared.folder);
    fmt.value = t.format || S.shared.format || 'md';
    preview();
  };
  const grid = h('div.tpl-grid', { role: 'group', 'aria-label': 'Template' });
  for (const t of tpls) {
    const b = h('button.tpl-pick', { type: 'button', dataset: { name: t.name }, 'aria-pressed': 'false' }, iconEl(t.name === 'Blank' ? 'file-plus' : TEMPLATE_ICONS[t.name.toLowerCase()] || 'file-text'), h('span', t.name === 'Blank' ? 'Blank note' : t.name));
    b.addEventListener('click', () => pick(t));
    grid.append(b);
  }
  for (const el of [title, dateIn, fresh, fmt]) el.addEventListener('input', preview);
  const create = async () => {
    const d = dateIn.value || todayIso();
    const f = fill(chosen.body || '', { title: title.value.trim(), date: d });
    try {
      const n = await lib.createNote({ folder: folderOf(), date: d, title: title.value.trim() || chosen.title || 'Untitled', ext: fmt.value, text: f.text });
      app.navigate(app.noteHash(n.path));
      return true;
    } catch (e) {
      toast('The note couldn’t be made: ' + e.message, 'bad', 8000);
      return false;
    }
  };
  const form = h('form.form', h('div.field', h('span.field-label', 'Template'), grid), h('label.field', h('span.field-label', 'Title'), title), h('div.form.cols', h('label.field', h('span.field-label', 'Date'), dateIn), h('label.field', h('span.field-label', 'Kind of file'), fmt)), h('label.field', h('span.field-label', 'Folder'), folderSel, fresh), where);
  let m;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await create()) m.close();
  });
  m = modal({ title: 'New note', body: form, wide: true, actions: [{ label: 'Cancel' }, { label: 'Make the note', primary: true, onClick: () => create() }] });
  pick(chosen);
  setTimeout(() => title.focus(), 30);
}

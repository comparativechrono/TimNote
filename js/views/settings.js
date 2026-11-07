/* Settings: the folder, new notes, the lists and their words, templates, how it looks, dictation and the AI. */
import { h, icon, iconEl, btn, modal, toast, confirmDialog, promptDialog, uid } from '../util.js';
import * as S from '../settings.js';
import * as lib from '../library.js';
import * as fsx from '../fsx.js';
import * as ai from '../ai.js';
import * as dict from '../dictation.js';
import { COLORS, parseTrigger } from '../tasks.js';
import { cleanFolder, joinPath } from '../notes.js';
import { app, applyLook, SHORTCUTS } from '../app.js';
import { TEMPLATE_ICONS } from './sidebar.js';

export const VERSION = '1.0.0';

const field = (label, control, hint) => h('label.field', h('span.field-label', label), control, hint ? h('span.hint', hint) : null);
const select = (value, options, onchange) => {
  const s = h('select.input', options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  s.addEventListener('change', () => onchange(s.value));
  return s;
};
const check = (label, value, onchange, hint) => {
  const c = h('input', { type: 'checkbox', checked: !!value });
  c.addEventListener('change', () => onchange(c.checked));
  return h('label.check', c, h('span', label, hint ? h('span.hint.block', hint) : null));
};
const shared = () => S.sharedChanged();
const device = () => S.saveDevice();

export function openSettings(section) {
  const sections = [
    ['folder', 'Your notes folder', folderSection],
    ['new', 'New notes', newSection],
    ['lists', 'Lists', listsSection],
    ['templates', 'Templates', templatesSection],
    ['look', 'How it looks', lookSection],
    ['dictation', 'Dictation', dictationSection],
    ['ai', 'The AI', aiSection],
    ['keys', 'Keyboard', keysSection],
    ['about', 'About', aboutSection]
  ];
  const nav = h('nav.set-nav');
  const main = h('div.set-main');
  let m;
  for (const [id, label, fn] of sections) {
    if (!app.connected && ['new', 'lists', 'templates'].includes(id)) continue;
    const sec = h('section.set-sec', { id: 'set-' + id }, h('h3', label), fn(() => m));
    main.append(sec);
    nav.append(h('a', { href: '#set-' + id, onclick: (e) => (e.preventDefault(), sec.scrollIntoView({ behavior: 'smooth', block: 'start' })) }, label));
  }
  m = modal({ title: 'Settings', body: h('div.settings', nav, main), wide: true, cls: 'settings-modal' });
  if (section) setTimeout(() => {
    const s = main.querySelector('#set-' + section);
    if (s) s.scrollIntoView({ block: 'start' });
  }, 40);
}

/* ---------------- the folder ---------------- */
function folderSection() {
  const info = fsx.info();
  const box = h('div.form');
  if (!app.connected) {
    box.append(h('p', 'No folder is open yet.'));
    return box;
  }
  box.append(
    h('p.folder-line', iconEl(info.mode === 'browser' ? 'hard-drive' : 'folder'), h('b', info.name || 'Notes'), h('span.hint', info.mode === 'browser' ? ' (kept in this browser only: not synced, and not in a file manager)' : ' (on this computer)')),
    h('div.btn-row', btn('Choose another folder…', 'folder-open', () => app.changeFolder(), 'btn'), btn('Look through it again', 'refresh-cw', async () => (await app.rescan(), toast('Up to date.', 'ok', 2000)), 'btn')),
    h('p.hint', 'Each browser on each computer remembers the folder it was given. Choose the same folder in Dropbox (or OneDrive, or Google Drive for desktop) on every computer and they all have the same notes. If it asks for permission each time, choose “Allow on every visit”.'),
    h('p.hint', 'TimNote keeps its settings in a folder called .timnote inside your notes folder, so they are the same on every computer.')
  );
  return box;
}

/* ---------------- new notes ---------------- */
function newSection() {
  const folders = lib.noteFolders();
  const opts = [['', '(the top of the notes folder)']].concat(folders.map((f) => [f, f]));
  return h(
    'div.form',
    field('Kind of file', select(S.shared.format, [['md', 'Markdown (.md): headings, bold and checkboxes are shown as such'], ['txt', 'Plain text (.txt)']], (v) => ((S.shared.format = v), shared())), 'Both are plain text that any computer can open and search.'),
    field('Folder for blank notes', select(S.shared.folder, opts, (v) => ((S.shared.folder = v), shared())), 'Notes from a template go in the template’s folder.'),
    h('p.hint', 'Each note’s file is named with its date and title, such as “2026-11-06 Lab meeting.md”, so that the files sort by date in any file manager.')
  );
}

/* ---------------- lists ---------------- */
function listsSection() {
  const box = h('div.form');
  const rows = h('div.lists-edit');
  const draw = () => {
    rows.replaceChildren(h('div.le-head', h('span'), h('span', 'List'), h('span', 'Words that put a line on it'), h('span', 'Word for done'), h('span')));
    S.shared.lists.forEach((l, i) => rows.append(row(l, i)));
  };
  const commit = () => {
    S.shared.lists = S.shared.lists.filter((l) => l.name.trim() && l.triggers.some((t) => parseTrigger(t).words.length));
    shared();
  };
  const row = (l, i) => {
    const colour = h('select.input.le-colour', { 'aria-label': 'Colour', title: 'Colour' }, COLORS.map((c) => h('option', { value: c, selected: c === l.color }, c)));
    const sw = h(`span.swatch.big.hl-${l.color || 'yellow'}`);
    colour.addEventListener('change', () => {
      l.color = colour.value;
      sw.className = `swatch big hl-${l.color}`;
      commit();
    });
    const name = h('input.input', { type: 'text', value: l.name, 'aria-label': 'Name of the list' });
    name.addEventListener('change', () => {
      l.name = name.value.trim() || l.name;
      commit();
    });
    const words = h('input.input', { type: 'text', value: (l.triggers || []).join(', '), 'aria-label': 'Words that put a line on it', spellcheck: false });
    words.addEventListener('change', () => {
      const t = words.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!t.length) {
        toast('A list needs at least one word.', 'warn');
        words.value = l.triggers.join(', ');
        return;
      }
      l.triggers = t;
      commit();
    });
    const done = h('input.input', { type: 'text', value: l.done || '', placeholder: '(none: a record)', 'aria-label': 'Word for done', spellcheck: false });
    done.addEventListener('change', () => {
      const v = done.value.trim();
      const all = S.shared.lists.flatMap((x) => (x === l ? x.triggers : x.triggers.concat(x.done ? [x.done] : []))).map((x) => parseTrigger(x).label.toLowerCase());
      if (v && all.includes(parseTrigger(v).label.toLowerCase())) {
        toast('That word is already used by a list.', 'warn');
        done.value = l.done || '';
        return;
      }
      l.done = v;
      commit();
    });
    const del = h('button.icon-btn', { type: 'button', title: 'Remove this list', 'aria-label': 'Remove this list', html: icon('trash-2') });
    del.addEventListener('click', async () => {
      if (S.shared.lists.length <= 1) return toast('There has to be at least one list.', 'warn');
      if (!(await confirmDialog('Remove this list?', `“${l.name}” will no longer be collected. Nothing in your notes is changed.`, 'Remove', true))) return;
      S.shared.lists.splice(i, 1);
      commit();
      draw();
    });
    return h('div.le-row', h('div.le-c', sw, colour), name, words, done, del);
  };
  draw();
  box.append(
    h('p.hint', 'A line with one of a list’s words goes on that list: “TO DO: book the room”. So do bullets under a heading that is the word (“## To do”, “## Actions”), or after a line that is just the word. Separate words with commas; capitals don’t matter unless you say so below. The first list also collects Markdown checkboxes. Ticking an item off changes its word to the done word (or ticks its checkbox) in the note itself.'),
    rows,
    h(
      'div.btn-row',
      btn('Add a list', 'plus', () => {
        const used = new Set(S.shared.lists.map((l) => l.color));
        S.shared.lists.push({ id: 'l' + uid(), name: 'New list', triggers: ['NEW:'], done: '', color: COLORS.find((c) => !used.has(c)) || 'grey' });
        commit();
        draw();
      }, 'btn small'),
      btn('Put back the original lists', 'refresh-cw', async () => {
        if (!(await confirmDialog('Put back the original lists?', 'The lists and their words go back to how they were at first.', 'Put them back'))) return;
        S.shared.lists = JSON.parse(JSON.stringify(S.SHARED_DEFAULTS.lists));
        commit();
        draw();
      }, 'btn small')
    ),
    check('Markdown checkboxes (- [ ] …) go on the first list', S.shared.checkboxes, (v) => ((S.shared.checkboxes = v), shared())),
    check('Capitals must match (TO DO: but not To do:)', S.shared.caseSensitive, (v) => ((S.shared.caseSensitive = v), shared()))
  );
  return box;
}

/* ---------------- templates ---------------- */
function templatesSection(getModal) {
  const box = h('div.form');
  const list = h('ul.tpl-list');
  const draw = () => {
    list.replaceChildren(
      ...lib.templates.map((t) =>
        h(
          'li',
          iconEl(TEMPLATE_ICONS[t.name.toLowerCase()] || 'file-text'),
          h('span.tpl-name', t.name),
          h('span.hint', t.folder ? `goes in ${t.folder}` : ''),
          t.path
            ? btn('Change it', 'pencil', () => {
                getModal().close();
                app.openNote(t.path);
              }, 'btn small')
            : h('span.hint', 'built in')
        )
      )
    );
  };
  draw();
  box.append(
    h('p.hint', `Templates are notes in the “${S.shared.templatesFolder}” folder: change them like any note. At the top of each, “folder:” is where its notes go and “title:” the title a new note starts with. In the text, {{title}}, {{date}}, {{date:long}}, {{weekday}} and {{time}} are filled in, and {{cursor}} is where you start typing.`),
    list,
    h(
      'div.btn-row',
      btn('New template', 'file-plus', async () => {
        const name = await promptDialog('New template', 'Name', '', 'Make it');
        if (!name || !name.trim()) return;
        const path = joinPath(S.shared.templatesFolder || 'Templates', name.trim().replace(/[\\/:*?"<>|]/g, '-') + '.md');
        try {
          await fsx.create(path, `---\nfolder: \ntitle: ${name.trim()}\n---\n# {{title}}\n\n{{date:long}}\n\n{{cursor}}\n`);
          await lib.scan();
          getModal().close();
          app.openNote(path);
        } catch (e) {
          toast(e.message, 'bad');
        }
      }, 'btn small'),
      btn('Put back the built-in templates', 'refresh-cw', async () => {
        try {
          const n = await lib.restoreTemplates();
          draw();
          toast(n ? `${n} template${n === 1 ? '' : 's'} put back.` : 'They are all there already.', 'ok');
        } catch (e) {
          toast(e.message, 'bad');
        }
      }, 'btn small')
    )
  );
  return box;
}

/* ---------------- how it looks ---------------- */
function lookSection() {
  const d = S.device;
  return h(
    'div.form.cols',
    field('Light or dark', select(d.theme, [['auto', 'As the computer is set'], ['light', 'Light'], ['dark', 'Dark']], (v) => ((d.theme = v), device(), applyLook()))),
    field('Typeface for notes', select(d.font, [['serif', 'Literata (a book face)'], ['sans', 'The computer’s own sans serif'], ['mono', 'Typewriter (monospace)']], (v) => ((d.font = v), device(), applyLook()))),
    field('Text size', select(d.size, [15, 16, 17, 18, 19, 20, 22].map((n) => [n, n + ' px' + (n === 17 ? ' (usual)' : '')]), (v) => ((d.size = +v), device(), applyLook()))),
    field('Width of the page', select(d.width, [['narrow', 'Narrow'], ['normal', 'Usual'], ['wide', 'Wide'], ['full', 'The whole window']], (v) => ((d.width = v), device(), applyLook())))
  );
}

/* ---------------- dictation ---------------- */
function dictationSection() {
  const d = S.device.dictation;
  const sup = dict.supported();
  return h(
    'div.form',
    field(
      'How',
      select(d.engine, [['browser', 'The browser’s own speech recognition' + (sup.browser ? '' : ' (not in this browser)')], ['gemini', 'Recorded, then written out by Gemini']], (v) => ((d.engine = v), device())),
      'The browser’s: the words appear as you speak (Chrome, Edge; the sound goes to Google’s or Microsoft’s speech service). Gemini: better with unusual words, but the text comes when you stop, and it needs a Gemini key.'
    ),
    field('Language', select(d.lang, [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['en-IE', 'English (Ireland)'], ['en-AU', 'English (Australia)'], ['cy-GB', 'Welsh'], ['fr-FR', 'French'], ['de-DE', 'German'], ['es-ES', 'Spanish'], ['it-IT', 'Italian']], (v) => ((d.lang = v), device()))),
    check('Spoken punctuation', d.spoken !== false, (v) => ((d.spoken = v), device()), 'Say “full stop”, “comma”, “question mark”, “new paragraph”, “new bullet” — and “action point” or “new to do” to start a new To do line.'),
    h('p.hint', 'Press the microphone, or F9, to start and stop.')
  );
}

/* ---------------- the AI ---------------- */
function aiSection() {
  const a = S.shared.ai;
  const box = h('div.form');
  const prov = select(a.provider, [['gemini', 'Google Gemini'], ['anthropic', 'Anthropic Claude']], (v) => {
    a.provider = v;
    shared();
    show();
  });
  const dl = (id, list) => h('datalist', { id }, list.map(([v, l]) => h('option', { value: v }, l)));
  const gm = h('input.input', { type: 'text', value: a.geminiModel, list: 'tn-gm', spellcheck: false });
  gm.addEventListener('change', () => ((a.geminiModel = gm.value.trim().replace(/^models\//, '') || 'gemini-3.8-flash'), shared()));
  const gf = h('input.input', { type: 'text', value: (a.geminiFallbacks || []).join(', '), spellcheck: false });
  gf.addEventListener('change', () => ((a.geminiFallbacks = gf.value.split(/[,\s]+/).filter(Boolean)), shared()));
  const am = h('input.input', { type: 'text', value: a.anthropicModel, list: 'tn-am', spellcheck: false });
  am.addEventListener('change', () => ((a.anthropicModel = am.value.trim() || 'claude-sonnet-5-5'), shared()));
  const effort = select(a.effort || '', [['', 'The model’s own (high)'], ['low', 'Low: quickest'], ['medium', 'Medium'], ['high', 'High']], (v) => ((a.effort = v), shared()));
  const gk = h('input.input', { type: 'password', value: ai.getKey('gemini'), placeholder: 'Paste your Gemini API key', autocomplete: 'off', spellcheck: false });
  const ak = h('input.input', { type: 'password', value: ai.getKey('anthropic'), placeholder: 'Paste your Claude API key', autocomplete: 'off', spellcheck: false });
  const keep = select(S.device.keysIn || 'computer', [['computer', 'In this browser, on this computer'], ['tab', 'Only until this tab is closed'], ['folder', 'In the notes folder, for every computer']], () => {});
  const saveKeys = async () => {
    if (gk.value.trim() === ai.getKey('gemini') && ak.value.trim() === ai.getKey('anthropic') && keep.value === (S.device.keysIn || 'computer')) return;
    try {
      await ai.setKeys({ gemini: gk.value, anthropic: ak.value }, keep.value);
      toast('Keys saved.', 'ok', 2000);
    } catch (e) {
      toast('The keys couldn’t be saved: ' + e.message, 'bad');
    }
  };
  for (const el of [gk, ak, keep]) el.addEventListener('change', saveKeys);
  const out = h('p.hint', { 'aria-live': 'polite' });
  const test = btn('Test', 'check', async () => {
    await saveKeys();
    out.textContent = 'Asking…';
    try {
      const r = await ai.call({ system: 'Answer in as few words as possible.', parts: [{ text: 'Reply with the single word: ready' }], maxTokens: 50 });
      out.textContent = `✓ ${ai.label(r.provider)} answered (${r.model}): “${r.text.trim().slice(0, 40)}”`;
    } catch (e) {
      out.textContent = '✗ ' + e.message;
    }
  }, 'btn small');
  const about = h('textarea.input', { rows: 3, placeholder: 'e.g. I’m Tim; I supervise first-year biomedical sciences at Cambridge. Use British spelling.' });
  about.value = a.aboutMe || '';
  about.addEventListener('change', () => ((a.aboutMe = about.value.trim()), shared()));
  const g = h('div.form', field('Model', h('div', gm, dl('tn-gm', ai.MODELS.gemini)), 'Gemini 3.8 Flash is quick and on the free tier; Gemini 4 Argon is Google’s most capable.'), field('If it is busy, try', gf, 'Other models, in turn.'), field('Gemini API key', gk, h('span', 'From ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), '.')));
  const c = h('div.form', field('Model', h('div', am, dl('tn-am', ai.MODELS.anthropic)), 'Sonnet 5.5 is a good balance; Opus 5.5 the most thorough; Haiku 5.5 the quickest.'), field('Effort', effort, 'How hard Claude thinks before answering. Low is plenty for tidying notes, and quicker.'), field('Claude API key', ak, h('span', 'From ', h('a', { href: 'https://platform.claude.com/settings/keys', target: '_blank', rel: 'noopener' }, 'the Claude Console'), '.')));
  const show = () => {
    g.hidden = prov.value !== 'gemini';
    c.hidden = prov.value !== 'anthropic';
  };
  show();
  box.append(
    field('Which', prov),
    g,
    c,
    field('Where the keys are kept', keep, 'In the notes folder means every computer that opens the folder has them (in .timnote/keys.json): only choose that if the folder is yours alone.'),
    h('div.btn-row', test),
    out,
    field('About you, for the AI', about, 'Told to the AI with every request, so that it writes as you would want.'),
    h('div.notice', h('b', 'What is sent. '), 'Only what you ask the AI to work on: the note (or the part you selected), or, when you ask about your notes, the notes that best match the question. On Gemini’s free tier, Google may use what is sent to improve its products: for anything confidential (students, patients, colleagues), use a key from a Google Cloud project with billing on, or Claude, and follow your institution’s guidance.')
  );
  return box;
}

/* ---------------- keys and about ---------------- */
function keysSection() {
  return h('table.keys', h('tbody', SHORTCUTS.map(([k, v]) => h('tr', h('td', h('kbd', k)), h('td', v)))));
}
function aboutSection() {
  return h(
    'div.form',
    h('p', `TimNote ${VERSION}. Notes and to-do lists kept as plain text files in a folder you choose. It runs in your browser: your notes go nowhere but your folder (and, if you use the AI, to the AI you choose).`),
    h('div.btn-row', h('a.btn.small', { href: 'https://github.com/comparativechrono/TimNote#readme', target: '_blank', rel: 'noopener' }, 'How to use it'), h('a.btn.small', { href: 'vendor/LICENSES.md', target: '_blank', rel: 'noopener' }, 'Third-party licences')),
    h('p.hint', 'Made with CodeMirror, marked, DOMPurify, Lucide icons and the Literata typeface.')
  );
}

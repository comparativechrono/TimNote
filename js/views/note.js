/* =====================================================================
   A note: its date and title (which are its file's name), the editor or
   the reading view, and everything that can be done with it. It saves
   itself a moment after you stop typing. If the file was changed
   elsewhere meanwhile (another computer, through Dropbox), it stops and
   asks which version to keep, rather than saving over it.
   ===================================================================== */
import { h, icon, iconEl, iconBtn, btn, menu, toast, modal, confirmDialog, promptDialog, copyText, download, debounce, plural, keyLabel } from '../util.js';
import * as fsx from '../fsx.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import * as rec from '../recovery.js';
import * as dict from '../dictation.js';
import { on, emit } from '../bus.js';
import { createEditor } from '../editor.js';
import { render, toHTML } from '../render.js';
import { fill } from '../templates.js';
import { fromIso, todayIso, fmtLong, MONTHS, DAYS, timeHM } from '../dates.js';
import { splitPath, joinPath, fileName, freeName, cleanTitle, cleanFolder, decodeText, encodeText, relPath, resolvePath, isMarkdown, parseName } from '../notes.js';
import { app } from '../app.js';
import { AiPanel } from './aipanel.js';
import { toICS } from '../ics.js';

/** a title from the first line of a note that wasn't given one */
function firstLine(text) {
  for (const raw of String(text).split('\n')) {
    const l = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^[A-Z][A-Z -]{1,20}:\s*/, '')
      .replace(/[*_`~[\]]/g, '')
      .trim();
    if (l) return cleanTitle(l.length > 60 ? l.slice(0, 60).replace(/\s+\S*$/, '') : l);
  }
  return '';
}

export class NoteView {
  constructor({ path = null, line = null, cursor = null, draft = null }) {
    this.kind = 'note';
    this.path = path;
    this.mode = 'write';
    this.dirty = false;
    this.version = 0;
    this.saving = null;
    this.conflict = null;
    this.destroyed = false;
    this.offs = [];
    this.urls = [];
    this.saveSoon = debounce(() => this.save(), 900);
    this.footSoon = debounce(() => this.renderFoot(), 300);
    this.readSoon = debounce(() => this.renderReader(), 250);

    let text = '', startAt = cursor;
    if (draft) {
      const t = draft.template && draft.template.toLowerCase() !== 'blank' ? lib.template(draft.template) : null;
      const title = draft.title != null ? draft.title : (t && t.title) || '';
      this.draft = {
        template: t,
        date: draft.date || todayIso(),
        folder: cleanFolder(draft.folder != null ? draft.folder : t ? t.folder : S.shared.folder),
        title,
        ext: (t && t.format) || S.shared.format || 'md'
      };
      const f = t ? fill(t.body, { title, date: this.draft.date }) : { text: '', cursor: 0 };
      text = f.text;
      startAt = f.cursor;
      this.pristine = text;
      this.titleTouched = !!draft.title;
      this.recId = 'draft:' + Date.now();
      this.eol = '\n';
      this.bom = false;
    } else {
      const n = lib.get(path);
      if (n) {
        text = n.text;
        this.mtime = n.mtime;
        this.eol = n.eol;
        this.bom = n.bom;
        this.notUtf8 = n.utf8 === false;
      } else this.needsLoad = true; // (a template, or a file not read yet: read it when the page is shown)
      this.isTemplate = lib.isTemplate(path);
      this.recId = path;
      this.startLine = line;
    }
    this.build(text, startAt);
  }

  /* ---------------- facts about the note ---------------- */
  get date() {
    if (this.draft) return this.draft.date;
    const n = lib.get(this.path);
    return n ? n.date : parseName(splitPath(this.path).name).date || todayIso();
  }
  get title() {
    if (this.draft) return this.draft.title;
    const n = lib.get(this.path);
    return n ? n.title : parseName(splitPath(this.path).name).title;
  }
  get dir() {
    return this.draft ? this.draft.folder : splitPath(this.path).dir;
  }
  get isMd() {
    return this.draft ? this.draft.ext !== 'txt' : isMarkdown(this.path);
  }
  hash() {
    return this.path ? app.noteHash(this.path) : location.hash;
  }

  /* ---------------- the page ---------------- */
  build(text, startAt) {
    this.dateBtn = h('button.datebox', { type: 'button', title: 'Change the date' });
    this.dateBtn.addEventListener('click', () => this.changeDate());
    this.titleEl = h('input.note-title', { type: 'text', spellcheck: true, 'aria-label': 'Title', placeholder: 'Title', autocomplete: 'off' });
    this.titleEl.addEventListener('input', () => this.titleTyped());
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
        e.preventDefault();
        this.commitTitle();
        this.ed.focus();
      } else if (e.key === 'Escape') {
        this.titleEl.value = this.title;
        this.ed.focus();
      } else if (e.key === 'F9') {
        e.preventDefault();
        dict.toggle(dict.boxTarget(this.titleEl));
      }
    });
    this.titleEl.addEventListener('blur', () => this.commitTitle());
    this.pathBtn = h('button.note-path', { type: 'button', title: 'Copy where the file is' });
    this.pathBtn.addEventListener('click', () => this.path && copyText(this.path).then(() => toast('The file’s place in the folder is copied: ' + this.path, 'ok')));
    this.statusEl = h('span.note-status', { role: 'status', 'aria-live': 'polite' });

    this.writeTab = h('button.seg', { type: 'button', 'aria-pressed': 'true', onclick: () => this.setMode('write') }, iconEl('pencil'), h('span', 'Write'));
    this.readTab = h('button.seg', { type: 'button', 'aria-pressed': 'false', onclick: () => this.setMode('read') }, iconEl('book-open'), h('span', 'Read'));
    this.micBtn = iconBtn('mic', `Dictate (F9)`, () => this.dictate(), 'mic');
    this.aiBtn = h('button.btn.ai-btn', { type: 'button', title: 'Ask the AI to tidy, summarise or find the actions', onclick: () => this.toggleAI() }, iconEl('sparkles'), h('span', 'AI'));
    const more = iconBtn('ellipsis', 'More', () => this.moreMenu(more));
    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');

    this.head = h(
      'header.note-head',
      burger,
      this.dateBtn,
      h('div.titlebox', this.titleEl, h('div.note-meta', this.pathBtn, this.statusEl)),
      h('div.note-tools', h('div.segs', { role: 'group', 'aria-label': 'Write or read' }, this.writeTab, this.readTab), this.micBtn, this.aiBtn, more)
    );
    this.banner = h('div.note-banner', { hidden: true });
    this.editorHost = h('div.editor-host');
    this.reader = h('article.reader', { hidden: true });
    this.reader.addEventListener('click', (e) => this.readerClick(e));
    this.reader.addEventListener('change', (e) => this.readerChange(e));
    this.reader.addEventListener('dblclick', (e) => {
      const b = e.target.closest('[data-line]');
      if (b && !e.target.closest('a, input, mark')) {
        this.setMode('write');
        this.ed.goToLine(+b.dataset.line);
      }
    });
    this.body = h('div.note-body', this.editorHost, this.reader);
    this.foot = h('footer.note-foot');
    this.el = h('section.note-view', this.head, this.banner, this.body, this.foot);

    this.ed = createEditor(this.editorHost, {
      readOnly: !!(this.needsLoad || this.notUtf8),
      doc: text,
      path: this.path || 'x.' + (this.draft ? this.draft.ext : 'md'),
      base: this.date,
      placeholder: this.draft ? 'Start writing. Lines with “TO DO:” go on your To do list.' : 'Empty note',
      onChange: () => this.changed(),
      onSave: () => this.save({ now: true }),
      onKey: (k) => k === 'F9' && this.dictate(),
      onOpen: (link) => this.openLink(link),
      onFiles: (files, pos) => this.pasteFiles(files, pos),
      data: {
        people: () => lib.people(),
        tags: () => lib.tags(),
        titles: () => lib.all().map((n) => ({ title: n.title, detail: n.date }))
      }
    });
    if (startAt != null) this.startAt = startAt;
    this.renderHead();
    this.renderFoot();

    this.offs.push(
      on('notes', (d) => {
        if (this.path && d && d.moved && d.moved[0] === this.path) this.path = d.moved[1];
        this.renderHead();
        this.footSoon();
      }),
      on('settings', () => {
        this.ed.refresh();
        this.footSoon();
        if (this.mode === 'read') this.readSoon();
      }),
      on('disk', (d) => d.changed.includes(this.path) && this.checkDisk()),
      on('reconnected', () => this.dirty && this.save()),
      dict.onState((onNow) => this.micBtn.classList.toggle('on', onNow))
    );
    this.onKeys = (e) => this.keys(e);
    document.addEventListener('keydown', this.onKeys);
    this.onUnload = (e) => {
      if (!this.dirty || this.destroyed) return;
      rec.keepNow(this.recId, { path: this.path, text: this.ed.getText(), base: this.mtime || 0, title: this.title, folder: fsx.info().name });
      this.save({ now: true });
      e.preventDefault();
      e.returnValue = '';
    };
    this.onHide = () => this.dirty && !this.destroyed && this.save({ now: true });
    window.addEventListener('beforeunload', this.onUnload);
    window.addEventListener('pagehide', this.onHide);
    document.addEventListener('visibilitychange', this.onHide);
    this.timer = setInterval(() => this.checkDisk(), 15000);
    lib.hooks.applyToOpen = async (p, fn) => {
      if (this.destroyed || p !== this.path) return false;
      const cur = this.ed.getText();
      const next = fn(cur);
      if (next !== cur) this.ed.setText(next, { asEdit: true });
      await this.save({ now: true });
      return true;
    };
  }

  mounted() {
    if (this.draft) {
      // a new note: the title first, then the text
      if (this.titleTouched || !this.draft.title) {
        this.ed.setCursor(this.startAt || 0);
        if (this.draft.title || !this.draft.template) this.ed.focus();
        else this.titleEl.focus();
      } else {
        this.titleEl.focus();
        if (/\b(with|to|from|for|about)$/i.test(this.draft.title)) {
          this.titleEl.value = this.draft.title + ' ';
          this.titleEl.setSelectionRange(this.titleEl.value.length, this.titleEl.value.length);
        } else this.titleEl.select();
      }
      this.status('draft');
      this.restorePending();
    } else {
      if (this.needsLoad) return this.load();
      if (this.startLine != null) this.ed.goToLine(this.startLine);
      else if (this.startAt != null) {
        this.ed.setCursor(this.startAt);
        this.ed.focus();
      } else this.ed.focus();
      this.status('saved');
      if (this.notUtf8) this.showNotUtf8();
      this.restorePending();
      this.checkDisk();
    }
  }

  async load() {
    try {
      const { raw, utf8, mtime } = await fsx.read(this.path);
      const d = decodeText(raw);
      this.ed.setText(d.text);
      this.mtime = mtime;
      this.eol = d.eol;
      this.bom = d.bom;
      this.needsLoad = false;
      this.notUtf8 = !utf8;
      this.ed.setReadOnly(this.notUtf8);
      this.renderFoot();
      if (this.startLine != null) this.ed.goToLine(this.startLine);
      this.ed.focus();
      this.status('saved');
      if (this.notUtf8) this.showNotUtf8();
      this.restorePending();
    } catch (e) {
      this.status('error', 'the file couldn’t be read');
      toast('The file couldn’t be read: ' + e.message, 'bad');
    }
  }

  /** text brought back from the browser's copy (unsaved typing from before), if it was meant for this note */
  restorePending() {
    const p = app.pendingRestore;
    if (!p || this.notUtf8) return;
    if (p.path ? p.path !== this.path : !this.draft) return;
    app.pendingRestore = null;
    if (this.draft) this.recId = p.id; // (so that the copy goes once this note is saved)
    this.ed.setText(p.text, { asEdit: true });
    toast('Restored. Press Ctrl+Z to undo it.', 'ok');
  }
  showNotUtf8() {
    const b = this.banner;
    b.hidden = false;
    b.className = 'note-banner warn';
    b.replaceChildren(iconEl('triangle-alert'), h('div.banner-text', h('b', 'This file isn’t UTF-8 text, so TimNote shows it but won’t change it.'), h('span', ' Saving it could spoil its accented letters and symbols. To edit it here, open it in Notepad, choose Save as, and set Encoding to UTF-8.')));
  }

  renderHead() {
    const d = fromIso(this.date);
    this.dateBtn.replaceChildren(h('span.dd', d ? String(d.getDate()) : '?'), h('span.mm', d ? `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : ''), h('span.ww', d ? DAYS[d.getDay()] : ''));
    const n = this.path && lib.get(this.path);
    this.dateBtn.classList.toggle('undated', !!(n && !n.dated));
    this.dateBtn.title = n && !n.dated ? 'This file’s name has no date: click to give it one' : 'Change the date';
    if (document.activeElement !== this.titleEl) this.titleEl.value = this.title;
    if (this.isTemplate) {
      this.titleEl.readOnly = true;
      this.dateBtn.hidden = true;
      this.titleEl.title = 'A template: rename it in the Templates folder';
    }
    const where = this.draft ? joinPath(this.draft.folder, fileName(this.draft.date, cleanTitle(this.draft.title) || firstLine(this.ed ? this.ed.getText() : '') || 'Untitled', this.draft.ext)) : this.path;
    this.pathBtn.textContent = where;
    this.pathBtn.disabled = !!this.draft;
    this.el.classList.toggle('pinned', !!(this.path && S.shared.pinned.includes(this.path)));
  }

  renderFoot() {
    if (this.destroyed) return;
    const text = this.ed.getText();
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    const tasks = this.ed.tasks();
    const byList = new Map();
    for (const t of tasks) {
      if (!byList.has(t.list)) byList.set(t.list, { open: 0, done: 0 });
      byList.get(t.list)[t.done ? 'done' : 'open']++;
    }
    const parts = [];
    for (const l of S.shared.lists) {
      const c = byList.get(l.id);
      if (!c) continue;
      const count = l.done ? c.open : c.open + c.done;
      parts.push(h('a.foot-list', { href: '#/list/' + encodeURIComponent(l.id), title: `Open ${l.name}` }, h(`span.swatch.hl-${l.color || 'yellow'}`), l.name, h('b', String(count)), l.done && c.done ? h('span.foot-done', `${c.done} done`) : null));
    }
    this.foot.replaceChildren(h('span.foot-words', plural(words, 'word')), ...parts, h('span.grow'), h('span.foot-hint', this.mode === 'read' ? 'Double-click to edit there' : `${keyLabel('Ctrl+Enter')} ticks off a line`));
  }

  status(kind, extra = '') {
    const s = this.statusEl;
    s.className = 'note-status ' + kind;
    s.textContent = { draft: 'New note: saved when you start writing', saved: 'Saved', saving: 'Saving…', unsaved: 'Not saved yet', error: 'Not saved' + (extra ? ': ' + extra : ''), conflict: 'Not saved: changed elsewhere' }[kind] || kind;
  }

  /* ---------------- typing and saving ---------------- */
  changed() {
    this.version++;
    this.dirty = true;
    if (this.draft && this.ed.getText() === this.pristine && !this.titleTouched) {
      this.dirty = false;
      this.status('draft');
      return;
    }
    this.status('unsaved');
    if (this.draft) this.renderHead();
    rec.keep(this.recId, { path: this.path, text: this.ed.getText(), base: this.mtime || 0, title: this.title, folder: fsx.info().name });
    if (!this.conflict) this.saveSoon();
    this.footSoon();
    if (this.mode === 'read') this.readSoon();
  }

  save({ now = false } = {}) {
    this.saveSoon.cancel();
    if (this.saving) {
      this.again = true;
      return this.saving;
    }
    this.saving = (async () => {
      try {
        do {
          this.again = false;
          await this.saveOnce();
        } while (this.again && this.dirty && !this.conflict);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  async saveOnce() {
    if (!this.dirty || this.conflict) return;
    if (this.moving) return; // (being renamed or moved: saved to its new place afterwards)
    if (this.notUtf8) return this.status('error', 'the file isn’t UTF-8, so it isn’t changed');
    // (never save a note whose file hasn't been read: what is shown isn't what is in it)
    if (this.needsLoad) return this.status('error', 'the file hasn’t been read yet');
    const text = this.ed.getText();
    const v = this.version;
    this.status('saving');
    try {
      if (this.draft) {
        if (text === this.pristine && !this.titleTouched) {
          this.dirty = false;
          return this.status('draft');
        }
        const d = this.draft;
        const n = await lib.createNote({ folder: d.folder, date: d.date, title: cleanTitle(d.title) || firstLine(text) || 'Untitled', ext: d.ext, text });
        rec.clear(this.recId);
        this.draft = null;
        this.path = n.path;
        this.recId = n.path;
        this.mtime = n.mtime;
        if (!this.destroyed && app.view === this) history.replaceState(null, '', app.noteHash(n.path));
        S.device.lastPath = n.path;
        S.saveDevice();
        this.renderHead();
        if (!this.destroyed && app.sidebar) app.sidebar.setActive({ name: 'note', arg: n.path });
      } else {
        const path = this.path;
        const r = await fsx.exclusive(path, () => fsx.write(path, encodeText(text, this.eol, this.bom), { expect: this.mtime }));
        this.mtime = r.mtime;
        lib.update(path, text, r.mtime, r.size, { eol: this.eol, bom: this.bom });
      }
      if (this.version === v) {
        this.dirty = false;
        rec.clear(this.recId);
        this.status('saved');
      } else this.again = true;
    } catch (e) {
      if (e.name === 'ConflictError') {
        const disk = await fsx.read(this.path).catch(() => null);
        if (disk && decodeText(disk.raw).text === text) {
          // (the same words: nothing to choose between)
          this.mtime = disk.mtime;
          this.dirty = this.version !== v;
          if (!this.dirty) rec.clear(this.recId);
          return this.status('saved');
        }
        return this.showConflict(disk);
      }
      if (e.name === 'NotFoundError') return this.showMissing();
      console.error('[TimNote] save', e);
      this.status('error', e.name === 'NotAllowedError' ? 'no permission for the folder' : e.message);
      if (e.name !== 'NotAllowedError') toast('This note couldn’t be saved: ' + e.message + ' What you typed is kept in the browser, and saving will be tried again.', 'bad', 9000);
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.dirty && this.save(), 15000);
    }
  }

  /** the file, looked at again: changed elsewhere? (it shows the new version, or asks if there are changes here too) */
  async checkDisk() {
    if (!this.path || this.draft || this.saving || this.conflict || this.destroyed || this.checking || this.moving || this.needsLoad) return;
    this.checking = true;
    try {
      const st = await fsx.stat(this.path);
      if (!st) return this.showMissing();
      if (this.missing) {
        // (the file is back: compare it with what is here)
        this.missing = false;
        this.banner.hidden = true;
        this.mtime = null;
      }
      if (st.mtime === this.mtime) return;
      const disk = await fsx.read(this.path);
      const d = decodeText(disk.raw);
      if (this.saving || this.moving) return;
      if (!disk.utf8) {
        if (this.dirty) return this.showConflict(disk);
        this.ed.setText(d.text);
        this.mtime = disk.mtime;
        this.notUtf8 = true;
        this.ed.setReadOnly(true);
        return this.showNotUtf8();
      }
      if (d.text === this.ed.getText()) {
        this.mtime = disk.mtime;
        return;
      }
      if (!this.dirty) {
        this.ed.setText(d.text);
        this.mtime = disk.mtime;
        this.eol = d.eol;
        this.bom = d.bom;
        lib.update(this.path, d.text, disk.mtime, disk.size, { eol: d.eol, bom: d.bom });
        this.footSoon();
        if (this.mode === 'read') this.renderReader();
        toast('This note was changed elsewhere (on another computer, perhaps): it shows the new version.', '', 5000);
        return;
      }
      this.showConflict(disk);
    } catch (e) {
      /* (looked at again next time) */
    } finally {
      this.checking = false;
    }
  }

  showConflict(disk) {
    this.conflict = disk || { raw: '', mtime: null };
    this.status('conflict');
    const theirs = disk ? decodeText(disk.raw).text : '';
    const b = this.banner;
    b.hidden = false;
    b.className = 'note-banner warn';
    b.replaceChildren(
      iconEl('triangle-alert'),
      h('div.banner-text', h('b', 'This note was changed somewhere else while you were writing here.'), h('span', ' Perhaps on another computer, through Dropbox. Which version should be kept?')),
      h(
        'div.banner-actions',
        btn('Compare', 'columns-2', () => this.compare(theirs), 'btn small'),
        btn('Keep both', 'files', () => this.resolve('both', disk), 'btn small'),
        btn('Use the other version', 'download', () => this.resolve('theirs', disk), 'btn small'),
        btn('Keep mine', 'save', () => this.resolve('mine', disk), 'btn small primary')
      )
    );
  }
  async resolve(choice, disk) {
    const theirs = disk ? decodeText(disk.raw) : null;
    this.banner.hidden = true;
    const mine = this.ed.getText();
    this.conflict = null;
    try {
      if (choice === 'mine') {
        // (over the version that was shown: if a newer one has come since, it asks again)
        const st = disk && disk.mtime != null ? { mtime: disk.mtime } : await fsx.stat(this.path);
        if (!st) return this.showMissing();
        this.mtime = st.mtime;
        this.dirty = true;
        await this.save({ now: true });
      } else if (choice === 'theirs' && theirs) {
        this.ed.setText(theirs.text);
        this.mtime = disk.mtime;
        this.eol = theirs.eol;
        this.bom = theirs.bom;
        this.dirty = false;
        rec.clear(this.recId);
        lib.update(this.path, theirs.text, disk.mtime, disk.size, { eol: theirs.eol, bom: theirs.bom });
        this.status('saved');
      } else if (choice === 'both' && theirs) {
        const { dir, name } = splitPath(this.path);
        const p = parseName(name);
        const copy = freeName(dir, fileName(p.date, `${p.title} (my version ${todayIso()} ${timeHM().replace(':', '')})`, p.ext), lib.takenPaths());
        const r = await fsx.create(copy, encodeText(mine, this.eol, this.bom));
        lib.added(copy, mine, r.mtime, r.size);
        this.ed.setText(theirs.text);
        this.mtime = disk.mtime;
        this.dirty = false;
        rec.clear(this.recId);
        lib.update(this.path, theirs.text, disk.mtime, disk.size, { eol: theirs.eol, bom: theirs.bom });
        this.status('saved');
        toast(`Your version is saved as “${splitPath(copy).name}”, beside this one.`, 'ok', 8000, { label: 'Open it', run: () => app.openNote(copy) });
      }
      this.footSoon();
      if (this.mode === 'read') this.renderReader();
    } catch (e) {
      toast('That didn’t work: ' + e.message, 'bad', 8000);
      this.showConflict(disk);
    }
  }
  compare(theirs) {
    const mine = this.ed.getText();
    const col = (label, text) => h('div.cmp-col', h('h3', label), h('textarea.cmp-text', { readonly: true, spellcheck: false }, text));
    modal({ title: 'The two versions', wide: true, body: h('div.cmp', col('Here (yours)', mine), col('In the file now', theirs)), actions: [{ label: 'Close' }] });
  }
  showMissing() {
    if (this.missing) return;
    this.missing = true;
    this.status('error', 'the file has gone');
    const b = this.banner;
    b.hidden = false;
    b.className = 'note-banner warn';
    b.replaceChildren(
      iconEl('triangle-alert'),
      h('div.banner-text', h('b', 'This note’s file isn’t in the folder any more.'), h('span', ' It may have been moved, renamed or deleted (perhaps on another computer).')),
      h(
        'div.banner-actions',
        btn('Save it again', 'save', async () => {
          try {
            const r = await fsx.exclusive(this.path, () => fsx.create(this.path, encodeText(this.ed.getText(), this.eol, this.bom)));
            this.mtime = r.mtime;
            this.missing = false;
            this.dirty = false;
            b.hidden = true;
            lib.update(this.path, this.ed.getText(), r.mtime, r.size);
            rec.clear(this.recId);
            this.status('saved');
          } catch (e) {
            if (e.name === 'ExistsError') {
              // (it has come back meanwhile: which version to keep?)
              this.missing = false;
              const disk = await fsx.read(this.path).catch(() => null);
              return this.showConflict(disk);
            }
            toast('It couldn’t be saved: ' + e.message, 'bad');
          }
        }, 'btn small primary'),
        btn('Close it', 'x', () => {
          this.dirty = false;
          lib.removed(this.path);
          app.navigate('#/', { replace: true });
        }, 'btn small')
      )
    );
  }



  /* ---------------- the title and the date (the file's name) ---------------- */
  titleTyped() {
    if (!this.draft) return;
    const t = this.titleEl.value;
    this.draft.title = t;
    this.titleTouched = true;
    // (a new note not yet written in: its template's {{title}} follows the title)
    if (this.draft.template && this.ed.getText() === this.pristine) {
      const f = fill(this.draft.template.body, { title: cleanTitle(t) || t, date: this.draft.date });
      this.pristine = f.text;
      this.ed.setText(f.text);
      this.startAt = f.cursor;
      this.ed.setCursor(f.cursor);
    }
    this.renderHead();
  }
  commitTitle() {
    if (this.titleBusy) return this.titleBusy;
    this.titleBusy = this.commitTitleNow().finally(() => (this.titleBusy = null));
    return this.titleBusy;
  }
  async commitTitleNow() {
    if (this.isTemplate) return;
    const t = cleanTitle(this.titleEl.value);
    if (this.draft) {
      if (t !== this.draft.title) {
        this.draft.title = t;
        this.titleTouched = true;
      }
      if (this.titleTouched && t) {
        this.dirty = true;
        this.saveSoon();
      }
      return;
    }
    if (!t) {
      this.titleEl.value = this.title;
      return;
    }
    if (t === this.title) return;
    await this.rename({ title: t });
  }
  async rename(what) {
    // (one at a time: a second waits for the first)
    const prev = this.renaming || Promise.resolve();
    const run = prev.then(() => this.renameNow(what));
    this.renaming = run.catch(() => {});
    return run;
  }
  async renameNow({ title = this.title, date = this.date, dir = this.dir }) {
    if (this.destroyed) return;
    if (this.draft) {
      Object.assign(this.draft, { title, date, folder: dir });
      this.ed.setBase(date);
      this.renderHead();
      return;
    }
    if (this.notUtf8) return toast('This file isn’t UTF-8 text, so TimNote doesn’t change it (or its name).', 'warn', 6000);
    await this.save({ now: true });
    if (this.dirty || this.conflict) return toast('The note has to be saved before its file can be renamed.', 'warn');
    const n = lib.get(this.path);
    const ext = (n && n.ext) || 'md';
    const name = fileName(date, title, ext);
    const from = this.path;
    let to = joinPath(dir, name);
    if (to.toLowerCase() !== from.toLowerCase()) {
      const taken = lib.takenPaths();
      taken.delete(from.toLowerCase());
      to = freeName(dir, name, taken);
    }
    if (to === from) return;
    // (while the file moves, nothing is saved: what is typed meanwhile is saved to the new place afterwards)
    this.moving = true;
    try {
      if (dir) await fsx.ensureFolder(dir);
      let r = null;
      for (let tries = 0; !r; tries++) {
        try {
          r = await fsx.exclusive(from, () => fsx.move(from, to, { expect: this.mtime }));
        } catch (e) {
          // (a file of that name that hasn't been read yet: the next free name)
          if (e.name !== 'ExistsError' || tries > 20) throw e;
          const taken = lib.takenPaths();
          taken.delete(from.toLowerCase());
          taken.add(to.toLowerCase());
          for (let k = 0; k < tries; k++) taken.add(freeName(dir, name, taken).toLowerCase());
          to = freeName(dir, name, taken);
        }
      }
      this.path = to;
      this.mtime = r.mtime;
      rec.clear(this.recId);
      this.recId = to;
      lib.moved(from, to, r.mtime);
      if (S.device.lastPath === from) {
        S.device.lastPath = to;
        S.saveDevice();
      }
      if (!this.destroyed && app.view === this) history.replaceState(null, '', app.noteHash(to));
      this.ed.setBase(date);
      this.renderHead();
      if (!this.destroyed) app.sidebar.setActive({ name: 'note', arg: to });
    } catch (e) {
      this.titleEl.value = this.title;
      if (e.name === 'ConflictError') {
        // (changed elsewhere since it was last seen here: shown first, and not renamed)
        this.moving = false;
        toast('The note had been changed elsewhere, so its file wasn’t renamed. Have a look, then rename it again if you still want to.', 'warn', 9000);
        await this.checkDisk();
      } else toast('The file couldn’t be renamed: ' + e.message, 'bad', 8000);
    } finally {
      this.moving = false;
      if (this.dirty) this.save();
    }
  }
  changeDate() {
    if (this.isTemplate) return;
    const input = h('input.input', { type: 'date', value: this.date, 'aria-label': 'Date' });
    modal({
      title: 'The note’s date',
      body: h('div.form', h('label.field', h('span.field-label', 'Date'), input), h('p.hint', 'The date is the start of the file’s name, so that the files sort by date in any file manager.')),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Change it',
          primary: true,
          onClick: () => {
            if (input.value && input.value !== this.date) this.rename({ date: input.value });
          }
        }
      ]
    });
  }
  async moveTo() {
    const folders = lib.noteFolders();
    const sel = h('select.input', h('option', { value: '' }, '(the top of the notes folder)'), folders.map((f) => h('option', { value: f, selected: f === this.dir }, f)));
    const fresh = h('input.input', { type: 'text', placeholder: 'or a new folder', spellcheck: false });
    modal({
      title: 'Move to a folder',
      body: h('div.form', h('label.field', h('span.field-label', 'Folder'), sel), h('label.field', h('span.field-label', 'New folder'), fresh)),
      actions: [{ label: 'Cancel' }, { label: 'Move', primary: true, onClick: () => this.rename({ dir: cleanFolder(fresh.value.trim() || sel.value) }) }]
    });
  }

  /* ---------------- write and read ---------------- */
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.writeTab.setAttribute('aria-pressed', String(m === 'write'));
    this.readTab.setAttribute('aria-pressed', String(m === 'read'));
    this.editorHost.hidden = m === 'read';
    this.reader.hidden = m !== 'read';
    this.el.classList.toggle('reading', m === 'read');
    if (m === 'read') this.renderReader();
    else this.ed.focus();
    this.renderFoot();
  }
  goToLine(n) {
    this.setMode('write');
    this.ed.goToLine(n);
    this.ed.focus();
  }
  renderReader() {
    if (this.destroyed || this.mode !== 'read') return;
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    const scroll = this.body.scrollTop;
    this.reader.replaceChildren(render(this.ed.getText(), { path: this.path || 'x.' + (this.draft ? this.draft.ext : 'md'), dir: this.dir }));
    this.body.scrollTop = scroll;
    for (const img of this.reader.querySelectorAll('img[data-src]')) {
      const p = resolvePath(this.dir, img.dataset.src);
      if (!p) continue;
      fsx.readBlob(p).then((b) => {
        const u = URL.createObjectURL(b);
        this.urls.push(u);
        img.src = u;
      }).catch(() => img.replaceWith(h('span.img-missing', `[picture not found: ${img.dataset.src}]`)));
    }
  }
  readerClick(e) {
    const mark = e.target.closest('mark.hl[data-line]');
    if (mark) {
      const l = S.listById(mark.dataset.list);
      if (l && l.done) this.ed.toggleLine(+mark.dataset.line);
      return;
    }
    const a = e.target.closest('a');
    if (!a) return;
    if (a.dataset.wiki) {
      e.preventDefault();
      this.openLink({ wiki: a.dataset.wiki });
    } else if (a.dataset.tag) {
      e.preventDefault();
      app.navigate('#/search/' + encodeURIComponent('#' + a.dataset.tag));
    } else if (a.dataset.path) {
      e.preventDefault();
      this.openLink({ path: a.dataset.path, resolved: true });
    }
  }
  readerChange(e) {
    const box = e.target.closest('input.task-box[data-line]');
    if (box) this.ed.toggleLine(+box.dataset.line);
  }
  openLink(link) {
    if (link.url) return window.open(link.url, '_blank', 'noopener');
    if (link.wiki) {
      const n = lib.byTitle(link.wiki);
      if (n) return app.openNote(n.path);
      return confirmDialog('No note with that title', `There’s no note called “${link.wiki}”. Make one?`, 'Make it').then((ok) => ok && app.newNote('Blank', { title: link.wiki }));
    }
    if (link.path) {
      const p = link.resolved ? link.path : resolvePath(this.dir, link.path);
      if (p && lib.get(p)) return app.openNote(p);
      if (p) {
        fsx.readBlob(p).then((b) => window.open(URL.createObjectURL(b), '_blank')).catch(() => toast('That file isn’t in the notes folder.', 'warn'));
      }
    }
  }

  /* ---------------- pictures pasted in ---------------- */
  async pasteFiles(files, pos) {
    if (this.notUtf8) return;
    const folder = S.shared.attachmentsFolder || 'attachments';
    const now = new Date();
    const stamp = `${this.date} ${timeHM(now).replace(':', '')}${String(now.getSeconds()).padStart(2, '0')}`;
    const base = cleanTitle(this.title || 'picture').slice(0, 40) || 'picture';
    // (the link goes where the picture was pasted, wherever that is by the time its file is saved)
    const at = this.ed.track(pos);
    let text = '';
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png';
        let path = null;
        for (let k = 1; !path && k < 50; k++) {
          const cand = joinPath(folder, `${stamp} ${base}${files.length > 1 ? ' ' + (i + 1) : ''}${k > 1 ? ` (${k})` : ''}.${ext}`);
          try {
            await fsx.create(cand, f);
            path = cand;
          } catch (e) {
            if (e.name !== 'ExistsError') throw e;
          }
        }
        if (!path) continue;
        const rel = relPath(this.dir, path).split('/').map(encodeURIComponent).join('/');
        text += `![${base}](${rel})\n`;
      }
    } catch (e) {
      toast('The picture couldn’t be saved: ' + e.message, 'bad');
    }
    pos = at.get();
    at.stop();
    if (text && !this.destroyed) {
      // (a picture goes on a line of its own)
      const before = this.ed.view.state.sliceDoc(Math.max(0, pos - 1), pos);
      const after = this.ed.view.state.sliceDoc(pos, pos + 1);
      if (pos > 0 && before !== '\n') text = '\n' + text;
      if (after && after !== '\n') text = text + '\n';
      else text = text.replace(/\n$/, '');
      this.ed.insert(text, pos);
      toast(`The picture is saved in the “${folder}” folder.`, 'ok', 3000);
    }
  }

  /* ---------------- dictation and the AI ---------------- */
  dictate() {
    const target = { insert: (t) => this.ed.insert(t), before: () => this.ed.textBefore(300), isConnected: () => !this.destroyed, focus: () => this.ed.focus() };
    if (this.mode === 'read') this.setMode('write');
    this.ed.focus();
    dict.toggle(target);
  }
  toggleAI() {
    if (this.ai) {
      this.ai.close();
      return;
    }
    this.ai = new AiPanel(this, () => {
      this.ai = null;
      this.el.classList.remove('with-ai');
      this.aiBtn.classList.remove('on');
    });
    this.el.append(this.ai.el);
    this.el.classList.add('with-ai');
    this.aiBtn.classList.add('on');
    this.ai.mounted();
  }

  /* ---------------- the ⋯ menu ---------------- */
  moreMenu(anchor) {
    const n = this.path && lib.get(this.path);
    const pinned = this.path && S.shared.pinned.includes(this.path);
    const archived = n && n.archived;
    if (this.draft) {
      return menu(anchor, [
        { label: 'Change the date…', icon: 'calendar', onClick: () => this.changeDate() },
        { label: 'Folder…', icon: 'folder-input', onClick: () => this.moveTo() },
        '-',
        { label: 'Discard this new note', icon: 'trash-2', danger: true, onClick: () => ((this.dirty = false), rec.clear(this.recId), app.navigate('#/', { replace: true })) }
      ], { align: 'right' });
    }
    menu(anchor, [
      { label: pinned ? 'Unpin' : 'Pin to the top', icon: pinned ? 'pin-off' : 'pin', onClick: () => this.pin() },
      { label: 'Change the date…', icon: 'calendar', onClick: () => this.changeDate() },
      { label: 'Move to a folder…', icon: 'folder-input', onClick: () => this.moveTo() },
      { label: 'Make a copy', icon: 'files', onClick: () => this.duplicate() },
      '-',
      { label: 'Copy as formatted text', icon: 'copy', hint: 'for email or Word', onClick: () => this.copyFormatted() },
      { label: 'Email it…', icon: 'mail', onClick: () => this.email() },
      { label: 'Print, or save as PDF', icon: 'printer', onClick: () => this.print() },
      { label: 'Download the file', icon: 'download', onClick: () => download(splitPath(this.path).name, encodeText(this.ed.getText(), this.eol, this.bom), (this.isMd ? 'text/markdown' : 'text/plain') + ';charset=utf-8') },
      { label: 'Dated items to a calendar (.ics)', icon: 'calendar-days', onClick: () => this.calendarFile() },
      '-',
      archived ? { label: 'Take out of the archive', icon: 'archive-restore', onClick: () => this.archive(false) } : { label: 'Archive', icon: 'archive', hint: 'its items leave the lists', onClick: () => this.archive(true) },
      { label: 'Delete…', icon: 'trash-2', danger: true, onClick: () => this.remove() }
    ], { align: 'right' });
  }
  pin() {
    const i = S.shared.pinned.indexOf(this.path);
    if (i >= 0) S.shared.pinned.splice(i, 1);
    else S.shared.pinned.unshift(this.path);
    lib.saveShared();
    emit('notes', { pinned: true });
  }
  async duplicate() {
    await this.save({ now: true });
    const n = lib.get(this.path);
    try {
      const c = await lib.createNote({ folder: this.dir, date: todayIso(), title: (n ? n.title : 'Note') + ' (copy)', ext: n ? n.ext : 'md', text: this.ed.getText() });
      app.openNote(c.path);
    } catch (e) {
      toast('The copy couldn’t be made: ' + e.message, 'bad');
    }
  }
  async copyFormatted() {
    const text = this.ed.getText();
    const ok = await copyText(text, this.isMd ? toHTML(text) : null);
    toast(ok ? 'Copied, formatted: paste it into an email or a document.' : 'It couldn’t be copied.', ok ? 'ok' : 'bad');
  }
  email() {
    const text = this.ed.getText();
    const subject = this.title;
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    if (url.length > 1800) {
      copyText(text, this.isMd ? toHTML(text) : null).then(() => {
        toast('The note is long, so it is copied: paste it into the email that opens.', 'ok', 7000);
        window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
      });
    } else window.location.href = url;
  }
  print() {
    const was = this.mode;
    this.setMode('read');
    document.body.classList.add('printing');
    setTimeout(() => {
      window.print();
      document.body.classList.remove('printing');
      if (was !== 'read') this.setMode(was);
    }, 120);
  }
  calendarFile() {
    const items = this.ed.tasks().filter((t) => t.due && !t.done);
    if (!items.length) return toast('No items in this note have a date. Give one a date with @ (for example @friday).', 'warn', 7000);
    download(`${cleanTitle(this.title)}.ics`, toICS(items.map((t) => ({ task: t, note: { title: this.title, path: this.path } }))), 'text/calendar;charset=utf-8');
    toast(`${plural(items.length, 'item')} in a calendar file: open it to add ${items.length === 1 ? 'it' : 'them'} to your calendar.`, 'ok', 7000);
  }
  async archive(yes) {
    const arch = cleanFolder(S.shared.archiveFolder || 'Archive');
    const dir = this.dir;
    let to;
    if (yes) to = dir ? joinPath(arch, dir) : arch;
    else {
      const parts = dir.split('/');
      to = parts.slice(1).join('/');
    }
    await this.rename({ dir: to });
    toast(yes ? 'Archived: it is in the Archive folder, and its items are off the lists.' : 'Taken out of the archive.', 'ok');
  }
  async remove() {
    const ok = await confirmDialog('Delete this note?', `“${splitPath(this.path).name}” will be deleted from the folder. (Dropbox keeps deleted files for a while, if you need it back.)`, 'Delete', true);
    if (!ok) return;
    try {
      this.saveSoon.cancel();
      await fsx.remove(this.path);
      this.dirty = false;
      rec.clear(this.recId);
      lib.removed(this.path);
      if (S.device.lastPath === this.path) {
        S.device.lastPath = '';
        S.saveDevice();
      }
      toast('Deleted.', 'ok');
      app.navigate('#/', { replace: true });
    } catch (e) {
      toast('It couldn’t be deleted: ' + e.message, 'bad');
    }
  }

  /* ---------------- keys, and leaving ---------------- */
  keys(e) {
    if (this.destroyed || document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      this.setMode(this.mode === 'write' ? 'read' : 'write');
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.save({ now: true });
    } else if (e.key === 'F9' && !this.ed.hasFocus() && document.activeElement !== this.titleEl && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) {
      e.preventDefault();
      this.dictate();
    }
  }
  async leave() {
    if (this.titleEl === document.activeElement) await this.commitTitle();
    if (dict.active()) dict.stop();
    // (nothing typed from now on could be saved, so nothing can be typed)
    this.ed.setReadOnly(true);
    await this.save({ now: true });
    const untouchedDraft = this.draft && this.ed.getText() === this.pristine && !this.titleTouched;
    if (this.dirty && !untouchedDraft) {
      const ok = await confirmDialog('This note isn’t saved', 'It couldn’t be saved to the folder just now. What you typed is kept in this browser and will be offered back next time. Leave it anyway?', 'Leave');
      if (!ok) this.ed.setReadOnly(!!(this.needsLoad || this.notUtf8));
      return ok;
    }
    return true;
  }
  destroy() {
    this.destroyed = true;
    this.saveSoon.cancel();
    this.footSoon.cancel();
    this.readSoon.cancel();
    clearInterval(this.timer);
    clearTimeout(this.retry);
    document.removeEventListener('keydown', this.onKeys);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('pagehide', this.onHide);
    document.removeEventListener('visibilitychange', this.onHide);
    for (const off of this.offs) off();
    for (const u of this.urls) URL.revokeObjectURL(u);
    if (this.ai) this.ai.close();
    if (lib.hooks.applyToOpen && app.view === this) lib.hooks.applyToOpen = null;
    this.ed.destroy();
  }
}

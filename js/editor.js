/* =====================================================================
   The editor (CodeMirror 6). Markdown is styled as it is typed (headings
   larger, bold bold), and the lists' words are highlighted in their
   list's colour, with a flag in the margin beside every line that is on
   a list. Checkboxes can be clicked; Ctrl+Enter ticks the line off.
   Typing @ offers dates (@friday → @2026-11-13) and people, # offers
   tags, and [[ offers the titles of notes, to link to them.
   ===================================================================== */
import {
  EditorView, EditorState, Compartment, StateField, StateEffect, Decoration, ViewPlugin, WidgetType, keymap, placeholder,
  drawSelection, dropCursor, highlightSpecialChars, history, historyKeymap, defaultKeymap, indentWithTab, search, searchKeymap,
  syntaxHighlighting, HighlightStyle, markdown, markdownLanguage, tags, gutter, GutterMarker, autocompletion, completionKeymap,
  EditorSelection, Prec, Annotation, Transaction
} from '../vendor/codemirror.js';
import * as S from './settings.js';
import { parse, toggleLine, toggleWordOnLine, listItem } from './tasks.js';
import { todayIso, dayWord, fmtShort, DAYS } from './dates.js';
import { icon } from './util.js';

const external = Annotation.define(); // a change that didn't come from typing (a reload from the file)
const setBase = StateEffect.define();
const refresh = StateEffect.define();
const flashLine = StateEffect.define();
const BIG = 300000; // (longer notes aren't searched for list items as they are typed)

/* ---------------- the items of the note, as it is typed ---------------- */
function compute(state, base) {
  if (state.doc.length > BIG) return { base, tasks: [], byLine: new Map(), labels: new Map() };
  const r = parse(state.doc.toString(), S.lists(), base);
  const byLine = new Map();
  for (const t of r.tasks) byLine.set(t.line, t);
  const labels = new Map();
  for (const l of r.labels) {
    if (!labels.has(l.line)) labels.set(l.line, []);
    labels.get(l.line).push(l);
  }
  return { base, tasks: r.tasks, byLine, labels };
}
const taskField = StateField.define({
  create: (state) => compute(state, todayIso()),
  update(v, tr) {
    let base = v.base, again = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setBase)) {
        base = e.value;
        again = true;
      } else if (e.is(refresh)) again = true;
    }
    return again ? compute(tr.state, base) : v;
  }
});

/* a line briefly highlighted (after jumping to it from a list or a search) */
const flashField = StateField.define({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashLine)) {
        if (e.value == null) v = Decoration.none;
        else {
          const line = tr.state.doc.line(Math.min(tr.state.doc.lines, e.value + 1));
          v = Decoration.set([Decoration.line({ class: 'cm-flash' }).range(line.from)]);
        }
      }
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f)
});

/* ---------------- how it looks ---------------- */
class BoxWidget extends WidgetType {
  constructor(on) {
    super();
    this.on = on;
  }
  eq(o) {
    return o.on === this.on;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-box' + (this.on ? ' on' : '');
    s.setAttribute('role', 'checkbox');
    s.setAttribute('aria-checked', String(this.on));
    s.title = this.on ? 'Done: click to undo' : 'Click to tick off';
    if (this.on) s.innerHTML = icon('check');
    return s;
  }
  ignoreEvent() {
    return false;
  }
}
const TAG = /(?:^|[\s(\[,;])(#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;
const WIKI = /\[\[[^\]\n]+\]\]/g;
const PERSON = /(?:^|[\s(\[,;])(@[\p{L}][\p{L}\p{N}_'’-]*)/gu;
const URLRE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

function build(view) {
  const { byLine, labels } = view.state.field(taskField);
  const lists = S.lists();
  const out = [];
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const ln = line.number - 1;
      const text = line.text;
      for (const lb of labels.get(ln) || []) {
        const list = lists.byId.get(lb.list);
        const cls = `cm-hl cm-hl-${lb.kind === 'done' ? 'done' : (list && list.color) || 'yellow'}${lb.block ? ' cm-hl-head' : ''}`;
        if (lb.to > lb.from) out.push(Decoration.mark({ class: cls, attributes: { title: list ? (lb.kind === 'done' ? `Done (${list.name})` : `On ${list.name}`) : '' } }).range(line.from + lb.from, line.from + lb.to));
      }
      const li = listItem(text);
      if (li && li.box != null) out.push(Decoration.replace({ widget: new BoxWidget(li.box === 'x') }).range(line.from + li.boxAt, line.from + li.boxAt + 3));
      const t = byLine.get(ln);
      if (t) {
        if (t.done) {
          const start = li ? li.contentAt : text.search(/\S/);
          if (start >= 0 && start < text.length) out.push(Decoration.mark({ class: 'cm-done' }).range(line.from + start, line.to));
        }
        if (t.dueText) {
          const i = text.indexOf(t.dueText);
          if (i >= 0) out.push(Decoration.mark({ class: 'cm-due' + (t.due < todayIso() && !t.done ? ' overdue' : ''), attributes: { title: fmtShort(t.due, true) } }).range(line.from + i, line.from + i + t.dueText.length));
        }
        for (const m of text.matchAll(PERSON)) {
          const i = m.index + m[0].length - m[1].length;
          const name = m[1].slice(1).replace(/[.'’-]+$/, '');
          if (t.people.includes(name)) out.push(Decoration.mark({ class: 'cm-person' }).range(line.from + i, line.from + i + 1 + name.length));
        }
      }
      for (const m of text.matchAll(TAG)) {
        const i = m.index + m[0].length - m[1].length;
        out.push(Decoration.mark({ class: 'cm-tag' }).range(line.from + i, line.from + i + m[1].length));
      }
      for (const m of text.matchAll(WIKI)) out.push(Decoration.mark({ class: 'cm-wikilink', attributes: { title: 'Ctrl+click to open' } }).range(line.from + m.index, line.from + m.index + m[0].length));
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

class Flag extends GutterMarker {
  constructor(color, done, title) {
    super();
    this.color = color;
    this.done = done;
    this.title = title;
  }
  eq(o) {
    return o.color === this.color && o.done === this.done && o.title === this.title;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = `cm-flag cm-flag-${this.color}${this.done ? ' done' : ''}`;
    s.title = this.title;
    return s;
  }
}
const spacer = new Flag('none', false, '');

const style = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.6em', fontWeight: '640', lineHeight: '1.25', letterSpacing: '-0.01em' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: '620', lineHeight: '1.3' },
  { tag: tags.heading3, fontSize: '1.12em', fontWeight: '620' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '620' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: tags.link, color: 'var(--link)' },
  { tag: tags.url, color: 'var(--muted)', textDecoration: 'underline', textDecorationColor: 'var(--rule-2)' },
  { tag: tags.monospace, fontFamily: 'var(--f-mono)', fontSize: '0.86em', backgroundColor: 'var(--code-bg)', borderRadius: '3px' },
  { tag: tags.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--marks)' },
  { tag: tags.labelName, color: 'var(--muted)' }
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--note-size)', color: 'var(--ink)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--f-note)', lineHeight: 'var(--note-lh)', paddingLeft: 'var(--page-pad)', paddingRight: '24px' },
  '.cm-content': { padding: '28px 0 40vh', caretColor: 'var(--ink)', width: 'var(--page-w)', maxWidth: 'calc(100% - 44px)', flex: '0 1 auto' },
  '.cm-line': { padding: '0 0 0 18px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', borderRight: '1.5px solid var(--margin-rule)', color: 'var(--muted)' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  '.cm-placeholder': { color: 'var(--muted)', fontStyle: 'italic' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection)' },
  '.cm-panels': { backgroundColor: 'var(--paper)', color: 'var(--ink)', borderColor: 'var(--rule)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--rule)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-hit)', outline: '1px solid var(--search-hit-line)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-hit-line)' },
  '.cm-tooltip': { border: '1px solid var(--rule-2)', backgroundColor: 'var(--paper)', color: 'var(--ink)', borderRadius: '8px', boxShadow: 'var(--shadow)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--f-ui)', fontSize: '13.5px', maxHeight: '16em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--ink)', color: 'var(--paper)' },
  '.cm-completionDetail': { marginLeft: '10px', fontStyle: 'normal', color: 'inherit', opacity: '0.7' }
});

/* ---------------- what can be typed ---------------- */
function completions(data) {
  const days = () => {
    const t = todayIso();
    const words = ['today', 'tomorrow'].concat(DAYS.slice(1).concat(DAYS.slice(0, 1)).map((d) => d.toLowerCase()), ['next week', 'end of month']);
    return words.map((w) => {
      const d = dayWord(w, t);
      return { label: '@' + w.replace(' ', '-'), detail: fmtShort(d, true), apply: '@' + d, type: 'date', boost: w === 'today' || w === 'tomorrow' ? 2 : 1 };
    });
  };
  const at = (ctx) => {
    const m = ctx.matchBefore(/(?:^|[\s(\[,;])@[\p{L}\p{N}_-]*/u);
    if (!m) return null;
    const from = m.text[0] === '@' ? m.from : m.from + 1;
    const people = (data.people() || []).map((p) => ({ label: '@' + p, type: 'person' }));
    return { from, options: days().concat(people), validFor: /^@[\p{L}\p{N}_-]*$/u };
  };
  const hash = (ctx) => {
    const m = ctx.matchBefore(/(?:^|[\s(\[,;])#[\p{L}\p{N}_/-]+/u);
    if (!m) return null;
    const from = m.text[0] === '#' ? m.from : m.from + 1;
    return { from, options: (data.tags() || []).map((t) => ({ label: '#' + t, type: 'tag' })), validFor: /^#[\p{L}\p{N}_/-]*$/u };
  };
  const wiki = (ctx) => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!m) return null;
    const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
    return {
      from: m.from,
      options: (data.titles() || []).slice(0, 400).map((t) => ({ label: '[[' + t.title, detail: t.detail, type: 'note', apply: (view, c, from, to) => view.dispatch({ changes: { from, to: after === ']]' ? to + 2 : to, insert: `[[${t.title}]]` }, selection: { anchor: from + t.title.length + 4 } }) })),
      validFor: /^\[\[[^\]\n]*$/
    };
  };
  return autocompletion({ override: [at, hash, wiki], icons: false, activateOnTyping: true, defaultKeymap: true, maxRenderedOptions: 60 });
}

/* ---------------- commands ---------------- */
function lineToggle(view, ln) {
  const st = view.state;
  if (ln < 0 || ln >= st.doc.lines) return false;
  const line = st.doc.line(ln + 1);
  const t = st.field(taskField).byLine.get(ln);
  let next;
  if (t) next = toggleLine(line.text, t, !t.done, S.lists());
  else {
    const li = listItem(line.text);
    if (!li || li.box == null) return false;
    next = line.text.slice(0, li.boxAt) + (li.box === 'x' ? '[ ]' : '[x]') + line.text.slice(li.boxAt + 3);
  }
  if (next === line.text) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: 'input.toggle' });
  return true;
}
function toggleCurrent(view) {
  const ln = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  return lineToggle(view, ln) || true;
}
function toggleWord(view) {
  const changes = [];
  const seen = new Set();
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    changes.push({ from: line.from, to: line.to, insert: toggleWordOnLine(line.text, S.lists()) });
  }
  view.dispatch({ changes, userEvent: 'input' });
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({ selection: { anchor: line.to } });
  return true;
}
function insertDate(view) {
  view.dispatch(view.state.replaceSelection(todayIso()), { userEvent: 'input' });
  return true;
}
function wrap(mark) {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((r) => {
        const text = view.state.sliceDoc(r.from, r.to);
        if (text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2) {
          const inner = text.slice(mark.length, text.length - mark.length);
          return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
        }
        return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }], range: EditorSelection.range(r.from + mark.length, r.to + mark.length) };
      }),
      { userEvent: 'input' }
    );
    return true;
  };
}
/* ---------------- the editor ---------------- */
/** o: {doc, path, base, onChange(text), onSave(), onOpen(link), onFiles(files, pos), onKey(name), data: {people, tags, titles}} */
export function createEditor(parent, o) {
  const lang = new Compartment();
  const ro = new Compartment();
  const trackers = new Set();
  const isMd = !/\.txt$/i.test(o.path || '');
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: o.doc || '',
      extensions: [
        taskField,
        flashField,
        ro.of([EditorState.readOnly.of(!!o.readOnly), EditorView.editable.of(!o.readOnly)]),
        lang.of(isMd ? markdown({ base: markdownLanguage, codeLanguages: [] }) : []),
        history(),
        drawSelection(),
        dropCursor(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', 'aria-label': 'Note' }),
        placeholder(o.placeholder || 'Start writing…'),
        syntaxHighlighting(style),
        theme,
        search({ top: true }),
        completions(o.data || { people: () => [], tags: () => [], titles: () => [] }),
        gutter({
          class: 'cm-flags',
          lineMarker(view, block) {
            const ln = view.state.doc.lineAt(block.from).number - 1;
            const t = view.state.field(taskField).byLine.get(ln);
            if (!t) return null;
            const list = S.lists().byId.get(t.list);
            if (!list) return null;
            return new Flag(t.done ? 'done' : list.color || 'yellow', t.done, `${list.name}${t.done ? ' (done)' : ''}${t.checkable ? ': click to ' + (t.done ? 'undo' : 'tick off') : ''}`);
          },
          lineMarkerChange: (u) => u.startState.field(taskField) !== u.state.field(taskField),
          initialSpacer: () => spacer,
          domEventHandlers: {
            mousedown(view, block) {
              const ln = view.state.doc.lineAt(block.from).number - 1;
              const t = view.state.field(taskField).byLine.get(ln);
              if (t && t.checkable) {
                lineToggle(view, ln);
                return true;
              }
              return false;
            }
          }
        }),
        ViewPlugin.fromClass(
          class {
            constructor(view) {
              this.decorations = build(view);
            }
            update(u) {
              if (u.docChanged || u.viewportChanged || u.startState.field(taskField) !== u.state.field(taskField)) this.decorations = build(u.view);
            }
          },
          {
            decorations: (v) => v.decorations,
            eventHandlers: {
              mousedown(e, view) {
                const box = e.target.closest && e.target.closest('.cm-box');
                if (box) {
                  const pos = view.posAtDOM(box);
                  lineToggle(view, view.state.doc.lineAt(pos).number - 1);
                  e.preventDefault();
                  return true;
                }
                if ((e.ctrlKey || e.metaKey) && o.onOpen) {
                  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                  if (pos == null) return false;
                  const line = view.state.doc.lineAt(pos);
                  const col = pos - line.from;
                  for (const m of line.text.matchAll(WIKI)) {
                    if (col >= m.index && col <= m.index + m[0].length) {
                      e.preventDefault();
                      o.onOpen({ wiki: m[0].slice(2, -2).split('|')[0].trim() });
                      return true;
                    }
                  }
                  for (const m of line.text.matchAll(URLRE)) {
                    if (col >= m.index && col <= m.index + m[0].length) {
                      e.preventDefault();
                      o.onOpen({ url: m[0] });
                      return true;
                    }
                  }
                  const md = /\]\(([^)\s]+)\)/g;
                  for (const m of line.text.matchAll(md)) {
                    if (col >= m.index && col <= m.index + m[0].length) {
                      e.preventDefault();
                      o.onOpen(/^https?:/i.test(m[1]) ? { url: m[1] } : { path: m[1] });
                      return true;
                    }
                  }
                }
                return false;
              }
            }
          }
        ),
        Prec.high(
          keymap.of([
            { key: 'Mod-s', run: () => (o.onSave && o.onSave(), true) },
            { key: 'Mod-Enter', run: toggleCurrent },
            { key: 'Alt-t', run: toggleWord },
            { key: 'Alt-d', run: insertDate },
            { key: 'Mod-b', run: wrap('**') },
            { key: 'Mod-i', run: wrap('*') },
            { key: 'F9', run: () => (o.onKey && o.onKey('F9'), true) }
          ])
        ),
        keymap.of([...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        EditorView.domEventHandlers({
          paste(e, view) {
            const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
            if (!files.length || !o.onFiles) return false;
            e.preventDefault();
            o.onFiles(files, view.state.selection.main.head);
            return true;
          },
          drop(e, view) {
            const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type));
            if (!files.length || !o.onFiles) return false;
            e.preventDefault();
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            o.onFiles(files, pos == null ? view.state.selection.main.head : pos);
            return true;
          }
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) for (const t of trackers) t.pos = u.changes.mapPos(t.pos, 1);
          if (u.docChanged && !u.transactions.some((t) => t.annotation(external)) && o.onChange) o.onChange();
        })
      ]
    })
  });
  if (o.base) view.dispatch({ effects: setBase.of(o.base) });

  let flashTimer = null;
  const api = {
    /** a place in the text that moves with it as it is typed in: {get(), stop()} */
    track(pos) {
      const t = { pos };
      trackers.add(t);
      return { get: () => t.pos, stop: () => trackers.delete(t) };
    },
    view,
    getText: () => view.state.doc.toString(),
    /** the text from the file, put in place of what is there (keeping the cursor where it can) */
    setText(text, { asEdit = false } = {}) {
      const cur = view.state.doc.toString();
      if (cur === text) return;
      const ch = diff(cur, text);
      // (text from the file isn't an edit: Ctrl+Z mustn't take it away again)
      view.dispatch({ changes: ch, annotations: asEdit ? [] : [external.of(true), Transaction.addToHistory.of(false)], userEvent: asEdit ? 'input.replace' : undefined });
    },
    setBase: (d) => view.dispatch({ effects: setBase.of(d) }),
    setReadOnly: (yes) => view.dispatch({ effects: ro.reconfigure([EditorState.readOnly.of(!!yes), EditorView.editable.of(!yes)]) }),
    refresh: () => view.dispatch({ effects: refresh.of(true) }),
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    tasks: () => view.state.field(taskField).tasks,
    selection() {
      const r = view.state.selection.main;
      return { from: r.from, to: r.to, text: view.state.sliceDoc(r.from, r.to) };
    },
    setCursor(pos) {
      pos = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },
    goToLine(n, { flash = true } = {}) {
      const ln = Math.max(1, Math.min(view.state.doc.lines, (n | 0) + 1));
      const line = view.state.doc.line(ln);
      view.dispatch({ selection: { anchor: line.from }, effects: [EditorView.scrollIntoView(line.from, { y: 'center' })].concat(flash ? [flashLine.of(ln - 1)] : []) });
      if (flash) {
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => view.dispatch({ effects: flashLine.of(null) }), 1600);
      }
    },
    /** words put in at the cursor (dictation, the AI, a picture's link) */
    insert(text, at = null) {
      const r = view.state.selection.main;
      const from = at == null ? r.from : at, to = at == null ? r.to : at;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input', scrollIntoView: true });
    },
    replaceRange(from, to, text) {
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input', scrollIntoView: true });
    },
    textBefore(n = 200) {
      const h = view.state.selection.main.from;
      return view.state.sliceDoc(Math.max(0, h - n), h);
    },
    toggleLine: (ln) => lineToggle(view, ln),
    destroy: () => view.destroy()
  };
  return api;
}

/** the smallest change that turns a into b */
function diff(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  while (s < n && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  let e = 0;
  while (e < n - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}

/* The AI panel, beside a note: tidy it, summarise it, find its actions, write it up as minutes or an email, or ask
   about all the notes. What comes back waits here until you choose to use it. */
import { h, iconEl, iconBtn, btn, toast, copyText, plural } from '../util.js';
import * as ai from '../ai.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { renderSnippet } from '../render.js';
import { todayIso, addDays } from '../dates.js';
import { app } from '../app.js';

export class AiPanel {
  constructor(nv, onClose) {
    this.nv = nv;
    this.onClose = onClose;
    this.ac = null;
    this.tab = 'note';
    this.el = h('aside.ai-panel', { 'aria-label': 'AI' });
    this.render();
  }
  mounted() {
    const f = this.el.querySelector('button.ai-act, textarea');
    if (f) f.focus();
  }
  close() {
    if (this.ac) this.ac.abort();
    this.el.remove();
    this.onClose();
  }

  render() {
    const p = ai.provider();
    const head = h('div.ai-head', h('h2', iconEl('sparkles'), 'AI'), h('span.ai-model', ai.ready() ? `${ai.label(p)}, ${ai.modelName(p)}` : ''), iconBtn('x', 'Close the AI panel', () => this.close()));
    const tabs = h(
      'div.ai-tabs',
      { role: 'tablist' },
      h('button.ai-tab', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === 'note'), onclick: () => ((this.tab = 'note'), this.render()) }, 'This note'),
      h('button.ai-tab', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === 'ask'), onclick: () => ((this.tab = 'ask'), this.render()) }, 'Ask your notes')
    );
    this.out = h('div.ai-out', { 'aria-live': 'polite' });
    let body;
    if (!ai.ready()) {
      body = h(
        'div.ai-body',
        h('p', `To use the AI, add your own ${ai.label(p)} API key. It is called straight from this browser, and what it writes waits for you to choose to use it.`),
        btn('Add a key in Settings', 'key-round', () => app.settings('ai'), 'btn primary')
      );
    } else body = this.tab === 'note' ? this.noteTab() : this.askTab();
    this.el.replaceChildren(head, tabs, body);
  }

  /* ---------------- this note ---------------- */
  noteTab() {
    const sel = this.nv.ed.selection();
    const scope = h('p.ai-scope', sel.text.trim() ? `Works on what’s selected (${plural((sel.text.match(/\S+/g) || []).length, 'word')}). Select nothing to work on the whole note.` : 'Works on the whole note, or select part of it first.');
    const acts = h('div.ai-acts');
    for (const [id, a] of Object.entries(ai.ACTIONS)) {
      acts.append(h('button.ai-act', { type: 'button', onclick: () => this.run(id) }, h('b', a.label), h('span', a.hint)));
    }
    const custom = h('textarea.input.ai-custom', { rows: 2, placeholder: 'Or say what you want, e.g. “make this into a table of who does what”', 'aria-label': 'Your own instruction' });
    custom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (custom.value.trim()) this.run('custom', custom.value);
      }
    });
    const go = btn('Ask', 'send', () => custom.value.trim() && this.run('custom', custom.value), 'btn small primary');
    return h('div.ai-body', scope, acts, h('div.ai-customrow', custom, go), this.out);
  }

  async run(action, instruction = '') {
    if (this.ac) this.ac.abort();
    const ed = this.nv.ed;
    const sel = ed.selection();
    const part = !!sel.text.trim();
    const full = ed.getText();
    const text = part ? sel.text : full;
    if (!text.trim()) return toast('There’s nothing in the note to work on yet.', 'warn');
    const a = action === 'custom' ? { label: 'Your instruction', result: 'replace' } : ai.ACTIONS[action];
    const req = ai.build(action, { title: this.nv.title, date: this.nv.date, part }, text, instruction);
    const ac = (this.ac = new AbortController());
    const pre = h('div.ai-text');
    const st = h('div.ai-status', h('span.spinner'), `${a.label}…`);
    const stop = btn('Stop', 'x', () => ac.abort(), 'btn small');
    const stopRow = h('div.ai-btns', stop);
    this.out.replaceChildren(st, pre, stopRow);
    const t0 = Date.now();
    try {
      const r = await ai.call(req, { signal: ac.signal, onText: (t) => (pre.textContent = t), onNote: (n) => (st.lastChild.textContent = n) });
      if (ac !== this.ac) return;
      const result = ai.clean(r.text);
      pre.textContent = result;
      stopRow.remove();
      st.replaceChildren(`${a.label}: ${ai.label(r.provider)} (${r.model}), ${Math.round((Date.now() - t0) / 100) / 10} s`);
      this.offer(action, a, result, { part, sel, full });
    } catch (e) {
      stopRow.remove();
      if (e.name === 'AbortError') return st.replaceChildren('Stopped.');
      st.replaceChildren(h('span.bad', e.message));
    } finally {
      if (ac === this.ac) this.ac = null;
    }
  }

  offer(action, a, result, { part, sel, full }) {
    const ed = this.nv.ed;
    const btns = h('div.ai-btns');
    const done = (msg) => {
      toast(msg + ' Press Ctrl+Z to undo it.', 'ok', 5000);
      btns.replaceChildren(btn('Copy', 'copy', () => copyText(result).then(() => toast('Copied.', 'ok', 1500)), 'btn small'));
    };
    const stillSame = () => (part ? ed.view.state.sliceDoc(sel.from, sel.to) === sel.text : ed.getText() === full);
    const replace = () => {
      if (!stillSame()) return toast('The note has changed since you asked, so it isn’t replaced: use Copy, or Add it below.', 'warn', 7000);
      if (part) ed.replaceRange(sel.from, sel.to, result);
      else ed.setText(result, { asEdit: true });
      done(part ? 'The selected text is replaced.' : 'The note is replaced.');
    };
    const below = () => {
      const at = part ? sel.to : ed.getText().length;
      ed.insert((part ? '\n\n' : '\n\n') + result + '\n', at);
      done('Added.');
    };
    const top = () => {
      const t = ed.getText();
      const first = t.split('\n')[0];
      const at = /^#\s/.test(first) ? first.length : 0;
      ed.insert(at ? '\n\n' + result + '\n' : result + '\n\n', at);
      done('Added at the top.');
    };
    const actions = () => {
      if (/^none found\.?$/i.test(result.trim())) return toast('The AI found no actions that aren’t on a list already.', '', 4000);
      const t = ed.getText();
      const lines = result.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
      const m = /^#{1,6}\s+actions?\s*$/im.exec(t);
      if (m) {
        const at = m.index + m[0].length;
        ed.insert('\n' + lines, at);
      } else ed.insert(`${t.endsWith('\n') ? '' : '\n'}\n## Actions\n\n${lines}\n`, t.length);
      done('Added to the note.');
    };
    const asNote = async () => {
      try {
        const n = await lib.createNote({ folder: this.nv.dir, date: this.nv.date, title: `${this.nv.title} (${action === 'minutes' ? 'minutes' : 'AI'})`, text: result + '\n' });
        toast('Saved as a new note.', 'ok', 4000, { label: 'Open it', run: () => app.openNote(n.path) });
      } catch (e) {
        toast('It couldn’t be saved: ' + e.message, 'bad');
      }
    };
    const copy = btn('Copy', 'copy', () => copyText(result).then(() => toast('Copied.', 'ok', 1500)), 'btn small');
    if (a.result === 'replace') btns.append(btn(part ? 'Replace the selection' : 'Replace the note', 'check', replace, 'btn small primary'), btn('Add it below', 'plus', below, 'btn small'), copy);
    else if (a.result === 'top') btns.append(btn('Add at the top', 'check', top, 'btn small primary'), copy);
    else if (a.result === 'actions') btns.append(btn('Add to the note', 'check', actions, 'btn small primary'), copy);
    else if (a.result === 'new') btns.append(btn('Save as a new note', 'file-plus', asNote, 'btn small primary'), btn('Add it below', 'plus', below, 'btn small'), copy);
    else if (a.result === 'copy') {
      const m = /^subject:\s*(.+)\n+/i.exec(result);
      const subject = m ? m[1].trim() : this.nv.title;
      const body = m ? result.slice(m[0].length) : result;
      btns.append(
        btn('Copy', 'copy', () => copyText(body).then(() => toast('Copied.', 'ok', 1500)), 'btn small primary'),
        btn('Open in your email', 'mail', () => (window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1500))}`), 'btn small')
      );
    }
    btns.append(btn('Discard', 'x', () => this.out.replaceChildren(), 'btn small'));
    this.out.append(btns);
  }

  /* ---------------- all the notes ---------------- */
  askTab() {
    const q = h('textarea.input.ai-q', { rows: 3, placeholder: 'e.g. What did we decide about the second-year practicals? Who was I waiting to hear from?', 'aria-label': 'Your question' });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.ask(q.value);
      }
    });
    return h(
      'div.ai-body',
      h('p.ai-scope', 'Answers from your notes: the ones that best match the question are sent with it.'),
      q,
      h('div.ai-btns', btn('Ask', 'send', () => this.ask(q.value), 'btn small primary'), btn('Review my week', 'calendar-days', () => this.week(), 'btn small')),
      this.out
    );
  }
  async ask(question) {
    question = String(question || '').trim();
    if (!question) return;
    const notes = ai.relevant(question, lib.all());
    await this.answer(ai.buildAsk(question, notes), notes, 'Answer');
  }
  async week() {
    const from = addDays(todayIso(), -7);
    const notes = lib.all().filter((n) => n.date >= from && n.date <= todayIso());
    const open = [];
    for (const l of S.shared.lists) if (l.done) for (const it of lib.items(l.id)) if (!it.task.done) open.push(it);
    await this.answer(ai.buildWeek(notes, open.slice(0, 150)), notes, 'Week review', true);
  }
  async answer(req, notes, label, saveable = false) {
    if (this.ac) this.ac.abort();
    const ac = (this.ac = new AbortController());
    const st = h('div.ai-status', h('span.spinner'), `${label}: reading ${plural(notes.length, 'note')}…`);
    const box = h('div.ai-answer');
    this.out.replaceChildren(st, box);
    try {
      const r = await ai.call(req, { signal: ac.signal, onText: (t) => box.replaceChildren(renderSnippet(t)), onNote: (n) => (st.lastChild.textContent = n) });
      const text = ai.clean(r.text);
      box.replaceChildren(renderSnippet(text));
      box.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        if (a.dataset.wiki) {
          const n = lib.byTitle(a.dataset.wiki);
          if (n) app.openNote(n.path);
          else toast(`There’s no note called “${a.dataset.wiki}”.`, 'warn');
        } else if (/^https?:/.test(a.href)) window.open(a.href, '_blank', 'noopener');
      });
      st.replaceChildren(`${ai.label(r.provider)} (${r.model}), from ${plural(notes.length, 'note')}`);
      const used = h('details.ai-used', h('summary', 'The notes it was sent'), h('ul', notes.map((n) => h('li', h('a', { href: app.noteHash(n.path) }, n.title), h('span.hint', ' ' + n.date)))));
      const btns = h('div.ai-btns', btn('Copy', 'copy', () => copyText(text).then(() => toast('Copied.', 'ok', 1500)), 'btn small'));
      btns.append(
        btn(saveable ? 'Save as a note' : 'Save the answer as a note', 'file-plus', async () => {
          try {
            const n = await lib.createNote({ folder: saveable ? S.shared.dailyFolder || 'Daily' : '', date: todayIso(), title: saveable ? 'Week review' : 'Answer', text: text + '\n' });
            toast('Saved.', 'ok', 4000, { label: 'Open it', run: () => app.openNote(n.path) });
          } catch (e) {
            toast('It couldn’t be saved: ' + e.message, 'bad');
          }
        }, 'btn small')
      );
      this.out.append(used, btns);
    } catch (e) {
      st.replaceChildren(h('span.bad', e.name === 'AbortError' ? 'Stopped.' : e.message));
    } finally {
      if (ac === this.ac) this.ac = null;
    }
  }
}

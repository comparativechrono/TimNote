/* Searching all the notes, with the lines that match. */
import { h, iconEl, iconBtn, debounce, plural, esc } from '../util.js';
import * as lib from '../library.js';
import { on } from '../bus.js';
import { search } from '../search.js';
import { fmtShort } from '../dates.js';
import { app } from '../app.js';

export class SearchView {
  constructor(q) {
    this.kind = 'search';
    this.q = q || '';
    this.el = h('section.search-view');
    this.input = h('input.search-big', { type: 'search', value: this.q, placeholder: 'Search all your notes', 'aria-label': 'Search all your notes', spellcheck: false });
    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    this.results = h('ol.results');
    this.info = h('p.page-sub');
    this.el.append(
      h('header.page-head.search-head', burger, h('div.search-box', iconEl('search'), this.input)),
      h('div.search-help', this.info, h('p.hint', 'Every word must be in the note. Use "quotes" for words together, -word to leave a word out, in:Folder for one folder.')),
      this.results
    );
    const run = debounce(() => this.run(), 140);
    this.input.addEventListener('input', () => {
      this.q = this.input.value;
      history.replaceState(null, '', '#/search/' + encodeURIComponent(this.q));
      run();
    });
    this.input.addEventListener('keydown', (e) => {
      const links = Array.from(this.results.querySelectorAll('a.res-link'));
      if (e.key === 'Enter' && links[0]) {
        e.preventDefault();
        links[0].click();
      } else if (e.key === 'ArrowDown' && links[0]) {
        e.preventDefault();
        links[0].focus();
      }
    });
    this.results.addEventListener('keydown', (e) => {
      const links = Array.from(this.results.querySelectorAll('a.res-link'));
      const i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i >= 0 && links[i + 1]) {
        e.preventDefault();
        links[i + 1].focus();
      } else if (e.key === 'ArrowUp' && i >= 0) {
        e.preventDefault();
        (links[i - 1] || this.input).focus();
      }
    });
    this.offs = [on('notes', debounce(() => this.run(), 300))];
    this.run();
  }
  mounted() {
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }
  hash() {
    return '#/search/' + encodeURIComponent(this.q);
  }
  run() {
    const q = this.q.trim();
    this.results.replaceChildren();
    if (!q) {
      this.info.textContent = `${plural(lib.all({ archived: true }).length, 'note')} to search.`;
      return;
    }
    const res = search(q);
    this.info.textContent = res.length ? `${plural(res.length, 'note')}${res.length >= 200 ? ' (the first 200)' : ''}` : 'Nothing found.';
    for (const r of res) {
      const n = r.note;
      const line = r.snippets[0] ? r.snippets[0].line : null;
      const a = h('a.res-link', { href: app.noteHash(n.path, line) }, h('span.res-title', n.title), h('span.res-date', fmtShort(n.date, true)), n.dir ? h('span.res-dir', iconEl('folder', 'small'), n.dir) : null, n.archived ? h('span.res-dir', 'archived') : null);
      const snips = h('div.res-snips');
      for (const s of r.snippets) {
        const p = h('a.res-snip', { href: app.noteHash(n.path, s.line), tabindex: '-1' });
        let at = 0, html = '';
        for (const [a1, b1] of s.hits) {
          if (a1 < at) continue;
          html += esc(s.text.slice(at, a1)) + '<mark>' + esc(s.text.slice(a1, b1)) + '</mark>';
          at = b1;
        }
        html += esc(s.text.slice(at));
        p.innerHTML = html;
        snips.append(p);
      }
      this.results.append(h('li.res', a, snips));
    }
  }
  destroy() {
    for (const off of this.offs) off();
  }
}

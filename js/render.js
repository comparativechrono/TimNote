/* =====================================================================
   Reading view: a note's Markdown shown as a page. Each paragraph, item
   and heading knows the line of the file it came from, so that ticking a
   checkbox or a highlighted word changes that line, and double-clicking
   opens the editor there. Plain .txt notes are shown as they are, with
   their links, checkboxes and highlighted words.
   ===================================================================== */
import { Marked } from '../vendor/marked.js';
import DOMPurify from '../vendor/purify.js';
import { esc } from './util.js';
import * as S from './settings.js';
import { resolvePath, isMarkdown } from './notes.js';
import { cleanName, personKey, displayName } from './people.js';

const nl = (s) => (String(s).match(/\n/g) || []).length;
const dl = (t) => (t._line != null ? ` data-line="${t._line}"` : '');
const isExternal = (href) => /^(https?:|mailto:|tel:|data:|blob:|#)/i.test(href || '');

const md = new Marked({ gfm: true, breaks: true });
md.use({
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start: (src) => {
        const i = src.indexOf('[[');
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] || m[1]).trim() };
      },
      renderer: (t) => `<a class="wikilink" href="#" data-wiki="${esc(t.target)}">${esc(t.label)}</a>`
    },
    {
      name: 'hashtag',
      level: 'inline',
      start: (src) => {
        const m = /(^|\s)#[\p{L}\p{N}_]/u.exec(src);
        return m ? m.index + m[1].length : undefined;
      },
      tokenizer(src) {
        const m = /^#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/u.exec(src);
        if (m) return { type: 'hashtag', raw: m[0], tag: m[1] };
      },
      renderer: (t) => `<a class="tag" href="#" data-tag="${esc(t.tag)}">#${esc(t.tag)}</a>`
    },
    {
      // @Millie is shown as Millie (and leads to the notes that mention her); @friday is a date, left as it is
      name: 'person',
      level: 'inline',
      start: (src) => {
        const m = /(^|[\s(\[{,;:"'“‘])@\p{L}/u.exec(src);
        return m ? m.index + m[1].length : undefined;
      },
      tokenizer(src) {
        const m = /^@([\p{L}][\p{L}\p{N}_'’.-]*)/u.exec(src);
        const name = m && cleanName(m[1]);
        if (name) return { type: 'person', raw: '@' + name, name };
      },
      renderer: (t) => `<a class="person" href="#" data-person="${esc(personKey(t.name))}" title="${esc(`Notes that mention ${displayName(t.name)}`)}">${esc(displayName(t.name))}</a>`
    }
  ],
  renderer: {
    paragraph(t) {
      return `<p${dl(t)}>${this.parser.parseInline(t.tokens)}</p>\n`;
    },
    heading(t) {
      return `<h${t.depth}${dl(t)}>${this.parser.parseInline(t.tokens)}</h${t.depth}>\n`;
    },
    listitem(it) {
      if (/^\[[ xX]\]$/.test(String(it.text || '').trim()) || (it.task && !String(it.text || '').trim())) return ''; // (an empty checkbox, from a template)
      return `<li${dl(it)}${it.task ? ' class="task' + (it.checked ? ' done' : '') + '"' : ''}>${this.parser.parse(it.tokens)}</li>\n`;
    },
    checkbox({ checked }) {
      return `<input type="checkbox" class="task-box"${checked ? ' checked' : ''}> `;
    },
    code(t) {
      return `<pre${dl(t)}><code>${esc(t.text)}</code></pre>\n`;
    },
    blockquote(t) {
      return `<blockquote${dl(t)}>${this.parser.parse(t.tokens)}</blockquote>\n`;
    },
    image({ href, title, text }) {
      if (!href) return esc(text || '');
      if (isExternal(href)) return `<img src="${esc(href)}" alt="${esc(text || '')}"${title ? ` title="${esc(title)}"` : ''}>`;
      return `<img data-src="${esc(href)}" alt="${esc(text || '')}"${title ? ` title="${esc(title)}"` : ''}>`;
    }
  }
});

function lines(tokens, start) {
  let line = start;
  for (const t of tokens) {
    t._line = line;
    if (t.type === 'list') {
      let l = line;
      for (const it of t.items) {
        it._line = l;
        if (it.tokens) lines(it.tokens, l);
        l += nl(it.raw);
      }
    } else if (t.type === 'blockquote' && t.tokens) lines(t.tokens, line);
    line += nl(t.raw);
  }
}

/** the lists' words in a piece of text, for highlighting: [{from, to, list, kind}] */
function findAll(text) {
  const C = S.lists();
  const out = [];
  for (const e of C.entries) {
    const re = new RegExp(e.inline.source, e.inline.flags.includes('g') ? e.inline.flags : e.inline.flags + 'g');
    let m;
    while ((m = re.exec(text))) {
      const from = m.index + m[1].length;
      out.push({ from, to: m.index + m[0].length, list: e.list, kind: e.kind });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  out.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept = [];
  for (const x of out) if (!kept.length || x.from >= kept[kept.length - 1].to) kept.push(x);
  return kept;
}
/** highlight the lists' words in the text of a block (not in code or links), each knowing its line */
function highlight(block, baseLine) {
  let offset = 0;
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag === 'BR') {
          offset++;
          continue;
        }
        if (child.hasAttribute('data-line') || tag === 'CODE' || tag === 'PRE' || tag === 'A' || tag === 'MARK') continue;
        walk(child);
      } else if (child.nodeType === 3) {
        const text = child.nodeValue;
        const found = findAll(text);
        if (!found.length) {
          offset += nl(text);
          continue;
        }
        const frag = document.createDocumentFragment();
        let at = 0;
        for (const f of found) {
          frag.append(text.slice(at, f.from));
          offset += nl(text.slice(at, f.from));
          const mark = document.createElement('mark');
          mark.className = `hl hl-${f.kind === 'done' ? 'done' : f.list.color || 'yellow'}`;
          mark.dataset.list = f.list.id;
          mark.dataset.line = String(baseLine + offset);
          mark.textContent = text.slice(f.from, f.to);
          if (f.list.done) {
            mark.title = f.kind === 'done' ? `Done (${f.list.name}). Click to mark as not done.` : `On ${f.list.name}. Click to mark as done.`;
            mark.tabIndex = 0;
            mark.setAttribute('role', 'button');
          } else mark.title = `On ${f.list.name}`;
          frag.append(mark);
          at = f.to;
        }
        frag.append(text.slice(at));
        offset += nl(text.slice(at));
        child.replaceWith(frag);
      }
    }
  };
  walk(block);
}

/** a note's text → a DocumentFragment for the reading view */
export function render(text, note) {
  const frag = isMarkdown(note.path || note.name || '.md') ? renderMarkdown(text) : renderPlain(text);
  for (const block of frag.querySelectorAll('[data-line]')) {
    if (block.tagName === 'PRE') continue;
    highlight(block, +block.dataset.line);
  }
  for (const box of frag.querySelectorAll('input.task-box')) {
    const li = box.closest('[data-line]');
    if (li) box.dataset.line = li.dataset.line;
    box.setAttribute('aria-label', 'Done');
  }
  for (const a of frag.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (href && href !== '#' && !href.startsWith('#')) {
      const p = resolvePath(note.dir || '', href.split('#')[0]);
      if (p) a.dataset.path = p;
    }
  }
  return frag;
}

function renderMarkdown(text) {
  const tokens = md.lexer(text);
  lines(tokens, 0);
  const html = md.parser(tokens);
  return DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] });
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]|(?<=^|[\s(\[{,;:"'“‘])@[\p{L}][\p{L}\p{N}_'’.-]*/gu;
function renderPlain(text) {
  const out = document.createDocumentFragment();
  const box = document.createElement('div');
  box.className = 'plain';
  String(text).split('\n').forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'pl';
    div.dataset.line = String(i);
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s(.*)$/.exec(line);
    let rest = line;
    if (m) {
      div.append(m[1]);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'task-box';
      cb.checked = m[2] !== ' ';
      div.append(cb, ' ');
      rest = m[3];
      if (cb.checked) div.classList.add('done');
    }
    let at = 0;
    for (const u of rest.matchAll(URL_RE)) {
      div.append(rest.slice(at, u.index));
      at = u.index + u[0].length;
      const a = document.createElement('a');
      if (u[0][0] === '@') {
        // (a person, shown by name)
        const name = cleanName(u[0].slice(1));
        if (!name) {
          div.append(u[0]);
          continue;
        }
        a.href = '#';
        a.className = 'person';
        a.dataset.person = personKey(name);
        a.textContent = displayName(name);
        div.append(a, u[0].slice(1 + name.length));
        continue;
      }
      a.href = u[0];
      a.textContent = u[0];
      div.append(a);
    }
    div.append(rest.slice(at));
    if (!line) div.append(' ');
    box.append(div);
  });
  out.append(box);
  return out;
}

/** Markdown → HTML for copying into an email or a document */
export function toHTML(text) {
  const tokens = md.lexer(text);
  lines(tokens, 0);
  // (people as their names, not links that lead nowhere outside TimNote)
  return DOMPurify.sanitize(md.parser(tokens), { FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style', 'data-line', 'class'] }).replace(/<a [^>]*data-person="[^"]*"[^>]*>([^<]*)<\/a>/g, '$1');
}
/** a short answer (from the AI) as HTML, with [[note]] links */
export function renderSnippet(text) {
  return DOMPurify.sanitize(md.parse(String(text || '')), { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] });
}

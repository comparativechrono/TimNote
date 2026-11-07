/* =====================================================================
   Tags. @Millie in a note tags it with Millie; #grant tags it with a
   topic. This page lists everyone and every topic; a person's page (or a
   topic's) has what is still to do that mentions them, then every note
   that does, newest first, with the lines where they come up.
     #/tags            everyone, and the topics
     #/tags/@millie    a person
     #/tags/#grant     a topic
   ===================================================================== */
import { h, iconEl, iconBtn, debounce, plural, reEsc } from '../util.js';
import * as lib from '../library.js';
import * as S from '../settings.js';
import { on } from '../bus.js';
import { fromIso, fmtDayMonth, fmtShort, DAYS, todayIso } from '../dates.js';
import { mentions, initials, personColour, displayName } from '../people.js';
import { inline } from '../inline.js';
import { app } from '../app.js';
import { itemRow, byWhen } from './items.js';
import { draggable, notePayload } from '../drag.js';

const SORTS = { recent: 'Most recent', name: 'A to Z', most: 'Most notes' };

/** a person's badge: their initials on their colour */
export const badge = (key, name, big = false) => h(`span.badge.hl-${personColour(key)}` + (big ? '.big' : ''), { 'aria-hidden': 'true' }, initials(name));

export class TagsView {
  constructor(arg) {
    this.kind = 'tags';
    this.arg = arg || '';
    this.filter = '';
    this.pending = new Map();
    this.el = h('section.tags-view');
    this.offs = [on('notes', debounce(() => this.render(), 120)), on('settings', debounce(() => this.render(), 60))];
    this.render();
  }
  hash() {
    return this.arg ? app.tagHash(this.arg) : '#/tags';
  }
  render() {
    const scroller = this.el.querySelector('.tags-scroll');
    const top = scroller ? scroller.scrollTop : 0;
    if (!this.arg) this.renderIndex();
    else if (this.arg[0] === '#') this.renderTopic(this.arg.slice(1).toLowerCase());
    else this.renderPerson(this.arg.replace(/^@/, '').toLowerCase());
    const s = this.el.querySelector('.tags-scroll');
    if (s) s.scrollTop = top;
  }

  /* ---------------- everyone ---------------- */
  renderIndex() {
    const people = Array.from(lib.peopleIndex().values());
    const topics = Array.from(lib.tagIndex().values());
    const q = lib.fold(this.filter).trim();
    const match = (s) => !q || lib.fold(s).includes(q);
    const sort = S.device.tagSort || 'recent';
    const last = (e) => (e.notes[0] ? e.notes[0].date : '');
    people.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'most' ? (a, b) => b.notes.length - a.notes.length || a.name.localeCompare(b.name) : (a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : b.notes.length - a.notes.length));
    topics.sort(sort === 'name' ? (a, b) => a.tag.localeCompare(b.tag) : (a, b) => b.notes.length - a.notes.length || a.tag.localeCompare(b.tag));

    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    const filter = h('input.input.small.list-filter', { type: 'search', placeholder: 'Find a name', value: this.filter, 'aria-label': 'Find a person or a topic' });
    filter.addEventListener('input', debounce(() => {
      this.filter = filter.value;
      this.render();
      const f = this.el.querySelector('.list-filter');
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
    }, 150));
    const sortSel = h('select.input.small', { 'aria-label': 'Order' }, Object.entries(SORTS).map(([k, v]) => h('option', { value: k, selected: k === sort }, v)));
    sortSel.addEventListener('change', () => {
      S.device.tagSort = sortSel.value;
      S.saveDevice();
      this.render();
    });
    const head = h(
      'header.page-head',
      burger,
      h('div.page-title', h('h1', 'Tags'), h('p.page-sub', 'Write ', h('code', '@Millie'), ' in a note to tag it with Millie (', h('code', '@Millie_Smith'), ' for Millie Smith). Words with ', h('code', '#'), ' are topics.')),
      h('div.page-tools', filter, sortSel)
    );
    const body = h('div.tags-scroll');
    const ps = people.filter((e) => match(e.name) || match(displayName(e.name)));
    const ts = topics.filter((e) => match(e.tag));
    if (!people.length && !topics.length) {
      body.append(
        h(
          'div.list-empty',
          h('p', 'No one is tagged yet.'),
          h('p.hint', 'Mention someone with @ in any note, and they appear here, with every note that mentions them:'),
          h('p.example', 'Talked to ', h('span.person', 'Millie'), ' about the poster. ', h('mark.hl.hl-yellow', 'TO DO:'), ' send her the figures'),
          h('p.hint', 'In the note that is written ', h('code', '@Millie'), '; it shows as just “Millie” when you read it.')
        )
      );
    }
    if (people.length) {
      body.append(
        h(
          'section.tag-sec',
          h('h2', 'People', h('span.n', String(ps.length))),
          ps.length
            ? h(
                'ul.people',
                ps.map((e) =>
                  h(
                    'li',
                    h(
                      'a.pcard',
                      { href: app.tagHash('@' + e.key) },
                      badge(e.key, e.name),
                      h('span.pcard-main', h('span.pcard-name', displayName(e.name)), h('span.pcard-meta', plural(e.notes.length, 'note') + (e.open ? `, ${e.open} to do` : '')), e.notes[0] ? h('span.pcard-last', 'Last mentioned ' + (e.notes[0].date === todayIso() ? 'today' : fmtDayMonth(e.notes[0].date))) : null)
                    )
                  )
                )
              )
            : h('p.hint', 'No one by that name.')
        )
      );
    }
    if (topics.length) {
      body.append(h('section.tag-sec', h('h2', 'Topics', h('span.n', String(ts.length))), ts.length ? h('ul.topics', ts.map((e) => h('li', h('a.tchip', { href: app.tagHash('#' + e.tag) }, '#' + e.tag, h('span.n', String(e.notes.length)))))) : h('p.hint', 'No topic like that.')));
    }
    this.el.replaceChildren(head, body);
  }

  /* ---------------- a person, or a topic ---------------- */
  renderPerson(key) {
    const e = lib.peopleIndex().get(key);
    const name = e ? displayName(e.name) : displayName(key);
    const items = [];
    for (const n of lib.all()) {
      if (n.conflict) continue;
      for (const t of n.tasks) if (!t.done && t.people.some((p) => p.toLowerCase() === key)) items.push({ task: t, note: n });
    }
    const lines = (n) => Array.from(new Set(mentions(n.text).filter((m) => m.key === key).map((m) => m.line)));
    this.page({ title: name, badge: badge(key, e ? e.name : key, true), notes: e ? e.notes : [], items: byWhen(items), lines, nobody: `No note mentions @${key} now.` });
  }
  renderTopic(tag) {
    const e = lib.tagIndex().get(tag);
    const items = [];
    for (const n of lib.all()) {
      if (n.conflict) continue;
      for (const t of n.tasks) if (!t.done && t.tags.includes(tag)) items.push({ task: t, note: n });
    }
    const re = new RegExp('(^|[\\s(\\[,;])#' + reEsc(tag) + '(?![\\p{L}\\p{N}_/-])', 'iu');
    const lines = (n) => n.text.split('\n').map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
    this.page({ title: '#' + tag, badge: h('span.badge.topic', { 'aria-hidden': 'true' }, iconEl('hash')), notes: e ? e.notes : [], items: byWhen(items), lines, nobody: `No note has #${tag} now.` });
  }
  page({ title, badge: b, notes, items, lines, nobody }) {
    const burger = iconBtn('menu', 'Notes and lists', () => document.body.classList.toggle('sidebar-open'), 'burger');
    const back = h('a.icon-btn.back', { href: '#/tags', title: 'All the tags', 'aria-label': 'All the tags' }, iconEl('arrow-left'));
    const shown = S.device.showArchive ? notes : notes.filter((n) => !n.archived);
    const archived = notes.length - shown.length;
    const latest = notes[0];
    const sub = notes.length ? `In ${plural(notes.length, 'note')}${latest ? `, most recently ${latest.date === todayIso() ? 'today' : 'on ' + fmtShort(latest.date, true)}` : ''}.` : nobody;
    const head = h('header.page-head', burger, back, h('div.page-title', h('h1', b, title), h('p.page-sub', sub)));
    const body = h('div.tags-scroll');
    if (items.length) {
      body.append(h('section.tag-sec', h('h2', 'Still to do', h('span.n', String(items.length))), h('ul.items.irows', items.map((it) => itemRow(it, { pending: this.pending, list: true })))));
    }
    if (shown.length) {
      body.append(
        h(
          'section.tag-sec',
          h('h2', 'Notes', h('span.n', String(shown.length))),
          h('ul.tnotes', shown.slice(0, 400).map((n) => this.noteRow(n, lines(n)))),
          archived ? h('p.hint', `And ${plural(archived, 'note')} in the archive. `, h('button.linkish', { type: 'button', onclick: () => ((S.device.showArchive = true), S.saveDevice(), this.render()) }, 'Show them')) : null
        )
      );
    } else if (archived) body.append(h('p.hint.tag-sec', `Only in ${plural(archived, 'archived note')}. `, h('button.linkish', { type: 'button', onclick: () => ((S.device.showArchive = true), S.saveDevice(), this.render()) }, 'Show them')));
    this.el.replaceChildren(head, body);
  }
  noteRow(n, lineNos) {
    const d = fromIso(n.date);
    const all = n.text.split('\n');
    const snips = lineNos.slice(0, 3).map((i) => h('a.tsnip', { href: app.noteHash(n.path, i), draggable: 'false' }, ...inline(clean(all[i] || ''), { marks: true })));
    if (lineNos.length > 3) snips.push(h('span.hint', `and ${lineNos.length - 3} more`));
    const li = h(
      'li.tnote' + (n.archived ? '.archived' : ''),
      h('span.sb-day', d ? h('b', String(d.getDate())) : '', d ? h('small', DAYS[d.getDay()].slice(0, 3)) : ''),
      h('div.tnote-main', h('a.tnote-title', { href: app.noteHash(n.path), draggable: 'false' }, n.title, h('span.tnote-date', fmtShort(n.date, true) + (n.dir ? '  ' + n.dir : ''))), snips.length ? h('div.tsnips', snips) : null)
    );
    draggable(li, () => notePayload(n), n.title);
    return li;
  }
  destroy() {
    for (const off of this.offs) off();
  }
}

/** a line as a snippet: without its heading marks, bullet or checkbox */
function clean(line) {
  const t = line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .trim();
  return t.length > 240 ? t.slice(0, 240).replace(/\s+\S*$/, '') + '…' : t;
}

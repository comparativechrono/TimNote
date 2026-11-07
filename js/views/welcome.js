/* The first page: choose the notes folder (or allow it again, on a later visit). */
import { h, iconEl, toast } from '../util.js';
import * as fsx from '../fsx.js';
import { app } from '../app.js';
import { MARK } from './sidebar.js';

/* what TimNote does, shown rather than told: a note with a highlighted line, and the list it lands on */
function demo() {
  return h(
    'div.demo',
    { 'aria-hidden': 'true' },
    h(
      'div.demo-page',
      h('div.demo-name', '2026-11-06 Lab meeting.md'),
      h('div.demo-line.h', 'Lab meeting'),
      h('div.demo-line', 'Sarah has the new imaging data; the controls look clean.'),
      h('div.demo-line', h('mark.hl.hl-yellow', 'TO DO:'), ' send Sarah the figures by Friday'),
      h('div.demo-line', h('mark.hl.hl-lilac', 'DECISION:'), ' repeat the knockdown in May'),
      h('div.demo-line', h('mark.hl.hl-blue', 'FOLLOW UP:'), ' ask Priya about the microscope booking')
    ),
    h(
      'div.demo-list',
      h('div.demo-list-head', h('span.swatch.hl-yellow'), 'To do'),
      h('div.demo-item', h('span.demo-box'), 'send Sarah the figures', h('span.demo-due', 'Fri')),
      h('div.demo-item', h('span.demo-box'), 'book the seminar room'),
      h('div.demo-item.done', h('span.demo-box.on', { html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>' }), 'mark the essays')
    )
  );
}

export function welcome() {
  const choose = h('button.btn.primary.big', { type: 'button' }, iconEl('folder-open'), h('span', 'Choose your notes folder'));
  choose.addEventListener('click', async () => {
    try {
      if (await fsx.pick()) {
        await app.connect();
        app.navigate('#/', { replace: true });
      }
    } catch (e) {
      toast('The folder couldn’t be opened: ' + e.message, 'bad', 8000);
    }
  });
  const trial = h('button.linkish', { type: 'button' }, 'Try it first, with the notes kept in this browser');
  trial.addEventListener('click', async () => {
    await fsx.useBrowserStorage();
    await app.connect();
    app.navigate('#/', { replace: true });
  });
  const ok = fsx.supported();
  return h(
    'div.welcome',
    h(
      'div.welcome-inner',
      h('div.welcome-brand', h('span.brand-mark.big', { html: MARK }), h('h1', 'TimNote')),
      h('p.lede', 'Notes and to-do lists, kept as plain text files in a folder you choose.'),
      demo(),
      h(
        'ul.welcome-points',
        h('li', h('b', 'Plain files. '), 'Every note is a .md or .txt file named with its date, such as “2026-11-06 Lab meeting.md”, so your file manager can find and search them.'),
        h('li', h('b', 'Lists from your notes. '), 'Write “TO DO:” in any note and the line goes on your To do list; tick it off there and the note says “DONE:”.'),
        h('li', h('b', 'Every computer. '), 'Choose a folder in Dropbox: each browser remembers it, and they all see the same notes.')
      ),
      ok
        ? h('div.welcome-go', choose, h('p.hint', 'TimNote asks the browser for permission to read and save files in that folder only. Nothing is uploaded anywhere.'), fsx.browserStorageSupported() ? trial : null)
        : h('div.notice.warn', h('b', 'This browser can’t open a folder. '), 'Use Chrome or Edge on a computer to keep your notes in a folder (and so in Dropbox). ', fsx.browserStorageSupported() ? trial : null)
    )
  );
}

export function reconnectScreen(name, onAllow) {
  const allow = h('button.btn.primary.big', { type: 'button', onclick: onAllow }, iconEl('folder-open'), h('span', `Open “${name}”`));
  const other = h('button.linkish', { type: 'button' }, 'Choose a different folder');
  other.addEventListener('click', async () => {
    try {
      if (await fsx.pick()) {
        await app.connect();
        app.navigate('#/', { replace: true });
      }
    } catch (e) {
      toast(e.message, 'bad');
    }
  });
  return h(
    'div.welcome',
    h(
      'div.welcome-inner.narrow',
      h('div.welcome-brand', h('span.brand-mark.big', { html: MARK }), h('h1', 'Welcome back')),
      h('p.lede', `TimNote needs your permission to open your notes folder, “${name}”, again.`),
      h('div.welcome-go', allow, h('p.hint', 'When the browser asks, choose “Allow on every visit” and it won’t ask again on this computer.'), other)
    )
  );
}

export function unsupported() {
  return h(
    'div.welcome',
    h('div.welcome-inner.narrow', h('div.welcome-brand', h('span.brand-mark.big', { html: MARK }), h('h1', 'TimNote')), h('p.lede', 'This browser can’t keep notes in a folder.'), h('p', 'Open TimNote in Chrome or Microsoft Edge on a computer (Windows, Mac, Linux or ChromeOS).'))
  );
}

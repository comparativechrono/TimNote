/* TimNote in Chrome: @people and the Tags page, notes and lists as mind maps, the lists as cards (ticking, adding,
   moving an item to another list by dragging), and boards kept as files (dragging items and notes on, moving cards,
   a change made on another computer). Run: node test/e2e-boards.mjs */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const PORT = 8767;
const server = await serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let n = 40;
const shot = (name) => page.screenshot({ path: join(OUT, `${++n}-${name}.png`) });
const ok = (cond, msg) => {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ✓ ' + msg);
};
const url = (hash) => `http://localhost:${PORT}/${hash}`;
const fs = {
  read: (p) => page.evaluate(async (p) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote');
    const parts = p.split('/');
    const name = parts.pop();
    for (const x of parts) d = await d.getDirectoryHandle(x);
    return (await (await d.getFileHandle(name)).getFile()).text();
  }, p),
  exists: (p) => fs.read(p).then(() => true, () => false),
  write: (p, text) => page.evaluate(async ([p, text]) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote');
    const parts = p.split('/');
    const name = parts.pop();
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }, [p, text])
};
const until = async (fn, msg, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch (e) {
      /* (not yet) */
    }
    if (Date.now() > end) throw new Error('FAILED (timed out): ' + msg);
    await page.waitForTimeout(100);
  }
};
const noToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

const LAB = 'Meetings/2026-11-05 Lab meeting.md';
const MILLIE = '2026-11-06 One to one with Millie.md';
const GRANT = '2026-11-04 Grant planning.md';
const SEMINAR = '2026-11-02 Seminar with Dr Okafor.md';
const NOTES = {
  [LAB]: '# Lab meeting\n\nTalked to @Millie about the poster. She wants the figures by Friday.\n\n## Actions\n- TO DO: send @Millie the figures @friday\n- FOLLOW UP: ask @Priya about the microscope booking #imaging\n- IDEA: a shared protocol doc for the qPCR\n\n## Decisions\nDECISION: repeat the knockdown in May\n\n## Next time\nPriya to show the new imaging data.\n',
  [MILLIE]: '# One to one with Millie\n\nThe thesis is going well. @Millie has nearly finished chapter 2.\n\nTO DO: check the travel budget for @Millie\nWAITING FOR: chapter 2 draft @2026-11-20\n',
  [GRANT]: '# Grant planning\n\nBudget lines for the renewal. #grant\n\nTO DO: draft the case for support by 2026-11-10\nTO DO: ask @Sam for the costings\n- [ ] email the research office\n',
  [SEMINAR]: '# Seminar with Dr Okafor\n\nCircadian clocks in plants.\n\nIDEA: try the temperature step on our lines\n'
};

try {
  await page.goto(url(''));
  await page.getByText('Try it first').click();
  await page.waitForSelector('#sidebar .sb-new');
  for (const [p, t] of Object.entries(NOTES)) await fs.write(p, t);
  await page.evaluate(() => window.TimNote.rescan());
  await page.waitForSelector(`.sb-note[data-path="${LAB}"]`);

  console.log('@people: a note mentioning @Millie is tagged with Millie');
  await page.goto(url('#/note/' + encodeURIComponent(LAB)));
  await page.waitForSelector('.note-view .cm-content');
  ok(await page.locator('.cm-person', { hasText: '@Millie' }).count() === 2, '@Millie is marked in the editor, wherever it is');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('.reader:not([hidden]) a.person');
  const names = await page.locator('.reader a.person').allInnerTexts();
  ok(names.join(',') === 'Millie,Millie,Priya', 'the reading view shows just the names: ' + names.join(', '));
  ok(!(await page.locator('.reader').innerText()).includes('@Millie'), 'with no @');
  await page.locator('.reader a.person').first().click();
  await page.waitForSelector('.tags-view .tnote');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/tags/@millie', 'clicking a name opens their page');
  ok(await page.locator('.tnote').count() === 2, 'which has both notes that mention Millie');
  ok(await page.locator('.tags-view .irow').count() === 2, 'and what is still to do that mentions her');
  ok((await page.locator('.tsnip').first().innerText()).includes('nearly finished chapter 2'), 'with the lines where she comes up');
  await shot('person');
  await page.click('.tags-view .back');
  await page.waitForSelector('.pcard');
  ok((await page.locator('.pcard-name').allInnerTexts()).join(',') === 'Millie,Priya,Sam', 'the Tags page lists everyone, most recently mentioned first');
  ok(await page.locator('.tchip').count() === 2, 'and the #topics');
  await shot('tags');
  await page.goto(url('#/note/' + encodeURIComponent(LAB)));
  await page.waitForSelector('.note-view .cm-person');
  await page.locator('.cm-person', { hasText: '@Priya' }).click({ modifiers: ['Control'] });
  await page.waitForSelector('.tags-view h1');
  ok((await page.locator('.tags-view h1').innerText()).includes('Priya'), 'Ctrl+click on @Priya in the editor opens her page');

  console.log('A note as a mind map');
  await page.goto(url('#/note/' + encodeURIComponent(LAB)));
  await page.waitForSelector('.note-view .cm-content');
  const before = await fs.read(LAB);
  await page.click('.note-tools .seg:has-text("Map")');
  await page.waitForSelector('.mcard.k-root');
  await page.waitForTimeout(300);
  ok(await page.locator('.mcard').count() === 10, 'each heading, paragraph and line is a card (10)');
  ok((await page.locator('.mcard.k-root').innerText()) === 'Lab meeting', 'the title in the middle');
  ok(await page.locator('.mlink.auto').count() === 9, 'joined to what they are under');
  const overlap = await page.evaluate(() => {
    const r = Array.from(document.querySelectorAll('.mcard')).map((e) => e.getBoundingClientRect());
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 1 && r[j].left < r[i].right - 1 && r[i].top < r[j].bottom - 1 && r[j].top < r[i].bottom - 1) return [i, j];
    return null;
  });
  ok(!overlap, 'no cards overlap');
  await page.focus('.marea');
  await page.keyboard.press('ArrowRight');
  ok((await page.locator('.mcard.selected').innerText()) === 'Lab meeting', 'the arrow keys choose a card: the middle one first');
  await page.keyboard.press('ArrowRight');
  ok((await page.locator('.mcard.selected').count()) === 1 && !(await page.locator('.mcard.selected.k-root').count()), 'then the next one that way');
  await page.keyboard.press('Escape');
  await shot('note-map');
  const card = page.locator('.mcard', { hasText: 'Priya to show' });
  const b0 = await card.boundingBox();
  await page.mouse.move(b0.x + 30, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + 80, b0.y + 120, { steps: 6 });
  await page.mouse.up();
  const b1 = await card.boundingBox();
  ok(Math.abs(b1.y - b0.y - 120 + b0.height / 2) < 4, 'a card can be dragged');
  const mapPath = '.timnote/maps/note%3AMeetings%2F2026-11-05 Lab meeting.md.json';
  await until(() => fs.exists(mapPath), 'the layout is saved');
  const layout = JSON.parse(await fs.read(mapPath));
  ok(Object.values(layout.cards).some((c) => c.x != null), 'where it was put is kept in .timnote/maps, for every computer');
  ok((await fs.read(LAB)) === before, 'and the note itself is not changed');
  await page.locator('.mcard', { hasText: 'send' }).locator('.mbox').click();
  await until(async () => (await fs.read(LAB)).includes('- DONE: send @Millie the figures @friday'), 'ticking a card ticks off its line in the note');
  ok(true, 'ticking a card ticks the line off in the note');
  await page.locator('.mcard', { hasText: 'FOLLOW UP' }).dblclick();
  await page.waitForSelector('.editor-host:not([hidden])');
  const at = await page.evaluate(() => {
    const v = window.TimNote.view.ed.view;
    return v.state.doc.lineAt(v.state.selection.main.head).text;
  });
  ok(at.startsWith('- FOLLOW UP:'), 'double-clicking a card opens the note at its line');
  await page.click('.note-tools .seg:has-text("Map")');
  await page.waitForSelector('.mcard.k-root');
  await page.click('.note-title');
  await page.fill('.note-title', 'Lab meeting with Priya');
  await page.keyboard.press('Enter');
  const mapPath2 = '.timnote/maps/note%3AMeetings%2F2026-11-05 Lab meeting with Priya.md.json';
  await until(() => fs.exists(mapPath2), 'the layout moves with the note when it is renamed');
  ok(!(await fs.exists(mapPath)), 'its layout moves with it when the note is renamed');
  const LAB2 = 'Meetings/2026-11-05 Lab meeting with Priya.md';

  console.log('The lists, side by side');
  await page.goto(url(''));
  await page.waitForSelector('.overview .tile .irow');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/lists', 'TimNote opens on the lists');
  const todo = page.locator('.tile[data-list="todo"]');
  ok(await todo.locator('.irow').count() === 4, 'the To do card shows what is still to do (4)');
  ok(await page.locator('.tile.soon').count() === 1, 'and a card for what is coming up');
  await shot('lists');
  await todo.locator('.irow', { hasText: 'ask Sam' }).locator('.item-box').check();
  await until(async () => (await fs.read(GRANT)).includes('DONE: ask @Sam for the costings'), 'ticked off in its note');
  ok(true, 'an item ticked off on its card is ticked off in its note');
  await noToasts();
  await page.fill('.tile[data-list="ideas"] .tile-input', 'a lab away day');
  await page.keyboard.press('Enter');
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await until(async () => (await fs.read(`Daily/${today} Daily note.md`)).includes('IDEA: a lab away day'), 'added to Ideas, in the daily note');
  ok(true, 'something typed at the foot of a card goes on that list, in today’s note');
  await page.waitForTimeout(300); // (the cards drawn again meanwhile)
  await page.keyboard.type('a reading group');
  await page.keyboard.press('Enter');
  await until(async () => (await fs.read(`Daily/${today} Daily note.md`)).includes('IDEA: a reading group'), 'a second one typed straight after');
  ok(true, 'and the box is ready for the next one straight away');
  await noToasts();
  await page.evaluate(() => (document.querySelector('.tiles').scrollLeft = 0)); // (typing in Ideas brought it into view)
  await todo.locator('.irow', { hasText: 'email the research office' }).dragTo(page.locator('.tile[data-list="followup"]'));
  await until(async () => (await fs.read(GRANT)).includes('- [ ] FOLLOW UP: email the research office'), 'moved to Follow up');
  ok(true, 'an item dragged onto another list moves to it (its note now says FOLLOW UP:)');
  await until(async () => (await page.locator('.tile[data-list="followup"] .irow', { hasText: 'email the research office' }).count()) === 1, 'shown on Follow up');
  await page.locator('.toast .toast-act', { hasText: 'Undo' }).click();
  await until(async () => (await fs.read(GRANT)).includes('\n- [ ] email the research office\n'), 'undo');
  ok(true, 'and Undo puts it back as it was');
  await page.click('.overview .seg:has-text("Mind map")');
  await page.waitForSelector('.overview .mcard.k-root');
  ok((await page.locator('.overview .mcard.k-root').innerText()) === 'Lists' && (await page.locator('.overview .mcard.list').count()) >= 5, 'or as a mind map: the lists round the middle');
  await shot('lists-map');
  await page.click('.overview .seg:has-text("Cards")');

  console.log('A board, kept as a file');
  // (a folder called Boards that already has notes in it: they stay notes)
  await fs.write('Boards/2026-11-01 Board meeting.md', '# Board meeting\n\nThe trustees met.\n\n## Finance\n\n- accounts approved\n');
  await page.evaluate(() => window.TimNote.rescan());
  await page.waitForSelector('.sb-note[data-path="Boards/2026-11-01 Board meeting.md"]');
  ok((await page.locator('.sb-board').count()) === 0, 'a note in a folder called Boards is still a note, not a board');
  await page.click('.sb-board-new');
  await page.fill('.modal input', 'Lab projects');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.board-view .bcol');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/board/Lab projects', 'a new board opens');
  ok((await fs.read('Boards/Lab projects.md')) === '---\nkanban-plugin: basic\n---\n\n## To do\n\n## Doing\n\n## Done\n\n', 'its file is in the Boards folder, with three columns');
  await page.waitForSelector('.btray-row');
  await noToasts();
  const col = (title) => page.locator(`.bcol[data-col="${title}"] .bcards`);
  await page.locator('.btray-row', { hasText: 'draft the case for support' }).dragTo(col('To do'));
  await until(async () => (await fs.read('Boards/Lab projects.md')).includes('## To do\n\n- [ ] draft the case for support by 2026-11-10 (from [[2026-11-04 Grant planning]])'), 'item on the board');
  ok(true, 'an item dragged from the tray goes on the board, as a line that names its note');
  await page.locator(`.sb-note[data-path="${SEMINAR}"]`).dragTo(col('Doing'));
  await until(async () => (await fs.read('Boards/Lab projects.md')).includes('## Doing\n\n- [ ] [[2026-11-02 Seminar with Dr Okafor]]'), 'note on the board');
  ok(true, 'a note dragged from the sidebar goes on the board, as a link to it');
  await page.locator(`.sb-note[data-path="${GRANT}"]`).dragTo(page.locator('.sb-board', { hasText: 'Lab projects' }));
  await until(async () => (await page.locator('.bcard.is-note', { hasText: 'Grant planning' }).count()) === 1, 'shown on the open board');
  ok(true, 'something dropped on the name of the board that is open appears on it');
  await page.locator('.bcard.is-note', { hasText: 'Grant planning' }).locator('.bcard-menu').click();
  await page.getByRole('menuitem', { name: 'Take off the board' }).click();
  await until(async () => !(await fs.read('Boards/Lab projects.md')).includes('- [ ] [[2026-11-04 Grant planning]]'), 'taken off');
  await page.click('.bcol[data-col="Done"] .badd');
  await page.keyboard.type('Order the antibodies');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await until(async () => (await fs.read('Boards/Lab projects.md')).includes('## Done\n\n- [ ] Order the antibodies'), 'card typed');
  ok(true, 'a card can be typed in');
  await page.locator('.bcard', { hasText: 'Seminar with Dr Okafor' }).dragTo(col('Done'));
  await until(async () => /## Doing\n\n## Done\n\n- \[ \] Order the antibodies\n- \[ \] \[\[2026-11-02 Seminar with Dr Okafor\]\]/.test(await fs.read('Boards/Lab projects.md')), 'card moved');
  ok(true, 'cards are dragged between columns');
  ok(await page.locator('.bcard.is-note .bnote-title', { hasText: 'Seminar with Dr Okafor' }).count() === 1, 'a note’s card shows its title and date');
  await shot('board');
  await page.locator('.bcard.is-item .item-box').check();
  await until(async () => (await fs.read(GRANT)).includes('DONE: draft the case for support'), 'ticked from the board');
  ok(true, 'an item’s box on the board ticks it off in its note');
  ok(!(await fs.read('Boards/Lab projects.md')).includes('[x]'), 'the board file itself is unchanged by that');

  console.log('From anywhere, onto a board in the sidebar');
  await page.goto(url('#/lists'));
  await page.waitForSelector('.tile .irow');
  await noToasts();
  await page.locator('.tile[data-list="todo"] .irow', { hasText: 'travel budget' }).dragTo(page.locator('.sb-board', { hasText: 'Lab projects' }));
  await until(async () => (await fs.read('Boards/Lab projects.md')).includes('- [ ] check the travel budget for @Millie (from [[2026-11-06 One to one with Millie]])'), 'dropped on the sidebar');
  ok(true, 'an item dragged onto a board’s name goes in its first column');
  ok(await page.locator('.sb-list[data-id="todo"] .count').innerText() === '2', 'boards are not notes: their lines are not counted on the lists');

  console.log('Changed on another computer');
  const now = await fs.read('Boards/Lab projects.md');
  await fs.write('Boards/Lab projects.md', now.replace('## Doing\n\n', '## Doing\n\n- [ ] Written on the other computer\n\n'));
  await page.goto(url('#/board/Lab%20projects'));
  await page.waitForSelector('.bcard');
  await page.evaluate(() => window.TimNote.rescan());
  await until(async () => (await page.locator('.bcard', { hasText: 'Written on the other computer' }).count()) === 1, 'shown');
  ok(true, 'a board changed elsewhere shows the change');
  await page.locator('.bcard', { hasText: 'Order the antibodies' }).dragTo(col('Doing'));
  await until(async () => {
    const t = await fs.read('Boards/Lab projects.md');
    return t.includes('Written on the other computer') && /## Doing\n\n- \[ \] Written on the other computer\n- \[ \] Order the antibodies/.test(t);
  }, 'both kept');
  ok(true, 'and a change made here keeps it');
  await page.locator('.bcard.is-item', { hasText: 'travel budget' }).locator('.bitem-text').click();
  await page.waitForSelector('.note-view .cm-content');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)).startsWith('#/note/' + MILLIE), 'clicking an item on a board opens its note, at its line');
  await page.click('.note-title');
  await page.fill('.note-title', 'One to one with Millie Smith');
  await page.keyboard.press('Enter');
  await until(async () => (await fs.read('Boards/Lab projects.md')).includes('(from [[2026-11-06 One to one with Millie Smith]])'), 'relinked');
  ok(true, 'renaming a note changes the cards on boards that link to it');
  ok((await fs.read('Boards/2026-11-01 Board meeting.md')) === '# Board meeting\n\nThe trustees met.\n\n## Finance\n\n- accounts approved\n', 'and leaves the notes in the Boards folder alone');

  console.log('Renaming and deleting a board');
  await page.goto(url('#/board/Lab%20projects'));
  await page.waitForSelector('.bcard');
  await page.click('.board-view .page-tools .icon-btn');
  await page.getByRole('menuitem', { name: 'Rename the board…' }).click();
  await page.fill('.modal input', 'Lab jobs');
  await page.keyboard.press('Enter');
  await until(async () => (await fs.exists('Boards/Lab jobs.md')) && !(await fs.exists('Boards/Lab projects.md')), 'renamed');
  await until(async () => (await page.locator('.sb-board').allInnerTexts()).join(',') === 'Lab jobs', 'the sidebar has the new name');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/board/Lab jobs', 'renaming a board renames its file (and the sidebar and address follow)');
  await page.click('.board-view .page-tools .icon-btn');
  await page.getByRole('menuitem', { name: 'Delete the board…' }).click();
  await page.click('.modal .btn.danger');
  await until(async () => !(await fs.exists('Boards/Lab jobs.md')), 'deleted');
  await until(async () => (await page.locator('.sb-board').count()) === 0, 'gone from the sidebar');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/lists', 'deleting a board deletes its file');
  ok(await fs.exists(LAB2), 'and its notes are still there');

  ok(errors.length === 0, 'no errors in the console' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nAll passed.');
} catch (e) {
  console.error('\n' + e.message);
  await shot('failure');
  if (errors.length) console.error('Console errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

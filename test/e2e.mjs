/* End-to-end test: TimNote in Chrome, using browser storage (the browser's private folder: a real folder can't be
   chosen by a test, but it is the same API). Run: npm run test:e2e (CHROME=/path/to/chrome if it isn't at
   /usr/bin/google-chrome). Screenshots go in test/out/. */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const server = await serve(8765);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let n = 0;
const shot = (name) => page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
const ok = (cond, msg) => {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ✓ ' + msg);
};
const fs = {
  read: (p) => page.evaluate(async (p) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote');
    const parts = p.split('/');
    const name = parts.pop();
    for (const x of parts) d = await d.getDirectoryHandle(x);
    return (await (await d.getFileHandle(name)).getFile()).text();
  }, p),
  write: (p, text) => page.evaluate(async ([p, text]) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote');
    const parts = p.split('/');
    const name = parts.pop();
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }, [p, text]),
  list: () => page.evaluate(async () => {
    const out = [];
    const walk = async (d, pre) => {
      for await (const [name, h] of d.entries()) {
        if (h.kind === 'directory') await walk(h, pre + name + '/');
        else out.push(pre + name);
      }
    };
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote'), '');
    return out.sort();
  })
};
const editorText = () => page.evaluate(() => window.TimNote.view.ed.getText());
const today = await page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

try {
  console.log('Starting');
  await page.goto('http://localhost:8765/');
  await page.getByText('Try it first').click();
  await page.waitForSelector('#sidebar .sb-new');
  await page.waitForTimeout(400);
  const files0 = await fs.list();
  ok(files0.includes('Templates/Meeting notes.md') && files0.length === 8, 'the built-in templates are written to the Templates folder');
  await page.waitForSelector('.overview .tile');
  ok(await page.locator('.overview .tile').count() === 6 && (await page.locator('.overview .tile-title').first().innerText()) === 'To do', 'it opens on the lists, side by side');
  await shot('empty-list');

  console.log('A meeting note from its template');
  await page.click('.sb-new');
  await page.getByRole('menuitem', { name: 'Meeting notes' }).click();
  await page.waitForSelector('.note-view');
  ok(await page.inputValue('.note-title') === 'Meeting', 'the template gives the title');
  await page.keyboard.type('Lab meeting with Sarah');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Discussed the imaging data. Sarah thinks the controls are clean.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('TO DO: send Sarah the figures by Friday');
  await page.keyboard.press('Enter');
  await page.keyboard.type('DECISION: repeat the knockdown in May');
  await page.keyboard.press('Enter');
  await page.keyboard.type('FOLLOW UP: ask @Priya about the microscope booking #imaging');
 await page.waitForFunction(() => document.querySelector('.note-status').textContent === 'Saved', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const path = `Meetings/${today} Lab meeting with Sarah.md`;
  const text1 = await fs.read(path);
  ok(text1.includes('# Lab meeting with Sarah') && text1.includes('TO DO: send Sarah the figures by Friday'), 'the note is saved as ' + path);
  ok(text1.includes('Friday\nDECISION: repeat the knockdown in May\nFOLLOW UP:'), 'each line is as typed');
  ok(await page.locator('.cm-hl-yellow').count() >= 1 && await page.locator('.cm-flag-yellow').count() === 1, 'the TO DO: word is highlighted, with a flag in the margin');
  ok(await page.locator('.sb-list[data-id="todo"] .count').innerText() === '1', 'the sidebar counts one to do');
  ok(await page.locator('.sb-list[data-id="decisions"] .count').innerText() === '1', 'and one decision');
  await shot('meeting-note');

  console.log('Ticking off on the To do list changes the file');
  await page.click('.sb-list[data-id="todo"]');
  await page.waitForSelector('.list-view .item-text');
  ok((await page.locator('.item-text').first().innerText()).includes('send Sarah the figures by Friday'), 'the item is on the list');
  ok((await page.locator('.item-meta .due').first().innerText()).length > 0, 'with its date ("by Friday")');
  await shot('todo-list');
  await page.locator('.item-box').first().check();
  await page.waitForTimeout(800);
  ok((await fs.read(path)).includes('DONE: send Sarah the figures by Friday'), 'the note now says DONE:');
  ok(await page.locator('.done-group summary').innerText().then((t) => t.includes('1')), 'and it is under Done');

  console.log('Adding to the list');
  await page.fill('.qa-text', 'book the seminar room');
  await page.fill('.qa-due', '2026-12-01');
  await page.click('.quick-add button[type=submit]');
  await page.waitForTimeout(800);
  const daily = await fs.read(`Daily/${today} Daily note.md`);
  ok(daily.includes('- TO DO: book the seminar room @2026-12-01'), "it goes in today's daily note, under Plan");
  ok(!/- \[ \] \n/.test(daily), "in place of the template's empty item");
  ok(await page.locator('.item-text', { hasText: 'book the seminar room' }).count() === 1, 'and it is on the list');

  console.log('The note again: reading view');
  await page.click(`.sb-note[data-path="${path}"]`);
  await page.waitForSelector('.note-view .cm-content');
  ok((await editorText()).includes('DONE: send Sarah'), 'the editor has the ticked-off line');
  ok(await page.locator('.cm-hl-done').count() === 1 && await page.locator('.cm-done').count() === 1, 'shown as done');
  await page.evaluate(() => window.TimNote.view.ed.setCursor(window.TimNote.view.ed.getText().length));
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] email the department');
  await page.waitForTimeout(1300);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('.reader:not([hidden]) mark.hl');
  ok(await page.locator('.reader mark.hl-lilac').count() === 1, 'the decision is highlighted in the reading view');
  await shot('reading');
  await page.locator('.reader input.task-box').last().check();
  await page.waitForTimeout(1300);
  ok((await fs.read(path)).includes('- [x] email the department'), 'a checkbox ticked in the reading view is saved');
  await page.locator('.reader mark.hl-done').first().click();
  await page.waitForTimeout(1300);
  ok((await fs.read(path)).includes('TO DO: send Sarah the figures'), 'clicking a done word un-ticks it');
  await page.keyboard.press('Control+e');

  console.log('Renaming through the title');
  await page.click('.note-title');
  await page.fill('.note-title', 'Lab meeting with Sarah and Priya');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const path2 = `Meetings/${today} Lab meeting with Sarah and Priya.md`;
  const files1 = await fs.list();
  ok(files1.includes(path2) && !files1.includes(path), 'the file is renamed, keeping its date');
  ok(decodeURIComponent(await page.evaluate(() => location.hash)).includes('Sarah and Priya'), 'and the address follows it');

  console.log('Search, the calendar and Ctrl+K');
  await page.goto('http://localhost:8765/#/search/imaging%20Sarah');
  await page.waitForSelector('.res-title');
  ok((await page.locator('.res-title').first().innerText()) === 'Lab meeting with Sarah and Priya', 'search finds the note');
  ok(await page.locator('.res-snip mark').count() >= 1, 'with the matching words marked');
  await shot('search');
  await page.goto('http://localhost:8765/#/calendar/');
  await page.waitForSelector('.cal-day.today');
  ok((await page.locator('.cal-day.today').innerText()).includes('Lab meeting'), "today's square has the note");
  await shot('calendar');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('priya');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.note-view .cm-content');
  ok((await page.inputValue('.note-title')) === 'Lab meeting with Sarah and Priya', 'Ctrl+K opens the note');

  console.log('Changes from another computer');
  const before = await editorText();
  await fs.write(path2, before + '\nWritten on the other computer.\n');
  await page.evaluate(() => window.TimNote.view.checkDisk());
  await page.waitForTimeout(300);
  ok((await editorText()).includes('Written on the other computer.'), 'a note changed elsewhere shows the new version');
  await page.evaluate(() => window.TimNote.view.ed.setCursor(0));
  await page.keyboard.type('My change. ');
  await fs.write(path2, before + '\nA different change, elsewhere.\n');
  await page.waitForSelector('.note-banner.warn', { timeout: 4000 });
  ok(true, 'changed in both places: it asks which to keep');
  await shot('conflict');
  await page.getByRole('button', { name: 'Keep both' }).click();
  await page.waitForTimeout(600);
  const files2 = await fs.list();
  const copy = files2.find((f) => f.includes('(my version'));
  ok(!!copy && (await fs.read(copy)).startsWith('My change.'), 'Keep both saves mine beside it: ' + copy);
  ok((await editorText()).includes('A different change, elsewhere.'), 'and shows the other version here');

  console.log('The AI (with a stand-in for Gemini)');
  let sent = null;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    sent = { url: route.request().url(), headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    const out = '# Lab meeting\\n\\nTidied: the controls are clean.\\n\\nTO DO: send Sarah the figures';
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: `data: {"candidates":[{"content":{"parts":[{"text":"${out}"}]},"finishReason":"STOP"}]}\n\n` });
  });
  await page.click('button[title="Settings"]');
  await page.locator('#set-ai input[type=password]').first().fill('test-key-123');
  await page.locator('#set-ai input[type=password]').first().dispatchEvent('change');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.click('.ai-btn');
  await page.getByRole('button', { name: /Tidy up/ }).click();
  await page.waitForSelector('.ai-btns button:has-text("Replace the note")');
  ok(sent && sent.headers['x-goog-api-key'] === 'test-key-123' && sent.url.includes('gemini-3.8-flash:streamGenerateContent'), 'the request goes to Gemini with the key');
  ok(sent.body.systemInstruction.parts[0].text.includes('TO DO:') && sent.body.contents[0].parts[0].text.includes('<note>'), 'with the list words and the note');
  await shot('ai');
  await page.getByRole('button', { name: 'Replace the note' }).click();
  await page.waitForTimeout(1300);
  ok((await editorText()).startsWith('# Lab meeting\n\nTidied:'), 'Replace puts the tidied text in the note');
  ok((await fs.read(path2)).includes('Tidied: the controls are clean.'), 'and it is saved');
  await page.keyboard.press('Control+z');
  ok(!(await editorText()).includes('Tidied:'), 'Ctrl+Z undoes it');

  console.log('Dark, and coming back later (set to open on the last note)');
  await page.evaluate(() => {
    localStorage.setItem('timnote:device', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('timnote:device') || '{}'), { theme: 'dark', home: 'last' })));
  });
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('.note-view .cm-content');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark is remembered');
  ok((await page.inputValue('.note-title')).startsWith('Lab meeting'), 'the last note opens again');
  await shot('dark-note');
  await page.goto('http://localhost:8765/#/list/todo');
  await page.waitForSelector('.list-view');
  await shot('dark-list');
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

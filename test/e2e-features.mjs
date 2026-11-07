/* More of TimNote in Chrome: Claude, asking about the notes, templates, plain-text notes, pictures, typing @dates
   and [[links]], archiving, pinning and deleting, unsaved changes after a crash, the new-note dialog, settings and a
   narrow window. Run: node test/e2e-features.mjs */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const server = await serve(8766);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let n = 20;
const shot = (name) => page.screenshot({ path: join(OUT, `${++n}-${name}.png`) });
const ok = (cond, msg) => {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ✓ ' + msg);
};
const fsRead = (p) => page.evaluate(async (p) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote');
  const parts = p.split('/');
  const name = parts.pop();
  for (const x of parts) d = await d.getDirectoryHandle(x);
  const f = await (await d.getFileHandle(name)).getFile();
  return f.type.startsWith('image/') || /\.png$/.test(name) ? 'bytes:' + f.size : f.text();
}, p);
const fsList = () => page.evaluate(async () => {
  const out = [];
  const walk = async (d, pre) => {
    for await (const [name, h] of d.entries()) h.kind === 'directory' ? await walk(h, pre + name + '/') : out.push(pre + name);
  };
  await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote'), '');
  return out.sort();
});
const text = () => page.waitForFunction(() => window.TimNote.view && window.TimNote.view.ed).then(() => page.evaluate(() => window.TimNote.view.ed.getText()));
const saved = () => page.waitForFunction(() => document.querySelector('.note-status') && document.querySelector('.note-status').textContent === 'Saved', null, { timeout: 5000 });
const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));

try {
  await page.goto('http://localhost:8766/');
  await page.getByText('Try it first').click();
  await page.waitForSelector('#sidebar .sb-new');

  console.log('A blank note takes its title from its first line');
  await page.keyboard.press('Alt+n');
  await page.waitForSelector('.modal .tpl-grid');
  await shot('new-note-dialog');
  await page.keyboard.press('Escape');
  await page.click('.sb-new');
  await page.getByRole('menuitem', { name: 'Blank note' }).click();
  await page.waitForSelector('.note-view .cm-content');
  await page.keyboard.type('Call the bank about the grant account');
  await page.keyboard.press('Enter');
  await page.keyboard.type('TO DO: send them the form @fri');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await shot('autocomplete-date');
  await page.keyboard.press('Enter');
  await saved();
  const t1 = await text();
  ok(/TO DO: send them the form @\d{4}-\d{2}-\d{2}/.test(t1), 'typing @fri offers the date, and puts in ' + t1.split('@')[1]);
  const files = await fsList();
  const blank = files.find((f) => f.includes('Call the bank'));
  ok(blank === `${today} Call the bank about the grant account.md`, 'the file is named from the first line: ' + blank);

  console.log('Links between notes: [[');
  await page.keyboard.press('Enter');
  await page.keyboard.type('See [[Call');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.keyboard.press('Enter');
  ok((await text()).includes('\nSee [[Call the bank about the grant account]]'), 'typing [[ offers the notes, and makes the link');

  console.log('A plain-text note');
  await page.evaluate(() => window.TimNote.newNoteDialog());
  await page.waitForSelector('.modal .tpl-grid');
  await page.fill('.modal input[placeholder="Title"]', 'Shopping');
  await page.selectOption('.modal select:has(option[value="txt"])', 'txt');
  await page.getByRole('button', { name: 'Make the note' }).click();
  await page.waitForFunction(() => window.TimNote.view && /Shopping\.txt$/.test(window.TimNote.view.path || '') && !window.TimNote.view.needsLoad);
  await page.click('.cm-content');
  await page.keyboard.type('- [ ] milk\n- [ ] bread\nTODO: book the car service');
  await saved();
  ok((await fsRead(`${today} Shopping.txt`)).includes('TODO: book the car service'), 'a .txt note is saved as plain text');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('.reader .plain');
  ok(await page.locator('.reader .plain input.task-box').count() === 2 && await page.locator('.reader mark.hl').count() === 1, 'and read with its checkboxes and words');
  await page.locator('.reader .plain input.task-box').first().check();
  await page.waitForTimeout(1300);
  ok((await fsRead(`${today} Shopping.txt`)).startsWith('- [x] milk'), 'ticked in the reading view');
  await page.keyboard.press('Control+e');

  console.log('A picture pasted in');
  await page.evaluate(() => window.TimNote.view.ed.setCursor(window.TimNote.view.ed.getText().length));
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    c.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1500);
  const pic = (await fsList()).find((f) => f.startsWith('attachments/'));
  ok(!!pic && (await fsRead(pic)).startsWith('bytes:'), 'it is saved in the attachments folder: ' + pic);
  ok((await text()).includes('](attachments/'), 'and linked from the note');

  console.log('Templates are files you can change');
  await page.click('button[title="Settings"]');
  await page.locator('#set-templates').scrollIntoViewIfNeeded();
  await shot('settings');
  await page.locator('#set-templates li', { hasText: 'Phone call' }).getByRole('button', { name: 'Change it' }).click();
  await page.waitForSelector('.note-view .cm-content');
  await page.waitForFunction(() => window.TimNote.view && window.TimNote.view.ed && window.TimNote.view.ed.getText().includes('{{title}}'));
  ok(await page.locator('.note-title').evaluate((e) => e.readOnly), 'a template opens, its title fixed');
  await page.evaluate(() => {
    const ed = window.TimNote.view.ed;
    ed.setCursor(ed.getText().length);
  });
  await page.keyboard.type('\nWHO: ');
  await saved();
  await page.waitForTimeout(500);
  ok((await fsRead('Templates/Phone call.md')).includes('WHO: '), 'the change is saved in the template');
  ok(!(await page.locator('.sb-note', { hasText: 'Phone call' }).count()), 'templates are not listed as notes');
  await page.click('.sb-new');
  await page.getByRole('menuitem', { name: 'Phone call' }).click();
  await page.waitForSelector('.note-view .cm-content');
  ok((await text()).includes('WHO: '), 'and new notes from it have the change');
  await page.keyboard.press('Escape');

  console.log('Pin, archive, delete');
  const bankPath = `${today} Call the bank about the grant account.md`;
  await page.click(`.sb-note[data-path="${bankPath}"]`);
  await page.waitForSelector('.note-view .cm-content');
  await page.click('.note-tools button[title="More"]');
  await page.getByRole('menuitem', { name: 'Pin to the top' }).click();
  await page.waitForTimeout(800);
  ok(await page.locator('.sb-group', { hasText: 'Pinned' }).count() === 1, 'pinned notes are listed first');
  ok((await fsRead('.timnote/settings.json')).includes(bankPath), 'and the pin is kept in .timnote/settings.json, for every computer');
  const before = await page.locator('.sb-list[data-id="todo"] .count').innerText();
  await page.click('.note-tools button[title="More"]');
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.waitForTimeout(900);
  ok((await fsList()).includes('Archive/' + bankPath), 'archiving moves it to the Archive folder');
  const after = await page.locator('.sb-list[data-id="todo"] .count').innerText().catch(() => '0');
  ok(+after === +before - 1, `and its items leave the lists (${before} → ${after})`);
  await page.click('.note-tools button[title="More"]');
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(600);
  ok(!(await fsList()).some((f) => f.includes('Call the bank')), 'deleting removes the file');

  console.log('Claude, and asking about the notes');
  let sent = null;
  await page.route('https://api.anthropic.com/**', async (route) => {
    sent = { headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    const body = ev({ type: 'message_start', message: { id: 'm' } }) + ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'You need to book the car service, from [[Shopping]].' } }) + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + ev({ type: 'message_stop' });
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  });
  await page.evaluate(async () => {
    const S = await import('/js/settings.js');
    S.shared.ai.provider = 'anthropic';
    S.sharedChanged();
    const ai = await import('/js/ai.js');
    await ai.setKeys({ gemini: '', anthropic: 'sk-ant-test' }, 'computer');
  });
  await page.click(`.sb-note:has-text("Shopping")`);
  await page.waitForSelector('.note-view .cm-content');
  await page.click('.ai-btn');
  await page.getByRole('tab', { name: 'Ask your notes' }).click();
  await page.fill('.ai-q', 'What do I need to book?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForSelector('.ai-answer a.wikilink');
  ok(sent.headers['x-api-key'] === 'sk-ant-test' && sent.headers['anthropic-version'] === '2023-06-01' && sent.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'Claude is called with the key and the browser header');
  ok(sent.body.model === 'claude-sonnet-5-5' && sent.body.output_config && sent.body.output_config.effort === 'low' && sent.body.stream === true, 'with the model, low effort, streamed');
  ok(sent.body.messages[0].content[0].text.includes('### [[Shopping]]'), 'the notes that match the question are sent with it');
  await shot('ask');
  await page.locator('.ai-answer a.wikilink').click();
  ok((await page.inputValue('.note-title')) === 'Shopping', 'a [[note]] in the answer opens it');

  console.log('Unsaved changes after a crash');
  await page.evaluate(async () => {
    const { idbSet } = await import('/js/idb.js');
    const lib = await import('/js/library.js');
    const path = window.TimNote.view.path;
    await idbSet('rec:' + path, { at: Date.now(), path, text: 'Typed but never saved.', base: lib.get(path).mtime, title: 'Shopping', folder: 'Browser storage' });
  });
  await page.goto('http://localhost:8766/#/calendar/');
  await page.reload();
  await page.waitForSelector('.toast:has-text("unsaved changes")');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForSelector('.rec-row');
  await shot('recovery');
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.waitForTimeout(600);
  ok((await text()) === 'Typed but never saved.', 'they are offered back, and restored into the note');
  await saved();

  console.log('Safety: changes from another computer are never lost');
  const fsWrite = (p, data) => page.evaluate(async ([p, data]) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote');
    const parts = p.split('/');
    const name = parts.pop();
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(typeof data === 'string' ? data : new Uint8Array(data));
    await w.close();
  }, [p, data]);
  const fsBytes = (p) => page.evaluate(async (p) => Array.from(new Uint8Array(await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote')).getFileHandle(p)).getFile()).arrayBuffer())), p);
  await fsWrite(`${today} Safety.md`, 'First line.\n');
  await page.evaluate(() => window.TimNote.rescan());
  await page.evaluate((p) => window.TimNote.openNote(p), `${today} Safety.md`);
  await page.waitForFunction(() => window.TimNote.view && window.TimNote.view.path && window.TimNote.view.path.includes('Safety'));
  await page.click('.cm-content');
  await page.evaluate(() => window.TimNote.view.ed.setCursor(0));
  await page.keyboard.type('Mine. ');
  await saved();
  await fsWrite(`${today} Safety.md`, 'Mine. First line.\nWritten on the other computer.\n');
  await page.evaluate(() => window.TimNote.view.checkDisk());
  await page.waitForFunction(() => window.TimNote.view && window.TimNote.view.ed.getText().includes('other computer'));
  await page.click('.cm-content');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1300);
  ok((await text()).includes('Written on the other computer.') && (await fsRead(`${today} Safety.md`)).includes('Written on the other computer.'), 'Ctrl+Z undoes only your own typing, not a change brought in from elsewhere');

  await fsWrite(`${today} Safety.md`, 'Changed elsewhere, not yet seen here.\n');
  await page.click('.note-title');
  await page.fill('.note-title', 'Safety renamed');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const afterRename = await fsList();
  ok(afterRename.includes(`${today} Safety.md`) && !afterRename.includes(`${today} Safety renamed.md`), 'a note changed elsewhere since it was last seen is not renamed');
  ok((await text()).includes('Changed elsewhere, not yet seen here.') && (await fsRead(`${today} Safety.md`)).includes('Changed elsewhere'), 'and the change made elsewhere is shown, and kept');

  console.log('Safety: a file that is not UTF-8 is never changed');
  const ansi = [0x54, 0x4f, 0x20, 0x44, 0x4f, 0x3a, 0x20, 0x70, 0x61, 0x79, 0x20, 0x74, 0x68, 0x65, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x35, 0x0d, 0x0a]; // "TO DO: pay the café £5" (Windows-1252)
  await fsWrite('ansi.txt', ansi);
  await page.evaluate(() => window.TimNote.rescan());
  await page.evaluate(() => window.TimNote.openNote('ansi.txt'));
  await page.waitForFunction(() => window.TimNote.view && window.TimNote.view.path === 'ansi.txt');
  await page.waitForSelector('.note-banner:has-text("isn’t UTF-8")');
  ok((await text()).includes('pay the café £5') && (await page.locator('.cm-content').getAttribute('contenteditable')) === 'false', 'it is shown, read-only, with a warning');
  await page.click('.sb-list[data-id="todo"]');
  await page.waitForSelector('.item-text:has-text("café")');
  await page.locator('.item', { hasText: 'café' }).locator('.item-box').check();
  await page.waitForSelector('.toast:has-text("UTF-8")');
  ok(JSON.stringify(await fsBytes('ansi.txt')) === JSON.stringify(ansi), 'ticking it off on the list is refused, and its bytes are unchanged');

  console.log('Safety: two items ticked quickly in one note are both kept');
  await fsWrite(`${today} Two items.md`, 'TO DO: first quick one\nTO DO: second quick one\n');
  await page.evaluate(() => window.TimNote.rescan());
  await page.waitForSelector('.item-text:has-text("second quick one")');
  // (both clicked at once, so that the two changes to the file are under way together)
  await page.evaluate(() => {
    for (const li of document.querySelectorAll('.item')) if (/quick one/.test(li.textContent)) li.querySelector('.item-box').click();
  });
  await page.waitForTimeout(1200);
  const two = await fsRead(`${today} Two items.md`);
  ok(two === 'DONE: first quick one\nDONE: second quick one\n', 'both are ticked off in the file: ' + JSON.stringify(two));

  console.log('Spoken punctuation');
  const shaped = await page.evaluate(async () => (await import('/js/dictation.js')).shape('discussed the data full stop new paragraph action point book the room comma then lunch', ''));
  ok(shaped === 'Discussed the data.\n\nTO DO: Book the room, then lunch', 'dictation turns "full stop", "new paragraph" and "action point" into text: ' + JSON.stringify(shaped));

  console.log('A narrow window');
  await page.setViewportSize({ width: 420, height: 820 });
  await page.waitForTimeout(300);
  await shot('narrow-note');
  await page.locator('.burger:visible').first().click();
  await page.waitForTimeout(300);
  await shot('narrow-sidebar');
  ok(await page.evaluate(() => document.body.classList.contains('sidebar-open')), 'the sidebar opens from the menu button');
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

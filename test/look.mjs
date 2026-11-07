/* Not a test: seeds a few notes and takes screenshots of the newer pages, to look at. Run: node test/look.mjs */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out', process.env.OUTDIR || 'look');
mkdirSync(OUT, { recursive: true });
const server = await serve(8768);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const width = +(process.env.W || 1360), height = +(process.env.H || 860);
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: +(process.env.DPR || 1) });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const write = (p, text) => page.evaluate(async ([p, text]) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('TimNote', { create: true });
  const parts = p.split('/');
  const name = parts.pop();
  for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}, [p, text]);

export const NOTES = {
  'Meetings/2026-11-05 Lab meeting.md': `# Lab meeting\n\nTalked to @Millie about the poster. She wants the figures by Friday, and the abstract tidied.\n\n## Actions\n- TO DO: send @Millie the figures @friday\n- FOLLOW UP: ask @Priya about the microscope booking #imaging\n- IDEA: a shared protocol doc for the qPCR\n\n## Decisions\nDECISION: repeat the knockdown in May\n\n## Next time\nPriya to show the new imaging data.\n`,
  '2026-11-06 One to one with Millie.md': `# One to one with Millie\n\nThe thesis is going well. @Millie has nearly finished chapter 2.\n\n- Chapter 2 draft is nearly done\n- Wants to go to the conference in March\n  - needs funding #travel\n\nTO DO: check the travel budget for @Millie\nWAITING FOR: Millie's chapter 2 draft @2026-11-20\nQUESTION: can we pay for the conference from the grant?\n`,
  '2026-11-04 Grant planning.md': `# Grant planning\n\nBudget lines for the renewal. #grant\n\nTO DO: draft the case for support by 2026-11-10\nTO DO: ask @Sam for the costings\n- [ ] email the research office\n`,
  '2026-11-02 Seminar with Dr Okafor.md': `# Seminar with Dr Okafor\n\nNotes from the seminar on circadian clocks in plants.\n\n- Clock genes are expressed in a wave across the leaf\n- Temperature resets the clock faster than light\n\nIDEA: try the temperature step on our lines\nTO DO: read Okafor 2024 #reading\n`
};

try {
  await page.goto('http://localhost:8768/');
  await page.getByText('Try it first').click();
  await page.waitForSelector('#sidebar .sb-new');
  for (const [p, t] of Object.entries(NOTES)) await write(p, t);
  await page.evaluate(() => window.TimNote.rescan());
  await page.waitForTimeout(500);
  await page.goto('http://localhost:8768/#/lists');
  await page.waitForSelector('.tile .irow');
  await shot('lists-tiles');
  await page.click('.overview .seg:nth-child(2)');
  await page.waitForSelector('.mcard');
  await page.waitForTimeout(400);
  await shot('lists-map');
  await page.click('.overview .seg:nth-child(1)');
  await page.goto('http://localhost:8768/#/note/' + encodeURIComponent('Meetings/2026-11-05 Lab meeting.md'));
  await page.waitForSelector('.note-view .cm-content');
  await shot('note-write');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('.reader a.person');
  await shot('note-read');
  await page.click('.note-tools .seg:nth-child(3)');
  await page.waitForSelector('.mcard');
  await page.waitForTimeout(400);
  await shot('note-map');
  await page.goto('http://localhost:8768/#/tags');
  await page.waitForSelector('.pcard');
  await shot('tags');
  await page.click('.pcard');
  await page.waitForSelector('.tnote');
  await shot('person');
  const made = await page.evaluate(async () => {
    const lib = await import('/js/library.js');
    await lib.createBoard('Lab projects');
    return true;
  });
  await page.goto('http://localhost:8768/#/board/Lab%20projects');
  await page.waitForSelector('.bcol');
  await page.waitForSelector('.btray-row');
  const rows = page.locator('.btray-row');
  await rows.nth(0).dragTo(page.locator('.bcol').nth(0).locator('.bcards'));
  await page.waitForTimeout(300);
  await rows.nth(2).dragTo(page.locator('.bcol').nth(1).locator('.bcards'));
  await page.waitForTimeout(300);
  const noteRows = page.locator('.btray-sec').last().locator('.btray-row');
  await noteRows.nth(0).dragTo(page.locator('.bcol').nth(0).locator('.bcards'));
  await page.waitForTimeout(300);
  await page.click('.bcol:nth-child(3) .badd');
  await page.keyboard.type('Order the antibodies');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => (document.querySelector('.bcols').scrollLeft = 0));
  await shot('board');
  await page.click('.tray-btn');
  await page.waitForTimeout(200);
  await shot('board-no-tray');
  if (process.env.DARK) {
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await shot('board-dark');
    await page.goto('http://localhost:8768/#/lists');
    await page.waitForSelector('.tile .irow');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await shot('lists-dark');
  }
  console.log('done', made);
} catch (e) {
  console.error(e);
  await shot('failure');
} finally {
  await browser.close();
  server.close();
}

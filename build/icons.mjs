/* Makes the PNG icons from icons/icon.svg and icons/icon-maskable.svg (needs Chrome, through Playwright). */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage();
for (const [src, out, size] of [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['icon-maskable.svg', 'icon-maskable-512.png', 512]]) {
  const svg = readFileSync(join(root, 'icons', src), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(root, 'icons', out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons made');

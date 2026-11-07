import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseName, fileName, cleanTitle, cleanFolder, freeName, relPath, resolvePath, decodeText, encodeText, isConflictCopy, splitPath } from '../../js/notes.js';
import { dateFromName, dayWord, ukDate, monthGrid, fmtLong } from '../../js/dates.js';
import { fill, parseTemplate, templateFile, BUILTIN } from '../../js/templates.js';

test('a file name is its date and title', () => {
  assert.equal(fileName('2026-11-06', 'Lab meeting', 'md'), '2026-11-06 Lab meeting.md');
  assert.deepEqual(parseName('2026-11-06 Lab meeting.md'), { date: '2026-11-06', title: 'Lab meeting', ext: 'md' });
  assert.deepEqual(parseName('20261106_notes.txt'), { date: '2026-11-06', title: 'notes', ext: 'txt' });
  assert.deepEqual(parseName('Shopping list.md'), { date: null, title: 'Shopping list', ext: 'md' });
  assert.equal(parseName('2026-13-45 Not a date.md').date, null);
  assert.equal(fileName('2026-11-06', '', 'md'), '2026-11-06 Untitled.md');
});

test('titles and folders are made safe for every computer', () => {
  assert.equal(cleanTitle('Q3: plans / ideas?'), 'Q3- plans - ideas-');
  assert.equal(cleanTitle('  ..hidden. '), 'hidden');
  assert.equal(cleanTitle('a'.repeat(200)).length, 120);
  assert.equal(cleanFolder('Meetings/../x'), 'Meetings/x');
  assert.equal(cleanFolder('/Work\\Projects/'), 'Work/Projects');
});

test('a name already taken gets a number', () => {
  const taken = new Set(['meetings/2026-11-06 a.md', 'meetings/2026-11-06 a (2).md']);
  assert.equal(freeName('Meetings', '2026-11-06 A.md', taken), 'Meetings/2026-11-06 A (3).md');
  assert.equal(freeName('', 'b.md', taken), 'b.md');
});

test('links between files', () => {
  assert.equal(relPath('Meetings', 'attachments/x.png'), '../attachments/x.png');
  assert.equal(relPath('', 'attachments/x.png'), 'attachments/x.png');
  assert.equal(resolvePath('Meetings', '../attachments/x%20y.png'), 'attachments/x y.png');
  assert.equal(resolvePath('', '../outside.png'), null);
  assert.deepEqual(splitPath('a/b/c.md'), { dir: 'a/b', name: 'c.md' });
});

test('Windows line endings and a byte-order mark are kept', () => {
  const d = decodeText('﻿one\r\ntwo\r\n');
  assert.deepEqual(d, { text: 'one\ntwo\n', eol: '\r\n', bom: true });
  assert.equal(encodeText('one\ntwo\nthree', d.eol, d.bom), '﻿one\r\ntwo\r\nthree');
  assert.equal(encodeText('a\nb', '\n', false), 'a\nb');
});

test("Dropbox's conflicted copies are recognised", () => {
  assert.ok(isConflictCopy("2026-11-06 Notes (Tim's conflicted copy 2026-11-06).md"));
  assert.ok(isConflictCopy('2026-11-06 Notes (conflicted copy 2026-11-06).md'));
  assert.ok(!isConflictCopy('2026-11-06 Notes about conflicts.md'));
});

test('dates', () => {
  assert.deepEqual(dateFromName('2026-11-06 x'), { date: '2026-11-06', rest: 'x' });
  assert.deepEqual(dateFromName('20261106'), { date: '2026-11-06', rest: '' });
  assert.equal(dateFromName('2026-11-06x'), null);
  assert.equal(dayWord('friday', '2026-11-04'), '2026-11-06');
  assert.equal(dayWord('friday', '2026-11-06'), '2026-11-13');
  assert.equal(dayWord('end of month', '2026-02-10'), '2026-02-28');
  assert.equal(ukDate(29, 2, null, '2027-01-01'), null);
  assert.equal(fmtLong('2026-11-06'), 'Friday 6 November 2026');
  const g = monthGrid(2026, 10);
  assert.equal(g[0][0], '2026-10-26');
  assert.ok(g.every((w) => w.length === 7));
});

test('templates', () => {
  const t = parseTemplate(templateFile(BUILTIN[0]));
  assert.equal(t.folder, 'Meetings');
  assert.equal(t.title, 'Meeting');
  const f = fill('# {{title}}\n{{date:long}}\n{{cursor}}\n{{unknown}}', { title: 'Lab', date: '2026-11-06' });
  assert.equal(f.text, '# Lab\nFriday 6 November 2026\n\n{{unknown}}');
  assert.equal(f.cursor, '# Lab\nFriday 6 November 2026\n'.length);
});

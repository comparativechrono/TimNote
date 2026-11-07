import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBytes, decodeText, encodeText } from '../../js/notes.js';
import { mergeShared } from '../../js/library.js';

test('UTF-8 is read strictly, keeping a byte-order mark', () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc2, 0xa3]); // BOM, "a£"
  const d = decodeBytes(bom.buffer);
  assert.equal(d.utf8, true);
  assert.equal(d.raw, '﻿a£');
  const t = decodeText(d.raw);
  assert.equal(t.bom, true);
  assert.equal(encodeText(t.text, t.eol, t.bom), '﻿a£');
});

test('a file that isn’t UTF-8 is marked, so that it is never written back', () => {
  const ansi = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x35]); // "café £5" in Windows-1252
  const d = decodeBytes(ansi.buffer);
  assert.equal(d.utf8, false);
  assert.equal(d.raw, 'café £5');
});

test('shared settings: theirs, with what was changed here on top', () => {
  const base = { pinned: ['a.md'], lists: [{ id: 'todo' }], ai: { provider: 'gemini', aboutMe: '' } };
  const mine = { pinned: ['a.md', 'b.md'], lists: [{ id: 'todo' }], ai: { provider: 'gemini', aboutMe: 'Tim' } };
  const theirs = { pinned: ['a.md'], lists: [{ id: 'todo' }, { id: 'new' }], ai: { provider: 'anthropic', aboutMe: '' } };
  const m = mergeShared(base, mine, theirs);
  assert.deepEqual(m.pinned, ['a.md', 'b.md'], 'my pin is kept');
  assert.deepEqual(m.lists, [{ id: 'todo' }, { id: 'new' }], 'their new list is kept');
  assert.equal(m.ai.provider, 'anthropic', 'their change in ai is kept');
  assert.equal(m.ai.aboutMe, 'Tim', 'and mine');
});

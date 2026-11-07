import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentions, peopleIn, cleanName, displayName, initials } from '../../js/people.js';
import { parseBoard, serializeBoard, cardKind, ops, NEW_BOARD, itemCard, noteCard, noteRef, isBoardText, relinkCard } from '../../js/boards.js';
import { noteBlocks, noteTree, treeLayout, itemsTree } from '../../js/mapdata.js';
import { compile, DEFAULT_LISTS } from '../../js/tasks.js';

test('@Name anywhere tags a note with that person', () => {
  const t = 'Met @Millie and @sam.\nTO DO: ask @Millie_Smith about it @friday\nemail jo@example.com\n`@code` stays\n```\n@fenced\n```';
  const m = mentions(t);
  assert.deepEqual(m.map((x) => x.name), ['Millie', 'sam', 'Millie_Smith']);
  assert.deepEqual(m[0], { name: 'Millie', key: 'millie', line: 0, from: 4, to: 11 });
  assert.deepEqual(peopleIn('@Millie, @millie and @Sam').map((p) => p.key), ['millie', 'sam']);
  assert.equal(cleanName('tomorrow'), null);
  assert.equal(cleanName('next'), null);
  assert.equal(displayName('Millie_Smith'), 'Millie Smith');
  assert.equal(initials('Millie_Smith'), 'MS');
  assert.equal(initials('Millie'), 'Mi');
  // (possessives, dates and web addresses)
  assert.deepEqual(peopleIn("@Millie's poster, by @end of month, on @the 12th of Nov, medium.com/@writer, https://mastodon.social/@bob, (@Priya)").map((p) => p.name), ['Millie', 'Priya']);
  assert.deepEqual(peopleIn('````\n```\n@inside\n````\n@after').map((p) => p.name), ['after']);
});

test('a board file is read and written back as it was', () => {
  const text = '---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] Book the room\n- [ ] [[2026-11-06 Lab meeting]]\n- [ ] send figures (from [[2026-11-06 Lab meeting]])\n\n## Doing\n\n## Done\n\n- [x] Order antibodies\n\n%% kanban:settings\n```\n{"kanban-plugin":"basic"}\n```\n%%\n';
  const b = parseBoard(text);
  assert.deepEqual(b.columns.map((c) => c.title), ['To do', 'Doing', 'Done']);
  assert.equal(b.columns[0].cards.length, 3);
  assert.equal(b.columns[2].cards[0].done, true);
  assert.ok(b.tail[0].startsWith('%% kanban:settings'));
  assert.equal(serializeBoard(b), text);
  assert.deepEqual(parseBoard(NEW_BOARD()).columns.map((c) => c.title), ['To do', 'Doing', 'Done']);
});

test('a board changed keeps everything it doesn’t understand exactly as it was', () => {
  const text = '---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] Write report\n    - [ ] intro\n\tmore under it\n- [ ] Two\n\nA paragraph between\n\n- [x] Three\n\n```\n# not a column\n\n- [ ] not a card\n```\n\n# An H1 note\n### A sub heading\n\n## C#\n\n- [ ] sharp\n\n***\n\n## Archive\n\n- [x] old\n';
  const b = parseBoard(text);
  assert.equal(serializeBoard(b), text);
  assert.deepEqual(b.columns.map((c) => c.title), ['To do', 'C#', 'Archive']);
  assert.deepEqual(b.columns[0].cards.map((c) => c.text), ['Write report', 'Two', 'Three']);
  // (a card moved takes the lines under it with it; nothing else moves)
  assert.ok(ops.moveCard(b, { from: 'To do', text: 'Write report', to: 'C#' }));
  assert.ok(ops.addCard(b, { column: 'C#', text: 'new' }));
  const out = serializeBoard(b);
  assert.ok(out.includes('## C#\n\n- [ ] sharp\n- [ ] Write report\n    - [ ] intro\n\tmore under it\n- [ ] new\n\n***\n'), out);
  assert.ok(out.includes('## To do\n\n- [ ] Two\n\nA paragraph between\n\n- [x] Three\n\n```\n# not a column\n\n- [ ] not a card\n```\n\n# An H1 note\n### A sub heading\n'), out);
  assert.ok(ops.setDone(parseBoard(text), { column: 'C#', text: 'sharp', done: true }));
  // (only a file with kanban-plugin at its top is a board)
  assert.ok(isBoardText(text) && isBoardText('\ufeff---\r\nkanban-plugin: board\r\n---\r\n'));
  assert.ok(!isBoardText('# Board meeting\n\n- [ ] item\n') && !isBoardText('---\ntitle: x\n---\n## A\n'));
  // (a note renamed: the cards that link to it follow)
  assert.equal(relinkCard('x (from [[2026-11-05 Lab meeting]])', '2026-11-05 Lab meeting', '2026-11-05 Lab meeting with Priya'), 'x (from [[2026-11-05 Lab meeting with Priya]])');
  assert.equal(relinkCard('[[2026-11-05 lab meeting|the meeting]]', '2026-11-05 Lab meeting', 'New'), '[[New|the meeting]]');
  assert.equal(relinkCard('[[2026-11-05 Lab meeting 2]]', '2026-11-05 Lab meeting', 'New'), null);
});

test('cards are notes, list items, or plain', () => {
  assert.deepEqual(cardKind('[[2026-11-06 Lab meeting]]'), { kind: 'note', ref: '2026-11-06 Lab meeting' });
  assert.deepEqual(cardKind('send figures (from [[2026-11-06 Lab meeting]])'), { kind: 'item', text: 'send figures', ref: '2026-11-06 Lab meeting' });
  assert.deepEqual(cardKind('Book the room'), { kind: 'plain', text: 'Book the room' });
  assert.equal(itemCard('send figures', 'x'), 'send figures (from [[x]])');
  assert.equal(noteCard('x'), '[[x]]');
  assert.equal(noteRef('Meetings/2026-11-06 Lab meeting.md'), '2026-11-06 Lab meeting');
});

test('changes to a board find their cards by text, and can be made again on a newer version', () => {
  const b = parseBoard(NEW_BOARD());
  assert.ok(ops.addCard(b, { column: 'To do', text: 'A' }));
  assert.ok(ops.addCard(b, { column: 'To do', text: 'B' }));
  assert.ok(ops.addCard(b, { column: 'To do', text: 'C', index: 0 }));
  assert.deepEqual(b.columns[0].cards.map((c) => c.text), ['C', 'A', 'B']);
  assert.ok(ops.moveCard(b, { from: 'To do', text: 'C', to: 'To do', index: 3 }));
  assert.deepEqual(b.columns[0].cards.map((c) => c.text), ['A', 'B', 'C']);
  assert.ok(ops.moveCard(b, { from: 'To do', text: 'A', to: 'Doing', index: 0 }));
  assert.deepEqual(b.columns[1].cards.map((c) => c.text), ['A']);
  assert.ok(ops.setDone(b, { column: 'Doing', text: 'A', done: true }));
  assert.ok(ops.editCard(b, { column: 'Doing', text: 'A', to: 'A2' }));
  assert.equal(ops.editCard(b, { column: 'Doing', text: 'nope', to: 'x' }), false);
  assert.ok(ops.renameColumn(b, { title: 'Doing', to: 'In progress' }));
  assert.equal(ops.renameColumn(b, { title: 'Done', to: 'To do' }), false);
  assert.ok(ops.moveColumn(b, { title: 'Done', by: -1 }));
  assert.deepEqual(b.columns.map((c) => c.title), ['To do', 'Done', 'In progress']);
  assert.ok(ops.deleteCard(b, { column: 'To do', text: 'B' }));
  assert.ok(ops.deleteColumn(b, { title: 'Done' }));
  assert.equal(serializeBoard(b), '---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] C\n\n## In progress\n\n- [x] A2\n');
});

test('a note becomes cards: the title in the middle, headings, then paragraphs and bullets', () => {
  const text = '# Lab meeting\n\nIntro para\nsecond line\n\n## Notes\n\n- one\n  - one point one\n- two\n\nTO DO: send figures\n\n## Decisions\n\n- go with B\n\n```\ncode\n```';
  const blocks = noteBlocks(text);
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'para', 'heading', 'item', 'item', 'item', 'para', 'heading', 'item', 'code']);
  const C = compile(DEFAULT_LISTS, {});
  const t = noteTree(text, 'Lab meeting', C, '2026-11-06');
  const kids = (n) => n.children.map((c) => c.text);
  assert.deepEqual(kids(t.root), ['Intro para\nsecond line', 'Notes', 'Decisions']);
  assert.deepEqual(kids(t.root.children[2]), ['go with B', 'code']);
  const notes = t.root.children[1];
  assert.deepEqual(kids(notes), ['one', 'two', 'TO DO: send figures']);
  assert.deepEqual(kids(notes.children[0]), ['one point one']);
  assert.equal(notes.children[2].task.list, 'todo');
  assert.equal(t.root.children[2].children[0].task.list, 'decisions');
  assert.equal(t.links.length, t.nodes.length - 1);
  // (keys stay the same while the text does, and differ for the same text twice)
  const t2 = noteTree('- same\n- same', 'x');
  assert.deepEqual(t2.root.children.map((c) => c.key), ['b:same#1', 'b:same#2']);
});

test('a line on a list is a card of its own, even in the middle of a paragraph', async () => {
  const T = await import('../../js/tasks.js');
  const C = T.compile(T.DEFAULT_LISTS);
  const t = noteTree('Talked about the poster.\nTO DO: send the figures\nWAITING FOR: the abstract\nThen lunch.\nAnd coffee.\n', 'Chat', C, '2026-11-07');
  assert.deepEqual(t.root.children.map((c) => c.text), ['Talked about the poster.', 'TO DO: send the figures', 'WAITING FOR: the abstract', 'Then lunch.\nAnd coffee.']);
  assert.deepEqual(t.root.children.map((c) => c.line), [0, 1, 2, 3]);
  assert.deepEqual(t.root.children.map((c) => c.task && c.task.list), [undefined, 'todo', 'waiting', undefined]);
});

test('the first layout is a mind map out to both sides, with nothing overlapping', () => {
  const t = noteTree('## A\n- a1\n- a2\n## B\n- b1\n## C\n- c1\n- c2\n- c3\n## D', 'Root');
  const pos = treeLayout(t.root, () => ({ w: 100, h: 40 }));
  assert.equal(pos.size, t.nodes.length);
  const r = pos.get('root');
  assert.deepEqual(r, { x: -50, y: -20 });
  const xs = t.root.children.map((c) => pos.get(c.key).x);
  assert.ok(xs.some((x) => x > 0) && xs.some((x) => x < 0), 'branches on both sides');
  const boxes = Array.from(pos.values());
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + 100 && b.x < a.x + 100 && a.y < b.y + 40 && b.y < a.y + 40;
    assert.ok(!overlap, `cards ${i} and ${j} overlap`);
  }
});

test('lists become a tree: the lists around the middle, their items around them', () => {
  const item = (text, path) => ({ task: { text }, note: { path } });
  const r = itemsTree('Lists', [
    { key: 'todo', title: 'To do', color: 'yellow', items: [item('a', 'n.md'), item('a', 'n.md'), item('b', 'm.md')] },
    { key: 'ideas', title: 'Ideas', color: 'green', items: [] }
  ], { max: 2 });
  assert.deepEqual(r.root.children.map((c) => c.text), ['To do', 'Ideas']);
  const todo = r.root.children[0];
  assert.deepEqual(todo.children.map((c) => c.kind), ['item', 'item', 'more']);
  assert.equal(todo.children[2].text, 'and 1 more');
  // (the same text twice in a note: two cards, with keys of their own)
  assert.notEqual(todo.children[0].key, todo.children[1].key);
  assert.equal(r.links.length, r.nodes.length - 1);
  const pos = treeLayout(r.root, () => ({ w: 200, h: 40 }));
  assert.equal(pos.size, r.nodes.length);
});

test('an item moves to another list: its word changes, or the list’s word is put on it', async () => {
  const T = await import('../../js/tasks.js');
  const C = T.compile(T.DEFAULT_LISTS);
  const text = '# Meeting\n\nTO DO: book the room @friday\n- **Todo:** email Sam\n\n## To do\n- call Millie\n- [ ] buy milk\nDONE: old thing\n';
  const tasks = T.parse(text, C, '2026-11-07').tasks;
  const waiting = C.byId.get('waiting');
  const moved = tasks.map((t) => T.retagAt(text, t, waiting, C, '2026-11-07'));
  assert.deepEqual(moved.map((m) => m && m.raw), ['WAITING FOR: book the room @friday', '- **Waiting for:** email Sam', '- WAITING FOR: call Millie', '- [ ] WAITING FOR: buy milk', null]);
  // (each is on the other list afterwards)
  for (const m of moved.filter(Boolean)) assert.ok(T.parse(m.text, C, '2026-11-07').tasks.some((t) => t.line === m.line && t.list === 'waiting'));
  // (to a list whose word has no colon, and back again)
  const lists = T.DEFAULT_LISTS.concat([{ id: 'later', name: 'Later', triggers: ['LATER'], done: '', color: 'grey' }]);
  const C2 = T.compile(lists);
  const one = 'TO DO: tidy the lab\n';
  const r = T.retagAt(one, T.parse(one, C2).tasks[0], C2.byId.get('later'), C2);
  assert.equal(r.raw, 'LATER tidy the lab');
  const back = T.retagAt(r.text, T.parse(r.text, C2).tasks[0], C2.byId.get('todo'), C2);
  assert.equal(back.raw, 'TO DO: tidy the lab');
  // (a line that has changed since: nothing is changed)
  assert.equal(T.retagAt('something else\n', tasks[0], waiting, C, '2026-11-07'), null);
  // (a note under the item stays a note, not a new item)
  const sub = '## To do\n- book the room\n  - ask facilities first\n- order coffee\n';
  const st = T.parse(sub, C).tasks;
  assert.deepEqual(st.map((t) => t.text), ['book the room', 'order coffee']);
  const r2 = T.retagAt(sub, st[0], waiting, C);
  assert.equal(r2.text, '## To do\n- WAITING FOR: book the room\n  - ask facilities first\n- order coffee\n');
  assert.deepEqual(T.parse(r2.text, C).tasks.map((t) => t.list + ':' + t.text), ['waiting:book the room', 'todo:order coffee']);
});

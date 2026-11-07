import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, parse, toggleInText, toggleLine, itemMeta, toggleWordOnLine, newItemLine, DEFAULT_LISTS } from '../../js/tasks.js';

const C = compile(DEFAULT_LISTS, {});
const P = (t, base = '2026-11-04') => parse(t, C, base).tasks;
const one = (t, base) => {
  const ts = P(t, base);
  assert.equal(ts.length, 1, `expected one item in ${JSON.stringify(t)}, got ${JSON.stringify(ts.map((x) => x.text))}`);
  return ts[0];
};

test('a word anywhere in a line makes the rest of the line an item', () => {
  const t = one('Discussed the budget. TO DO: send figures to Sarah');
  assert.equal(t.list, 'todo');
  assert.equal(t.text, 'send figures to Sarah');
  assert.equal(t.done, false);
  assert.equal(t.kind, 'inline');
  assert.equal(t.checkable, true);
});

test('the words are found whatever their capitals, and with hyphens or bold', () => {
  assert.equal(one('todo: buy milk').text, 'buy milk');
  assert.equal(one('To do: buy milk').text, 'buy milk');
  assert.equal(one('TO-DO: buy milk').text, 'buy milk');
  assert.equal(one('**TO DO:** call Ann').text, 'call Ann');
  assert.equal(one('**TO DO**: call Ann').text, 'call Ann');
  assert.equal(one('- ACTION: book the room').text, 'book the room');
  assert.equal(one('Things to do: buy milk').text, 'buy milk');
});

test('a word inside another word is not one of the words', () => {
  assert.equal(P('XTODO: y').length, 0);
  assert.equal(P('autodone: y').length, 0);
});

test('DONE: is a done item on the To do list', () => {
  const t = one('DONE: send figures');
  assert.equal(t.list, 'todo');
  assert.equal(t.done, true);
});

test('ticking off changes the word, keeping its capitals', () => {
  const text = 'a\nTO DO: x\nb';
  const t = one(text);
  const done = toggleInText(text, t, true, C);
  assert.equal(done, 'a\nDONE: x\nb');
  const back = toggleInText(done, one(done), false, C);
  assert.equal(back, 'a\nTO DO: x\nb');
  assert.equal(toggleInText('To do: x', one('To do: x'), true, C), 'Done: x');
  assert.equal(toggleInText('todo: x', one('todo: x'), true, C), 'done: x');
  assert.equal(toggleInText('Met Sam. FOLLOW UP: the grant', one('Met Sam. FOLLOW UP: the grant'), true, C), 'Met Sam. FOLLOWED UP: the grant');
});

test('Markdown checkboxes go on To do, and are ticked as checkboxes', () => {
  const t = one('- [ ] email John');
  assert.equal(t.list, 'todo');
  assert.equal(t.kind, 'checkbox');
  assert.equal(toggleInText('- [ ] email John', t, true, C), '- [x] email John');
  assert.equal(toggleInText('- [x] email John', one('- [x] email John'), false, C), '- [ ] email John');
  assert.equal(one('1. [ ] numbered').text, 'numbered');
  assert.equal(P('- [ ]').length, 0);
});

test('a checkbox with a word changes both', () => {
  const t = one('- [ ] TO DO: email');
  assert.equal(t.kind, 'inline');
  assert.equal(toggleInText('- [ ] TO DO: email', t, true, C), '- [x] DONE: email');
  assert.equal(one('- [x] TO DO: email').done, true);
});

test('bullets under a heading are items, until the next heading', () => {
  const text = '# Meeting\n## To do\n- a\n- b\n\nSome text\n- c\n## Other\n- d';
  assert.deepEqual(P(text).map((t) => t.text), ['a', 'b', 'c']);
  assert.ok(P(text).every((t) => t.kind === 'item' && t.list === 'todo'));
});

test('a heading is matched in the plural: "## Actions", "### Questions"', () => {
  assert.deepEqual(P('## Actions\n- a\n  - a detail\n- b').map((t) => t.text), ['a', 'b']);
  const q = P('### Questions\n- why?');
  assert.equal(q[0].list, 'questions');
});

test('bullets after a line that is just a word are items, until a gap', () => {
  assert.deepEqual(P('TO DO:\n- a\n- b\n\n- c').map((t) => t.text), ['a', 'b']);
  assert.deepEqual(P('TO DO:\n\n- a').map((t) => t.text), ['a']);
  assert.deepEqual(P('**Decisions:**\n- go with B').map((t) => [t.text, t.list]), [['go with B', 'decisions']]);
});

test('an item under a heading is ticked off with a checkbox', () => {
  const text = '## To do\n- book the room';
  const t = P(text)[0];
  assert.equal(toggleInText(text, t, true, C), '## To do\n- [x] book the room');
  const again = '## To do\n- [x] book the room';
  assert.equal(P(again)[0].done, true);
  assert.equal(toggleInText(again, P(again)[0], false, C), '## To do\n- [ ] book the room');
});

test('lists without a done word are kept as records', () => {
  const idea = one('IDEA: a timer for each supervision');
  assert.equal(idea.list, 'ideas');
  assert.equal(idea.checkable, false);
  assert.equal(toggleInText('IDEA: x', idea, true, C), null);
  const d = P('## Decisions\n- option B')[0];
  assert.equal(d.list, 'decisions');
  assert.equal(d.checkable, false);
});

test('code is not read', () => {
  assert.equal(P('```\nTO DO: x\n```').length, 0);
  assert.equal(P('~~~js\n- [ ] x\n~~~\nTO DO: y').length, 1);
});

test('front matter is not read', () => {
  assert.equal(P('---\ntitle: TO DO: x\n---\nTO DO: y').length, 1);
});

test('the longer word wins: WAITING FOR: is not WAITING', () => {
  const t = one('WAITING FOR: the reply from Jo');
  assert.equal(t.list, 'waiting');
  assert.equal(t.text, 'the reply from Jo');
});

test('a word with nothing after it is not an item', () => {
  assert.equal(P('TO DO:').length, 0);
  assert.equal(P('Notes TO DO:').length, 0);
  assert.equal(parse('Notes TO DO:', C).labels.length, 1);
});

test('dates, people, tags and priority are read from an item', () => {
  const t = one('TO DO: email @Sarah about #budget by Friday !!', '2026-11-04');
  assert.equal(t.due, '2026-11-06');
  assert.deepEqual(t.people, ['Sarah']);
  assert.deepEqual(t.tags, ['budget']);
  assert.equal(t.priority, true);
  assert.equal(itemMeta('x @2026-11-20', '2026-11-04').due, '2026-11-20');
  assert.equal(itemMeta('x due 13/11', '2026-11-04').due, '2026-11-13');
  assert.equal(itemMeta('x due 3/1', '2026-11-04').due, '2027-01-03');
  assert.equal(itemMeta('x by 3rd Dec', '2026-11-04').due, '2026-12-03');
  assert.equal(itemMeta('x by tomorrow', '2026-11-06').due, '2026-11-07');
  assert.equal(itemMeta('x @fri', '2026-11-06').due, '2026-11-13');
  assert.equal(itemMeta('x by next week', '2026-11-04').due, '2026-11-09');
  assert.equal(itemMeta('x 📅 2026-12-01', '2026-11-04').due, '2026-12-01');
  assert.equal(itemMeta('reviewed by Sarah', '2026-11-04').due, null);
  assert.deepEqual(itemMeta('write to sam@example.com', '2026-11-04').people, []);
  assert.deepEqual(itemMeta('ask @Jo.', '2026-11-04').people, ['Jo']);
  assert.deepEqual(itemMeta('#1 issue', '2026-11-04').tags, []);
});

test('the options: capitals, and checkboxes', () => {
  const strict = compile(DEFAULT_LISTS, { caseSensitive: true });
  assert.equal(parse('todo: x', strict).tasks.length, 0);
  assert.equal(parse('TODO: x', strict).tasks.length, 1);
  const noBoxes = compile(DEFAULT_LISTS, { checkboxes: false });
  assert.equal(parse('- [ ] x', noBoxes).tasks.length, 0);
  assert.equal(parse('## To do\n- [ ] x', noBoxes).tasks.length, 1);
});

test('nothing is changed when the line has gone', () => {
  const t = one('TO DO: x');
  assert.equal(toggleInText('something else entirely', t, true, C), null);
  // (moved to another line: still found)
  assert.equal(toggleInText('new first line\nTO DO: x', t, true, C), 'new first line\nDONE: x');
});

test('the To do word can be put on a line and taken off', () => {
  assert.equal(toggleWordOnLine('- email John', C), '- TO DO: email John');
  assert.equal(toggleWordOnLine('- TO DO: email John', C), '- email John');
  assert.equal(toggleWordOnLine('email John', C), 'TO DO: email John');
  assert.equal(toggleWordOnLine('TO DO: email John', C), 'email John');
  assert.equal(newItemLine(DEFAULT_LISTS[0], 'book the room', '2026-11-13'), 'TO DO: book the room @2026-11-13');
});

test('a rule is not a list item', () => {
  assert.equal(P('## To do\n* * *\n- a').length, 1);
});

test('toggleLine on its own', () => {
  const t = one('Spoke to Sam. TO DO: book');
  assert.equal(toggleLine('Spoke to Sam. TO DO: book', t, true, C), 'Spoke to Sam. DONE: book');
});

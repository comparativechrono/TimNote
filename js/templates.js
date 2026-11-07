/* Templates: a note to start from. They are kept as files in the notes folder (Templates/Meeting notes.md), so they
   can be changed like any note and are the same on every computer. A template can begin with settings:
     ---
     folder: Meetings        the folder its notes go in
     title: Meeting          the title a new note starts with
     ---
   and its text can have {{title}}, {{date}} (2026-11-06), {{date:long}} (Friday 6 November 2026), {{date:short}}
   (Fri 6 Nov 2026), {{weekday}}, {{time}} and {{cursor}} (where the cursor starts). */
import { fmtLong, fmtShort, weekday, timeHM } from './dates.js';

export const BUILTIN = [
  {
    name: 'Meeting notes',
    folder: 'Meetings',
    title: 'Meeting',
    body: `# {{title}}

{{date:long}}

Present:
Apologies:

## Agenda

1.

## Notes

{{cursor}}

## Decisions

-

## Actions

- [ ]
`
  },
  {
    name: 'Daily note',
    folder: 'Daily',
    title: 'Daily note',
    body: `# {{date:long}}

## Plan

- [ ] {{cursor}}

## Notes



## End of the day

`
  },
  {
    name: 'Supervision',
    folder: 'Supervisions',
    title: 'Supervision',
    body: `# {{title}}

{{date:long}}

Students:
Topic:

## What we covered

{{cursor}}

## Follow up

-

## For next time

## Actions

- [ ]
`
  },
  {
    name: 'One to one',
    folder: 'Meetings',
    title: 'One to one with',
    body: `# {{title}}

{{date:long}}

## Their news

{{cursor}}

## My news

## Discussed

## Actions

- [ ]
`
  },
  {
    name: 'Phone call',
    folder: 'Calls',
    title: 'Call with',
    body: `# {{title}}

{{date:long}}, {{time}}
Number:

{{cursor}}

## Follow up

-
`
  },
  {
    name: 'Seminar or lecture',
    folder: 'Seminars',
    title: 'Seminar',
    body: `# {{title}}

{{date:long}}
Speaker:

## Main points

{{cursor}}

## Questions

-

## References

`
  },
  {
    name: 'Idea',
    folder: 'Ideas',
    title: 'Idea',
    body: `# {{title}}

{{cursor}}

## Why it matters

## First steps

- [ ]
`
  },
  {
    name: 'Week plan',
    folder: 'Daily',
    title: 'Week plan',
    body: `# Week of {{date:long}}

## Most important this week

1. {{cursor}}

## To do

- [ ]

## Waiting for

-

## Notes

`
  }
];

/** a template file's text → {folder, title, format, body} */
export function parseTemplate(text) {
  const out = { folder: '', title: '', format: '', body: String(text || '') };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(out.body);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      const v = kv[2].replace(/^["']|["']$/g, '');
      if (k === 'folder') out.folder = v;
      else if (k === 'title') out.title = v;
      else if (k === 'format') out.format = v.replace(/^\./, '').toLowerCase();
    }
    out.body = out.body.slice(m[0].length);
  }
  return out;
}
/** a built-in template as a file */
export function templateFile(t) {
  return `---\nfolder: ${t.folder || ''}\ntitle: ${t.title || ''}\n---\n${t.body}`;
}

/** the template's text for a new note. → {text, cursor (where the cursor goes)} */
export function fill(body, { title = '', date, time } = {}) {
  const vars = {
    title,
    date: date || '',
    'date:long': fmtLong(date),
    'date:short': fmtShort(date, true),
    weekday: weekday(date),
    time: time || timeHM()
  };
  let text = String(body || '').replace(/\{\{\s*([a-z:]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() === 'cursor' ? '\u0000' : k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
  let cursor = text.indexOf('\u0000');
  if (cursor >= 0) text = text.replace(/\u0000/g, '');
  else cursor = text.length;
  return { text, cursor };
}

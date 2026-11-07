# TimNote

**Notes and to-do lists, kept as plain text files in a folder you choose.** Every note is an ordinary `.md` or `.txt` file named with its date, such as `2026-11-06 Lab meeting.md`, so any file manager can find it and search inside it. Write `TO DO:` in any note and the line goes on your To do list; tick it off there and the note itself says `DONE:`. Write `@Millie` and the note is tagged with Millie. Point it at a folder in Dropbox and every computer sees the same notes.

**Open it: [comparativechrono.github.io/TimNote](https://comparativechrono.github.io/TimNote/)** (in Chrome or Edge, on a computer).

It runs entirely in your browser. There is no server and no account: your notes go nowhere but your folder (and, if you use the AI, to the AI you choose).

---

## Contents

1. [Starting it](#starting-it)
2. [Notes are files](#notes-are-files)
3. [Lists](#lists)
4. [People and tags](#people-and-tags)
5. [Mind maps](#mind-maps)
6. [Boards](#boards)
7. [Writing](#writing)
8. [Templates](#templates)
9. [Dictation](#dictation)
10. [The AI](#the-ai)
11. [Finding things](#finding-things)
12. [Several computers, and Dropbox](#several-computers-and-dropbox)
13. [Settings](#settings)
14. [Keyboard shortcuts](#keyboard-shortcuts)
15. [Your data](#your-data)
16. [Files](#files)
17. [How it was tested](#how-it-was-tested)

---

## Starting it

1. **Make a folder for your notes in Dropbox**, such as *Dropbox/Notes*. (A folder just for notes: TimNote reads every `.md` and `.txt` file in the folder you give it, and its subfolders.)
2. **Open TimNote** in Chrome or Microsoft Edge and press **Choose your notes folder**. Choose that folder, and allow TimNote to see and save files in it.
3. **Do the same on each computer.** Each browser remembers the folder it was given. On a later visit it may ask for permission again with one click: choose **Allow on every visit** and it won't ask again.

**Install it as an app** (optional): in Chrome or Edge, the install button at the right of the address bar (or *⋮ → Cast, save and share → Install page as app*). TimNote then opens in its own window from the Start menu, Dock or taskbar, and works without the internet.

To try it before choosing a folder, press **Try it first**: the notes are kept in the browser's own storage. They aren't synced and can't be seen in a file manager, so choose a real folder (in Settings) when you start for real.

Safari and Firefox can't open a folder from a web page, so TimNote needs Chrome or Edge (on Windows, macOS, Linux or ChromeOS). On a phone, the Dropbox app shows the notes, since they are just text files.

## Notes are files

**Names.** A note's file is named with its date and its title: `2026-11-06 Lab meeting.md`. The date comes first so that the files sort by date in any file manager. Change the title at the top of a note and the file is renamed; click the date beside it to change the date. A new note with no title is named after its first line.

**Folders.** Notes from a template go in that template's folder (meeting notes in *Meetings*, daily notes in *Daily*), and **⋯ → Move to a folder** moves a note. Notes you've finished with can be archived (**⋯ → Archive**): they move to the *Archive* folder, are still searchable, and their items leave the lists.

**Markdown or plain text.** Markdown (`.md`, the usual) is plain text with a few conventions: `# Heading`, `**bold**`, `- bullet`, `- [ ] checkbox`. TimNote shows them as they are typed, and **Read** shows the note as a page. A `.txt` note is the same without the formatting. Both open in Notepad, TextEdit, Word, VS Code or Obsidian.

**Saving.** Notes save themselves a moment after you stop typing (the word *Saved* beside the file's name says so). What you type is also copied into the browser at once, so if the browser closes before it is saved, TimNote offers it back the next time.

**Pictures.** Paste a screenshot (or drag a picture) into a note and it is saved in the *attachments* folder, with a link to it in the note.

**Links between notes.** Type `[[` and choose a note to link to it: `[[Lab meeting]]`. Ctrl+click the link (or click it in Read) to open that note.

## Lists

A line goes on a list when it has one of the list's words. The lists, and their words, at first:

| List | Words that put a line on it | Word for done |
| --- | --- | --- |
| To do | `TO DO:` `TODO:` `ACTION:` `REMINDER:` | `DONE:` |
| Follow up | `FOLLOW UP:` | `FOLLOWED UP:` |
| Waiting for | `WAITING FOR:` `WAITING ON:` | `RECEIVED:` |
| Questions | `QUESTION:` `ASK:` | `ANSWERED:` |
| Ideas | `IDEA:` | (none: a record) |
| Decisions | `DECISION:` `DECIDED:` | (none: a record) |

Capitals don't matter (`To do:` works too), and the words can be anywhere in a line: *"Spoke to Sam. TO DO: book the room"* puts *book the room* on To do. The lists, their words and their colours can all be changed in Settings, and you can add lists of your own.

**Three ways to put things on a list:**

1. **A word in a line**: `TO DO: send Sarah the figures`.
2. **A heading or a line that is just the word, with bullets under it**: every bullet under `## To do` (or `## Actions`, `## Decisions`, `## Questions`…) is on that list, until the next heading; so is every bullet after a line that is just `TO DO:`, until a gap.
3. **A checkbox**: `- [ ] book the room` goes on To do (this can be turned off).

**What's on a list is highlighted where you wrote it**, in the list's colour, with a flag in the margin beside the line. If it's highlighted, it's on a list.

**Ticking off.** Tick an item on its list's page, click its flag in the margin, press **Ctrl+Enter** on its line, or click the highlighted word in Read. The note itself changes: `TO DO:` becomes `DONE:` (keeping your capitals), and a checkbox gets its tick, `- [x]`. So the files say what's done, and searching your folder for `TO DO:` finds only what's still to do.

**Dates, people and tags.** Give an item a date with `@` and a day, `by` or `due`: `@friday`, `@2026-11-13`, `by Friday`, `due 13/11`, `by 3 Dec`. Days such as *Friday* count from the note's date, so *by Friday* in last Tuesday's meeting notes means last Friday. Typing `@` offers the next few days and puts in the date itself. Name who's doing it with `@Name`, and tag it with `#tag`; `!!` (or *URGENT*) marks it as important.

**All the lists, side by side.** TimNote opens on **All lists**: every list as a card showing what is on it, so you can see at a glance what is on each without opening it. Swipe (or scroll, or use the arrows) across them. The first card, **Coming up**, gathers everything due in the next week, and anything overdue, from all the lists. On a card you can tick things off, click one to open its note at that line, and type at the foot of the card to add to that list (it goes in today's daily note). **Drag an item onto another list's card** (or onto a list's name in the sidebar) to move it there: its word in the note changes, so `TO DO: book the room` becomes `WAITING FOR: book the room`; **Undo** puts it back. **Mind map** shows the same as a mind map (see below).

**A list's page** (click its name) groups its items by date due (overdue, today, tomorrow, later this week, later, no date), by note, by person or by tag, and shows done items too; **Mind map** shows it as a mind map, grouped the same way. Click an item to open its note at that line. **Add to To do…** at the top writes the item into today's daily note. **⋯** copies the list, saves it as a note, or puts the dated items in a calendar file (`.ics`) to add to Outlook, Google or Apple Calendar, where they can remind you.

## People and tags

**Write `@Millie` anywhere in a note and the note is tagged with Millie.** In Read, and on the lists, it shows as just *Millie*. For a name with a space, join it with an underscore: `@Millie_Smith` shows as *Millie Smith*. Days (`@friday`, `@tomorrow`) are dates, not people, and an email address isn't a mention. Typing `@` offers the people you've mentioned before.

**Tags** (in the sidebar) lists everyone you've mentioned, most recent first (or A to Z, or by how many notes), with how many notes mention them and how much is still to do, and the `#topics` below. **Choose someone to see what is still to do that mentions them, and every note that does, newest first, with the lines where they come up.** Click a name in Read (or Ctrl+click `@Millie` while writing) to go straight there. A `#topic` has a page like that too.

## Mind maps

**Any note can be seen as a mind map: press Map** at the top of the note (beside Write and Read). The title is in the middle; its headings branch out from it, and each paragraph, bullet and line is a card joined to the heading it is under (bullets under bullets, under their bullet). Items on a list keep their colour and their tick box. **The note isn't changed.**

- Drag cards to arrange them; Shift+click (or Shift+drag round them) to move several. Drag the background to move around; the mouse wheel or a pinch zooms; **F** (or the first button) fits it all in.
- Drag from the dot on a card's edge to another card to draw an arrow between them; click an arrow and press Delete to remove it.
- **Colour** colours the chosen cards. Delete takes a card off the map (not out of the note); **Show … taken off** brings them back. **Arrange again** puts everything back where it started.
- Double-click a card to open the note at that line. Tick a card's box to tick the line off in the note.
- **Export** saves it as a picture (PNG) or a drawing (SVG).

Where the cards are, their colours and the arrows are kept in `.timnote/maps/` in your notes folder, so the map is the same on every computer (and moves with the note if it is renamed). Change the note and the map follows: new lines are new cards.

**The lists** can be seen as a mind map too: **Mind map** on the All lists page (the lists round the middle, their items round them), or on a list's page.

## Boards

**A board (kanban) is something you turn on when you want one.** Press **+** beside *Boards* in the sidebar and give it a name. It starts with three columns, *To do*, *Doing* and *Done*, and is kept as a Markdown file in the *Boards* folder, so it is the same on every computer and can be read anywhere:

```
## To do

- [ ] Book the seminar room
- [ ] [[2026-11-06 Lab meeting]]
- [ ] send Sarah the figures (from [[2026-11-06 Lab meeting]])

## Doing

## Done
```

(This is the form the Kanban plugin for Obsidian uses, if you use Obsidian too.)

- **Drag things on.** **Add from lists** opens a tray beside the board with what is on your lists and your recent notes: drag one onto a column (or press its **+**). Or drag an item from any list, or a note from the sidebar, **onto the board's name in the sidebar**: it goes in the first column.
- **A card is an item, a note, or a line of your own.** Click an item's card to open its note at that line, or a note's card to open the note. Its tick box ticks the item off in its note. Type your own card with **Add a card** at the foot of a column; click it to change it.
- **Move cards** by dragging them between columns (or **⋯ → Move to**). **⋯** on a card also marks it done or takes it off the board (it stays in its note). **⋯** on a column renames, moves or deletes it, and **Add a column** adds one.
- **⋯** at the top renames or deletes the board, or opens its file to edit as text.

Every change is made to the board's file as it is at that moment, so a change made on another computer meanwhile is kept, and only the lines it is about change: anything else you write in the file (lines under a card, other headings, notes) stays as it is. A file is a board only if it starts with that `kanban-plugin:` line, wherever it is in your folder; boards aren't notes, so their lines don't go on your lists. (Other notes in a folder called *Boards* stay notes.) Rename a note and the cards that link to it follow it.

## Writing

The note is a page with a margin: headings are larger, bold is bold, and the Markdown marks are faded rather than hidden, so what you see is what is in the file. **Write** and **Read** (Ctrl+E) switch between editing and reading; double-click anywhere in Read to edit there. **Map** shows it as a mind map.

- **Ctrl+Enter** ticks off the line the cursor is on; **Alt+T** puts `TO DO:` on the line (or takes it off); **Alt+D** puts in today's date.
- Bullets and checkboxes continue when you press Enter; Enter on an empty one ends the list.
- **Ctrl+F** finds (and replaces) in the note.
- **⋯** pins a note to the top of the sidebar, copies it as formatted text (for an email or Word), emails it, prints it or saves it as a PDF, downloads its file, makes a copy, archives or deletes it.

## Templates

**New note** offers a blank note or one from a template: Meeting notes, Daily note, Supervision, One to one, Phone call, Seminar or lecture, Idea and Week plan. **Today** opens today's daily note (making it the first time). **Alt+N** chooses the folder and date too, for a note about another day.

The templates are notes in the *Templates* folder of your notes folder, so you can change them like any note (Settings → Templates → **Change it**) and they are the same on every computer. At the top of each, `folder:` is where its notes go and `title:` the title a new note starts with. In the text, `{{title}}`, `{{date}}` (2026-11-06), `{{date:long}}` (Friday 6 November 2026), `{{weekday}}` and `{{time}}` are filled in, and `{{cursor}}` is where you start typing. **New template** makes another; **Put back the built-in templates** restores any you deleted.

## Dictation

Press the microphone at the top of a note, or **F9**, and speak; press again to stop. Say *"full stop"*, *"comma"*, *"question mark"*, *"exclamation mark"*, *"semicolon"*, *"open bracket"*, *"close bracket"*, *"new paragraph"* and *"new bullet"* for punctuation, and **"action point"** or **"new to do"** to start a new `TO DO:` line. (*"Colon"* and *"period"* are left as words.) Sentences get their capital letters. Two ways of dictating, in Settings:

- **The browser's own** (the usual): the words appear as you speak. In Chrome and Edge the sound goes to Google's or Microsoft's speech service.
- **Gemini**: the sound is recorded and, when you stop, written out by Gemini: better with unusual words, but the text comes only when you stop, and it needs a Gemini key.

The AI's **Clean up dictation** then puts in what speech recognition missed.

## The AI

The AI is yours: your own **Google Gemini** or **Anthropic Claude** key, called straight from your browser (the same keys as in Hearn marking). Add one in Settings → The AI; **Test** checks it. Then press **AI** at the top of a note:

| This note | What you get |
| --- | --- |
| **Tidy up** | Spelling, grammar and layout put right, every detail kept |
| **Clean up dictation** | Punctuation and paragraphs; fillers and misheard words put right |
| **Summarise** | A few bullet points, at the top of the note |
| **Find actions** | The things to do that aren't on a list yet, written as `TO DO:` lines with who and when |
| **Write as minutes** | Formal minutes (Present, Apologies, items, decisions, actions), as a new note |
| **Draft an email** | What was discussed and decided and who does what, to copy into an email |
| Your own instruction | Whatever you ask: *"make this a table of who does what"* |

Select part of a note first to work on just that part. **Nothing goes into the note until you choose**: **Replace**, **Add it below**, **Add to the note**, or **Copy**; and Ctrl+Z undoes it. The AI is told to keep every fact, to use British spelling, and to keep the list words exactly, so tidied notes keep their lists.

**Ask your notes** answers a question from your notes (*"What did we decide about the practicals?"*, *"Who was I waiting to hear from?"*): the notes that best match the question are sent with it, and its answer links to the notes it used. **Review my week** writes a review of the last seven days' notes and what's still open, to save as a note.

**Keys** are kept, as you choose, in this browser (the usual), only until the tab closes, or in the notes folder (`.timnote/keys.json`) so that every computer has them; choose that only if the folder is yours alone. **What is sent** is only what you ask the AI to work on. On Gemini's free tier, Google may use what is sent to improve its products: for anything confidential (students, patients, colleagues), use a key from a Google Cloud project with billing on, or Claude (Anthropic doesn't train on what is sent through its API), and follow your institution's guidance. *About you, for the AI* (in Settings) is told to the AI with every request.

## Finding things

- **The sidebar** lists your notes newest first, by month, with pinned notes at the top; the number beside a note is how many of its items are still to do. **Filter notes** narrows the list as you type (titles and text).
- **Tags** finds every note that mentions someone (`@Millie`) or has a `#topic`.
- **Search** (Ctrl+Shift+F, or Enter in the filter) searches every note and shows the lines that match. Every word must be in the note; `"words in quotes"` must be together; `-word` leaves notes with that word out; `in:Meetings` looks in one folder.
- **Ctrl+K** finds a note by its title, or a command, by typing a few letters.
- **The calendar** shows each day's notes and what's due that day; choose a day to make a note on it or open its daily note.
- **Your file manager** works too: search the folder for `TO DO:`, a name or a phrase, in Windows Explorer, Finder or Dropbox.

## Several computers, and Dropbox

Each computer reads and writes the same files, and Dropbox carries the changes between them. TimNote looks through the folder again whenever you come back to it, and every minute and a half, so notes written elsewhere appear; an open note that changed elsewhere shows the new version.

**Edited in two places at once?** TimNote never saves over a file that has changed since it was opened. It stops and asks: **Keep mine**, **Use the other version**, **Keep both** (yours is saved beside it as *… (my version …)*), or **Compare** them side by side. If Dropbox itself made a *conflicted copy*, the sidebar says so, so that you can open both and keep what you need.

**Make the folder available offline** in Dropbox (right-click → *Make available offline*), so that the files are really on each computer: online-only files can't be read until Dropbox downloads them.

TimNote keeps its own settings (the lists, pinned notes, the AI's model and *About you*) in `.timnote/settings.json` inside the notes folder, and the mind maps' layouts in `.timnote/maps/`, so they are the same on every computer; boards are files in the *Boards* folder. How it looks, dictation, what it opens on, and (usually) the AI keys are kept in each browser.

## Settings

| Section | What it sets |
| --- | --- |
| Your notes folder | Which folder; choose another, or look through it again |
| New notes | Markdown or plain text; the folder for blank notes |
| Lists | The lists, their words, done words and colours; whether checkboxes go on To do; whether capitals must match |
| Templates | Change them, make new ones, put back the built-in ones |
| How it looks | Light or dark; the typeface for notes (Literata, a sans serif, or typewriter); the text size; the width of the page; whether it opens on all the lists or the last note |
| Dictation | The browser's own or Gemini; the language; spoken punctuation |
| The AI | Gemini or Claude; the model (and fall-backs, or Claude's effort); your keys and where they are kept; *About you* |
| Keyboard | The shortcuts |

## Keyboard shortcuts

On a Mac, ⌘ for Ctrl and ⌥ for Alt.

| Keys | |
| --- | --- |
| Ctrl+K | Find a note, or a command |
| Ctrl+Shift+F | Search all the notes |
| Alt+N | New note (choosing the template, folder and date) |
| Alt+L | All the lists |
| Alt+C | The calendar |
| Ctrl+E | Write or read the note |
| Ctrl+S | Save now (it saves as you type anyway) |
| F9 | Start or stop dictation |
| Ctrl+Enter | Tick off the line the cursor is on |
| Alt+T | Put the To do word on the line (or take it off) |
| Alt+D | Today's date |
| Ctrl+B, Ctrl+I | Bold, italic |
| Ctrl+F | Find in the note |
| Ctrl+click | Open a link, a `[[note]]`, or the page of an `@person` or `#topic` |
| `@` `#` `[[` | Offer dates and people, tags, and notes to link to |
| F, +, − (on a mind map) | Fit it all in, zoom in, zoom out |
| Delete (on a mind map) | Take the chosen cards off the map, or remove the chosen arrow |

## Your data

Your notes are the files in your folder, and nothing else: TimNote keeps no copy anywhere except, briefly, typing that hasn't been saved yet (in the browser, deleted once it is saved). It needs the internet only to load (once installed, not even then), for the browser's dictation, and for the AI. Deleted notes go from the folder; Dropbox keeps deleted files for a while (30 days or more) if you need one back, and keeps earlier versions of every file.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The app |
| `js/` | Its code: `app.js` (pages and starting), `fsx.js` (the folder), `library.js` (the notes, their lists, people and boards), `tasks.js` (finding, ticking off and moving list items), `people.js` (`@mentions`), `boards.js` (board files), `mapdata.js` and `canvas.js` (mind maps), `drag.js`, `inline.js`, `editor.js`, `render.js` (reading), `search.js`, `templates.js`, `dictation.js`, `ai.js`, `settings.js`, and `views/` (the sidebar and each page) |
| `css/` | Its look |
| `vendor/`, `assets/fonts/` | The libraries it uses (CodeMirror, marked, DOMPurify, Lucide icons) and the Literata typeface, with their licences |
| `sw.js`, `manifest.webmanifest`, `icons/` | For working offline and installing as an app |
| `build/` | Scripts that make `vendor/`, `sw.js` and the icons |
| `test/` | The tests |

## How it was tested

`test/unit/` tests the reading of list items (the words anywhere in a line, headings and bullets, checkboxes, capitals, code left alone, dates such as *by Friday* counted from the note's date, people and tags), ticking them off and moving them to another list in the text, `@mentions`, reading and writing board files (and each change to a board, made again on a newer version of the file), and turning a note into a mind map and laying it out without overlaps. `test/e2e-boards.mjs` runs `@people` and the Tags page, notes and lists as mind maps (dragging a card, its layout kept, ticking a card, renaming the note), the lists as cards (ticking, adding, dragging an item to another list and Undo), and boards (dragging items and notes on from the tray and the sidebar, typing and moving cards, a board changed on another computer, renaming and deleting). `test/e2e.mjs` and `test/e2e-features.mjs` run TimNote in Chrome (with the browser's private storage standing in for a folder) through making notes from templates, typing, saving, renaming through the title, ticking off on the To do list and seeing the file change, adding from a list, reading view, search, the calendar, Ctrl+K, a note changed on another computer, a note changed in two places at once, plain-text notes, pasted pictures, `@` dates and `[[` links, templates, pinning, archiving and deleting, unsaved typing offered back after a crash, a narrow window, and the AI against stand-ins for Gemini and Claude that check what is sent.

The AI was tested only against those stand-ins, so the first time, press **Test** in Settings → The AI. If a service retires a model, choose another there.

To run the tests: `npm install`, then `npm test` and `npm run test:e2e` (they need Chrome; set `CHROME=` to its path if it isn't at `/usr/bin/google-chrome`). To try it on your own computer: `node test/serve.mjs`, then open `http://localhost:8765`. After changing any file, `npm run build:sw` updates the list of files kept for working offline.

## Credits and licences

TimNote uses [CodeMirror](https://codemirror.net/) for the editor, [marked](https://marked.js.org/) and [DOMPurify](https://github.com/cure53/DOMPurify) for the reading view, [Lucide](https://lucide.dev/) icons, and the [Literata](https://github.com/googlefonts/literata) typeface (SIL Open Font License). Their licences are in [vendor/LICENSES.md](vendor/LICENSES.md) and [assets/fonts/OFL.txt](assets/fonts/OFL.txt).

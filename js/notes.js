/* Notes as files: the name of a note's file is its date and its title ("2026-11-06 Lab meeting.md"),
   so that the files sort by date in any file manager. */
import { dateFromName } from './dates.js';

export const NOTE_RE = /\.(md|markdown|txt)$/i;
export const isNoteFile = (name) => NOTE_RE.test(name) && !name.startsWith('.') && !name.startsWith('~$');
export const extOf = (name) => {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
};
export const isMarkdown = (path) => /\.(md|markdown)$/i.test(path);

/** 'Meetings/2026-11-06 Lab meeting.md' → {dir: 'Meetings', name: '2026-11-06 Lab meeting.md'} */
export function splitPath(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}
export const joinPath = (dir, name) => (dir ? dir.replace(/\/+$/, '') + '/' + name : name);

/** a note's file name → {date (YYYY-MM-DD or null), title, ext} */
export function parseName(name) {
  const ext = extOf(name);
  const base = name.slice(0, name.length - (ext ? ext.length + 1 : 0));
  const d = dateFromName(base);
  if (d) return { date: d.date, title: d.rest.trim() || '', ext };
  return { date: null, title: base.trim(), ext };
}

/** what may be in a file name on Windows, macOS and Linux (and so in Dropbox) */
export function cleanTitle(t) {
  let s = String(t || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '');
  if (s.length > 120) s = s.slice(0, 120).replace(/[.\s]+$/, '');
  return s;
}
export const fileName = (date, title, ext = 'md') => `${date ? date + ' ' : ''}${cleanTitle(title) || 'Untitled'}.${ext || 'md'}`;

/** a folder name, made safe; '' for the top folder */
export function cleanFolder(f) {
  return String(f || '')
    .split(/[\\/]+/)
    .map((p) => cleanTitle(p))
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

/** a name not yet taken in a folder: "Name.md", "Name (2).md", … (taken: Set of lower-case paths) */
export function freeName(dir, name, taken) {
  const ext = extOf(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  let n = 1, cand = name;
  while (taken.has(joinPath(dir, cand).toLowerCase())) {
    n++;
    cand = `${base} (${n})${ext ? '.' + ext : ''}`;
  }
  return joinPath(dir, cand);
}

/** the path of `target` from the folder `fromDir`, for links between files ('../attachments/x.png') */
export function relPath(fromDir, target) {
  const a = fromDir ? fromDir.split('/') : [];
  const b = target.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}
/** a link's path from a note's folder → the path from the top folder (or null if it leaves the folder) */
export function resolvePath(fromDir, href) {
  const parts = fromDir ? fromDir.split('/') : [];
  for (const p of decodeURIComponent(href).split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
}

/** a file's bytes → its text, if it is UTF-8 (a byte-order mark kept, for decodeText to see). Anything else (an
    "ANSI" file from Windows Notepad, say) is read as Windows-1252 to show, with utf8: false, so that it is never
    written back, which would damage its accented letters and symbols. */
export function decodeBytes(buf) {
  try {
    return { raw: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf), utf8: true };
  } catch (e) {
    return { raw: new TextDecoder('windows-1252').decode(buf), utf8: false };
  }
}

/** text as it is kept in the editor (lines split by \n), and how to put it back as the file had it */
export function decodeText(raw) {
  let text = String(raw);
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  if (eol === '\r\n') text = text.replace(/\r\n/g, '\n');
  return { text, eol, bom };
}
export function encodeText(text, eol = '\n', bom = false) {
  let t = String(text);
  if (eol === '\r\n') t = t.replace(/\r?\n/g, '\r\n');
  return (bom ? '﻿' : '') + t;
}

/** Dropbox's copies of a file that was changed in two places at once */
export const isConflictCopy = (name) => /\((?:[^()]*'s )?conflicted copy[^()]*\)/i.test(name) || /\(conflict \d{4}-\d{2}-\d{2}[^()]*\)/i.test(name);

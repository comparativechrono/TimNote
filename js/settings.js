/* Settings. Two kinds:
     shared   kept in the notes folder (.timnote/settings.json), so every computer that opens the folder has them:
              the lists and their words, templates' folders, pinned notes, the AI's model and what it is told
     device   kept in this browser: how it looks, dictation, and the AI keys (unless you choose to keep the keys
              in the folder) */
import { DEFAULT_LISTS, compile } from './tasks.js';
import { emit } from './bus.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export const SHARED_DEFAULTS = {
  version: 1,
  lists: DEFAULT_LISTS,
  checkboxes: true,
  caseSensitive: false,
  format: 'md',
  folder: '',
  dailyFolder: 'Daily',
  templatesFolder: 'Templates',
  archiveFolder: 'Archive',
  attachmentsFolder: 'attachments',
  boardsFolder: 'Boards',
  pinned: [],
  ai: {
    provider: 'gemini',
    geminiModel: 'gemini-3.8-flash',
    geminiFallbacks: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    anthropicModel: 'claude-sonnet-5-5',
    effort: 'low',
    aboutMe: ''
  }
};

export const DEVICE_DEFAULTS = {
  theme: 'auto',
  font: 'serif',
  size: 17,
  width: 'normal',
  sidebar: true,
  showArchive: false,
  lastPath: '',
  home: 'lists', // what TimNote opens on: 'lists' (the lists, side by side) or 'last' (the last note)
  overview: 'tiles', // the lists page: 'tiles' or 'map'
  boardTray: true, // a board's tray of list items and notes to drag on
  tagSort: 'recent',
  listGroup: {},
  listMode: {}, // a list's page: 'list' or 'map', by list
  listShowDone: {},
  dictation: { engine: 'browser', lang: 'en-GB', spoken: true },
  keysIn: 'computer'
};

const DKEY = 'timnote:device';
function merge(base, over) {
  const out = clone(base);
  if (!over || typeof over !== 'object') return out;
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export const device = (() => {
  try {
    return merge(DEVICE_DEFAULTS, JSON.parse(localStorage.getItem(DKEY) || '{}'));
  } catch (e) {
    return clone(DEVICE_DEFAULTS);
  }
})();
export function saveDevice() {
  try {
    localStorage.setItem(DKEY, JSON.stringify(device));
  } catch (e) {
    /* storage blocked: it lasts for this visit */
  }
  emit('settings', { scope: 'device' });
}

export let shared = clone(SHARED_DEFAULTS);
let compiled = null;
/** the shared settings as read from the folder */
export function loadShared(obj) {
  shared = merge(SHARED_DEFAULTS, obj || {});
  if (!Array.isArray(shared.lists) || !shared.lists.length) shared.lists = clone(DEFAULT_LISTS);
  if (!Array.isArray(shared.pinned)) shared.pinned = [];
  compiled = null;
  emit('settings', { scope: 'shared' });
}
/** what the lists' parser uses (made again when the lists change) */
export function lists() {
  if (!compiled) compiled = compile(shared.lists, { caseSensitive: shared.caseSensitive, checkboxes: shared.checkboxes });
  return compiled;
}
export function sharedChanged() {
  compiled = null;
  emit('settings', { scope: 'shared', save: true });
}
export const listById = (id) => shared.lists.find((l) => l.id === id) || null;

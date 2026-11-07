/* =====================================================================
   Dictation: speak, and the words go in where the cursor is.
     browser  the browser's own speech recognition (Chrome, Edge). Words
              appear as they are spoken; the sound goes to Google's or
              Microsoft's speech service.
     gemini   the sound is recorded here and, when you stop, sent to
              Gemini (with your key) to be written out: better with
              unusual words, and it works in any browser that can record.
   Spoken punctuation: "full stop", "comma", "question mark", "exclamation
   mark", "semicolon", "open bracket", "close bracket", "new paragraph",
   "new bullet" — and "action point" or "new to do", which start a new
   line with the To do list's word. "Colon", "period" and "new line" are
   left as words (the colon is an organ; "a new line of evidence").
   F9 starts and stops it.
   ===================================================================== */
import { h, icon, toast } from './util.js';
import * as S from './settings.js';
import { parseTrigger } from './tasks.js';
import { transcribe, hasKey } from './ai.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = () => ({ browser: !!SR, gemini: !!(navigator.mediaDevices && window.MediaRecorder) });

let cur = null; // {target, engine, rec | recorder, stopping}
let bar = null;
const listeners = new Set();
export const onState = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const tell = () => listeners.forEach((fn) => fn(!!cur));
export const active = () => !!cur;

function spoken() {
  const main = S.lists().main;
  const w = main ? parseTrigger(main.triggers[0]) : { label: 'TO DO', colon: true };
  const word = w.label + (w.colon ? ':' : '');
  // (spaces before a spoken mark go, but not line breaks that an earlier one made)
  return [
    [/[ \t]*\bnew paragraph\b[ \t,.]*/gi, '\n\n'],
    [/[ \t]*\b(?:new|next) bullet(?: point)?\b[ \t,.]*/gi, '\n- '],
    [/[ \t]*\b(?:action point|new to-?do|new action)\b[ \t,.:]*/gi, '\n' + word + ' '],
    [/[ \t]*\bfull stop\b/gi, '.'],
    [/[ \t]*\bcomma\b/gi, ','],
    [/[ \t]*\bquestion mark\b/gi, '?'],
    [/[ \t]*\bexclamation mark\b/gi, '!'],
    [/[ \t]*\bsemicolon\b/gi, ';'],
    [/\bopen bracket[ \t]*/gi, '('],
    [/[ \t]*\bclose bracket\b/gi, ')']
  ];
}
/** dictated words → the text to put in after `before` (what is there before the cursor) */
export function shape(words, before) {
  let t = String(words || '');
  if (S.device.dictation.spoken !== false) for (const [re, s] of spoken()) t = t.replace(re, s);
  t = t.replace(/[ \t]+([.,;!?)])/g, '$1').replace(/\( +/g, '(').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  const atStart = !before.trim() || /[.!?]\s*$/.test(before) || /\n\s*(?:[-*+] |\d+[.)] )?(?:\[[ x]\] )?$/.test(before) || /:\s*$/.test(before);
  t = t.replace(/^(\s*)(\p{Ll})/u, (m, s, c) => (atStart ? s + c.toUpperCase() : m));
  t = t.replace(/([.!?]\s+|\n\s*(?:- |[A-Z ]+: )?)(\p{Ll})/gu, (m, s, c) => s + c.toUpperCase());
  if (before && !/[\s(]$/.test(before) && !/^[\s.,;:!?)]/.test(t)) t = ' ' + t;
  return t;
}

/* ---------------- where the words go ---------------- */
// target: {insert(text), before() → text before the cursor, isConnected() } — the editor, or a box
export function boxTarget(el) {
  return {
    insert(text) {
      const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
      el.setRangeText(text, s, e, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    before: () => el.value.slice(0, el.selectionStart ?? el.value.length),
    isConnected: () => el.isConnected,
    focus: () => el.focus()
  };
}
function put(words) {
  if (!cur || !words) return;
  const t = cur.target;
  if (!t.isConnected()) {
    navigator.clipboard.writeText(words).catch(() => {});
    toast('The note you were dictating into has closed, so what you said is on the clipboard.', 'warn', 9000);
    return;
  }
  t.insert(shape(words, t.before()));
}

/* ---------------- the bar at the foot of the screen ---------------- */
function showBar(state, text) {
  if (!bar) {
    bar = h('div.dictbar', { role: 'status', 'aria-live': 'polite' });
    document.body.append(bar);
  }
  bar.replaceChildren(
    h('span.dot' + (state === 'busy' ? '.busy' : '')),
    h('span.st', state === 'listen' ? 'Listening' : state === 'rec' ? 'Recording' : 'Writing it out with Gemini…'),
    h('span.it', text || ''),
    state !== 'busy' ? h('button.btn.small', { type: 'button', onclick: () => stop() }, 'Stop (F9)') : null
  );
  bar.hidden = false;
}
function hideBar() {
  if (bar) bar.hidden = true;
}
function end(sess) {
  if (cur === sess) {
    cur = null;
    hideBar();
    tell();
  }
}

/* ---------------- the browser's speech recognition ---------------- */
function startBrowser(sess) {
  if (!SR) {
    toast('This browser has no speech recognition. Use Chrome or Edge, or choose Gemini for dictation in Settings.', 'warn', 7000);
    return end(sess);
  }
  const rec = new SR();
  rec.lang = S.device.dictation.lang || 'en-GB';
  rec.continuous = true;
  rec.interimResults = true;
  sess.rec = rec;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) put(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    if (cur === sess) showBar('listen', interim);
  };
  rec.onerror = (e) => {
    const why = {
      'not-allowed': 'The browser wasn’t allowed to use the microphone. Allow it (the icon in the address bar) and try again.',
      'service-not-allowed': 'Speech recognition isn’t allowed here. Try Chrome or Edge, or choose Gemini for dictation in Settings.',
      network: 'Speech recognition needs the internet (the browser sends the sound to its speech service).',
      'audio-capture': 'No microphone was found.',
      'language-not-supported': 'The browser can’t recognise this language. Change it in Settings.'
    }[e.error];
    if (why) {
      toast(why, 'warn', 8000);
      sess.stopping = true;
    }
  };
  rec.onend = () => {
    if (!sess.stopping) {
      try {
        rec.start(); // (Chrome stops after a pause: start again until told to stop)
        return;
      } catch (e) {
        /* (it may not start again) */
      }
    }
    end(sess);
  };
  try {
    rec.start();
  } catch (e) {
    toast('Dictation couldn’t start: ' + e.message, 'warn');
    return end(sess);
  }
  showBar('listen', '');
}

/* ---------------- recording, for Gemini ---------------- */
async function startGemini(sess) {
  if (!hasKey('gemini')) {
    toast('Dictation with Gemini needs a Gemini API key: add one in Settings, or choose the browser’s dictation.', 'warn', 8000);
    return end(sess);
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('The microphone couldn’t be used: ' + (e.message || e.name), 'warn', 7000);
    return end(sess);
  }
  if (sess.stopping) {
    stream.getTracks().forEach((t) => t.stop());
    return end(sess);
  }
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const type = types.find((t) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  sess.recorder = recorder;
  const chunks = [];
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    if (cur === sess) showBar('rec', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    if (s >= 600) stopSession(sess); // (ten minutes at most: a longer recording is too big to send)
  }, 500);
  recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    const mime = (recorder.mimeType || type || 'audio/webm').split(';')[0];
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) return end(sess);
    showBar('busy', '');
    try {
      const text = await transcribe(blob, mime);
      put(text);
    } catch (e) {
      toast('Gemini couldn’t write it out: ' + e.message, 'warn', 9000);
    }
    end(sess);
  };
  recorder.start(1000);
  showBar('rec', '0:00');
}

function stopSession(sess) {
  if (!sess) return;
  sess.stopping = true;
  if (sess.rec) {
    try {
      sess.rec.stop();
    } catch (e) {
      end(sess);
    }
  } else if (sess.recorder && sess.recorder.state !== 'inactive') sess.recorder.stop();
  else if (!sess.recorder) {
    /* (still asking for the microphone: it stops when it gets it) */
  }
}
export function stop() {
  stopSession(cur);
}
/** start dictating into target (or stop, if already dictating) */
export function toggle(target) {
  if (cur) return stop();
  if (!target) return;
  const sess = { target, stopping: false };
  cur = sess;
  tell();
  if (S.device.dictation.engine === 'gemini') startGemini(sess);
  else startBrowser(sess);
}
export const micIcon = () => icon('mic');

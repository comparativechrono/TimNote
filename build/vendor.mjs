/* Builds vendor/: the libraries TimNote uses, as files the browser loads directly.
   Run with `npm install` then `npm run build:vendor`. Only needed when a library is upgraded:
   the built files are committed, so GitHub Pages serves them as they are. */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, p);
mkdirSync(out('vendor'), { recursive: true });
mkdirSync(out('assets/fonts'), { recursive: true });

const common = { bundle: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning' };

/* ---- CodeMirror 6: one module with everything the editor uses ---- */
await build({
  ...common,
  stdin: {
    contents: [
      // (only what js/editor.js uses: add a name here if the editor needs more)
      "export { EditorState, Compartment, StateField, StateEffect, EditorSelection, Prec, Annotation } from '@codemirror/state';",
      "export { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder, drawSelection, dropCursor, highlightSpecialChars, gutter, GutterMarker } from '@codemirror/view';",
      "export { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';",
      "export { syntaxHighlighting, HighlightStyle } from '@codemirror/language';",
      "export { search, searchKeymap } from '@codemirror/search';",
      "export { autocompletion, completionKeymap } from '@codemirror/autocomplete';",
      "export { markdown, markdownLanguage } from '@codemirror/lang-markdown';",
      "export { tags } from '@lezer/highlight';"
    ].join('\n'),
    resolveDir: root,
    loader: 'js'
  },
  outfile: out('vendor/codemirror.js')
});

/* ---- marked (Markdown → HTML) and DOMPurify (makes that HTML safe) ---- */
await build({ ...common, stdin: { contents: "export { marked, Marked } from 'marked';", resolveDir: root, loader: 'js' }, outfile: out('vendor/marked.js') });
await build({ ...common, stdin: { contents: "import DOMPurify from 'dompurify'; export default DOMPurify;", resolveDir: root, loader: 'js' }, outfile: out('vendor/purify.js') });

/* ---- icons (Lucide): the inner SVG of each icon used ---- */
const ICONS = (
  'plus search calendar calendar-days calendar-plus settings mic sparkles ellipsis pin pin-off archive archive-restore trash-2 folder folder-open ' +
  'folder-input file-text file-plus check x chevron-left chevron-right chevron-down list-checks lightbulb circle-help message-circle-question ' +
  'scale sun moon monitor menu book-open pencil copy download printer mail refresh-cw external-link triangle-alert user hash ' +
  'corner-down-left send square square-check circle-check clock history house keyboard cloud hard-drive link image wand-sparkles ' +
  'list info highlighter eye key-round save files inbox reply hourglass star notebook-pen bell arrow-left type text-quote columns-2 messages-square'
).split(/\s+/);
const icons = {};
for (const name of ICONS) {
  const svg = readFileSync(nm(`lucide-static/icons/${name}.svg`), 'utf8');
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
  icons[name] = inner;
}
writeFileSync(
  out('vendor/icons.js'),
  '/* Lucide icons (ISC licence, https://lucide.dev): the inner SVG of each icon TimNote uses. Made by build/vendor.mjs. */\n' +
    'export const ICONS = ' + JSON.stringify(icons, null, 0).replace(/","/g, '",\n"') + ';\n'
);

/* ---- the note typeface: Literata (SIL Open Font License), variable weight, roman and italic ---- */
const subsets = [
  ['latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  ['greek', 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF']
];
rmSync(out('assets/fonts'), { recursive: true, force: true });
mkdirSync(out('assets/fonts'), { recursive: true });
let css = '/* Literata (SIL Open Font License 1.1, see assets/fonts/OFL.txt). Made by build/vendor.mjs. */\n';
for (const style of ['normal', 'italic']) {
  for (const [subset, range] of subsets) {
    const file = `literata-${subset}-wght-${style}.woff2`;
    copyFileSync(nm(`@fontsource-variable/literata/files/${file}`), out(`assets/fonts/${file}`));
    css += `@font-face{font-family:'TN Literata';font-style:${style};font-display:swap;font-weight:200 900;src:url(../assets/fonts/${file}) format('woff2');unicode-range:${range}}\n`;
  }
}
copyFileSync(nm('@fontsource-variable/literata/LICENSE'), out('assets/fonts/OFL.txt'));
writeFileSync(out('css/fonts.css'), css);

/* ---- the licences of everything in vendor/ ---- */
const lic = (pkg, file = 'LICENSE') => {
  for (const f of [file, 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENSE-MIT']) {
    try {
      return readFileSync(nm(`${pkg}/${f}`), 'utf8').trim();
    } catch (e) {
      /* try the next name */
    }
  }
  return '(licence file not found)';
};
const version = (pkg) => JSON.parse(readFileSync(nm(`${pkg}/package.json`), 'utf8')).version;
const pkgs = ['@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@codemirror/lang-markdown', '@codemirror/search', '@codemirror/autocomplete', '@lezer/common', '@lezer/highlight', '@lezer/lr', '@lezer/markdown', 'style-mod', 'w3c-keyname', 'crelt', '@marijn/find-cluster-break', 'marked', 'dompurify', 'lucide-static'];
let notices = '# Third-party software in TimNote\n\nThe files in `vendor/` are built from these packages by `build/vendor.mjs`. The note typeface, Literata, is in `assets/fonts/` with its licence (SIL Open Font License 1.1).\n';
for (const p of pkgs) {
  try {
    notices += `\n## ${p} ${version(p)}\n\n\`\`\`\n${lic(p)}\n\`\`\`\n`;
  } catch (e) {
    /* (a package that isn't installed is not in the bundle) */
  }
}
writeFileSync(out('vendor/LICENSES.md'), notices);
console.log('vendor built');

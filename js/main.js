/* TimNote starts here. */
import { start } from './app.js';

start().catch((e) => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = '<div class="boot">TimNote couldn’t start: ' + String(e && e.message ? e.message : e).replace(/[<>&]/g, '') + '</div>';
});

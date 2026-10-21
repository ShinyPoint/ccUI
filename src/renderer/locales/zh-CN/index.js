// Simplified Chinese for the app's own words (lib/i18n.js), one file per part of the app. Keys are the English
// text exactly as written in the code; `plural:<word>` entries are the counted forms (plural() in lib/i18n.js).
import common from './common.js';
import chat from './chat.js';
import tools from './tools.js';
import app from './app.js';
import messages from './messages.js';

export default { ...common, ...chat, ...tools, ...app, ...messages };

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const {
  DISCORD_WEBHOOK_URL,
  MENTION_EVERYONE = 'false',
  MENTION_ROLE_ID = '',
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  STREAMERS,
  CHECK_INTERVAL_MS = '90000',
  DATA_DIR = './data',
  TEMPLATE_PATH = './templates/message_template.json',
  LOG_LEVEL = 'info'
} = process.env;

if (!DISCORD_WEBHOOK_URL || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !STREAMERS) {
  console.error('Config error: DISCORD_WEBHOOK_URL, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, STREAMERS are required.');
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const OAUTH_FILE = path.join(DATA_DIR, 'twitch_oauth.json');
const STATE_FILE = path.join(DATA_DIR, 'live_state.json');

const STREAMERS_LIST = STREAMERS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const log = {
  info: (...a) => (LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') && console.log('[INFO]', ...a),
  debug: (...a) => LOG_LEVEL === 'debug' && console.log('[DEBUG]', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let liveState = readJSON(STATE_FILE, {}); // { login: bool }
let twitchTokenCache = readJSON(OAUTH_FILE, { access_token: null, expires_at: 0 });

/* ---------- Tiny templating (placeholders + simple {{#if field}} blocks) ---------- */
function renderTemplateObject(obj, ctx) {
  if (Array.isArray(obj)) return obj.map(x => renderTemplateObject(x, ctx)).filter(v => v !== undefined);

  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const rendered = renderTemplateObject(v, ctx);
      if (rendered !== undefined && rendered !== null && rendered !== '__REMOVE__') out[k] = rendered;
    }
    // remove empty objects like image:{} if all fields removed
    if (Object.keys(out).length === 0) return undefined;
    return out;
  }

  if (typeof obj === 'string') {
    // handle {{#if field}} ... {{/if}}
    const ifRe = /{{#if\s+([\w.]+)}}([\s\S]*?){{\/if}}/g;
    let s = obj;
    s = s.replace(ifRe, (_, field, inner) => (ctx[field] ? inner : ''));
    // simple placeholders {{name}}
    s = s.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
      const val = ctx[key];
      return (val === undefined || val === null) ? '' : String(val);
    });
    // if string ends up empty, return undefined to allow field removal
    return s === '' ? undefined : s;
  }

  return obj;
}

function loadTemplate() {
  try {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    log.error('Failed to read template file:', e.message);
    return { content: '{{display_name}} just went live: {{url}}' };
  }
}

/* ---------- Twitch API ---------- */
async function getTwitchAppToken() {
  const now = Date.now();
  if (twitchTokenCache.access_token && now < twitchTokenCache.expires_at - 60_000) {
    return twitchTokenCache.access_token;
  }
  const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    },
    timeout: 12000
  });
  const token = res.data.access_token;
  const expiresIn = res.data.expires_in;
  twitchTokenCache = { access_token: token, expires_at: now + expiresIn * 1000 };
  writeJSON(OAUTH_FILE, twitchTokenCache);
  log.info('Obtained new Twitch token.');
  return token;
}

async function twitchGet(endpoint, params = {}) {
  const token = await getTwitchAppToken();
  const res = await axios.get(`https://api.twitch.tv/helix/${endpoint}`, {
    headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
    params,
    timeout: 12000
  });
  return res.data;
}

async function getUserMap(logins) {
  const data = await twitchGet('users', { login: logins });
  const map = {};
  for (const u of data.data) {
    map[u.login.toLowerCase()] = {
      id: u.id,
      display_name: u.display_name,
      profile_image_url: u.profile_image_url
    };
  }
  return map;
}

async function getStreamsByUserIds(ids) {
  if (!ids.length) return {};
  const p = new URLSearchParams();
  ids.forEach(id => p.append('user_id', id));
  const token = await getTwitchAppToken();
  const res = await axios.get('https://api.twitch.tv/helix/streams', {
    headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
    params: p,
    timeout: 12000
  });
  const byId = {};
  for (const s of res.data.data) {
    byId[s.user_id] = {
      title: s.title,
      game_name: s.game_name,
      started_at: s.started_at,
      thumbnail_url: (s.thumbnail_url || '').replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`,
      user_login: s.user_login || null
    };
  }
  return byId;
}

/* ---------- Discord ---------- */
function buildMentionPrefix() {
  const everyone = String(MENTION_EVERYONE).toLowerCase() === 'true';
  if (everyone) return '@everyone';
  if (MENTION_ROLE_ID) return `<@&${MENTION_ROLE_ID}>`;
  return '';
}

async function sendDiscordFromTemplate(context) {
  const base = loadTemplate();
  const rendered = renderTemplateObject(base, context);
  if (!rendered || (typeof rendered !== 'object')) {
    throw new Error('Template rendering failed');
  }
  await axios.post(DISCORD_WEBHOOK_URL, rendered, { timeout: 12000 });
  log.info(`Notification sent for ${context.login}.`);
}

/* ---------- Loop ---------- */
async function checkOnce() {
  const userMap = await getUserMap(STREAMERS_LIST);
  const ids = Object.values(userMap).map(u => u.id);
  const liveById = await getStreamsByUserIds(ids);

  for (const login of STREAMERS_LIST) {
    const u = userMap[login];
    if (!u) {
      log.error(`Unknown streamer: ${login}`);
      continue;
    }
    const isLive = !!liveById[u.id];
    const wasLive = !!liveState[login];

    if (isLive && !wasLive) {
      const info = liveById[u.id] || {};
      const ctx = {
        mention_prefix: buildMentionPrefix(),
        login,
        display_name: u.display_name || login,
        url: `https://twitch.tv/${login}`,
        title: info.title || 'Live',
        game_name: info.game_name || '',
        started_at: info.started_at || '',
        thumbnail_url: info.thumbnail_url || '',
        profile_image_url: u.profile_image_url || '',
        now_iso: new Date().toISOString()
      };
      await sendDiscordFromTemplate(ctx);
    }

    liveState[login] = isLive;
  }

  writeJSON(STATE_FILE, liveState);
}

let backoff = 0;
let timer = null;

async function loop() {
  try {
    await checkOnce();
    backoff = 0;
  } catch (e) {
    log.error('Loop error:', e?.response?.data || e.message);
    backoff = Math.min((backoff || 5000) * 2, 300000);
  } finally {
    const delay = backoff || Number(CHECK_INTERVAL_MS);
    timer = setTimeout(loop, delay);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
function shutdown() {
  log.info('Shutting down, saving state...');
  try { writeJSON(STATE_FILE, liveState); } catch {}
  if (timer) clearTimeout(timer);
  process.exit(0);
}
 
console.log('Twitch → Discord webhook notifier started.');
loop();

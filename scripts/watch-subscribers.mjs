// Hourly check: tells the approver's devices (tagged role=preview) when people
// sign up for, or turn off, result alerts.
// Usage: node scripts/watch-subscribers.mjs <state file>
// The state file keeps hashed subscription IDs between runs (GitHub Actions cache).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const [, , statePath] = process.argv;
const KEY = process.env.ONESIGNAL_API_KEY;
const APP = process.env.ONESIGNAL_APP_ID;
const SITE = process.env.SITE_URL || 'https://atmirish.github.io/dublin-club-fixtures/';
const ICON = new URL('icon-192.png', SITE).href;
const PREVIEW = { filters: [{ field: 'tag', key: 'role', relation: '=', value: 'preview' }] };
const SCHEMES = (KEY || '').startsWith('os_v2_') ? ['Key', 'Basic'] : ['Basic', 'Key'];
const hash = id => createHash('sha256').update(String(id)).digest('hex').slice(0, 16);

let prev = null;
const STATE_VERSION = 2; // bump to start counting afresh
try { prev = JSON.parse(await readFile(statePath, 'utf8')); if (prev.v !== STATE_VERSION) prev = null; } catch {}
async function save(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state));
}
if (!KEY || !APP) { console.log('No OneSignal key set; skipping.'); if (prev) await save(prev); process.exit(0); }

async function api(url, opts = {}) {
  let res;
  for (const scheme of SCHEMES) {
    res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: `${scheme} ${KEY}` }, signal: AbortSignal.timeout(30000) });
    if (res.status !== 401 && res.status !== 403) break;
  }
  return res;
}

// A subscription counts if it can still receive pushes
const isSub = s => !Number(s.invalid_identifier) && String(s.invalid_identifier) !== 'true' && Number(s.notification_types) > 0;

async function viaList() {
  const ids = [];
  for (let offset = 0; offset < 20000; offset += 300) {
    const res = await api(`https://api.onesignal.com/players?app_id=${APP}&limit=300&offset=${offset}`);
    if (!res.ok) throw new Error(`list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    if (!offset) console.log(`List API: total_count=${j.total_count}, returned=${(j.players || []).length}, fields=${JSON.stringify((j.players || []).map(p => [p.device_type, p.invalid_identifier, p.notification_types]))}`);
    for (const p of j.players || []) if (isSub(p)) ids.push(p.id);
    if (!j.players || j.players.length < 300) break;
  }
  return ids;
}

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

async function viaExport() {
  const res = await api(`https://api.onesignal.com/players/csv_export?app_id=${APP}`, { method: 'POST', body: '{}' });
  if (!res.ok) throw new Error(`export ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { csv_file_url: url } = await res.json();
  for (let i = 0; i < 24; i++) { // wait up to ~4 minutes for the file
    await new Promise(r => setTimeout(r, 10000));
    const f = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!f.ok) continue;
    const buf = Buffer.from(await f.arrayBuffer());
    const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
    const [head, ...rows] = parseCsv(text).filter(r => r.length > 1);
    const col = n => head.indexOf(n);
    const id = col('id'), it = col('invalid_identifier'), nt = col('notification_types');
    console.log(`Export: ${rows.length} rows; columns ${head.join(', ')}; status ${JSON.stringify(rows.map(r => [r[col('device_type')], r[it], r[nt]]))}`);
    return rows.map(r => ({ id: r[id], invalid_identifier: r[it], notification_types: r[nt] })).filter(isSub).map(r => r.id);
  }
  throw new Error('export file was not ready in time');
}

// The CSV export covers every subscription; the old list API can miss newer ones.
let ids;
try { ids = await viaExport(); console.log('Read subscribers from the CSV export.'); }
catch (e) {
  console.log(`Could not read subscribers: ${e.message}`); if (prev) await save(prev); process.exit(0);
}

const now = new Set(ids.map(hash));
await save({ v: STATE_VERSION, ids: [...now], checkedAt: new Date().toISOString() });
if (!prev) { console.log(`First check: ${now.size} subscribers. Nothing to report yet.`); process.exit(0); }

const before = new Set(prev.ids);
const joined = [...now].filter(h => !before.has(h)).length;
const left = [...before].filter(h => !now.has(h)).length;
console.log(`Subscribers: ${now.size} (new ${joined}, left ${left})`);
if (!joined && !left) process.exit(0);

const heading = joined && !left ? (joined === 1 ? 'New alert sign-up' : `${joined} new alert sign-ups`)
  : !joined ? (left === 1 ? 'Someone turned off alerts' : `${left} people turned off alerts`)
  : 'Alert sign-ups changed';
const parts = [joined && `${joined} new`, left && `${left} left`].filter(Boolean).join(', ');
const contents = `${parts} · ${now.size} in total`;
let res, text;
for (const scheme of SCHEMES) {
  res = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `${scheme} ${KEY}` },
    body: JSON.stringify({ app_id: APP, target_channel: 'push', ...PREVIEW, headings: { en: heading }, contents: { en: contents }, url: SITE, chrome_web_icon: ICON, firefox_icon: ICON }),
    signal: AbortSignal.timeout(30000)
  });
  text = await res.text();
  if (res.status !== 401 && res.status !== 403) break;
}
console.log(`${heading}: ${contents}\nOneSignal replied ${res.status}: ${text}`);

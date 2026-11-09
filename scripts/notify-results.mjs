// Result alerts via OneSignal, sent straight to every subscriber (no approval step).
//
//   node scripts/notify-results.mjs <new fixtures.json> <previous fixtures.json>
//     Finds BSJ results that weren't on the live site before this run and sends one alert
//     to everyone. If the send fails, the step fails (red in GitHub, and GitHub emails you).
//
// Manual test (Actions > Update fixtures > Run workflow > "Send a test alert"):
// sends a made-up result only to devices tagged role=preview (5 taps on the site's header icon).
//
// Needs ONESIGNAL_API_KEY (GitHub secret). Without it, or without the previous file, it does nothing.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [, , newPath, prevPath] = process.argv;
const KEY = process.env.ONESIGNAL_API_KEY;
const APP = process.env.ONESIGNAL_APP_ID;
const SITE = process.env.SITE_URL;
const ICON = new URL('icon-192.png', SITE || 'https://atmirish.github.io/dublin-club-fixtures/').href;

if (!KEY || !APP) { console.log('No OneSignal key set; skipping result alerts.'); process.exit(0); }
const PREVIEW = { filters: [{ field: 'tag', key: 'role', relation: '=', value: 'preview' }] };
const EVERYONE = { included_segments: ['Total Subscriptions'] };

// New OneSignal keys (os_v2_...) use "Key", older REST API keys use "Basic"; try the likely one first.
const SCHEMES = KEY.startsWith('os_v2_') ? ['Key', 'Basic'] : ['Basic', 'Key'];
// One key per workflow run, shaped as a UUID v4: if a run is re-run, OneSignal won't send it twice
function idempotencyKey() {
  const h = createHash('sha256').update(`result-alert-${process.env.GITHUB_RUN_ID || Date.now()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function push(target, heading, contents) {
  let res, text;
  for (const scheme of SCHEMES) {
    res = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `${scheme} ${KEY}` },
      body: JSON.stringify({
        app_id: APP, target_channel: 'push', ...target,
        headings: { en: heading }, contents: { en: contents }, url: SITE,
        chrome_web_icon: ICON, firefox_icon: ICON, idempotency_key: idempotencyKey()
      }),
      signal: AbortSignal.timeout(30000)
    });
    text = await res.text();
    if (res.status !== 401 && res.status !== 403) break;
  }
  console.log(`OneSignal replied ${res.status}: ${text}`);
  // OneSignal can answer 200 and still send nothing: it then gives no message id, or lists errors
  let j = {};
  try { j = JSON.parse(text); } catch {}
  const errors = Array.isArray(j.errors) ? j.errors : j.errors ? Object.values(j.errors) : [];
  return { ok: res.ok && !!j.id && !errors.length, text };
}
async function send(target, heading, contents, who) {
  console.log(`Sending to ${who}:\n${heading}\n${contents}`);
  let r = await push(target, heading, contents);
  // Older OneSignal apps call the all-subscribers segment "Subscribed Users"
  if (!r.ok && target === EVERYONE && /segment/i.test(r.text)) r = await push({ included_segments: ['Subscribed Users'] }, heading, contents);
  if (r.ok) { console.log('Sent.'); return; }
  console.log('::error title=Result alert not sent::OneSignal did not send the alert. See the reply above.');
  process.exit(1);
}

if (process.env.TEST_ALERT === 'true') {
  await send(PREVIEW, 'TEST: BSJ result', 'U12 Football (A): Won 2-10 v 1-08 Test Club\nThis is a test alert.', 'preview devices only (test)');
  process.exit(0);
}

let prev;
try { prev = JSON.parse(await readFile(prevPath, 'utf8')); }
catch { console.log('No previous fixtures to compare with; skipping alerts so nobody gets flooded.'); process.exit(0); }
const cur = JSON.parse(await readFile(newPath, 'utf8'));

const score = s => { const m = /^\s*(\d+)\s*[;:-]\s*(\d+)\s*$/.exec(s || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
const show = p => `${p[0]}-${String(p[1]).padStart(2, '0')}`;
const isResult = r => r[11] !== 'Postponed' && score(r[12]) && score(r[13]);
// Feed text goes into notifications: keep it to plain, short, printable text
const clean = (s, max = 40) => {
  const t = String(s || '').normalize('NFKC').replace(/[\p{C}<>{}\[\]\\`]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

// columns: id, date, time, sport, grade, compIndex, homeTeam, awayTeam, homeClub, awayClub, venue, status, homeScore, awayScore
const seen = new Set((prev.fx || []).filter(isResult).map(r => r[0]));
const fresh = (cur.fx || []).filter(r => isResult(r) && !seen.has(r[0]));
if (!fresh.length) { console.log('No new results.'); process.exit(0); }

const BSJ = /ballinteer/i;
const lines = fresh.map(r => {
  const home = BSJ.test(r[8] || r[6]);
  const us = score(home ? r[12] : r[13]), them = score(home ? r[13] : r[12]);
  const a = us[0] * 3 + us[1], b = them[0] * 3 + them[1];
  const outcome = a > b ? 'Won' : a < b ? 'Lost' : 'Drew';
  const team = clean((home ? r[6] : r[7]).replace(/^ballinteer\s*st\.?\s*john'?s\s*/i, ''), 20);
  const opp = clean(home ? r[7] : r[6]);
  return `${clean([r[4], r[3]].filter(Boolean).join(' '), 30)}${team ? ` (${team})` : ''}: ${outcome} ${show(us)} v ${show(them)} ${opp}`;
});

const heading = fresh.length === 1 ? 'BSJ result' : `${fresh.length} new BSJ results`;
const MAX = 6;
const contents = lines.slice(0, MAX).join('\n') + (lines.length > MAX ? `\n+${lines.length - MAX} more on the site` : '');
await send(EVERYONE, heading, contents, 'everyone');

// Result alerts via OneSignal, with approval before anything goes to everyone.
//
//   node scripts/notify-results.mjs prepare <new fixtures.json> <previous fixtures.json>
//     Finds BSJ results that weren't on the live site before this run, sends a PREVIEW
//     only to devices tagged role=preview, and writes the alert to $GITHUB_OUTPUT as "alert".
//
//   node scripts/notify-results.mjs send
//     Sends the approved alert (from the ALERT env var) to all subscribers.
//     Runs in the "result-alerts" environment, which needs a reviewer to approve it.
//
// Needs ONESIGNAL_API_KEY (GitHub secret). Without it, or without the previous file, it does nothing.
import { readFile, appendFile } from 'node:fs/promises';

const [, , mode, newPath, prevPath] = process.argv;
const KEY = process.env.ONESIGNAL_API_KEY;
const APP = process.env.ONESIGNAL_APP_ID;
const SITE = process.env.SITE_URL;
const ICON = new URL('icon-192.png', SITE || 'https://atmirish.github.io/dublin-club-fixtures/').href;
const MAX_AGE_HOURS = 3; // an approval later than this is too late; the alert is skipped

if (!KEY || !APP) { console.log('No OneSignal key set; skipping result alerts.'); process.exit(0); }
const PREVIEW = { filters: [{ field: 'tag', key: 'role', relation: '=', value: 'preview' }] };

// New OneSignal keys (os_v2_...) use "Key", older REST API keys use "Basic"; try the likely one first.
const SCHEMES = KEY.startsWith('os_v2_') ? ['Key', 'Basic'] : ['Basic', 'Key'];
async function push(target, heading, contents) {
  let res, text;
  for (const scheme of SCHEMES) {
    res = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `${scheme} ${KEY}` },
      body: JSON.stringify({
        app_id: APP, target_channel: 'push', ...target,
        headings: { en: heading }, contents: { en: contents }, url: SITE,
        chrome_web_icon: ICON, firefox_icon: ICON
      }),
      signal: AbortSignal.timeout(30000)
    });
    text = await res.text();
    if (res.status !== 401 && res.status !== 403) break;
  }
  console.log(`OneSignal replied ${res.status}: ${text}`);
  return { ok: res.ok, text };
}

if (mode === 'send') {
  let alert;
  try { alert = JSON.parse(Buffer.from(process.env.ALERT || '', 'base64').toString('utf8')); }
  catch { console.log('No alert to send.'); process.exit(0); }
  const ageH = (Date.now() - new Date(alert.createdAt).getTime()) / 36e5;
  if (!(ageH <= MAX_AGE_HOURS)) { console.log(`Approved ${ageH.toFixed(1)} hours after the results came in; too late, not sending.`); process.exit(0); }
  if (alert.test) {
    console.log(`Test alert approved; sending to preview devices only:\n${alert.heading}\n${alert.contents}`);
    const t = await push(PREVIEW, alert.heading, alert.contents);
    if (!t.ok) process.exitCode = 1;
    process.exit();
  }
  console.log(`Sending to everyone:\n${alert.heading}\n${alert.contents}`);
  let r = await push({ included_segments: ['Total Subscriptions'] }, alert.heading, alert.contents);
  if (!r.ok && /segment/i.test(r.text)) r = await push({ included_segments: ['Subscribed Users'] }, alert.heading, alert.contents);
  if (!r.ok) process.exitCode = 1;
  process.exit();
}

if (mode !== 'prepare') { console.log('Usage: notify-results.mjs prepare <new> <previous> | send'); process.exit(1); }

async function queue(alert, count = 1) {
  console.log(`Alert waiting for approval:\n${alert.heading}\n${alert.contents}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `alert=${Buffer.from(JSON.stringify(alert)).toString('base64')}\n`);
  }
  // Preview to the approver's devices only
  const warn = count > 15 ? `\n⚠ ${count} results at once – check the feed looks right.` : '';
  await push(PREVIEW, `Preview: ${alert.heading}`, `${alert.contents}${warn}\nApprove in GitHub to send this to everyone.`);
}

// Manual test (Actions > Update fixtures > Run workflow > "Send a test alert"):
// goes through preview and approval, but is only ever sent to preview devices.
if (process.env.TEST_ALERT === 'true') {
  await queue({ heading: 'TEST: BSJ result', contents: 'U12 Football (A): Won 2-10 v 1-08 Test Club\nThis is a test of the approval step.', createdAt: new Date().toISOString(), test: true });
  process.exit();
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
await queue({ heading, contents, createdAt: new Date().toISOString() }, fresh.length);

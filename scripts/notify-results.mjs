// Sends one push notification (via OneSignal) listing BSJ results that weren't on the live site before this run.
// Usage: node scripts/notify-results.mjs <new fixtures.json> <previous fixtures.json>
// Needs ONESIGNAL_API_KEY (GitHub secret). Without it, or without the previous file, it does nothing.
import { readFile } from 'node:fs/promises';

const [, , newPath, prevPath] = process.argv;
const KEY = process.env.ONESIGNAL_API_KEY;
const APP = process.env.ONESIGNAL_APP_ID;
const SITE = process.env.SITE_URL;
const ICON = new URL('icon-192.png', SITE || 'https://atmirish.github.io/dublin-club-fixtures/').href;

if (!KEY || !APP) { console.log('No OneSignal key set; skipping result alerts.'); process.exit(0); }

let prev;
try { prev = JSON.parse(await readFile(prevPath, 'utf8')); }
catch { console.log('No previous fixtures to compare with; skipping alerts so nobody gets flooded.'); process.exit(0); }
const cur = JSON.parse(await readFile(newPath, 'utf8'));

const score = s => { const m = /^\s*(\d+)\s*[;:-]\s*(\d+)\s*$/.exec(s || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
const show = p => `${p[0]}-${String(p[1]).padStart(2, '0')}`;
const isResult = r => r[11] !== 'Postponed' && score(r[12]) && score(r[13]);

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
  const team = (home ? r[6] : r[7]).replace(/^ballinteer\s*st\.?\s*john'?s\s*/i, '').trim();
  const opp = home ? r[7] : r[6];
  return `${[r[4], r[3]].filter(Boolean).join(' ')}${team ? ` (${team})` : ''}: ${outcome} ${show(us)} v ${show(them)} ${opp}`;
});

const heading = fresh.length === 1 ? 'BSJ result' : `${fresh.length} new BSJ results`;
const MAX = 6;
const contents = lines.slice(0, MAX).join('\n') + (lines.length > MAX ? `\n+${lines.length - MAX} more on the site` : '');

async function send(segment) {
  const res = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${KEY}` },
    body: JSON.stringify({
      app_id: APP, target_channel: 'push', included_segments: [segment],
      headings: { en: heading }, contents: { en: contents }, url: SITE,
      chrome_web_icon: ICON, firefox_icon: ICON
    }),
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

console.log(`${heading}:\n${contents}`);
let r = await send('Total Subscriptions');
if (!r.ok && /segment/i.test(r.text)) r = await send('Subscribed Users');
console.log(`OneSignal replied ${r.status}: ${r.text}`);
if (!r.ok) process.exitCode = 1;

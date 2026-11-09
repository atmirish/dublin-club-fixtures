// Quick check before a full update: is a rebuild of the site worth doing right now?
//   node scripts/should-update.mjs
// Writes run=true|false to $GITHUB_OUTPUT and explains why in the log and job summary.
//
// Runs a full update when:
//   - the site's data is missing, or from last week (Monday switch-over)
// Never before 07:00 Irish time (except when the data is missing).
//   - the morning sweep is due (first check after 07:00 Irish time each day)
//   - the regular refresh is due (data more than 3 hours old)
//   - a BSJ game is in its "result could appear now" window AND the Dublin feeds show
//     something has changed (a score, time, venue, status or a new/removed fixture)
// Result windows, measured from throw-in:  45 min - 3 h: every check;  3 h - 8 h: every 20 min.
// U8-U11 games are ignored: their scores are almost never entered (none in Oct-Nov 2026).
import { readFile, appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const SITE = process.env.SITE_URL || 'https://atmirish.github.io/dublin-club-fixtures/';
const TZ = 'Europe/Dublin';
const REFRESH_HOURS = 3;
const SWEEP_HOUR = 7;
const MIN_RESULT_AGE = 12; // youngest grade whose results get entered

const parts = d => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
}).formatToParts(d).map(p => [p.type, p.value]));
const now = new Date(process.env.NOW || Date.now());
const P = parts(now);
const today = `${P.year}-${P.month}-${P.day}`;
const nowMin = Number(P.hour) * 60 + Number(P.minute);
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekFrom = addDays(today, -['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(P.weekday));

async function decide(run, reason) {
  console.log(`Irish time ${today} ${P.hour}:${P.minute}. ${run ? 'Full update' : 'No update'}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${run}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `**${run ? 'Full update' : 'No update'}**: ${reason}\n`);
  process.exit(0);
}

// 1. What the live site shows now
let live;
try {
  const res = await fetch(new URL(`fixtures.json?t=${Date.now()}`, SITE), { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  live = await res.json();
} catch (e) { await decide(true, `couldn't read the live site's data (${e.message})`); }

if (!Array.isArray(live.fx) || !live.updatedAt) await decide(true, 'the live data looks incomplete');
if (Number(P.hour) < SWEEP_HOUR) await decide(false, `before ${SWEEP_HOUR}am; the morning sweep will catch up`);
if (live.from !== weekFrom) await decide(true, `new week (site shows ${live.from}, this week starts ${weekFrom})`);

const updated = new Date(live.updatedAt), U = parts(updated);
const updatedDay = `${U.year}-${U.month}-${U.day}`;
if (Number(P.hour) >= SWEEP_HOUR && (updatedDay < today || Number(U.hour) < SWEEP_HOUR))
  await decide(true, 'morning sweep (picks up scores entered overnight)');
const ageH = (now - updated) / 36e5;
if (ageH >= REFRESH_HOURS) await decide(true, `regular refresh (data is ${ageH.toFixed(1)} hours old)`);

// 2. Is any BSJ game in its result window?
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hasScore = r => /\d/.test(r[12] || '') && /\d/.test(r[13] || '');
const everyCheck = [], every20 = [];
for (const r of live.fx) {
  if (r[1] !== today || r[11] === 'Postponed' || hasScore(r)) continue;
  const age = /^U(\d{1,2})$/i.exec(r[4] || '');
  if (age && Number(age[1]) < MIN_RESULT_AGE) continue;
  const start = toMin(r[2]);
  const label = `${r[2] || 'time TBC'} ${r[6]} v ${r[7]}`;
  if (start == null) { if (nowMin >= 11 * 60 && nowMin <= 21 * 60) every20.push(label); continue; }
  const since = nowMin - start;
  if (since >= 45 && since < 180) everyCheck.push(label);
  else if (since >= 180 && since < 480) every20.push(label);
}
const slot20 = Number(P.minute) % 20 < 5; // checks starting at :00-:04, :20-:24, :40-:44
if (!everyCheck.length && !(every20.length && slot20)) {
  const waiting = every20.length ? ` (${every20.length} game(s) in the 20-minute window; next look at :00, :20 or :40)` : '';
  await decide(false, `no BSJ game is waiting for a result right now${waiting}`);
}
const watching = [...everyCheck, ...(slot20 ? every20 : [])];

// 3. Ask the Dublin feeds and compare with the live site
const dir = await mkdtemp(join(tmpdir(), 'check-'));
const out = join(dir, 'now.json');
const ok = await new Promise(res => execFile(process.execPath, [new URL('./fetch-fixtures.mjs', import.meta.url).pathname, out],
  { timeout: 120000 }, (err, stdout, stderr) => { process.stdout.write(stdout); process.stderr.write(stderr); res(!err); }));
let fresh;
try { if (ok) fresh = JSON.parse(await readFile(out, 'utf8')); } catch {}
if (!fresh) await decide(false, `watching ${watching.length} game(s), but the Dublin feeds couldn't be read this time`);

const partial = (fresh.feeds || []).some(s => /failed/.test(s));
const norm = (doc, r) => JSON.stringify([...r.slice(0, 5), (doc.comps || [])[r[5]] ?? r[5], ...r.slice(6)]);
const before = new Map(live.fx.map(r => [r[0], norm(live, r)]));
const after = new Map(fresh.fx.map(r => [r[0], norm(fresh, r)]));
const changed = [];
for (const [id, v] of after) if (before.get(id) !== v) changed.push(before.has(id) ? 'changed' : 'new');
if (!partial) for (const id of before.keys()) if (!after.has(id)) changed.push('removed');

if (changed.length) {
  const n = k => changed.filter(x => x === k).length;
  await decide(true, `the Dublin feeds changed (${['changed', 'new', 'removed'].filter(n).map(k => `${n(k)} ${k}`).join(', ')}) while watching: ${watching.join('; ')}`);
}
await decide(false, `no change yet for: ${watching.join('; ')}`);

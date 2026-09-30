// Builds fixtures.json: every Dublin club fixture for the current Monday–Sunday week (Europe/Dublin),
// from the SportsManager feeds behind dublingaa.ie. Run by .github/workflows/update-fixtures.yml.
import { writeFile } from 'node:fs/promises';

const FEEDS = [
  { id: '7282', board: 'Camogie' },
  { id: '7046', board: 'Ladies Football' },
  { id: '7167', board: 'GAA CCC1' },
  { id: '7130', board: 'GAA CCC2' },
  { id: '3', board: 'GAA Adult & Minor' }
];
const TZ = 'Europe/Dublin';
const OUT = process.argv[2] || new URL('../fixtures.json', import.meta.url);

const dublinParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
}).formatToParts(d).map(p => [p.type, p.value]));
const ymdOf = d => { const p = dublinParts(d); return `${p.year}-${p.month}-${p.day}`; };
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };

function currentWeek(now = new Date()) {
  const today = ymdOf(now);
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(dublinParts(now).weekday);
  const from = addDays(today, -dow);
  return { from, to: addDays(from, 6) };
}

const clean = v => String(v == null ? '' : v).trim();
const sportOf = (f, board) => {
  const c = clean(f.competitionName || f.competition);
  if (board === 'Camogie' || /camog/i.test(c)) return 'Camogie';
  if (board === 'Ladies Football' || /lgfa|ladies/i.test(c)) return 'Ladies Football';
  if (/hurl/i.test(c)) return 'Hurling';
  if (/football/i.test(c)) return 'Football';
  return 'Other';
};
const gradeOf = f => {
  const c = clean(f.competitionName || f.competition);
  let m = /\b(?:U|Under)\s?(\d{1,2})\b/i.exec(c);
  if (m) return 'U' + m[1];
  m = /\b(Minor|Junior|Intermediate|Senior|Adult)\b/i.exec(c);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const a = clean(f.ageName);
  if (/^U\d{1,2}$/i.test(a)) return a.toUpperCase();
  if (/^M[FH][CL]$/i.test(a)) return 'Minor';
  if (/^J[FH][CL]$/i.test(a)) return 'Junior';
  return '';
};
const when = f => {
  const ts = Number(f.fixtureDate);
  if (ts > 1e9) { const p = dublinParts(new Date(ts * 1000)); return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`]; }
  const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f.date || '');
  return [p ? `${p[3]}-${p[2]}-${p[1]}` : clean(f.date), clean(f.time)];
};

async function getFeed(id, from, to) {
  const url = new URL('https://sportsmanager.ie/dataFeed/index.php');
  Object.entries({ feedType: 'fixture', type: 'all', user_id: id, date_from: from, date_to: to, sort: 'date' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'dublin-club-fixtures (GitHub Actions)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const p = JSON.parse(await res.text());
  return Array.isArray(p) ? p : (p && (p.fixtures || p.data || Object.values(p).find(v => Array.isArray(v)))) || [];
}

const { from, to } = currentWeek();
const fx = [], seen = new Set(), feeds = [], comps = [], compIdx = new Map();
const ci = c => { if (!compIdx.has(c)) { compIdx.set(c, comps.length); comps.push(c); } return compIdx.get(c); };
const isBye = t => /^bye\b/i.test(t);

for (const feed of FEEDS) {
  let arr;
  try { arr = await getFeed(feed.id, from, to); feeds.push(`${feed.board}: ok`); }
  catch (e) { feeds.push(`${feed.board}: failed`); console.warn(feed.board, e.message); continue; }
  for (const f of arr) {
    if (!f) continue;
    const k = clean(f.fixtureId) || [f.fixtureDate, f.homeTeam, f.awayTeam].join('|');
    if (seen.has(k)) continue; seen.add(k);
    const home = clean(f.homeTeam || f.home), away = clean(f.awayTeam || f.away);
    if (isBye(home) || isBye(away)) continue;
    const [day, time] = when(f);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) continue;
    const pp = f.postponed && String(f.postponed) !== '0';
    fx.push([k, day, time === '00:00' ? '' : time, sportOf(f, feed.board), gradeOf(f), ci(clean(f.competitionName || f.competition)),
      home, away, clean(f.homeClub), clean(f.awayClub), clean(f.venue),
      pp ? 'Postponed' : clean(f.fixtureStatus), clean(f.homeScore), clean(f.awayScore)]);
  }
}
fx.sort((a, b) => (a[1] + a[2]).localeCompare(b[1] + b[2]) || a[0].localeCompare(b[0]));

if (feeds.every(s => s.endsWith('failed'))) { console.error('Every feed failed; keeping the existing fixtures.json'); process.exit(1); }


const doc = {
  from, to, updatedAt: new Date().toISOString(), feeds, count: fx.length,
  cols: ['id', 'date', 'time', 'sport', 'grade', 'compIndex', 'homeTeam', 'awayTeam', 'homeClub', 'awayClub', 'venue', 'status', 'homeScore', 'awayScore'],
  comps, fx
};
await writeFile(OUT, JSON.stringify(doc) + '\n');
console.log(`Wrote ${fx.length} games for week of ${from} (${feeds.join(', ')})`);

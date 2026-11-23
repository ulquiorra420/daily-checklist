// Family checklist server: people + PINs, each person's list, reminder notifications.
import { sendPush } from './push.js';

const ALLOWED_ORIGINS = ['https://ulquiorra420.github.io', 'http://localhost:8765'];
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;
const EVERY_OPTIONS = [15, 30, 45, 60, 90, 120];

const TEXT = {
  en: { waterTitle: '💧 Time to drink water', waterBody: 'Have a glass of water.', summaryTitle: '📝 Still to do today', testTitle: 'Notifications are working ✓', testBody: 'You will get your reminders here.',
        morningTitle: '⏩ Moved to today', morningBody: (from, yesterday, list) => `Not finished ${from === yesterday ? 'yesterday' : 'on ' + from}: ${list}` },
  vi: { waterTitle: '💧 Đến giờ uống nước rồi', waterBody: 'Uống một cốc nước nhé.', summaryTitle: '📝 Việc chưa làm hôm nay', testTitle: 'Thông báo đã hoạt động ✓', testBody: 'Bạn sẽ nhận nhắc nhở ở đây.',
        morningTitle: '⏩ Đã chuyển sang hôm nay', morningBody: (from, yesterday, list) => `${from === yesterday ? 'Hôm qua' : 'Ngày ' + from} chưa xong: ${list}` },
};

export const defaultSettings = lang => ({
  lang, tz: 'Asia/Ho_Chi_Minh',
  water: { on: true, every: 30, from: 9, to: 23 },
  summary: { on: true, time: '22:30' },
  morning: { on: true, time: '10:00' },
});
// A new person has no days yet; the app adds their first "Drink water" task on first open.
export const starterData = () => ({ days: {} });

// data = { days: { 'YYYY-MM-DD': Day }, popupShown?: date }
// Day  = { tasks: [{ text, done, repeat }], notes: [text], carried?: [text], from?: date, legacy?: true }
// The app creates each new day the same way (keep in sync with newDay() in index.html).
export function newDay(days, date) {
  const prevKey = Object.keys(days).filter(d => d < date).sort().pop();
  const prev = days[prevKey];
  if (!prev) return { tasks: [], notes: [], carried: [] };
  return {
    tasks: prev.tasks.filter(t => !t.done || t.repeat).map(t => ({ text: t.text, done: false, repeat: t.repeat })),
    notes: [],
    carried: prev.tasks.filter(t => !t.done).map(t => t.text), // unfinished yesterday, shown in the 10am reminder
    from: prevKey,
  };
}
export const dayFor = (data, date) => data.days[date] || newDay(data.days, date);
const yesterdayOf = date => new Date(Date.parse(date + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);

class HttpError extends Error { constructor(status, code, extra = {}) { super(code); Object.assign(this, { status, code, extra }); } }

const cors = origin => ALLOWED_ORIGINS.includes(origin) ? {
  'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : {};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    try { return reply(await route(req, env)); }
    catch (e) {
      if (e instanceof HttpError) return reply({ error: e.code, ...e.extra }, e.status);
      console.error(e); return reply({ error: 'server' }, 500);
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(sendReminders(env, new Date())); },
};

async function route(req, env) {
  const { pathname: p } = new URL(req.url), m = req.method;
  const body = m === 'GET' ? {} : await req.json().catch(() => ({}));
  const db = env.DB;

  if (m === 'GET' && p === '/people') {
    const { results } = await db.prepare('SELECT id, name, pin_hash IS NOT NULL AS hasPin, settings FROM people ORDER BY sort, name').all();
    return results.map(r => ({ id: r.id, name: r.name, hasPin: !!r.hasPin, lang: JSON.parse(r.settings).lang }));
  }
  if (m === 'GET' && p === '/vapid') return { key: env.VAPID_PUBLIC };

  if (m === 'POST' && p === '/login') {
    const { id, pin } = body;
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new HttpError(400, 'bad-pin');
    const person = await db.prepare('SELECT * FROM people WHERE id = ?').bind(String(id)).first();
    if (!person) throw new HttpError(404, 'no-person');
    const now = Date.now();
    if (!person.pin_hash) { // first time: this PIN becomes theirs
      const salt = crypto.randomUUID();
      const res = await db.prepare('UPDATE people SET pin_hash = ?, salt = ?, failed = 0, locked_until = 0 WHERE id = ? AND pin_hash IS NULL')
        .bind(await hashPin(env, salt, pin), salt, person.id).run();
      if (!res.meta.changes) throw new HttpError(409, 'pin-already-set');
    } else {
      if (person.locked_until > now) throw new HttpError(423, 'locked', { minutes: Math.ceil((person.locked_until - now) / 60000) });
      if (await hashPin(env, person.salt, pin) !== person.pin_hash) {
        const failed = person.failed + 1, lock = failed >= LOCK_AFTER;
        await db.prepare('UPDATE people SET failed = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : failed, lock ? now + LOCK_MS : 0, person.id).run();
        throw lock ? new HttpError(423, 'locked', { minutes: LOCK_MS / 60000 }) : new HttpError(401, 'wrong-pin', { triesLeft: LOCK_AFTER - failed });
      }
      await db.prepare('UPDATE people SET failed = 0, locked_until = 0 WHERE id = ?').bind(person.id).run();
    }
    const token = crypto.randomUUID() + crypto.randomUUID();
    await db.prepare('INSERT INTO sessions (token, person_id, created) VALUES (?, ?, ?)').bind(token, person.id, now).run();
    return { token };
  }

  // Everything below needs a signed-in person.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const me = token && await db.prepare('SELECT p.* FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = ?').bind(token).first();
  if (!me) throw new HttpError(401, 'signed-out');

  const data = JSON.parse(me.data);
  const saveData = () => db.prepare('UPDATE people SET data = ? WHERE id = ?').bind(JSON.stringify(data), me.id).run();
  if (m === 'GET' && p === '/me') {
    const recent = Object.fromEntries(Object.keys(data.days).sort().slice(-2).map(d => [d, data.days[d]]));
    return { id: me.id, name: me.name, isAdmin: !!me.is_admin, settings: JSON.parse(me.settings), recent, popupShown: data.popupShown || null };
  }
  if (m === 'PUT' && p === '/day') { // only the newest day can change; older days are the read-only Archive
    const date = String(body.date);
    const newest = Object.keys(data.days).sort().pop();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (newest && date < newest)) throw new HttpError(400, 'day-is-archived');
    data.days[date] = cleanDay(body.day);
    if (JSON.stringify(data).length > 1_500_000) throw new HttpError(413, 'too-much-data');
    await saveData();
    return { ok: true };
  }
  if (m === 'PUT' && p === '/popup') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(body.date)) { data.popupShown = body.date; await saveData(); }
    return { ok: true };
  }
  if (m === 'GET' && p === '/archive')
    return Object.fromEntries(Object.entries(data.days).map(([d, day]) =>
      [d, { done: day.tasks.filter(t => t.done).length, total: day.tasks.length, notes: day.notes.length }]));
  if (m === 'GET' && p === '/archive/day') {
    const day = data.days[new URL(req.url).searchParams.get('date')];
    if (!day) throw new HttpError(404, 'no-day');
    return day;
  }
  if (m === 'PUT' && p === '/settings') {
    const settings = cleanSettings(body.settings || {}, JSON.parse(me.settings));
    await db.prepare('UPDATE people SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), me.id).run();
    return settings;
  }
  if (m === 'POST' && p === '/subscribe') {
    const sub = body.subscription;
    if (!sub || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, 'bad-subscription');
    await db.prepare('INSERT OR REPLACE INTO subs (endpoint, person_id, sub) VALUES (?, ?, ?)')
      .bind(sub.endpoint, me.id, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys })).run();
    if (body.test !== true) return { ok: true }; // re-linking this device to a person after switching
    const t = TEXT[JSON.parse(me.settings).lang];
    const status = await sendPush(sub, { title: t.testTitle, body: t.testBody }, env);
    return { ok: status < 300, status };
  }
  if (m === 'POST' && p === '/logout') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return { ok: true };
  }

  if (p.startsWith('/admin/')) {
    if (!me.is_admin) throw new HttpError(403, 'not-admin');
    if (m === 'POST' && p === '/admin/reset-pin') { // their list stays; they choose a new PIN next time they open it
      const id = String(body.id);
      await db.batch([
        db.prepare('UPDATE people SET pin_hash = NULL, salt = NULL, failed = 0, locked_until = 0 WHERE id = ?').bind(id),
        db.prepare('DELETE FROM sessions WHERE person_id = ?').bind(id),
      ]);
      return { ok: true };
    }
    if (m === 'POST' && p === '/admin/people') {
      const name = String(body.name || '').trim(), lang = body.lang === 'vi' ? 'vi' : 'en';
      if (!name || name.length > 30) throw new HttpError(400, 'bad-name');
      if (await db.prepare('SELECT 1 FROM people WHERE lower(name) = lower(?)').bind(name).first()) throw new HttpError(409, 'name-taken');
      const { n } = await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM people').first();
      await db.prepare('INSERT INTO people (id, name, sort, data, settings) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), name, n, JSON.stringify(starterData()), JSON.stringify(defaultSettings(lang))).run();
      return { ok: true };
    }
    if (m === 'DELETE' && p === '/admin/people') {
      const id = String(body.id);
      if (id === me.id) throw new HttpError(400, 'cannot-remove-self');
      await db.batch(['DELETE FROM subs WHERE person_id = ?', 'DELETE FROM sessions WHERE person_id = ?', 'DELETE FROM people WHERE id = ?']
        .map(sql => db.prepare(sql).bind(id)));
      return { ok: true };
    }
  }
  throw new HttpError(404, 'not-found');
}

// The pepper lives only in the server's secret settings, so a copy of the database alone can't be used to guess PINs.
async function hashPin(env, salt, pin) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PIN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function cleanDay(d) {
  const texts = (a, max, len) => Array.isArray(a) && a.length <= max && a.every(x => typeof x === 'string' && x.length <= len);
  const isDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (!d || !Array.isArray(d.tasks) || d.tasks.length > 200
      || !d.tasks.every(t => t && typeof t.text === 'string' && t.text.length <= 200 && typeof t.done === 'boolean' && typeof t.repeat === 'boolean')
      || !texts(d.notes, 100, 5000) || (d.carried !== undefined && !texts(d.carried, 200, 200)) || (d.from !== undefined && !isDate(d.from)))
    throw new HttpError(400, 'bad-data');
  const out = { tasks: d.tasks.map(t => ({ text: t.text, done: t.done, repeat: t.repeat })), notes: d.notes };
  if (d.carried) out.carried = d.carried;
  if (d.from) out.from = d.from;
  if (d.legacy === true) out.legacy = true;
  return out;
}

// One-time conversion from the version 7/8 format { tasks, done } to days (used by the migration script).
export function fromOldFormat(old, today) {
  const days = {};
  for (const [d, list] of Object.entries(old.done || {}))
    if (d < today && list.length) days[d] = { tasks: list.map(text => ({ text, done: true, repeat: true })), notes: [], legacy: true };
  const doneToday = old.done?.[today] || [];
  days[today] = { tasks: old.tasks.map(text => ({ text, done: doneToday.includes(text), repeat: true })), notes: [] };
  return { days };
}

export function cleanSettings(s, old) {
  const out = structuredClone(old);
  if (s.lang === 'en' || s.lang === 'vi') out.lang = s.lang;
  if (typeof s.tz === 'string') { try { new Intl.DateTimeFormat('en', { timeZone: s.tz }); out.tz = s.tz; } catch {} }
  const hour = h => Number.isInteger(h) && h >= 0 && h <= 23;
  if (s.water) {
    const w = s.water;
    if (typeof w.on === 'boolean') out.water.on = w.on;
    if (EVERY_OPTIONS.includes(w.every)) out.water.every = w.every;
    if (hour(w.from) && hour(w.to) && w.from < w.to) Object.assign(out.water, { from: w.from, to: w.to });
  }
  for (const k of ['summary', 'morning']) if (s[k]) {
    if (typeof s[k].on === 'boolean') out[k].on = s[k].on;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s[k].time)) out[k].time = s[k].time;
  }
  return out;
}

export function localNow(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: +parts.hour * 60 + +parts.minute };
}

// Which reminders are due for one person at this minute (pure, so it can be tested).
export function dueReminders(person, now) {
  const s = JSON.parse(person.settings), d = JSON.parse(person.data), t = TEXT[s.lang];
  const { date, minutes } = localNow(now, s.tz);
  const out = { messages: [], summaryDate: null, morningDate: null };
  const w = s.water;
  if (w.on && minutes >= w.from * 60 && minutes <= w.to * 60 && (minutes - w.from * 60) % w.every === 0)
    out.messages.push({ title: t.waterTitle, body: t.waterBody, tag: 'water' });
  // 15-minute window so a skipped cron run doesn't lose the day's reminder; last_* columns stop repeats.
  const due = (r, last) => { const [hh, mm] = r.time.split(':').map(Number), at = hh * 60 + mm; return r.on && last !== date && minutes >= at && minutes < at + 15; };
  const today = dayFor(d, date); // the app may not have been opened yet today
  if (due(s.morning, person.last_morning)) {
    out.morningDate = date;
    if (today.carried?.length) out.messages.push({ title: t.morningTitle, body: t.morningBody(today.from, yesterdayOf(date), today.carried.join(', ')), tag: 'morning' });
  }
  if (due(s.summary, person.last_summary)) {
    out.summaryDate = date;
    const left = today.tasks.filter(x => !x.done).map(x => x.text);
    if (left.length) out.messages.push({ title: t.summaryTitle, body: left.join(', '), tag: 'summary' });
  }
  return out;
}

// shortcut: sends one by one inside a single cron run; fine for a family, rework if it grows past ~10 people.
async function sendReminders(env, now) {
  const db = env.DB;
  const { results: people } = await db.prepare('SELECT id, data, settings, last_summary, last_morning FROM people').all();
  for (const person of people) {
    const { messages, summaryDate, morningDate } = dueReminders(person, now);
    if (summaryDate) await db.prepare('UPDATE people SET last_summary = ? WHERE id = ?').bind(summaryDate, person.id).run();
    if (morningDate) await db.prepare('UPDATE people SET last_morning = ? WHERE id = ?').bind(morningDate, person.id).run();
    if (!messages.length) continue;
    const { results: subs } = await db.prepare('SELECT endpoint, sub FROM subs WHERE person_id = ?').bind(person.id).all();
    for (const row of subs) for (const msg of messages) {
      const status = await sendPush(JSON.parse(row.sub), msg, env).catch(() => 0);
      if (status === 404 || status === 410) await db.prepare('DELETE FROM subs WHERE endpoint = ?').bind(row.endpoint).run();
    }
  }
}

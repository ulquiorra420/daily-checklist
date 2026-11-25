// Family checklist server: people + PINs, each person's list, reminder notifications.
import { sendPush } from './push.js';

const ALLOWED_ORIGINS = ['https://ulquiorra420.github.io', 'http://localhost:8765'];
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;
const EVERY_OPTIONS = [15, 30, 45, 60, 90, 120];
const MAX_PLANS = 200; // "For later" tasks waiting for their day, per person
const PLAN_REPEAT = 15;  // minutes between reminders for a "For later" task that isn't ticked off yet (until midnight of its day)
const isDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isTime = x => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
const toMinutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

const TEXT = {
  en: { waterTitle: '💧 Time to drink water', waterBody: 'Have a glass of water.', summaryTitle: '📝 Still to do today', testTitle: 'Notifications are working ✓', testBody: 'You will get your reminders here.',
        morningTitle: '⏩ Moved to today', morningBody: (from, yesterday, list) => `Not finished ${from === yesterday ? 'yesterday' : 'on ' + from}: ${list}`,
        helpNewTitle: name => `📩 Help message from ${name}`, helpSolvedTitle: '✅ Your request was solved',
        helpSolvedBody: 'Please pull down to refresh the app so the changes take effect.',
        planBody: (time, date) => date ? `Was planned for ${date}, ${time}` : `Planned for ${time}`,
        addedBy: name => `Added by ${name}`, stopHint: 'If you have finished this task, tick it in the app to stop receiving these notifications.' },
  vi: { waterTitle: '💧 Đến giờ uống nước rồi', waterBody: 'Uống một cốc nước nhé.', summaryTitle: '📝 Việc chưa làm hôm nay', testTitle: 'Thông báo đã hoạt động ✓', testBody: 'Bạn sẽ nhận nhắc nhở ở đây.',
        morningTitle: '⏩ Đã chuyển sang hôm nay', morningBody: (from, yesterday, list) => `${from === yesterday ? 'Hôm qua' : 'Ngày ' + from} chưa xong: ${list}`,
        helpNewTitle: name => `📩 Tin nhắn trợ giúp từ ${name}`, helpSolvedTitle: '✅ Yêu cầu của bạn đã được giải quyết',
        helpSolvedBody: 'Hãy kéo xuống để làm mới ứng dụng và nhận thay đổi.',
        planBody: (time, date) => date ? `Đã hẹn ngày ${date}, ${time}` : `Hẹn lúc ${time}`,
        addedBy: name => `Thêm bởi ${name}`, stopHint: 'Nếu bạn đã làm xong việc này, hãy đánh dấu ✓ trong ứng dụng để không nhận thông báo này nữa.' },
};

export const defaultSettings = lang => ({
  lang, tz: 'Asia/Ho_Chi_Minh',
  water: { on: true, every: 30, from: 9, to: 23 },
  summary: { on: true, time: '22:30' },
  morning: { on: true, time: '10:00' },
});
// A new person has no days yet; the app adds their first "Drink water" task on first open.
export const starterData = () => ({});

// people.data = { popupShown?: date }; each day is its own row in the days table:
// Day = { tasks: [{ text, done, repeat, time?, plan?, by? }], notes: [text], carried?: [text], from?: date, legacy?: true }
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

  const data = JSON.parse(me.data); // { popupShown }
  if (m === 'GET' && p === '/me') {
    return { id: me.id, name: me.name, isAdmin: !!me.is_admin, settings: JSON.parse(me.settings),
      recent: await recentDays(db, me.id), popupShown: data.popupShown || null, plans: await waitingPlans(db, me.id) };
  }

  // "For later" tasks: wait here until their day, then the app moves them into that day's list.
  // The reminder at their time is sent by the cron job (sendReminders), even if the app is never opened.
  // "For someone else": the same, but put on another person's list (person_id = them, by_id = whoever added it).
  if (m === 'GET' && p === '/plans') return waitingPlans(db, me.id);
  if (m === 'POST' && p === '/plans') {
    const text = String(body.text || '').trim(), { date, time } = body;
    if (!text || text.length > 200 || !isDate(date) || !isTime(time)) throw new HttpError(400, 'bad-plan');
    let target = me.id;
    if (body.for && body.for !== me.id) {
      const them = await db.prepare('SELECT id FROM people WHERE id = ?').bind(String(body.for)).first();
      if (!them) throw new HttpError(404, 'no-person');
      target = them.id;
    }
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM plans WHERE person_id = ? AND added = 0').bind(target).first();
    if (n >= MAX_PLANS) throw new HttpError(400, 'too-many-plans');
    if (await usage(db, target) + bytes(text) > USAGE_LIMIT) throw new HttpError(413, 'storage-full');
    await db.prepare('INSERT INTO plans (person_id, by_id, text, date, time, created) VALUES (?, ?, ?, ?, ?, ?)').bind(target, me.id, text, date, time, Date.now()).run();
    return waitingPlans(db, me.id);
  }
  if (m === 'DELETE' && p === '/plans') { // their own, or one they added for someone else
    await db.prepare('DELETE FROM plans WHERE id = ? AND (person_id = ?2 OR by_id = ?2)').bind(Number(body.id), me.id).run();
    return waitingPlans(db, me.id);
  }
  if (m === 'POST' && p === '/plans/added') { // the app has put these into today's list
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, MAX_PLANS) : [];
    if (ids.length) await db.batch(ids.map(id => db.prepare('UPDATE plans SET added = 1 WHERE id = ? AND person_id = ?').bind(id, me.id)));
    return { ok: true };
  }
  if (m === 'GET' && p === '/usage') return { used: await usage(db, me.id), limit: USAGE_LIMIT };
  if (m === 'PUT' && p === '/day') { // only the newest day can change; older days are the read-only Archive
    const date = String(body.date);
    const { newest } = await db.prepare('SELECT MAX(date) AS newest FROM days WHERE person_id = ?').bind(me.id).first();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (newest && date < newest)) throw new HttpError(400, 'day-is-archived');
    const json = JSON.stringify(cleanDay(body.day));
    const old = await db.prepare('SELECT length(CAST(day AS BLOB)) AS n FROM days WHERE person_id = ? AND date = ?').bind(me.id, date).first();
    if (await usage(db, me.id) - (old?.n || 0) + bytes(json) > USAGE_LIMIT) throw new HttpError(413, 'storage-full');
    await db.prepare('INSERT OR REPLACE INTO days (person_id, date, day) VALUES (?, ?, ?)').bind(me.id, date, json).run();
    return { ok: true };
  }
  if (m === 'PUT' && p === '/popup') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(body.date))
      await db.prepare('UPDATE people SET data = ? WHERE id = ?').bind(JSON.stringify({ ...data, popupShown: body.date }), me.id).run();
    return { ok: true };
  }
  if (m === 'GET' && p === '/archive') {
    const { results } = await db.prepare('SELECT date, day FROM days WHERE person_id = ?').bind(me.id).all();
    return Object.fromEntries(results.map(r => { const day = JSON.parse(r.day);
      return [r.date, { done: day.tasks.filter(t => t.done).length, total: day.tasks.length, notes: day.notes.length }]; }));
  }
  if (m === 'GET' && p === '/archive/day') {
    const row = await db.prepare('SELECT day FROM days WHERE person_id = ? AND date = ?').bind(me.id, new URL(req.url).searchParams.get('date')).first();
    if (!row) throw new HttpError(404, 'no-day');
    return JSON.parse(row.day);
  }

  // Help: anyone can send; only admins read everything and mark messages solved.
  if (m === 'POST' && p === '/help') {
    const text = String(body.text || '').trim();
    if (!text || text.length > 2000) throw new HttpError(400, 'bad-text');
    if (await usage(db, me.id) + bytes(text) > USAGE_LIMIT) throw new HttpError(413, 'storage-full');
    await db.prepare('INSERT INTO help (person_id, text, created) VALUES (?, ?, ?)').bind(me.id, text, Date.now()).run();
    const { results: admins } = await db.prepare('SELECT id, settings FROM people WHERE is_admin = 1').all();
    for (const a of admins) {
      const t = TEXT[JSON.parse(a.settings).lang];
      await notify(env, a.id, { title: t.helpNewTitle(me.name), body: text.slice(0, 180) });
    }
    return { ok: true };
  }
  if (m === 'GET' && p === '/help') {
    const sql = 'SELECT h.id, h.text, h.created, h.solved, p.name FROM help h JOIN people p ON p.id = h.person_id '
      + (me.is_admin ? '' : 'WHERE h.person_id = ? ') + 'ORDER BY h.solved, h.created DESC';
    const stmt = db.prepare(sql);
    const { results } = await (me.is_admin ? stmt : stmt.bind(me.id)).all();
    return results.map(r => ({ ...r, solved: !!r.solved }));
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
      await db.batch(['DELETE FROM subs WHERE person_id = ?', 'DELETE FROM sessions WHERE person_id = ?', 'DELETE FROM days WHERE person_id = ?',
        'DELETE FROM help WHERE person_id = ?', 'DELETE FROM plans WHERE person_id = ?', 'DELETE FROM people WHERE id = ?'].map(sql => db.prepare(sql).bind(id)));
      return { ok: true };
    }
    if (m === 'GET' && p === '/admin/usage') {
      const { results } = await db.prepare('SELECT id FROM people').all();
      return { limit: USAGE_LIMIT, people: Object.fromEntries(await Promise.all(results.map(async r => [r.id, await usage(db, r.id)]))) };
    }
    if (m === 'POST' && p === '/admin/help-solved') { // tick / untick; ticking tells the sender
      const id = Number(body.id), solved = body.solved === true;
      const msg = await db.prepare('SELECT h.person_id, h.solved, p.settings FROM help h JOIN people p ON p.id = h.person_id WHERE h.id = ?').bind(id).first();
      if (!msg) throw new HttpError(404, 'no-message');
      await db.prepare('UPDATE help SET solved = ? WHERE id = ?').bind(solved ? 1 : 0, id).run();
      if (solved && !msg.solved) {
        const t = TEXT[JSON.parse(msg.settings).lang];
        await notify(env, msg.person_id, { title: t.helpSolvedTitle, body: t.helpSolvedBody });
      }
      return { ok: true };
    }
  }
  throw new HttpError(404, 'not-found');
}

// Not exported: Cloudflare only allows functions/handlers as exports from this file.
const USAGE_LIMIT = 5 * 1024 * 1024; // 5 MB per person: their days, Help messages and "For later" tasks
const bytes = s => new TextEncoder().encode(s).length;
async function usage(db, personId) {
  const r = await db.prepare(`SELECT
      (SELECT COALESCE(SUM(length(CAST(day AS BLOB))), 0) FROM days WHERE person_id = ?1) +
      (SELECT COALESCE(SUM(length(CAST(text AS BLOB))), 0) FROM help WHERE person_id = ?1) +
      (SELECT COALESCE(SUM(length(CAST(text AS BLOB))), 0) FROM plans WHERE person_id = ?1 AND added = 0) AS n`).bind(personId).first();
  return r.n;
}
async function recentDays(db, personId) {
  const { results } = await db.prepare('SELECT date, day FROM days WHERE person_id = ? ORDER BY date DESC LIMIT 2').bind(personId).all();
  return Object.fromEntries(results.map(r => [r.date, JSON.parse(r.day)]));
}
// Plans waiting for their day: this person's own ({ by: name } if someone else added it), and ones
// they added for someone else ({ to: name }; shown in their Upcoming so they can cancel, never in their list).
async function waitingPlans(db, personId) {
  const { results } = await db.prepare(`
    SELECT pl.id AS id, pl.text AS text, pl.date AS date, pl.time AS time, b.name AS by_name, NULL AS to_name FROM plans pl
      LEFT JOIN people b ON b.id = pl.by_id AND pl.by_id != pl.person_id
      WHERE pl.person_id = ?1 AND pl.added = 0
    UNION ALL
    SELECT pl.id, pl.text, pl.date, pl.time, NULL, r.name FROM plans pl JOIN people r ON r.id = pl.person_id
      WHERE pl.by_id = ?1 AND pl.person_id != ?1 AND pl.added = 0
    ORDER BY date, time, id`).bind(personId).all();
  return results.map(({ by_name, to_name, ...p }) => ({ ...p, ...(by_name && { by: by_name }), ...(to_name && { to: to_name }) }));
}
async function notify(env, personId, msg) {
  const { results: subs } = await env.DB.prepare('SELECT endpoint, sub FROM subs WHERE person_id = ?').bind(personId).all();
  for (const row of subs) {
    const status = await sendPush(JSON.parse(row.sub), msg, env).catch(e => { console.error('push failed', e); return 0; });
    if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(row.endpoint).run();
  }
}

// The pepper lives only in the server's secret settings, so a copy of the database alone can't be used to guess PINs.
async function hashPin(env, salt, pin) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PIN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function cleanDay(d) {
  const texts = (a, max, len) => Array.isArray(a) && a.length <= max && a.every(x => typeof x === 'string' && x.length <= len);
  if (!d || !Array.isArray(d.tasks) || d.tasks.length > 200
      || !d.tasks.every(t => t && typeof t.text === 'string' && t.text.length <= 200 && typeof t.done === 'boolean' && typeof t.repeat === 'boolean'
        && (t.time === undefined || isTime(t.time)) && (t.plan === undefined || Number.isInteger(t.plan))
        && (t.by === undefined || (typeof t.by === 'string' && t.by.length <= 30)))
      || !texts(d.notes, 100, 5000) || (d.carried !== undefined && !texts(d.carried, 200, 200)) || (d.from !== undefined && !isDate(d.from)))
    throw new HttpError(400, 'bad-data');
  const out = { tasks: d.tasks.map(t => ({ text: t.text, done: t.done, repeat: t.repeat, ...(t.time && { time: t.time }), ...(t.plan !== undefined && { plan: t.plan }), ...(t.by && { by: t.by }) })), notes: d.notes };
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
  if (s.textSize === 'big' || s.textSize === 'standard') out.textSize = s.textSize;
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
    if (isTime(s[k].time)) out[k].time = s[k].time;
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
  const out = { messages: [], summaryDate: null, morningDate: null, waterSlot: null, plansSent: [], planSlots: [] };
  // Water: work out the latest reminder time (e.g. 09:30) and send it if it hasn't been sent yet.
  // A late or skipped cron run (Cloudflare sometimes misses a minute) then catches up instead of losing it.
  const w = s.water, start = w.from * 60, end = w.to * 60;
  if (w.on && minutes >= start) {
    const slot = start + Math.floor((Math.min(minutes, end) - start) / w.every) * w.every;
    const key = `${date} ${hhmm(slot)}`;
    if (minutes - slot < Math.min(15, w.every) && person.last_water !== key) {
      out.waterSlot = key;
      out.messages.push({ title: t.waterTitle, body: t.waterBody, tag: 'water', ttl: w.every * 60 }); // same tag: replaces the last one on the phone
    }
  }
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
  // "For later" tasks: a reminder at their time, then again every 15 minutes until ticked off, but only
  // until 23:59 of that same day (it never rolls over). Like water, a late cron run catches up on the latest one.
  for (const p of person.plans || []) {
    const offset = Math.round((Date.parse(date) - Date.parse(p.date)) / 864e5); // 0 = its day, 1 = the day after
    if (offset < 0) continue;
    const at = toMinutes(p.time), now = minutes + offset * 1440;
    const last = at + Math.floor((1439 - at) / PLAN_REPEAT) * PLAN_REPEAT; // the last reminder of its day
    if (now >= last + PLAN_REPEAT || offset > 1) { out.plansSent.push(p.id); continue; } // its day is over: finished
    if (now < at) continue;
    const slot = at + Math.floor((Math.min(now, last) - at) / PLAN_REPEAT) * PLAN_REPEAT;
    if (now - slot >= PLAN_REPEAT || p.last_slot === slot) continue;
    const task = today.tasks.find(x => x.plan === p.id);
    if (offset === 0 && p.added && (!task || task.done)) continue; // ticked off, or deleted from the list
    out.planSlots.push({ id: p.id, slot });
    const body = [t.planBody(p.time, offset ? p.date : null), p.by_name && t.addedBy(p.by_name)].filter(Boolean).join(' · ');
    out.messages.push({ title: '⏰ ' + p.text, body: slot === at ? body : body + '. ' + t.stopHint,
      tag: 'plan-' + p.id, ttl: PLAN_REPEAT * 60 }); // one tag per task: each repeat replaces the one before
  }
  return out;
}

// shortcut: sends one by one inside a single cron run; fine for a family, rework if it grows past ~10 people.
async function sendReminders(env, now) {
  const db = env.DB;
  const { results: people } = await db.prepare('SELECT id, settings, last_summary, last_morning, last_water FROM people').all();
  const { results: plans } = await db.prepare(`SELECT pl.id, pl.person_id, pl.text, pl.date, pl.time, pl.added, pl.last_slot,
      CASE WHEN pl.by_id != pl.person_id THEN b.name END AS by_name FROM plans pl LEFT JOIN people b ON b.id = pl.by_id WHERE pl.sent = 0`).all();
  for (const person of people) {
    try {
      person.data = JSON.stringify({ days: await recentDays(db, person.id) }); // today + the day before is all reminders need
      person.plans = plans.filter(p => p.person_id === person.id);
      const { messages, summaryDate, morningDate, waterSlot, plansSent, planSlots } = dueReminders(person, now);
      for (const msg of messages) await notify(env, person.id, msg);
      // Recorded after sending: if this run is cut short, the next minute's run sends what was missed.
      const updates = [];
      if (summaryDate) updates.push(db.prepare('UPDATE people SET last_summary = ? WHERE id = ?').bind(summaryDate, person.id));
      if (morningDate) updates.push(db.prepare('UPDATE people SET last_morning = ? WHERE id = ?').bind(morningDate, person.id));
      if (waterSlot) updates.push(db.prepare('UPDATE people SET last_water = ? WHERE id = ?').bind(waterSlot, person.id));
      for (const id of plansSent) updates.push(db.prepare('UPDATE plans SET sent = 1 WHERE id = ?').bind(id));
      for (const { id, slot } of planSlots) updates.push(db.prepare('UPDATE plans SET last_slot = ? WHERE id = ?').bind(slot, id));
      if (updates.length) await db.batch(updates);
    } catch (e) { console.error('reminders failed for', person.id, e); } // one person's problem must not stop everyone else's reminders
  }
}

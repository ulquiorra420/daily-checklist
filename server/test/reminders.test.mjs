// Self-check for days/rollover, reminder timing, time zones and input cleaning.
import assert from 'node:assert';
import { dueReminders, defaultSettings, cleanSettings, cleanDay, localNow, newDay, fromOldFormat } from '../index.js';

const T = (text, done = false, repeat = false) => ({ text, done, repeat });
const person = (lang, tz, data, extra = {}, last = {}) =>
  ({ settings: JSON.stringify({ ...defaultSettings(lang), tz, ...extra }), data: JSON.stringify(data), last_summary: null, last_morning: null, ...last });
const at = iso => new Date(iso);
const tags = r => r.messages.map(m => m.tag);
const msg = (r, tag) => r.messages.find(m => m.tag === tag);

// ---- rollover at midnight ----
const days = { '2026-11-24': { tasks: [T('Buy rice', true), T('Call bank'), T('Drink water', true, true), T('Exercise', false, true)], notes: ['busy day'] } };
const d25 = newDay(days, '2026-11-25');
assert.deepStrictEqual(d25.tasks, [T('Call bank'), T('Drink water', false, true), T('Exercise', false, true)]); // finished one-time task archived; repeat comes back unticked
assert.deepStrictEqual(d25.carried, ['Call bank', 'Exercise']); // every unfinished task, including repeat-daily
assert.strictEqual(d25.from, '2026-11-24');
assert.deepStrictEqual(d25.notes, []); // notes stay with their own day
assert.strictEqual(newDay({ ...days, '2026-11-25': { tasks: [], notes: [] } }, '2026-11-27').from, '2026-11-25'); // skipped days roll from the latest day
assert.deepStrictEqual(newDay({}, '2026-11-24'), { tasks: [], notes: [], carried: [] });

// ---- converting the old format ----
const conv = fromOldFormat({ tasks: ['A', 'B'], done: { '2026-11-22': ['A', 'Old'], '2026-11-23': [], '2026-11-24': ['B'] } }, '2026-11-24');
assert.deepStrictEqual(conv.days['2026-11-22'], { tasks: [T('A', true, true), T('Old', true, true)], notes: [], legacy: true });
assert.ok(!conv.days['2026-11-23']); // nothing finished that day -> nothing recorded
assert.deepStrictEqual(conv.days['2026-11-24'].tasks, [T('A', false, true), T('B', true, true)]);

// ---- reminders (Vietnam UTC+7) ----
const vnData = { days: { '2026-11-23': { tasks: [T('Tập thể dục'), T('Uống nước', true, true)], notes: [] } } };
const vn = person('vi', 'Asia/Ho_Chi_Minh', vnData);
assert.deepStrictEqual(tags(dueReminders(vn, at('2026-11-24T02:00:00Z'))), ['water']);   // 09:00
assert.deepStrictEqual(tags(dueReminders(vn, at('2026-11-24T02:15:00Z'))), []);          // 09:15
assert.deepStrictEqual(tags(dueReminders(vn, at('2026-11-24T16:30:00Z'))), []);          // 23:30
// 10:00 morning: the app hasn't been opened today, so the server works out the rollover itself
const m = dueReminders(vn, at('2026-11-24T03:00:00Z'));
assert.deepStrictEqual(tags(m), ['water', 'morning']);
assert.strictEqual(msg(m, 'morning').body, 'Hôm qua chưa xong: Tập thể dục');
assert.strictEqual(m.morningDate, '2026-11-24');
assert.deepStrictEqual(tags(dueReminders(person('vi', 'Asia/Ho_Chi_Minh', vnData, {}, { last_morning: '2026-11-24', last_water: '2026-11-24 10:00' }), at('2026-11-24T03:05:00Z'))), []); // not twice
// nothing unfinished yesterday -> no morning message, but the day is marked handled
const clean = dueReminders(person('en', 'Asia/Ho_Chi_Minh', { days: { '2026-11-23': { tasks: [T('A', true)], notes: [] } } }), at('2026-11-24T03:00:00Z'));
assert.ok(!tags(clean).includes('morning')); assert.strictEqual(clean.morningDate, '2026-11-24');
// English, rolled over from an older day
const en = dueReminders(person('en', 'Asia/Ho_Chi_Minh', { days: { '2026-11-20': { tasks: [T('Pay rent')], notes: [] } } }), at('2026-11-24T03:00:00Z'));
assert.strictEqual(msg(en, 'morning').body, 'Not finished on 2026-11-20: Pay rent');

// 22:30 summary uses today's list (as saved by the app)
const tonight = person('vi', 'Asia/Ho_Chi_Minh', { days: { '2026-11-24': { tasks: [T('Tập thể dục'), T('Uống nước', true, true)], notes: [] } } });
const s = dueReminders(tonight, at('2026-11-24T15:30:00Z'));
assert.strictEqual(msg(s, 'summary').body, 'Tập thể dục');
assert.strictEqual(msg(s, 'summary').title, '📝 Việc chưa làm hôm nay');
assert.ok(tags(dueReminders(tonight, at('2026-11-24T15:40:00Z'))).includes('summary')); // late cron run still sends

// Other time zone: New York 10:00 (UTC-5) = 15:00 UTC
const ny = person('en', 'America/New_York', { days: { '2026-11-23': { tasks: [T('X')], notes: [] } } });
assert.ok(tags(dueReminders(ny, at('2026-11-24T15:00:00Z'))).includes('morning'));
assert.strictEqual(localNow(at('2026-11-24T03:00:00Z'), 'America/New_York').date, '2026-11-23');
// Morning reminder off / moved to 08:30
assert.ok(!tags(dueReminders(person('vi', 'Asia/Ho_Chi_Minh', vnData, { morning: { on: false, time: '10:00' } }), at('2026-11-24T03:00:00Z'))).includes('morning'));
assert.ok(tags(dueReminders(person('vi', 'Asia/Ho_Chi_Minh', vnData, { morning: { on: true, time: '08:30' } }), at('2026-11-24T01:30:00Z'))).includes('morning'));

// ---- settings cleaning ----
const base = defaultSettings('en');
const cleaned = cleanSettings({ lang: 'fr', tz: 'Not/AZone', water: { every: 7, from: 22, to: 8 }, summary: { time: '25:00', on: false }, morning: { time: '9am' } }, base);
assert.deepStrictEqual({ ...cleaned, summary: { ...cleaned.summary, on: true } }, base);
assert.strictEqual(cleanSettings({ morning: { on: false, time: '07:15' } }, base).morning.time, '07:15');

// ---- day cleaning ----
assert.throws(() => cleanDay({ tasks: ['plain string'], notes: [] }));
assert.throws(() => cleanDay({ tasks: [T('a')], notes: 'x' }));
assert.throws(() => cleanDay({ tasks: [{ text: 'a', done: 'yes', repeat: false }], notes: [] }));
assert.deepStrictEqual(cleanDay({ tasks: [{ ...T('a'), extra: 1 }], notes: ['n'], carried: ['a'], from: '2026-11-23', junk: 1 }),
  { tasks: [T('a')], notes: ['n'], carried: ['a'], from: '2026-11-23' });

// ---- water: a late or skipped cron run catches up, but never sends the same reminder twice ----
const w = dueReminders(vn, at('2026-11-24T02:33:00Z'));                     // 09:33, cron missed 09:30..09:32
assert.deepStrictEqual(tags(w), ['water']); assert.strictEqual(w.waterSlot, '2026-11-24 09:30');
assert.strictEqual(msg(w, 'water').ttl, 30 * 60);                            // stale after the next one is due
assert.deepStrictEqual(tags(dueReminders(person('vi', 'Asia/Ho_Chi_Minh', vnData, {}, { last_water: '2026-11-24 09:30' }), at('2026-11-24T02:34:00Z'))), []); // already sent
assert.deepStrictEqual(tags(dueReminders(person('vi', 'Asia/Ho_Chi_Minh', vnData, {}, { last_water: '2026-11-23 23:00' }), at('2026-11-24T02:00:00Z'))), ['water']); // yesterday's doesn't block today
assert.deepStrictEqual(tags(dueReminders(vn, at('2026-11-24T16:05:00Z'))), ['water']); // 23:05: the 23:00 one, if it was missed
assert.deepStrictEqual(tags(dueReminders(vn, at('2026-11-24T01:59:00Z'))), []);         // 08:59: not started yet
// every slot from 09:00 to 23:00 (29 of them) is sent exactly once, even with a random cron minute missing each hour
{
  let p = person('en', 'Asia/Ho_Chi_Minh', vnData), sent = [];
  for (let m = 8 * 60; m <= 24 * 60 - 1; m++) {
    if (m % 60 === 17 || m % 60 === 30) continue; // skipped runs, including exactly on :30
    const r = dueReminders(p, new Date(Date.parse('2026-11-24T00:00:00+07:00') + m * 60e3));
    if (r.waterSlot) { sent.push(r.waterSlot.slice(11)); p = { ...p, last_water: r.waterSlot }; }
  }
  assert.strictEqual(sent.length, 29); assert.strictEqual(sent[0], '09:00'); assert.strictEqual(sent.at(-1), '23:00');
}

// ---- "For later" tasks ----
const plan = (id, date, time, extra = {}) => ({ id, text: 'Dentist', date, time, added: 0, ...extra });
const withPlans = (plans, data = vnData) => ({ ...person('en', 'Asia/Ho_Chi_Minh', data, { water: { on: false, every: 30, from: 9, to: 23 } }), plans });
assert.deepStrictEqual(dueReminders(withPlans([plan(1, '2026-11-24', '15:00')]), at('2026-11-24T07:59:00Z')).plansSent, []); // 14:59
const pl = dueReminders(withPlans([plan(1, '2026-11-24', '15:00'), plan(2, '2026-11-25', '15:00')]), at('2026-11-24T08:00:00Z')); // 15:00
assert.deepStrictEqual(pl.plansSent, [1]);
assert.strictEqual(msg(pl, 'plan').title, '⏰ Dentist'); assert.strictEqual(msg(pl, 'plan').body, 'Planned for 15:00');
assert.deepStrictEqual(dueReminders(withPlans([plan(1, '2026-11-24', '15:00')]), at('2026-11-24T08:07:00Z')).plansSent, [1]); // late run still sends
assert.strictEqual(msg(dueReminders(withPlans([plan(1, '2026-11-23', '23:59')]), at('2026-11-24T02:00:00Z')), 'plan').body, 'Was planned for 2026-11-23, 23:59');
// already in today's list: ticked off or deleted -> no reminder; still unticked -> reminder
const day24 = tasks => ({ days: { '2026-11-24': { tasks, notes: [] } } });
const added = plan(1, '2026-11-24', '15:00', { added: 1 });
assert.deepStrictEqual(tags(dueReminders(withPlans([added], day24([{ ...T('Dentist', true), time: '15:00', plan: 1 }])), at('2026-11-24T08:00:00Z'))), []);
assert.deepStrictEqual(tags(dueReminders(withPlans([added], day24([])), at('2026-11-24T08:00:00Z'))), []);
const still = dueReminders(withPlans([added], day24([{ ...T('Dentist'), time: '15:00', plan: 1 }])), at('2026-11-24T08:00:00Z'));
assert.deepStrictEqual(tags(still), ['plan']); assert.deepStrictEqual(still.plansSent, [1]);
// Vietnamese
assert.strictEqual(msg(dueReminders({ ...withPlans([plan(1, '2026-11-24', '15:00')]), settings: JSON.stringify({ ...defaultSettings('vi'), water: { on: false, every: 30, from: 9, to: 23 } }) }, at('2026-11-24T08:00:00Z')), 'plan').body, 'Hẹn lúc 15:00');
// timed tasks keep their time and plan id; a bad time is refused
assert.deepStrictEqual(cleanDay({ tasks: [{ ...T('a'), time: '15:00', plan: 3 }], notes: [] }).tasks, [{ ...T('a'), time: '15:00', plan: 3 }]);
assert.throws(() => cleanDay({ tasks: [{ ...T('a'), time: '3pm' }], notes: [] }));
// the next day the carried task is a plain task again
assert.deepStrictEqual(newDay({ '2026-11-24': { tasks: [{ ...T('Dentist'), time: '15:00', plan: 1 }], notes: [] } }, '2026-11-25').tasks, [T('Dentist')]);

console.log('reminders + days OK');

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
assert.deepStrictEqual(tags(dueReminders(person('vi', 'Asia/Ho_Chi_Minh', vnData, {}, { last_morning: '2026-11-24' }), at('2026-11-24T03:05:00Z'))), []); // not twice
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

console.log('reminders + days OK');

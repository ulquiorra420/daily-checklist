// Self-check for reminder timing, time zones and input cleaning.
import assert from 'node:assert';
import { dueReminders, defaultSettings, cleanSettings, cleanData, localNow } from '../index.js';

const person = (lang, tz, data, extra = {}) => ({ settings: JSON.stringify({ ...defaultSettings(lang), tz, ...extra }), data: JSON.stringify(data), last_summary: null });
const at = iso => new Date(iso);
const titles = r => r.messages.map(m => m.tag);

// Vietnam (UTC+7): 09:00 local = 02:00 UTC
const vn = person('vi', 'Asia/Ho_Chi_Minh', { tasks: ['Uống nước', 'Tập thể dục'], done: { '2026-11-24': ['Uống nước'] } });
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T02:00:00Z'))), ['water']);     // 09:00 first reminder
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T02:30:00Z'))), ['water']);     // 09:30
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T02:15:00Z'))), []);            // 09:15 not on the 30-min grid
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T01:30:00Z'))), []);            // 08:30 before window
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T16:00:00Z'))), ['water']);     // 23:00 last one
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T16:30:00Z'))), []);            // 23:30 after window

// 22:30 summary lists only unfinished tasks, in Vietnamese
const s = dueReminders(vn, at('2026-11-24T15:30:00Z'));
assert.deepStrictEqual(titles(s), ['water', 'summary']); // 22:30 is also on the water grid
assert.strictEqual(s.messages[1].body, 'Tập thể dục');
assert.strictEqual(s.messages[1].title, '📝 Việc chưa làm hôm nay');
assert.strictEqual(s.summaryDate, '2026-11-24');
assert.deepStrictEqual(titles(dueReminders({ ...vn, last_summary: '2026-11-24' }, at('2026-11-24T15:35:00Z'))), []); // not twice
assert.deepStrictEqual(titles(dueReminders(vn, at('2026-11-24T15:40:00Z'))), ['summary']); // late cron run still sends

// Everything done -> no summary message, but the day is marked as handled
const allDone = person('en', 'Asia/Ho_Chi_Minh', { tasks: ['A'], done: { '2026-11-24': ['A'] } });
const r = dueReminders(allDone, at('2026-11-24T15:30:00Z'));
assert.ok(!titles(r).includes('summary')); assert.strictEqual(r.summaryDate, '2026-11-24');

// A different time zone: New York 09:00 (UTC-5 in November) = 14:00 UTC
const ny = person('en', 'America/New_York', { tasks: [], done: {} });
assert.deepStrictEqual(titles(dueReminders(ny, at('2026-11-24T14:00:00Z'))), ['water']);
assert.strictEqual(localNow(at('2026-11-24T03:00:00Z'), 'America/New_York').date, '2026-11-23');

// Custom settings: every 60 min, 7–20h, water off/on
const custom = person('en', 'Asia/Ho_Chi_Minh', { tasks: [], done: {} }, { water: { on: true, every: 60, from: 7, to: 20 } });
assert.deepStrictEqual(titles(dueReminders(custom, at('2026-11-24T00:00:00Z'))), ['water']); // 07:00
assert.deepStrictEqual(titles(dueReminders(custom, at('2026-11-24T00:30:00Z'))), []);        // 07:30
const off = person('en', 'Asia/Ho_Chi_Minh', { tasks: [], done: {} }, { water: { on: false, every: 30, from: 9, to: 23 } });
assert.deepStrictEqual(titles(dueReminders(off, at('2026-11-24T02:00:00Z'))), []);

// Settings cleaning rejects bad values and keeps the old ones
const base = defaultSettings('en');
const cleaned = cleanSettings({ lang: 'fr', tz: 'Not/AZone', water: { every: 7, from: 22, to: 8 }, summary: { time: '25:00', on: false } }, base);
assert.deepStrictEqual({ ...cleaned, summary: { ...cleaned.summary, on: true } }, base);
assert.strictEqual(cleaned.summary.on, false);
assert.strictEqual(cleanSettings({ tz: 'Europe/London', water: { every: 45 } }, base).water.every, 45);

// Data cleaning
assert.throws(() => cleanData({ tasks: 'x', done: {} }));
assert.throws(() => cleanData({ tasks: [], done: { 'not-a-date': [] } }));
assert.deepStrictEqual(cleanData({ tasks: ['a'], done: { '2026-11-24': ['a'] }, extra: 1 }), { tasks: ['a'], done: { '2026-11-24': ['a'] } });

console.log('reminders OK');

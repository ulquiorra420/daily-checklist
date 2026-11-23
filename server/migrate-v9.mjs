// One-time move to version 9 (days + notes). Usage:
//   wrangler d1 execute daily-checklist --remote --json --command "SELECT id, data, settings FROM people" > people.json
//   node migrate-v9.mjs people.json migrate.sql && wrangler d1 execute daily-checklist --remote --file migrate.sql
import fs from 'node:fs';
import { fromOldFormat, localNow } from './index.js';

const [, , inFile, outFile] = process.argv;
const rows = JSON.parse(fs.readFileSync(inFile, 'utf8'))[0].results;
const q = s => "'" + s.replace(/'/g, "''") + "'";
const sql = ['ALTER TABLE people ADD COLUMN last_morning TEXT;'];
for (const r of rows) {
  const data = JSON.parse(r.data), settings = JSON.parse(r.settings);
  if (data.days) continue; // already moved
  const newData = fromOldFormat(data, localNow(new Date(), settings.tz).date);
  settings.morning ??= { on: true, time: '10:00' };
  sql.push(`UPDATE people SET data = ${q(JSON.stringify(newData))}, settings = ${q(JSON.stringify(settings))} WHERE id = ${q(r.id)};`);
  console.log(r.id, '→', Object.keys(newData.days).length, 'day(s)');
}
fs.writeFileSync(outFile, sql.join('\n') + '\n');

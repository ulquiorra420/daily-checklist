// One-time move to version 10: each day becomes its own row; adds the Help table.
// Optional third argument: JSON {date: Day} that replaces dannyle's old "finished only" days
// (rebuilt from the Gist revision history).
//   wrangler d1 execute daily-checklist --remote --json --command "SELECT id, data FROM people" > people.json
//   node migrate-v10.mjs people.json migrate.sql [rebuilt.json] && wrangler d1 execute daily-checklist --remote --file migrate.sql
import fs from 'node:fs';
import { cleanDay } from './index.js';

const [, , inFile, outFile, rebuiltFile] = process.argv;
const rows = JSON.parse(fs.readFileSync(inFile, 'utf8'))[0].results;
const rebuilt = rebuiltFile ? JSON.parse(fs.readFileSync(rebuiltFile, 'utf8')) : {};
const q = s => "'" + s.replace(/'/g, "''") + "'";
const sql = [
  'CREATE TABLE IF NOT EXISTS days (person_id TEXT NOT NULL, date TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (person_id, date));',
  'CREATE TABLE IF NOT EXISTS help (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, solved INTEGER NOT NULL DEFAULT 0);',
];
for (const r of rows) {
  const data = JSON.parse(r.data);
  if (!data.days) continue; // already moved
  const days = { ...data.days };
  if (r.id === 'dannyle') for (const [d, day] of Object.entries(rebuilt)) if (days[d]?.legacy) days[d] = day;
  for (const [d, day] of Object.entries(days))
    sql.push(`INSERT OR REPLACE INTO days (person_id, date, day) VALUES (${q(r.id)}, ${q(d)}, ${q(JSON.stringify(cleanDay(day)))});`);
  sql.push(`UPDATE people SET data = ${q(JSON.stringify(data.popupShown ? { popupShown: data.popupShown } : {}))} WHERE id = ${q(r.id)};`);
  console.log(r.id, '→', Object.keys(days).length, 'day(s)', r.id === 'dannyle' ? `(rebuilt: ${Object.keys(rebuilt).filter(d => data.days[d]?.legacy).join(', ') || 'none'})` : '');
}
fs.writeFileSync(outFile, sql.join('\n') + '\n');

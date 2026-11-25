CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  pin_hash TEXT,               -- NULL = person chooses a PIN the first time they open their profile
  salt TEXT,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,          -- {"popupShown":date}
  settings TEXT NOT NULL,      -- {"lang","tz","water":{on,every,from,to},"summary":{on,time},"morning":{on,time}}
  last_summary TEXT,           -- local date the 'still to do' reminder was last sent
  last_morning TEXT,           -- local date the 10am 'moved to today' reminder was last sent
  last_water TEXT              -- local 'YYYY-MM-DD HH:MM' of the last water reminder sent (so a late cron run catches up once)
);
-- One row per person per day (keeps each row far below D1's 2 MB limit).
CREATE TABLE IF NOT EXISTS days (
  person_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD in the person's time zone
  day TEXT NOT NULL,           -- {"tasks":[{text,done,repeat,time?,plan?}],"notes":[...],"carried":[...],"from":date}
  PRIMARY KEY (person_id, date)
);
CREATE TABLE IF NOT EXISTS help (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created INTEGER NOT NULL,
  solved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  sub TEXT NOT NULL
);
-- "For later" tasks: a reminder at date + time (person's time zone); on that day the app moves it into the list.
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  text TEXT NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  time TEXT NOT NULL,          -- HH:MM
  created INTEGER NOT NULL,
  added INTEGER NOT NULL DEFAULT 0, -- 1 = the app has put it into that day's list
  sent INTEGER NOT NULL DEFAULT 0,  -- 1 = finished: its day is over, no more reminders
  last_slot INTEGER                 -- minutes after midnight of the last reminder sent (first one, then every 15 min)
);

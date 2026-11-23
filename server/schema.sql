CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  pin_hash TEXT,               -- NULL = person chooses a PIN the first time they open their profile
  salt TEXT,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,          -- {"days":{"YYYY-MM-DD":{tasks:[{text,done,repeat}],notes:[...]}},"popupShown":date}
  settings TEXT NOT NULL,      -- {"lang","tz","water":{on,every,from,to},"summary":{on,time},"morning":{on,time}}
  last_summary TEXT,           -- local date the 'still to do' reminder was last sent
  last_morning TEXT            -- local date the 10am 'moved to today' reminder was last sent
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

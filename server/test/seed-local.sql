-- Fake people for the LOCAL test database only (no PINs set; each tester picks one).
INSERT OR REPLACE INTO people (id, name, sort, is_admin, data, settings) VALUES
 ('xuantrung', 'xuantrung', 1, 0, '{}', '{"lang":"vi","tz":"Asia/Ho_Chi_Minh","water":{"on":true,"every":30,"from":9,"to":23},"summary":{"on":true,"time":"22:30"},"morning":{"on":true,"time":"10:00"}}'),
 ('binhminh',  'binhminh',  2, 0, '{}', '{"lang":"vi","tz":"Asia/Ho_Chi_Minh","water":{"on":true,"every":30,"from":9,"to":23},"summary":{"on":true,"time":"22:30"},"morning":{"on":true,"time":"10:00"}}'),
 ('dannyle',   'dannyle',   3, 1, '{}', '{"lang":"en","tz":"Asia/Ho_Chi_Minh","water":{"on":true,"every":30,"from":9,"to":23},"summary":{"on":true,"time":"22:30"},"morning":{"on":true,"time":"10:00"}}'),
 ('sushi',     'sushi',     4, 0, '{}', '{"lang":"en","tz":"Asia/Ho_Chi_Minh","water":{"on":true,"every":30,"from":9,"to":23},"summary":{"on":true,"time":"22:30"},"morning":{"on":true,"time":"10:00"}}');
-- A finished past day with an unfinished task, so the Archive and the "moved to today" pop-up have something to show.
INSERT OR REPLACE INTO days (person_id, date, day) VALUES
 ('dannyle', '2026-11-20', '{"tasks":[{"text":"Drink water","done":true,"repeat":true},{"text":"Call the bank","done":false,"repeat":false},{"text":"Buy rice","done":true,"repeat":false}],"notes":["Sample note"]}');

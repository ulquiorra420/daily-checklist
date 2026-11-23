# Daily Checklist — notes for Claude

A family to-do/habit app. Single-page web app on GitHub Pages + a Cloudflare Worker server.
Read this whole file before changing anything.

## The owner (dannyle, GitHub `ulquiorra420`)
- New to coding and GitHub. Explain in plain words, step by step, and **slowly** when they ask.
- **Run git/gh/wrangler commands for them**; typing into the Terminal panel did not work for them.
- Ask before changing behaviour they didn't ask for; they like being asked clarifying questions (AskUserQuestion) before big features.
- They test on real iPhones (Home Screen web app) and report back. Say clearly what was and wasn't tested on a real phone.
- Never publish anything without testing on the local test server first.

## Where things live
| What | Where |
|---|---|
| App (what phones load) | `index.html`, `sw.js` → https://ulquiorra420.github.io/daily-checklist/ (GitHub Pages serves the **main** branch) |
| Server | `server/` → Cloudflare Worker `daily-checklist` at https://daily-checklist.danganhle99.workers.dev, D1 database `daily-checklist`, cron every minute |
| Cloudflare account | the owner's; Mac is signed in with `npx wrangler login` (if expired: run it in the background with `--browser=false`, give them the link, they click Allow) |
| GitHub | Mac is signed in with `gh` (account ulquiorra420) |
| Secrets | `VAPID_PRIVATE_JWK`, `PIN_PEPPER` only in Cloudflare secrets and git-ignored `server/.dev.vars`. **Never** commit or print them. |
| Data backups | `../backups/` (outside the repo, never push — contains PIN hashes) |

The owner wanted the workers.dev name `dannyftsushi`, but the account already had `danganhle99`. Changing it means changing `API` in `index.html` (and releasing a new version).

## People (Family)
| id / name | who | language |
|---|---|---|
| xuantrung | Dad | vi |
| binhminh | Mom | vi |
| dannyle | the owner, **admin** (`is_admin = 1`) | en |
| sushi | owner's partner | en |
New people are added in-app (Settings → Family (admin)). Each person picks their own 4-digit PIN the first time; admin can Reset PIN / Remove. PINs are stored as HMAC(pepper, salt:pin) — nobody can read them.

## How the app works (version 10)
- "Who are you?" → PIN → **Today**. ☰ or swipe right from the left edge opens **The Bar**: Settings, Archive, Usage, Help.
- **Days**: each day is a row in D1 `days(person_id, date, day JSON)`. `Day = {tasks:[{text,done,repeat}], notes:[...], carried?, from?, legacy?}`.
- **Midnight rollover** (person's own time zone): finished one-time tasks stay in that day (Archive, read-only); unfinished + 🔁 repeat-daily tasks move to the new day unticked. `newDay()` exists in **both** `index.html` and `server/index.js` — keep them identical.
- Only the newest day can be edited (`PUT /day` rejects older dates). Notes can be edited/deleted the same day only.
- "Not finished yesterday" pop-up on first open each day; also a push at 10:00 (setting "Morning reminder").
- Reminders (per person, own time zone, all editable in Settings): water every 30 min 9–23h, morning 10:00, "still to do" 22:30.
- **Usage**: 5 MB per person (their days + Help text); saves are blocked when full.
- **Help**: anyone sends; admin gets a push, sees all, ticks solved → sender gets a push. Senders see only their own messages.
- Notifications: Web Push from the Worker (`server/push.js`, own RFC 8291/VAPID code, tested against `http_ece`). Users must open the app from the Home Screen icon and tap Settings → Turn on notifications.
- Old history: Nov 22–23 were rebuilt from the retired Gist's revision history; Nov 21 is lost. The old GitHub-Gist sync (v4–v6) is retired.

## Releasing a change — always in this order
0. Check `git branch --show-current`. These notes were added on branch `docs/claude-handoff-notes`; the live app only updates from **main**, so switch to main (merging these notes if they aren't there yet) before releasing.
1. **Bump `const VERSION = N`** in `index.html` on every app release. Installed iPhone apps compare it with the live page and reload themselves; without the bump phones never update.
2. Test locally (below). Server unit tests: `cd server && node test/reminders.test.mjs && node test/push.test.mjs`.
3. Server change: `cd server && npx wrangler deploy`. A data-format change needs a migration script (see `migrate-v9.mjs`, `migrate-v10.mjs`) and a backup first: `npx wrangler d1 export daily-checklist --remote --output ../../backups/backup-<date>.sql`.
   The server must stay compatible with the app version currently on phones until they update.
4. App change: commit on **main** and `git push`; GitHub Pages is live ~1 min later (`curl` the page and grep `const VERSION = N` to confirm).
5. `server/index.js` may only **export functions** — exporting a constant crashes the Worker at startup.

## Local testing (never test against the real server)
- `.claude/launch.json` has `checklist` (app on http://localhost:8765) and `server` (`wrangler dev` on :8787 with a **local** D1). The owner's chats usually start in the parent folder `Documents/DAILY-TASKS`, which has its own `.claude/launch.json` with the same two entries. When the app runs on `localhost` it automatically talks to `localhost:8787`.
- Fresh local database: `cd server && npx wrangler d1 execute daily-checklist --local --file schema.sql && npx wrangler d1 execute daily-checklist --local --file test/seed-local.sql`.
- Use the preview at mobile size (375×812). The test tool's `type` sends all characters at once, so type PINs 4 digits per action.
- `wrangler dev --test-scheduled` lets you run the reminder job: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.
- The preview pane blocks `confirm()` and notification permission — real notifications can only be checked on an iPhone.

## Limits / ideas not done
- Free Cloudflare plan: comfortable for ~10–15 people; reminders are sent one by one each minute (`sendReminders`).
- Ideas the owner may ask for: "Set PIN for…" (admin sets someone's PIN), proper app icon, streaks, changing the workers.dev name.

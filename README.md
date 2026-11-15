# Cadence

A calm planner for one person. Tasks, projects, goals, focus and reviews in one quiet place, kept in **your own Google Drive**.

- **No server.** Cadence is plain files on GitHub Pages and runs entirely in your browser.
- **Your data, your Drive.** Everything lives on your device (it works offline) and in a `Cadence` folder in your Google Drive. Cadence can only see the files it made.
- **Your AI.** Bring your own free Gemini key; calls go straight from your device to Google.

Live: https://peteradepoju.github.io/cadence/

## What's in it

| Area | What you get |
| --- | --- |
| Capture | Quick add anywhere (`Q`), natural language: `call mum fri 6pm #family !2 /Home every week for 30m`; paste several lines for several tasks; **Smart** capture with AI for looser sentences |
| Tasks | Inbox, projects, subtasks (nested), tags, four priorities, due dates and times, durations, repeats (daily, weekly on days, monthly by date or "2nd Tuesday", yearly, every N, after done, until), notes, files, reminders, energy level, links to goals |
| Views | Today (overdue, today, time blocks, "could do today"), Inbox, Upcoming (two weeks, with repeat previews), project list or **board** (your own columns), tags, completed, search (`⌘K`) |
| Calendar | Month, week and day; drag tasks between days; **time blocking**: drag tasks onto times, move and resize blocks; your Google calendars alongside (optional) |
| Goals | Year → quarter → month → week, nested; progress from linked tasks and smaller goals, or by hand; AI suggests steps |
| Focus | Pomodoro timer tied to a task, keeps running across pages, logs time to the task, weekly chart |
| Reviews | End of day: what got done, carry the rest forward (or drop the date), energy, notes, AI reflection. Weekly: numbers, where the work went, slipped tasks, AI write-up, then plan the week |
| Planning | Plan the week by hand or with AI (deadlines, priorities, your energy pattern, calendar); AI "plan my day" into time blocks; AI "break it down" into subtasks |
| Sync | Every device syncs through Drive, **field by field**: edits on two devices at once are both kept |
| Google Tasks | Two-way: Inbox ↔ My Tasks, each project ↔ a list; lists made in Google become projects |
| Google Calendar | A `Cadence` calendar gets timed tasks, reminders and time blocks, so your phone alerts you when Cadence is closed. Moving or deleting there comes back |
| Other apps | `…/cadence/add?title=…` adds a task from anywhere (Lumen, Selah, a bookmarklet); share to Cadence on phones |
| Bring and take | Import from Selah, Todoist (CSV) and Google Tasks; export a backup, readable JSON, CSV or `.ics` |
| Everywhere | Installs as an app on phone and desktop, works offline, light and dark, keyboard shortcuts (`?`) |

## How sync works

Each device keeps its own file in `Cadence/sync/` in your Drive and reads the others. Only one device ever writes a given file, so devices can't overwrite each other. Every field of every record carries a timestamp (a hybrid logical clock), and merging keeps the newest value of each field, so ticking a task off on your phone while renaming it on your laptop keeps both. Deletes are remembered, so nothing deleted comes back from an older copy. Google Tasks and Google Calendar edits join in as if they were another device, stamped with the time Google says they happened. See [src/lib/crdt.ts](src/lib/crdt.ts), [src/lib/sync.ts](src/lib/sync.ts), [src/lib/gtasks.ts](src/lib/gtasks.ts) and [src/lib/gcal.ts](src/lib/gcal.ts); [src/lib/sync.test.ts](src/lib/sync.test.ts) runs two devices against a fake Drive and Google Tasks.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173/cadence/
npm test
npm run build      # dist/, ready for GitHub Pages
```

Without a Google client ID, Cadence runs in device-only mode. To connect Google, see [SETUP.md](SETUP.md).

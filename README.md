# Interval Timer

A simple interval timer for workouts that runs in the browser and can be installed on an Android phone as an app (PWA). No server, no account, works offline. Everything is stored locally on the device.

**Live:** https://alexjaw.github.io/interval-timer/ (once GitHub Pages is enabled, see below)

## Features

- **Simple mode:** sets, get ready, time per set, rest, cool down. Rest only happens *between* sets, so 30 × 0:55 with 0:05 rest and 0:15 get ready = 30:10.
- **Advanced mode:** your own list of intervals (name, work/rest, time) repeated for N rounds, with optional rest between rounds, get ready and cool down.
- **Running screen:** large countdown, colour per phase (get ready = amber, work = green, rest = red, cool down = blue), set/round counter, what's next, total progress. Tap the time to pause. Buttons for previous, pause, next and stop.
- **Sound:** countdown beeps for the last 1–5 seconds and a tone when a phase changes. The beeps are scheduled on the Web Audio clock, so they stay on time even if the browser slows down JavaScript.
- **Optional voice cues** ("Work", "Rest") and vibration.
- **Keeps the screen on** during a workout (Screen Wake Lock).
- **Saved workouts:** save the current setup by name, load it again, or start it straight from the list.
- **Stats:** workouts and minutes this week, this month and all time, a 14-day bar chart, and a history list (completed or stopped).
- **Backup:** export and import everything as JSON from Settings.

## Install on Android

1. Open the live URL in Chrome.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. It now opens full screen and works without a network connection.

Tip: keep the screen on (the default) during a workout. If the screen locks, Android may pause the page and the timer catches up when you return.

## Enable GitHub Pages

Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save. The site appears at `https://alexjaw.github.io/interval-timer/` after a minute or so.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup for all views |
| `style.css` | Dark theme styling |
| `app.js` | Editor, timer engine, audio, saved workouts, stats, settings |
| `sw.js` | Service worker for offline use (bump `CACHE` when you change files) |
| `manifest.webmanifest` | PWA metadata and icons |
| `icons/` | App icons |

## Data

Stored in `localStorage` under the keys `it.current`, `it.presets`, `it.history` and `it.settings`. Clearing the browser's site data deletes it, so export a backup now and then.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

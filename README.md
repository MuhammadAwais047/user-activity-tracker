# trace — User Activity Tracker

A self-instrumenting activity dashboard. Every tab you open, filter you touch, search you type, and export you run is captured and analyzed — **100% locally in your browser**. No server, no accounts, no data leaves the device.

![Live demo](https://img.shields.io/badge/live-demo-5eead4) ![License](https://img.shields.io/badge/license-MIT-8b9aab)

**Live demo:** https://muhammadawais047.github.io/user-activity-tracker/

## Features

- **Self-instrumentation** — a central `track()` call records view, click, search, filter, and export events with page, label, and session attribution as you use the app
- **Session stitching** — events group into sessions with a 30-minute inactivity window; the live session updates every second
- **Overview dashboard** — 4 KPI cards with deltas vs the previous equal period and mini sparklines, smooth SVG area/line trend chart with keyboard-focusable points and tooltip, donut event mix, 7×24 weekday/hour heatmap (last 28 days), top screens bar list, and auto-generated insights
- **Range switching** — 7 / 14 / 30 day windows on every page, with all aggregates recomputed against the previous window
- **Activity stream** — full event log with type filter chips, debounced search, session replay filter, load-more batching, and an event-detail drawer with the raw JSON payload
- **Sessions view** — day-grouped session list (Today / Yesterday / weekday labels), summary stats, live session chip, one-click replay of any session into the filtered stream
- **Settings** — pause/resume tracking, live data stats (events, sessions, storage used), range-scoped JSON export, two-click confirmations for destructive actions, and demo-data restore
- **Seeded history** — 30 days of deterministic demo events (seeded PRNG) so the dashboard is full on first visit; clearing data empties it for real
- **Persistence** — everything stored in `localStorage` (`trace-data-v1`) with capped buffers (5,000 events / 600 sessions)
- **Hand-built charts** — zero chart libraries; all SVG charts are generated in vanilla JS
- **Accessible** — keyboard-navigable chart points, labelled controls, live-region announcements, visible focus states, reduced-motion support
- **Responsive** — 12-column desktop grid collapses gracefully; tab bar wraps to its own row, heatmap scrolls horizontally, drawer goes full-width on phones

## Tech

| Layer | Choice |
|---|---|
| Markup | Single `index.html` |
| Logic | Vanilla JS (IIFE, ~1,700 lines, zero dependencies) |
| Styling | Hand-written CSS with custom properties, ~1,600 lines |
| Charts | Hand-built SVG (area/line, donut, sparklines, heatmap) |
| Data | `localStorage` JSON |
| Build | None — static files, open and go |

## Run locally

```bash
cd user-activity-tracker
python -m http.server 8774
# open http://127.0.0.1:8774/
```

Or serve with any static server (`npx serve`, VS Code Live Server, etc.). Opening `index.html` directly also works.

## Structure

```
index.html   # app shell: topbar, 4 pages, drawer, toast
styles.css   # full theme, responsive breakpoints, reduced motion
app.js       # tracking core, seeding, aggregation, charts, routing, UI
```

## How tracking works

1. A central `track(type, label, page)` call fires on navigation, clicks, searches, filters, and exports
2. Events attach to a session (new one after 30 min idle) and persist to `localStorage`
3. Aggregations compute KPIs, series, mixes, and heatmap buckets for the selected range
4. Pause tracking at any time from Settings — nothing is recorded while paused

## Notes

- All data lives in your browser's `localStorage` only; clearing site data wipes it
- Demo history is deterministic (fixed seed) so every visitor starts with the same 30-day baseline
- Personal bests of QA: 0 console errors across all pages and flows

## License

[MIT](LICENSE) © 2026 Muhammad Awais

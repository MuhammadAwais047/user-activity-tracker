/* ============================================================
   trace — a self-instrumenting activity console
   Everything is local. No network, no dependencies.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- Constants ---------------- */

  const STORE_KEY = "trace-data-v1";
  const SESSION_GAP = 30 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const MAX_EVENTS = 5000;
  const MAX_SESSIONS = 600;
  const SEED = 0x7ea3c0de;

  const TYPES = {
    view: { label: "View" },
    click: { label: "Click" },
    search: { label: "Search" },
    filter: { label: "Filter" },
    export: { label: "Export" },
  };
  const TYPE_KEYS = Object.keys(TYPES);

  const PAGES = {
    overview: "Overview",
    stream: "Activity",
    sessions: "Sessions",
    settings: "Settings",
  };
  const SCREENS = ["Overview", "Activity", "Sessions", "Settings"];
  const ROUTES = Object.keys(PAGES);

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const nf = new Intl.NumberFormat("en-US");

  /* ---------------- Helpers ---------------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function shiftDay(ts, amount) {
    const d = new Date(ts);
    d.setDate(d.getDate() + amount);
    return d.getTime();
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function isSameDay(a, b) {
    return dayKey(a) === dayKey(b);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fmtHMS(ts) {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function fmtDay(ts) {
    const d = new Date(ts);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function fmtDayFull(ts) {
    const d = new Date(ts);
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function fmtFull(ts) {
    const d = new Date(ts);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${fmtHMS(ts)}`;
  }

  function relativeDay(ts) {
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff > 1 && diff < 7) return WEEKDAYS[new Date(ts).getDay()];
    return `${MONTHS[new Date(ts).getMonth()]} ${new Date(ts).getDate()}`;
  }

  function relativeShort(ts) {
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY);
    if (diff === 0) return "today";
    if (diff === 1) return "yesterday";
    return fmtDay(ts);
  }

  function fmtEventTime(ts) {
    return isSameDay(ts, Date.now()) ? fmtHMS(ts) : fmtTime(ts);
  }

  function fmtDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${pad2(m)}m`;
    if (m > 0) return `${m}m ${pad2(s)}s`;
    return `${s}s`;
  }

  function fmtElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  function niceMax(value) {
    if (value <= 4) return 4;
    const rawStep = value / 4;
    const exp = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const f = rawStep / exp;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : 10) * exp;
    return step * 4;
  }

  function uid(prefix) {
    return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rand, list) {
    return list[Math.floor(rand() * list.length)];
  }

  /* ---------------- State ---------------- */

  const state = {
    events: [],
    sessions: [],
    paused: false,
    activeSessionId: null,
    range: 7,
    tab: null,
    typeFilter: "all",
    query: "",
    sessionFilter: null,
    streamLimit: 40,
    sessionLimit: 30,
    lastTrackedQuery: "",
    drawerEventId: null,
    toastTimer: null,
    resizeTimer: null,
    searchTimer: null,
  };

  let els = {};

  /* ---------------- Seed + persistence ---------------- */

  const SEED_VIEWS = {
    Overview: ["Opened overview", "Refreshed the overview", "Returned to overview", "Reviewed the dashboard"],
    Activity: ["Opened the activity log", "Jumped into the stream", "Checked recent events"],
    Sessions: ["Opened sessions", "Reviewed recent visits", "Scanned the session list"],
    Settings: ["Opened settings", "Checked data controls"],
  };

  const SEED_CLICKS = [
    "Opened an event",
    "Inspected a session",
    "Hovered a chart point",
    "Clicked a KPI card",
    "Copied an event id",
    "Toggled the live feed",
    "Expanded a daily bucket",
    "Opened the event drawer",
  ];

  const SEED_QUERIES = ["export", "session", "range", "filter", "settings", "json", "heatmap", "click", "mobile"];

  const SEED_FILTERS = [
    "Filtered by clicks",
    "Filtered by views",
    "Changed the range",
    "Switched to 14 days",
    "Cleared the type filter",
    "Filtered by searches",
    "Changed the range to 30 days",
  ];

  const SEED_EXPORTS = ["Exported a 7-day report", "Exported activity JSON", "Exported the current range"];

  function seedType(rand) {
    const r = rand();
    if (r < 0.4) return "view";
    if (r < 0.68) return "click";
    if (r < 0.8) return "search";
    if (r < 0.93) return "filter";
    return "export";
  }

  function seedLabel(rand, type, page) {
    if (type === "view") return pick(rand, SEED_VIEWS[page] || SEED_VIEWS.Overview);
    if (type === "click") return pick(rand, SEED_CLICKS);
    if (type === "search") return `Searched "${pick(rand, SEED_QUERIES)}"`;
    if (type === "filter") return pick(rand, SEED_FILTERS);
    return pick(rand, SEED_EXPORTS);
  }

  function seedData() {
    const rand = mulberry32(SEED);
    const events = [];
    const sessions = [];
    const now = Date.now();
    const today = startOfDay(now);
    let eventCounter = 0;
    let sessionCounter = 0;

    for (let back = 30; back >= 1; back--) {
      const dayStart = shiftDay(today, -back);
      const weekday = new Date(dayStart).getDay();
      const weekend = weekday === 0 || weekday === 6;
      const count = weekend ? 1 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 4);
      let cursor = dayStart + (8 + Math.floor(rand() * 3)) * 3600000 + Math.floor(rand() * 45) * 60000;

      for (let s = 0; s < count; s++) {
        if (s > 0) cursor += (35 + Math.floor(rand() * 170)) * 60000;
        const hour = new Date(cursor).getHours();
        if (hour >= 22 || cursor > dayStart + DAY - 30 * 60000) break;

        const duration = (2 + Math.floor(rand() * 24)) * 60000;
        const sessionId = `S${String(++sessionCounter).padStart(4, "0")}`;
        const session = { id: sessionId, startedAt: cursor, endedAt: cursor + duration };
        sessions.push(session);

        let page = pick(rand, ["Overview", "Overview", "Activity", "Activity", "Sessions", "Settings"]);
        const eventCount = 3 + Math.floor(rand() * 11);
        for (let e = 0; e < eventCount; e++) {
          if (rand() < 0.22) page = pick(rand, SCREENS);
          const type = seedType(rand);
          events.push({
            id: `E${String(++eventCounter).padStart(5, "0")}`,
            ts: cursor + Math.floor(rand() * duration),
            type,
            label: seedLabel(rand, type, page),
            page,
            sessionId,
          });
        }
        cursor += duration;
      }
    }

    events.sort((a, b) => a.ts - b.ts);
    sessions.sort((a, b) => a.startedAt - b.startedAt);
    return { events, sessions };
  }

  function isValidEvent(event) {
    return Boolean(
      event &&
      typeof event.id === "string" &&
      typeof event.ts === "number" &&
      Number.isFinite(event.ts) &&
      TYPES[event.type] &&
      typeof event.label === "string" &&
      typeof event.page === "string" &&
      typeof event.sessionId === "string"
    );
  }

  function isValidSession(session) {
    return Boolean(
      session &&
      typeof session.id === "string" &&
      typeof session.startedAt === "number" &&
      typeof session.endedAt === "number" &&
      Number.isFinite(session.startedAt) &&
      Number.isFinite(session.endedAt)
    );
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.events) || !Array.isArray(data.sessions)) return null;
      const sessions = data.sessions.filter(isValidSession);
      const sessionIds = new Set(sessions.map((s) => s.id));
      const events = data.events.filter((e) => isValidEvent(e) && sessionIds.has(e.sessionId));
      if (events.length > 0 && sessions.length === 0) return null;
      events.sort((a, b) => a.ts - b.ts);
      sessions.sort((a, b) => a.startedAt - b.startedAt);
      return { events, sessions, paused: Boolean(data.paused) };
    } catch (error) {
      return null;
    }
  }

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          version: 1,
          paused: state.paused,
          events: state.events,
          sessions: state.sessions,
        })
      );
    } catch (error) {
      /* storage can be full or disabled; the session still works in memory */
    }
  }

  function ensureSession(now) {
    const stamp = now || Date.now();
    const last = state.sessions[state.sessions.length - 1];
    if (last && stamp - last.endedAt < SESSION_GAP) {
      state.activeSessionId = last.id;
      return last;
    }
    const session = { id: uid("S"), startedAt: stamp, endedAt: stamp };
    state.sessions.push(session);
    if (state.sessions.length > MAX_SESSIONS) state.sessions.splice(0, state.sessions.length - MAX_SESSIONS);
    state.activeSessionId = session.id;
    return session;
  }

  function getSession(id) {
    return state.sessions.find((session) => session.id === id) || null;
  }

  function getEvent(id) {
    return state.events.find((event) => event.id === id) || null;
  }

  /* ---------------- Tracking core ---------------- */

  function track(type, label, pageOverride) {
    if (state.paused) {
      updateTrackingUI();
      return null;
    }
    if (!TYPES[type]) return null;
    const now = Date.now();
    const session = ensureSession(now);
    const event = {
      id: uid("R"),
      ts: now,
      type,
      label: String(label).slice(0, 120),
      page: pageOverride || PAGES[state.tab] || "Overview",
      sessionId: session.id,
    };
    state.events.push(event);
    session.endedAt = now;
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    persist();
    onTracked(event);
    return event;
  }

  function onTracked() {
    updateTrackingUI();
    if (!state.tab) return;
    if (state.tab === "overview") renderOverview();
    else if (state.tab === "stream") renderStream();
    else if (state.tab === "sessions") renderSessions();
    else if (state.tab === "settings") renderDataStats();
  }

  /* ---------------- Time windows + aggregation ---------------- */

  function currentWindow() {
    const now = Date.now();
    const start = shiftDay(startOfDay(now), -(state.range - 1));
    return { start, end: now, prevStart: shiftDay(start, -state.range), prevEnd: start };
  }

  function rangeAggregate(start, endExclusive) {
    const eventList = state.events.filter((event) => event.ts >= start && event.ts < endExclusive);
    const ids = new Set(eventList.map((event) => event.sessionId));
    const sessionList = state.sessions.filter(
      (session) => session.startedAt >= start && session.startedAt < endExclusive && ids.has(session.id)
    );
    const activeDays = new Set(eventList.map((event) => dayKey(event.ts)));
    const durations = sessionList.map((session) => Math.max(0, session.endedAt - session.startedAt));
    const avgMs = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    return { events: eventList.length, sessions: sessionList.length, avgMs, activeDays: activeDays.size, eventList, sessionList };
  }

  function buildSeries() {
    const win = currentWindow();
    const today = startOfDay(win.end);
    const days = [];
    const index = new Map();
    for (let i = 0; i < state.range; i++) {
      const ts = shiftDay(today, i - (state.range - 1));
      const key = dayKey(ts);
      const entry = { ts, key, events: 0, sessions: 0, durationSum: 0 };
      days.push(entry);
      index.set(key, days.length - 1);
    }
    const current = rangeAggregate(win.start, win.end + 1);
    for (const event of current.eventList) {
      const i = index.get(dayKey(event.ts));
      if (i !== undefined) days[i].events++;
    }
    for (const session of current.sessionList) {
      const i = index.get(dayKey(session.startedAt));
      if (i === undefined) continue;
      days[i].sessions++;
      days[i].durationSum += Math.max(0, session.endedAt - session.startedAt);
    }
    const previous = rangeAggregate(win.prevStart, win.start);
    return { win, days, current, previous };
  }

  /* ---------------- Type + event formatting ---------------- */

  function typeBadge(type) {
    const label = TYPES[type] ? TYPES[type].label : type;
    return `<span class="type-badge t-${esc(type)}">${esc(label)}</span>`;
  }

  function eventRowHTML(event, compact) {
    return `<li><button class="event-row${compact ? " compact-row" : ""}" type="button" data-event-id="${esc(event.id)}" title="${esc(event.label)}">
      <span class="event-time"><b>${fmtEventTime(event.ts)}</b><span>${esc(relativeShort(event.ts))}</span></span>
      ${typeBadge(event.type)}
      <span class="event-label">${esc(event.label)}</span>
      <span class="event-screen">${esc(event.page)}</span>
    </button></li>`;
  }

  /* ---------------- Overview: KPIs ---------------- */

  function deltaMarkup(current, previous, label) {
    let cls = "flat";
    let text = "—";
    if (previous > 0) {
      const change = ((current - previous) / previous) * 100;
      if (Math.abs(change) < 0.5) {
        text = "0%";
      } else {
        cls = change > 0 ? "up" : "down";
        text = `${change > 0 ? "+" : ""}${change.toFixed(Math.abs(change) >= 10 ? 0 : 1)}%`;
      }
    } else if (current > 0) {
      cls = "up";
      text = "new";
    }
    return `<span class="kpi-delta ${cls}" title="${esc(label)}">${text}</span>`;
  }

  function sparkline(values) {
    const max = Math.max(1, ...values);
    const width = 100;
    const height = 32;
    const step = values.length > 1 ? width / (values.length - 1) : width;
    const points = values.map((value, i) => {
      const x = values.length > 1 ? i * step : width / 2;
      const y = height - 3 - (value / max) * (height - 7);
      return [x, y];
    });
    const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area}" fill="rgba(94,234,212,0.10)"></path>
      <path d="${line}" fill="none" stroke="#5eead4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"></path>
    </svg>`;
  }

  function renderKPIs(series) {
    const { current, previous, days } = series;
    const rangeLabel = `vs previous ${state.range} days`;
    const sessionSpark = sparkline(days.map((day) => day.sessions));
    const eventSpark = sparkline(days.map((day) => day.events));
    const avgSpark = sparkline(days.map((day) => (day.sessions ? day.durationSum / day.sessions / 60000 : 0)));

    const ticks = days
      .map((day) => {
        const isToday = isSameDay(day.ts, Date.now());
        return `<span class="day-tick${day.events > 0 ? " on" : ""}${isToday ? " today" : ""}" title="${esc(fmtDay(day.ts))} — ${nf.format(day.events)} events"></span>`;
      })
      .join("");

    els.kpis.innerHTML = `
      <article class="kpi" data-kpi="events">
        <div class="kpi-top"><span class="kpi-label">Total events</span>${deltaMarkup(current.events, previous.events, rangeLabel)}</div>
        <div class="kpi-value">${nf.format(current.events)}</div>
        <div class="kpi-spark">${eventSpark}</div>
      </article>
      <article class="kpi" data-kpi="sessions">
        <div class="kpi-top"><span class="kpi-label">Sessions</span>${deltaMarkup(current.sessions, previous.sessions, rangeLabel)}</div>
        <div class="kpi-value">${nf.format(current.sessions)}</div>
        <div class="kpi-spark">${sessionSpark}</div>
      </article>
      <article class="kpi" data-kpi="average">
        <div class="kpi-top"><span class="kpi-label">Avg session</span>${deltaMarkup(current.avgMs, previous.avgMs, rangeLabel)}</div>
        <div class="kpi-value sm">${current.avgMs ? fmtDuration(current.avgMs) : "—"}</div>
        <div class="kpi-spark">${avgSpark}</div>
      </article>
      <article class="kpi" data-kpi="active">
        <div class="kpi-top"><span class="kpi-label">Active days</span>${deltaMarkup(current.activeDays, previous.activeDays, rangeLabel)}</div>
        <div class="kpi-value">${current.activeDays}<small>of ${state.range}</small></div>
        <div class="day-ticks" aria-hidden="true">${ticks}</div>
      </article>`;
  }

  /* ---------------- Overview: trend chart ---------------- */

  function renderTrend(series) {
    const svg = els.trendChart;
    const wrap = els.trendWrap;
    if (!svg || !wrap) return;
    els.trendTip.hidden = true;

    const W = Math.max(300, Math.round(wrap.clientWidth || 760));
    const H = 260;
    const pad = { left: 40, right: 16, top: 16, bottom: 28 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const counts = series.days.map((day) => day.events);
    const total = counts.reduce((sum, value) => sum + value, 0);
    const n = counts.length;
    const max = niceMax(Math.max(1, ...counts));
    const baseY = pad.top + innerH;
    const xFor = (i) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (value) => pad.top + innerH - (value / max) * innerH;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.height = `${H}px`;

    if (total === 0) {
      svg.setAttribute("aria-label", "No events in the selected range");
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#5c6b7c" font-family="ui-monospace, monospace" font-size="11">No events in this range</text>`;
      els.trendTotal.textContent = "0 events";
      els.trendTip.hidden = true;
      return;
    }

    const grid = [];
    for (let k = 0; k <= 4; k++) {
      const value = (max * k) / 4;
      const y = yFor(value);
      grid.push(`<line class="trend-grid-line" x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"></line>`);
      grid.push(`<text class="trend-axis-text" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${nf.format(Math.round(value))}</text>`);
    }

    const labelEvery = Math.max(1, Math.ceil(n / 6));
    const xLabels = series.days.map((day, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return "";
      const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
      const x = i === 0 ? pad.left : i === n - 1 ? W - pad.right : xFor(i);
      return `<text class="trend-axis-text" x="${x}" y="${H - 8}" text-anchor="${anchor}">${esc(fmtDay(day.ts))}</text>`;
    }).join("");

    const linePoints = counts.map((value, i) => [xFor(i), yFor(value)]);
    const line = linePoints.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${linePoints[linePoints.length - 1][0].toFixed(1)},${baseY} L${linePoints[0][0].toFixed(1)},${baseY} Z`;
    const showDots = n <= 14;
    const dots = linePoints.map(([x, y], i) => {
      if (!showDots && i !== n - 1) return "";
      return `<circle class="trend-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === n - 1 ? 3.4 : 2.4}"></circle>`;
    }).join("");

    const hitWidth = innerW / n;
    const hits = series.days.map((day, i) => {
      const x = pad.left + i * hitWidth;
      return `<rect class="trend-hit" x="${x.toFixed(1)}" y="${pad.top}" width="${hitWidth.toFixed(1)}" height="${innerH}" tabindex="0" role="img"
        aria-label="${esc(fmtDayFull(day.ts))}: ${day.events} events" data-index="${i}"></rect>`;
    }).join("");

    svg.setAttribute(
      "aria-label",
      `Daily events from ${fmtDay(series.days[0].ts)} to ${fmtDay(series.days[n - 1].ts)}. ${nf.format(total)} events total.`
    );

    svg.innerHTML = `<defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#5eead4" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="#5eead4" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${grid.join("")}
      ${xLabels}
      <path class="trend-area" d="${area}"></path>
      <path class="trend-line" d="${line}"></path>
      ${dots}
      <line class="trend-cursor" x1="0" y1="${pad.top}" x2="0" y2="${baseY}" data-cursor></line>
      <g>${hits}</g>`;

    els.trendTotal.textContent = `${nf.format(total)} events`;

    const tip = els.trendTip;
    const cursor = $("[data-cursor]", svg);

    function showTip(i) {
      const day = series.days[i];
      const x = xFor(i);
      const y = yFor(counts[i]);
      tip.innerHTML = `<div class="tip-day">${esc(fmtDayFull(day.ts))}</div><div class="tip-val"><b>${nf.format(day.events)}</b> event${day.events === 1 ? "" : "s"}</div>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(x, 64), W - 64)}px`;
      tip.style.top = `${Math.max(y, 54)}px`;
      if (cursor) {
        cursor.setAttribute("x1", x.toFixed(1));
        cursor.setAttribute("x2", x.toFixed(1));
        cursor.style.opacity = "1";
      }
    }

    function hideTip() {
      tip.hidden = true;
      if (cursor) cursor.style.opacity = "0";
    }

    $$("[data-index]", svg).forEach((hit) => {
      const i = Number(hit.getAttribute("data-index"));
      hit.addEventListener("pointerenter", () => showTip(i));
      hit.addEventListener("focus", () => showTip(i));
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("blur", hideTip);
    });
  }

  /* ---------------- Overview: event mix ---------------- */

  function renderMix(series) {
    const counts = {};
    for (const key of TYPE_KEYS) counts[key] = 0;
    for (const event of series.current.eventList) counts[event.type] = (counts[event.type] || 0) + 1;
    const total = series.current.events;
    const present = TYPE_KEYS.filter((key) => counts[key] > 0);

    if (!total) {
      els.mixDonut.innerHTML = `<svg viewBox="0 0 168 168" aria-hidden="true"><circle class="donut-track" cx="84" cy="84" r="58"></circle></svg><div class="donut-center"><b>0</b><span>events</span></div>`;
      els.mixDonut.setAttribute("aria-label", "No events in this range");
      els.mixLegend.innerHTML = `<p class="list-empty">No events yet.</p>`;
      return;
    }

    const r = 58;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const slices = present.map((key) => {
      const share = counts[key] / total;
      const dash = Math.max(share * c - 1.6, 0.4);
      const slice = `<circle class="donut-slice t-${esc(key)}" cx="84" cy="84" r="${r}"
        stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 84 84)"></circle>`;
      offset += share * c;
      return slice;
    }).join("");

    els.mixDonut.innerHTML = `<svg viewBox="0 0 168 168" role="img" aria-label="Event mix of ${nf.format(total)} events">
      <circle class="donut-track" cx="84" cy="84" r="${r}"></circle>${slices}
    </svg><div class="donut-center"><b>${nf.format(total)}</b><span>events</span></div>`;

    els.mixLegend.innerHTML = present.map((key) => {
      const share = (counts[key] / total) * 100;
      return `<button class="legend-item t-${esc(key)}" type="button" data-legend-type="${esc(key)}" title="Filter the activity stream by ${esc(TYPES[key].label.toLowerCase())}">
        <span class="legend-dot"></span>
        <span class="legend-name">${esc(TYPES[key].label)}</span>
        <span class="legend-count">${nf.format(counts[key])}</span>
        <span class="legend-pct">${share.toFixed(share >= 10 ? 0 : 1)}%</span>
      </button>`;
    }).join("");
  }

  /* ---------------- Overview: heatmap ---------------- */

  function renderHeatmap() {
    const end = Date.now();
    const start = shiftDay(startOfDay(end), -27);
    const buckets = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const event of state.events) {
      if (event.ts < start) continue;
      const d = new Date(event.ts);
      const row = (d.getDay() + 6) % 7;
      buckets[row][d.getHours()]++;
    }
    let max = 0;
    let peak = null;
    for (let row = 0; row < 7; row++) {
      for (let hour = 0; hour < 24; hour++) {
        if (buckets[row][hour] > max) {
          max = buckets[row][hour];
          peak = { row, hour };
        }
      }
    }

    const order = [0, 1, 2, 3, 4, 5, 6];
    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let html = `<div class="heat-row"><span class="heat-day"></span>${Array.from({ length: 24 }, (_, hour) =>
      `<span class="heat-hour">${hour % 3 === 0 ? pad2(hour) : ""}</span>`).join("")}</div>`;

    for (const row of order) {
      html += `<div class="heat-row"><span class="heat-day">${dayLabels[row]}</span>`;
      for (let hour = 0; hour < 24; hour++) {
        const value = buckets[row][hour];
        const alpha = value === 0 ? 0 : 0.12 + 0.72 * Math.pow(value / max, 0.62);
        const background = value === 0 ? "rgba(148,163,184,0.055)" : `rgba(94,234,212,${alpha.toFixed(3)})`;
        html += `<span class="heat-cell" style="background:${background}" title="${WEEKDAYS_LONG[(row + 1) % 7]} ${pad2(hour)}:00 — ${nf.format(value)} event${value === 1 ? "" : "s"}"></span>`;
      }
      html += `</div>`;
    }

    els.heatmap.innerHTML = html;
    const label = peak
      ? `Peak activity ${WEEKDAYS_LONG[(peak.row + 1) % 7]} at ${pad2(peak.hour)}:00 with ${nf.format(max)} events.`
      : "No activity in the last 28 days.";
    els.heatmap.setAttribute("role", "img");
    els.heatmap.setAttribute("aria-label", `Weekday by hour activity, last 28 days. ${label}`);
    els.heatPeak.textContent = peak ? `peak ${dayLabels[peak.row]} ${pad2(peak.hour)}:00` : "quiet";
  }

  /* ---------------- Overview: top screens + signals ---------------- */

  function renderTopScreens(series) {
    const counts = new Map();
    for (const event of series.current.eventList) {
      counts.set(event.page, (counts.get(event.page) || 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
      els.topScreens.innerHTML = `<p class="list-empty">No screen activity in this range.</p>`;
      return;
    }
    const total = series.current.events;
    const max = sorted[0][1];
    els.topScreens.innerHTML = sorted.map(([page, count]) => {
      const share = (count / total) * 100;
      const width = (count / max) * 100;
      return `<div class="screen-row">
        <div class="screen-top">
          <span class="screen-name">${esc(page)} <b>${share.toFixed(share >= 10 ? 0 : 1)}%</b></span>
          <span class="screen-count">${nf.format(count)}</span>
        </div>
        <div class="screen-bar"><span style="width:${width.toFixed(1)}%"></span></div>
      </div>`;
    }).join("");
  }

  function renderSignals(series) {
    const events = series.current.eventList;
    if (!events.length) {
      els.signals.innerHTML = `<li class="signal"><span class="signal-ico" aria-hidden="true">–</span><p>Not enough activity yet<span>Interact with the console to generate signals.</span></p></li>`;
      return;
    }
    const hours = Array(24).fill(0);
    const weekdays = Array(7).fill(0);
    for (const event of events) {
      const d = new Date(event.ts);
      hours[d.getHours()]++;
      weekdays[d.getDay()]++;
    }
    const peakHour = hours.indexOf(Math.max(...hours));
    const peakHourShare = Math.round((hours[peakHour] / events.length) * 100);
    const topDay = weekdays.indexOf(Math.max(...weekdays));
    const topDayCount = weekdays[topDay];

    const typeCounts = {};
    for (const key of TYPE_KEYS) typeCounts[key] = 0;
    for (const event of events) typeCounts[event.type]++;
    const topType = TYPE_KEYS.reduce((best, key) => (typeCounts[key] > typeCounts[best] ? key : best), TYPE_KEYS[0]);
    const topTypeShare = Math.round((typeCounts[topType] / events.length) * 100);

    els.signals.innerHTML = `
      <li class="signal"><span class="signal-ico" aria-hidden="true">h</span><p>Most activity lands around <b>${pad2(peakHour)}:00</b><span>${peakHourShare}% of events in this range</span></p></li>
      <li class="signal"><span class="signal-ico" aria-hidden="true">d</span><p><b>${WEEKDAYS_LONG[topDay]}</b> is the busiest day<span>${nf.format(topDayCount)} events recorded</span></p></li>
      <li class="signal"><span class="signal-ico" aria-hidden="true">%</span><p><b>${esc(TYPES[topType].label)}</b> leads the mix<span>${topTypeShare}% of all events</span></p></li>`;
  }

  function renderRecent() {
    const events = state.events.slice(-6).sort((a, b) => b.ts - a.ts);
    if (!events.length) {
      els.recentList.innerHTML = `<li><p class="list-empty">Nothing recorded yet. Every interaction will show up here.</p></li>`;
      return;
    }
    els.recentList.innerHTML = events.map((event) => eventRowHTML(event, true)).join("");
  }

  function renderSessionCard() {
    const session = ensureSession() || getSession(state.activeSessionId);
    if (!session) return;
    const events = state.events.filter((event) => event.sessionId === session.id);
    const screens = new Set(events.map((event) => event.page));
    els.sessionElapsed.textContent = fmtElapsed(Date.now() - session.startedAt);
    els.sessionMeta.innerHTML = `
      <div><dt>Events</dt><dd>${nf.format(events.length)}</dd></div>
      <div><dt>Screens</dt><dd>${screens.size}</dd></div>
      <div><dt>Started</dt><dd>${fmtTime(session.startedAt)}</dd></div>`;
    els.sessionLiveTag.textContent = state.paused ? "paused" : "live";
    els.sessionLiveTag.classList.toggle("paused", state.paused);
  }

  function renderOverview() {
    if (state.tab !== "overview") return;
    const series = buildSeries();
    renderKPIs(series);
    renderTrend(series);
    renderMix(series);
    renderHeatmap();
    renderTopScreens(series);
    renderRecent();
    renderSessionCard();
    renderSignals(series);
    syncRangeButtons();
  }

  /* ---------------- Stream ---------------- */

  function eventMatches(event, options) {
    const opts = options || {};
    const win = currentWindow();
    if (event.ts < win.start || event.ts > win.end) return false;
    if (!opts.ignoreType && state.typeFilter !== "all" && event.type !== state.typeFilter) return false;
    if (state.sessionFilter && event.sessionId !== state.sessionFilter) return false;
    const query = state.query.trim().toLowerCase();
    if (query) {
      const haystack = `${event.label} ${event.page} ${TYPES[event.type] ? TYPES[event.type].label : event.type} ${event.sessionId}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function typeCountsForChips() {
    const win = currentWindow();
    const counts = { all: 0 };
    for (const key of TYPE_KEYS) counts[key] = 0;
    for (const event of state.events) {
      if (event.ts < win.start || event.ts > win.end) continue;
      if (state.sessionFilter && event.sessionId !== state.sessionFilter) continue;
      const query = state.query.trim().toLowerCase();
      if (query) {
        const haystack = `${event.label} ${event.page} ${TYPES[event.type] ? TYPES[event.type].label : event.type} ${event.sessionId}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      counts.all++;
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }

  function renderTypeChips() {
    const counts = typeCountsForChips();
    const parts = [`<button class="chip${state.typeFilter === "all" ? " active" : ""}" type="button" data-type="all" aria-pressed="${state.typeFilter === "all"}">All <span class="chip-n">${nf.format(counts.all)}</span></button>`];
    for (const key of TYPE_KEYS) {
      parts.push(`<button class="chip t-${esc(key)}${state.typeFilter === key ? " active" : ""}" type="button" data-type="${esc(key)}" aria-pressed="${state.typeFilter === key}">
        <span class="chip-dot"></span>${esc(TYPES[key].label)} <span class="chip-n">${nf.format(counts[key])}</span>
      </button>`);
    }
    els.typeChips.innerHTML = parts.join("");
  }

  function renderStreamStatus(baseCount, filteredCount) {
    let text = `${nf.format(filteredCount)} ${filteredCount === 1 ? "event" : "events"}`;
    if (filteredCount !== baseCount) text += ` of ${nf.format(baseCount)}`;
    els.streamCount.textContent = text;

    const session = state.sessionFilter ? getSession(state.sessionFilter) : null;
    if (session) {
      els.sessionFilter.hidden = false;
      els.sessionFilter.innerHTML = `session ${esc(fmtTime(session.startedAt))} – ${esc(fmtTime(session.endedAt))}`;
    } else {
      els.sessionFilter.hidden = true;
    }

    const hasFilters = state.typeFilter !== "all" || state.query.trim() || state.sessionFilter;
    els.clearFilters.hidden = !hasFilters;
  }

  function streamEmptyMarkup(baseCount) {
    if (state.events.length === 0) {
      return `<div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 18V9M9 18V5M14 18v-6M19 18v-9"/></svg></div>
        <h3>Nothing recorded yet</h3>
        <p>Your clicks, searches, and tab changes will appear here in real time. Restore the demo history to see a full 30 days.</p>
        <div class="btn-row"><button class="btn primary" type="button" data-empty-action="restore">Restore demo data</button><button class="btn" type="button" data-empty-action="widen">Use 30 days</button></div>`;
    }
    if (baseCount === 0) {
      return `<div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg></div>
        <h3>No events in this range</h3>
        <p>There is activity outside the selected window. Widen the range to bring it back.</p>
        <div class="btn-row"><button class="btn" type="button" data-empty-action="widen">Use 30 days</button></div>`;
    }
    return `<div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></div>
      <h3>No events match</h3>
      <p>Try a different search term, another event type, or clear the filters.</p>
      <div class="btn-row"><button class="btn primary" type="button" data-empty-action="clear-filters">Clear filters</button></div>`;
  }

  function renderStream() {
    if (state.tab !== "stream") return;
    syncRangeButtons();
    renderTypeChips();
    const win = currentWindow();
    const base = state.events.filter((event) => event.ts >= win.start && event.ts <= win.end);
    const filtered = base.filter((event) => eventMatches(event)).sort((a, b) => b.ts - a.ts);
    state.streamLimit = Math.max(40, state.streamLimit);
    const visible = filtered.slice(0, state.streamLimit);
    const rest = filtered.length - visible.length;

    els.streamList.innerHTML = visible.map((event) => eventRowHTML(event, false)).join("");
    els.streamList.hidden = filtered.length === 0;

    if (filtered.length === 0) {
      els.streamEmpty.hidden = false;
      els.streamEmpty.innerHTML = streamEmptyMarkup(base.length);
    } else {
      els.streamEmpty.hidden = true;
      els.streamEmpty.innerHTML = "";
    }

    els.streamMore.hidden = rest <= 0;
    if (rest > 0) els.streamMore.textContent = `Load ${Math.min(40, rest)} older events`;

    renderStreamStatus(base.length, filtered.length);
    els.streamClear.hidden = !els.streamSearch.value;
  }

  /* ---------------- Sessions ---------------- */

  function sessionEventMap() {
    const map = new Map();
    for (const event of state.events) {
      if (!map.has(event.sessionId)) map.set(event.sessionId, []);
      map.get(event.sessionId).push(event);
    }
    return map;
  }

  function sessionSummaryHTML(sessionList, allEvents) {
    const totalEvents = sessionList.reduce((sum, session) => sum + (allEvents.get(session.id) || []).length, 0);
    const durations = sessionList.map((session) => Math.max(0, session.endedAt - session.startedAt));
    const avg = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    const longest = durations.length ? Math.max(...durations) : 0;
    return `
      <div class="summary-cell"><dt>Sessions</dt><dd>${nf.format(sessionList.length)}</dd></div>
      <div class="summary-cell"><dt>Events</dt><dd>${nf.format(totalEvents)}</dd></div>
      <div class="summary-cell"><dt>Average</dt><dd>${avg ? fmtDuration(avg) : "—"}</dd></div>
      <div class="summary-cell"><dt>Longest</dt><dd>${longest ? fmtDuration(longest) : "—"}</dd></div>`;
  }

  function sessionRowHTML(session, events) {
    const isLive = session.id === state.activeSessionId;
    const duration = Math.max(0, session.endedAt - session.startedAt);
    const screens = new Set(events.map((event) => event.page));
    const byPage = new Map();
    const byType = new Map();
    for (const event of events) {
      byPage.set(event.page, (byPage.get(event.page) || 0) + 1);
      byType.set(event.type, (byType.get(event.type) || 0) + 1);
    }
    const topPage = Array.from(byPage.entries()).sort((a, b) => b[1] - a[1])[0];
    const dots = TYPE_KEYS.map((key) => {
      const count = byType.get(key) || 0;
      if (!count) return "";
      const width = (count / events.length) * 100;
      return `<i class="t-${esc(key)}" style="width:${width.toFixed(1)}%"></i>`;
    }).join("");

    return `<button class="session-row${isLive ? " is-live" : ""}" type="button" data-session-id="${esc(session.id)}" aria-label="Replay session from ${esc(fmtTime(session.startedAt))} to ${esc(fmtTime(session.endedAt))}, ${events.length} events">
      <span class="ses-time"><b>${esc(fmtTime(session.startedAt))}</b><span>→ ${esc(fmtTime(session.endedAt))}</span></span>
      <span class="ses-mid">
        <span class="ses-top"><strong>${topPage ? esc(topPage[0]) : "No screen"}</strong>${isLive ? '<span class="ses-live-chip">live</span>' : ""}</span>
        <span class="ses-sub"><span>${nf.format(events.length)} events</span><span>${screens.size} screen${screens.size === 1 ? "" : "s"}</span></span>
        <span class="ses-types">${dots}</span>
      </span>
      <span class="ses-right"><span class="ses-duration">${fmtDuration(duration)}</span><svg class="ses-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>
    </button>`;
  }

  function renderSessions() {
    if (state.tab !== "sessions") return;
    syncRangeButtons();
    ensureSession();
    const win = currentWindow();
    const current = rangeAggregate(win.start, win.end + 1);
    const allEvents = sessionEventMap();
    const sessionList = current.sessionList
      .filter((session) => (allEvents.get(session.id) || []).length > 0)
      .sort((a, b) => b.startedAt - a.startedAt);

    els.sessionSummary.innerHTML = sessionSummaryHTML(sessionList, allEvents);

    if (!sessionList.length) {
      els.sessionList.innerHTML = "";
      els.sessionsEmpty.hidden = false;
      if (state.events.length === 0) {
        els.sessionsEmpty.innerHTML = `<div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/></svg></div>
          <h3>No sessions yet</h3>
          <p>A session opens with your first interaction and closes after 30 minutes of quiet. Restore the demo history to see a month of visits.</p>
          <div class="btn-row"><button class="btn primary" type="button" data-empty-action="restore">Restore demo data</button></div>`;
      } else {
        els.sessionsEmpty.innerHTML = `<div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/></svg></div>
          <h3>No sessions in this range</h3>
          <p>Your activity lives outside this window. Try the last 30 days.</p>
          <div class="btn-row"><button class="btn" type="button" data-empty-action="widen">Use 30 days</button></div>`;
      }
      els.sessionsMore.hidden = true;
      return;
    }

    els.sessionsEmpty.hidden = true;
    els.sessionsEmpty.innerHTML = "";
    const limited = sessionList.slice(0, state.sessionLimit);
    const groups = [];
    let currentKey = null;
    let currentGroup = null;
    for (const session of limited) {
      const key = dayKey(session.startedAt);
      if (key !== currentKey) {
        currentKey = key;
        currentGroup = { key, ts: session.startedAt, sessions: [] };
        groups.push(currentGroup);
      }
      currentGroup.sessions.push(session);
    }

    els.sessionList.innerHTML = groups.map((group) => {
      const eventCount = group.sessions.reduce((sum, session) => sum + (allEvents.get(session.id) || []).length, 0);
      return `<section class="session-group">
        <div class="session-day">${esc(relativeDay(group.ts))} <b>${esc(fmtDay(group.ts))}</b> <span>· ${nf.format(eventCount)} events</span></div>
        <div class="session-rows">${group.sessions.map((session) => sessionRowHTML(session, allEvents.get(session.id) || [])).join("")}</div>
      </section>`;
    }).join("");

    const rest = sessionList.length - limited.length;
    els.sessionsMore.hidden = rest <= 0;
    if (rest > 0) els.sessionsMore.textContent = `Load ${Math.min(30, rest)} older sessions`;
  }

  /* ---------------- Settings + drawer ---------------- */

  function storageBytes() {
    try {
      return new Blob([JSON.stringify({ paused: state.paused, events: state.events, sessions: state.sessions })]).size;
    } catch (error) {
      return JSON.stringify({ events: state.events, sessions: state.sessions }).length;
    }
  }

  function renderDataStats() {
    if (!els.dataStats) return;
    const sessionIds = new Set(state.events.map((event) => event.sessionId));
    const sessions = state.sessions.filter((session) => sessionIds.has(session.id)).length;
    els.dataStats.innerHTML = `
      <div class="data-stat"><dt>Events</dt><dd>${nf.format(state.events.length)}</dd></div>
      <div class="data-stat"><dt>Sessions</dt><dd>${nf.format(sessions)}</dd></div>
      <div class="data-stat"><dt>Storage</dt><dd>${(storageBytes() / 1024).toFixed(1)} KB</dd></div>`;
  }

  function updateTrackingUI() {
    if (!els.liveText) return;
    els.liveText.textContent = state.paused ? "Paused" : "Live";
    els.livePill.classList.toggle("is-paused", state.paused);
    els.livePill.title = state.paused
      ? "Tracking is paused. Open settings to resume."
      : "Activity is recorded locally in this browser. Open settings to pause.";
    if (els.sessionLiveTag) {
      els.sessionLiveTag.textContent = state.paused ? "paused" : "live";
      els.sessionLiveTag.classList.toggle("paused", state.paused);
    }
    if (els.trackingToggle) els.trackingToggle.checked = !state.paused;
    if (els.trackingHint) {
      els.trackingHint.textContent = state.paused
        ? "Tracking is paused. New interactions stay out of the log until you turn it back on."
        : "Tracking is on. Interact with the console and watch the stream fill.";
    }
    if (els.streamLiveText) els.streamLiveText.textContent = state.paused ? "paused" : "auto-capturing";
  }

  function renderSettings() {
    if (state.tab !== "settings") return;
    updateTrackingUI();
    renderDataStats();
  }

  function renderDrawer(event) {
    els.drawerType.className = `type-badge t-${event.type}`;
    els.drawerType.textContent = TYPES[event.type] ? TYPES[event.type].label : event.type;
    els.drawerTitle.textContent = event.label;
    const session = getSession(event.sessionId);
    const sessionEvents = session ? state.events.filter((item) => item.sessionId === session.id) : [];
    const position = session ? sessionEvents.findIndex((item) => item.id === event.id) + 1 : 0;
    els.drawerSub.textContent = session
      ? `Event ${position} of ${sessionEvents.length} · session started ${fmtTime(session.startedAt)} on ${fmtDay(session.startedAt)}`
      : `Recorded on ${fmtDayFull(event.ts)}`;
    els.drawerMeta.innerHTML = `
      <div><dt>Timestamp</dt><dd>${esc(fmtFull(event.ts))}</dd></div>
      <div><dt>Screen</dt><dd>${esc(event.page)}</dd></div>
      <div><dt>Session</dt><dd>${esc(event.sessionId)}</dd></div>
      <div><dt>Event id</dt><dd>${esc(event.id)}</dd></div>`;
    els.drawerJson.textContent = JSON.stringify(
      {
        id: event.id,
        type: event.type,
        label: event.label,
        page: event.page,
        sessionId: event.sessionId,
        ts: new Date(event.ts).toISOString(),
        epoch: event.ts,
      },
      null,
      2
    );
    els.drawerSession.hidden = !session;
  }

  function openDrawer(eventId) {
    const event = getEvent(eventId);
    if (!event) return;
    state.drawerEventId = eventId;
    renderDrawer(event);
    if (!els.drawer.open) {
      els.drawer.showModal();
      document.body.classList.add("modal-open");
    }
    track("click", "Opened event detail");
  }

  function closeDrawer() {
    if (els.drawer.open) els.drawer.close();
    document.body.classList.remove("modal-open");
    state.drawerEventId = null;
  }

  /* ---------------- Export ---------------- */

  function exportJSON() {
    const win = currentWindow();
    track("export", `Exported ${state.range}-day activity`);
    const events = state.events
      .filter((event) => event.ts >= win.start && event.ts <= win.end)
      .sort((a, b) => a.ts - b.ts);
    const ids = new Set(events.map((event) => event.sessionId));
    const sessions = state.sessions
      .filter((session) => ids.has(session.id))
      .map((session) => ({
        ...session,
        startedAtIso: new Date(session.startedAt).toISOString(),
        endedAtIso: new Date(session.endedAt).toISOString(),
        eventCount: events.filter((event) => event.sessionId === session.id).length,
      }));
    const payload = {
      app: "trace",
      version: 1,
      exportedAt: new Date().toISOString(),
      rangeDays: state.range,
      window: { start: new Date(win.start).toISOString(), end: new Date(win.end).toISOString() },
      totals: { events: events.length, sessions: sessions.length },
      sessions,
      events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trace-activity-${dayKey(Date.now())}-${state.range}d.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Exported ${nf.format(events.length)} events as JSON`);
  }

  /* ---------------- Data actions ---------------- */

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function announce(message) {
    if (!els.live) return;
    els.live.textContent = "";
    window.requestAnimationFrame(() => {
      els.live.textContent = message;
    });
  }

  let armReset = null;

  function armButton(button, idleLabel, confirmLabel, hint) {
    if (armReset) armReset();
    const originalHint = hint ? hint.textContent : "";
    let timer = null;
    const reset = () => {
      button.classList.remove("is-arming");
      button.textContent = idleLabel;
      if (hint) {
        hint.textContent = originalHint;
        hint.classList.remove("warn");
      }
      clearTimeout(timer);
      if (armReset === reset) armReset = null;
    };
    button.classList.add("is-arming");
    button.textContent = confirmLabel;
    if (hint) {
      hint.textContent = "Click again within 4 seconds to confirm.";
      hint.classList.add("warn");
    }
    timer = setTimeout(reset, 4000);
    armReset = reset;
  }

  function resetControls() {
    state.typeFilter = "all";
    state.query = "";
    state.sessionFilter = null;
    state.lastTrackedQuery = "";
    state.streamLimit = 40;
    state.sessionLimit = 30;
    if (els.streamSearch) els.streamSearch.value = "";
    if (els.streamClear) els.streamClear.hidden = true;
  }

  function clearAllData() {
    state.events = [];
    state.sessions = [];
    resetControls();
    state.activeSessionId = null;
    ensureSession();
    persist();
    renderCurrentView();
    renderDataStats();
    updateTrackingUI();
    toast("All local activity cleared");
  }

  function restoreDemoData() {
    const fresh = seedData();
    state.events = fresh.events;
    state.sessions = fresh.sessions;
    state.activeSessionId = null;
    resetControls();
    ensureSession();
    persist();
    renderCurrentView();
    renderDataStats();
    updateTrackingUI();
    toast("Demo history restored");
    track("click", "Restored demo data");
  }

  function renderCurrentView() {
    if (!state.tab) return;
    if (state.tab === "overview") renderOverview();
    else if (state.tab === "stream") renderStream();
    else if (state.tab === "sessions") renderSessions();
    else if (state.tab === "settings") renderSettings();
  }

  /* ---------------- Routing ---------------- */

  function currentRoute() {
    const raw = (location.hash || "#/overview").replace(/^#\/?/, "").split("?")[0];
    return ROUTES.includes(raw) ? raw : "overview";
  }

  function syncRangeButtons() {
    $$("[data-range-set]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.rangeSet) === state.range));
    });
  }

  function syncStreamInput() {
    if (!els.streamSearch) return;
    els.streamSearch.value = state.query;
    els.streamClear.hidden = !state.query;
  }

  function showRoute() {
    const next = currentRoute();
    const changed = next !== state.tab;
    state.tab = next;
    if (next !== "stream") clearTimeout(state.searchTimer);
    state.streamLimit = 40;
    state.sessionLimit = 30;

    $$("[data-page]").forEach((section) => {
      section.hidden = section.dataset.page !== next;
    });
    $$("[data-nav]").forEach((link) => {
      if (link.dataset.nav === next) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    document.title = next === "overview" ? "trace — activity, on the record" : `${PAGES[next]} · trace`;
    syncRangeButtons();
    syncStreamInput();
    renderCurrentView();

    if (changed) {
      window.scrollTo(0, 0);
      track("view", `Opened ${PAGES[next]}`);
    }
  }

  function goToStream({ type, sessionId }) {
    if (type !== undefined) state.typeFilter = type;
    if (sessionId !== undefined) state.sessionFilter = sessionId;
    state.query = "";
    state.streamLimit = 40;
    syncStreamInput();
    if (state.tab === "stream") renderStream();
    else location.hash = "#/stream";
  }

  /* ---------------- Event bindings ---------------- */

  function cacheElements() {
    els = {
      livePill: $("#live-pill"),
      liveText: $("#live-text"),
      exportTop: $("#export-top"),
      kpis: $("#kpis"),
      trendWrap: $("#trend-wrap"),
      trendChart: $("#trend-chart"),
      trendTip: $("#trend-tip"),
      trendTotal: $("#trend-total"),
      mixDonut: $("#mix-donut"),
      mixLegend: $("#mix-legend"),
      heatmap: $("#heatmap"),
      heatPeak: $("#heat-peak"),
      topScreens: $("#top-screens"),
      recentList: $("#recent-list"),
      sessionElapsed: $("#session-elapsed"),
      sessionMeta: $("#session-meta"),
      sessionLiveTag: $("#session-live-tag"),
      signals: $("#signals"),
      typeChips: $("#type-chips"),
      streamSearch: $("#stream-search"),
      streamClear: $("#stream-clear"),
      streamList: $("#stream-list"),
      streamEmpty: $("#stream-empty"),
      streamMore: $("#stream-more"),
      streamCount: $("#stream-count"),
      sessionFilter: $("#session-filter"),
      clearFilters: $("#clear-filters"),
      streamLiveText: $("#stream-live-text"),
      sessionSummary: $("#session-summary"),
      sessionList: $("#session-list"),
      sessionsEmpty: $("#sessions-empty"),
      sessionsMore: $("#sessions-more"),
      trackingToggle: $("#tracking-toggle"),
      trackingHint: $("#tracking-hint"),
      dataStats: $("#data-stats"),
      exportSettings: $("#export-settings"),
      restoreData: $("#restore-data"),
      clearData: $("#clear-data"),
      clearHint: $("#clear-hint"),
      drawer: $("#drawer"),
      drawerType: $("#drawer-type"),
      drawerTitle: $("#drawer-title"),
      drawerSub: $("#drawer-sub"),
      drawerMeta: $("#drawer-meta"),
      drawerJson: $("#drawer-json"),
      drawerClose: $("#drawer-close"),
      drawerFilter: $("#drawer-filter"),
      drawerSession: $("#drawer-session"),
      toast: $("#toast"),
      live: $("#live"),
    };
  }

  function bindEvents() {
    window.addEventListener("hashchange", showRoute);

    document.addEventListener("click", (event) => {
      const rangeButton = event.target.closest("[data-range-set]");
      if (rangeButton) {
        const range = Number(rangeButton.dataset.rangeSet);
        if (range === state.range) return;
        state.range = range;
        state.streamLimit = 40;
        state.sessionLimit = 30;
        syncRangeButtons();
        renderCurrentView();
        track("filter", `Changed range to ${state.range} days`);
        return;
      }

      const legend = event.target.closest("[data-legend-type]");
      if (legend) {
        const type = legend.dataset.legendType;
        goToStream({ type, sessionId: null });
        track("filter", `Filtered by ${TYPES[type].label}`);
        return;
      }
    });

    els.exportTop.addEventListener("click", exportJSON);
    els.exportSettings.addEventListener("click", exportJSON);

    els.livePill.addEventListener("click", () => {
      if (state.tab === "settings") return;
      location.hash = "#/settings";
    });

    els.typeChips.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-type]");
      if (!chip) return;
      const type = chip.dataset.type;
      if (type === state.typeFilter) return;
      state.typeFilter = type;
      state.streamLimit = 40;
      renderStream();
      track("filter", type === "all" ? "Cleared type filter" : `Filtered by ${TYPES[type].label}`);
      announce(state.typeFilter === "all" ? "Showing all event types." : `Filtering by ${TYPES[type].label.toLowerCase()} events.`);
    });

    els.streamSearch.addEventListener("input", () => {
      state.query = els.streamSearch.value;
      state.streamLimit = 40;
      els.streamClear.hidden = !state.query;
      renderStream();
      clearTimeout(state.searchTimer);
      const query = state.query.trim();
      if (!query) {
        state.lastTrackedQuery = "";
        return;
      }
      if (query.length < 2) return;
      state.searchTimer = setTimeout(() => {
        if (query === state.lastTrackedQuery) return;
        state.lastTrackedQuery = query;
        track("search", `Searched "${query.slice(0, 60)}"`);
      }, 900);
    });

    els.streamSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.streamSearch.value) {
        event.preventDefault();
        clearStreamSearch();
      }
    });

    els.streamClear.addEventListener("click", clearStreamSearch);

    els.clearFilters.addEventListener("click", () => {
      resetControls();
      renderStream();
      track("filter", "Cleared all filters");
      announce("Filters cleared.");
    });

    els.sessionFilter.addEventListener("click", () => {
      state.sessionFilter = null;
      renderStream();
      track("filter", "Cleared session filter");
    });

    els.streamMore.addEventListener("click", () => {
      state.streamLimit += 40;
      renderStream();
      track("click", "Loaded older events");
    });

    els.streamList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-event-id]");
      if (row) openDrawer(row.dataset.eventId);
    });

    els.recentList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-event-id]");
      if (row) openDrawer(row.dataset.eventId);
    });

    els.streamEmpty.addEventListener("click", handleEmptyAction);
    els.sessionsEmpty.addEventListener("click", handleEmptyAction);

    els.sessionList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-session-id]");
      if (!row) return;
      const session = getSession(row.dataset.sessionId);
      if (!session) return;
      state.sessionFilter = session.id;
      state.typeFilter = "all";
      state.query = "";
      state.lastTrackedQuery = "";
      state.streamLimit = 40;
      syncStreamInput();
      if (state.tab === "stream") renderStream();
      else location.hash = "#/stream";
      track("click", `Replayed session at ${fmtTime(session.startedAt)}`);
    });

    els.sessionsMore.addEventListener("click", () => {
      state.sessionLimit += 30;
      renderSessions();
      track("click", "Loaded older sessions");
    });

    els.trackingToggle.addEventListener("change", () => {
      if (els.trackingToggle.checked) {
        state.paused = false;
        track("click", "Resumed tracking");
      } else {
        track("click", "Paused tracking");
        state.paused = true;
      }
      persist();
      updateTrackingUI();
      renderDataStats();
      toast(state.paused ? "Tracking paused" : "Tracking resumed");
    });

    els.clearData.addEventListener("click", () => {
      if (els.clearData.classList.contains("is-arming")) {
        if (armReset) armReset();
        clearAllData();
        return;
      }
      armButton(els.clearData, "Clear all", "Confirm clear", els.clearHint);
    });

    els.restoreData.addEventListener("click", () => {
      if (els.restoreData.classList.contains("is-arming")) {
        if (armReset) armReset();
        restoreDemoData();
        return;
      }
      armButton(els.restoreData, "Restore demo data", "Confirm restore", null);
    });

    els.drawerClose.addEventListener("click", closeDrawer);
    els.drawer.addEventListener("click", (event) => {
      if (event.target === els.drawer) closeDrawer();
    });
    els.drawer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    });
    els.drawer.addEventListener("cancel", () => {
      document.body.classList.remove("modal-open");
      state.drawerEventId = null;
    });
    els.drawer.addEventListener("close", () => {
      document.body.classList.remove("modal-open");
      state.drawerEventId = null;
    });

    els.drawerFilter.addEventListener("click", () => {
      const event = getEvent(state.drawerEventId);
      if (!event) return;
      const type = event.type;
      closeDrawer();
      goToStream({ type, sessionId: null });
      track("filter", `Filtered by ${TYPES[type].label}`);
    });

    els.drawerSession.addEventListener("click", () => {
      const event = getEvent(state.drawerEventId);
      if (!event) return;
      const session = getSession(event.sessionId);
      closeDrawer();
      if (!session) return;
      state.sessionFilter = session.id;
      state.typeFilter = "all";
      state.query = "";
      syncStreamInput();
      goToStream({ sessionId: session.id });
      track("click", `Replayed session at ${fmtTime(session.startedAt)}`);
    });

    window.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable)) return;
      if (els.drawer.open) return;
      event.preventDefault();
      if (state.tab !== "stream") location.hash = "#/stream";
      setTimeout(() => els.streamSearch.focus(), 60);
    });

    window.addEventListener("resize", () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => {
        if (state.tab === "overview") renderTrend(buildSeries());
      }, 150);
    });
  }

  function handleEmptyAction(event) {
    const button = event.target.closest("[data-empty-action]");
    if (!button) return;
    const action = button.dataset.emptyAction;
    if (action === "restore") {
      restoreDemoData();
    } else if (action === "widen") {
      state.range = 30;
      syncRangeButtons();
      renderCurrentView();
      track("filter", "Changed range to 30 days");
    } else if (action === "clear-filters") {
      resetControls();
      renderStream();
      track("filter", "Cleared all filters");
    }
  }

  function clearStreamSearch() {
    if (!state.query && !els.streamSearch.value) return;
    state.query = "";
    state.lastTrackedQuery = "";
    state.streamLimit = 40;
    els.streamSearch.value = "";
    els.streamClear.hidden = true;
    renderStream();
    track("filter", "Cleared search");
    els.streamSearch.focus();
  }

  /* ---------------- Init ---------------- */

  function tickSession() {
    const session = getSession(state.activeSessionId);
    if (!session || !els.sessionElapsed) return;
    els.sessionElapsed.textContent = fmtElapsed(Date.now() - session.startedAt);
  }

  function init() {
    cacheElements();

    let seeded = false;
    const stored = loadStore();
    if (stored) {
      state.events = stored.events;
      state.sessions = stored.sessions;
      state.paused = stored.paused;
    } else {
      const fresh = seedData();
      state.events = fresh.events;
      state.sessions = fresh.sessions;
      seeded = true;
    }

    if (!state.sessions.length) ensureSession();
    else {
      const last = state.sessions[state.sessions.length - 1];
      state.activeSessionId = Date.now() - last.endedAt < SESSION_GAP ? last.id : ensureSession().id;
    }

    if (seeded) persist();

    if (!location.hash) {
      history.replaceState(null, "", `${location.pathname}${location.search}#/overview`);
    }

    bindEvents();
    syncRangeButtons();
    updateTrackingUI();
    showRoute();
    renderDataStats();

    setInterval(tickSession, 1000);
    tickSession();
  }

  init();
})();

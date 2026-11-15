// Future Me planner: shared by the phone app and the Telegram bot.
// Pure functions, no DOM, no network.

export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = 365;
export const HABIT_XP = 10;
export const STAGES = [1, 21, 61, 121, 221, 301]; // first level of each stage (hidden from the UI)

const AR = "٠١٢٣٤٥٦٧٨٩";
export const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
export const arNum = (n) => (n == null ? "؟" : ar(Number(n).toLocaleString("en-US")).replace(/,/g, "٬"));

export function localDate(offsetHours = 3, d = new Date()) {
  return new Date(d.getTime() + offsetHours * 3600e3).toISOString().slice(0, 10);
}
export function localHM(offsetHours = 3, d = new Date()) {
  const t = new Date(d.getTime() + offsetHours * 3600e3);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
export function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(date) { return new Date(date + "T00:00:00Z").getUTCDay(); } // 0=Sun

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function dateLabel(date) {
  const d = new Date(date + "T00:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]} ${ar(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

export function dayType(date, profile) {
  if ((profile.weekend_days || [5, 6]).includes(weekday(date))) return "weekend";
  if (profile.leave_end && date <= profile.leave_end) return "leave";
  return "work";
}
export const DAY_LABEL = { leave: "يوم إجازة · ٧ص–٤م لك", work: "يوم دوام · الساعة الذهبية", weekend: "ويكند · وقت العائلة" };

export function expandRoadmap(roadmap) {
  const out = [];
  for (const t of roadmap.tasks || []) {
    if (t.repeat) {
      const start = t.start || 1;
      for (let i = 0; i < t.repeat; i++) {
        const n = start + i;
        out.push({ ...t, id: `${t.id}-${n}`, base: t.id, n, title: t.title.replace("{n}", ar(n)) });
      }
    } else out.push({ ...t, base: t.id });
  }
  return out;
}

function dayEntry(state, date) { return (state.days && state.days[date]) || { tasks: [], habits: [], skipped: [] }; }

export function doneTaskSet(state, beforeDate) {
  const s = new Set();
  for (const [d, e] of Object.entries(state.days || {})) {
    if (beforeDate && d >= beforeDate) continue;
    (e.tasks || []).forEach((id) => s.add(id));
  }
  return s;
}

/** Today's plan: the next undone tasks in roadmap order. Stable during the day. */
export function planFor(date, data) {
  const { profile, roadmap, state } = data;
  const type = dayType(date, profile);
  const count = (profile.steps_per_day || {})[type] ?? 1;
  const slots = (profile.slots || {})[type] || [];
  const doneBefore = doneTaskSet(state, date);
  const today = dayEntry(state, date);
  const skipped = new Set(today.skipped || []);
  let pool = expandRoadmap(roadmap).filter((t) => !doneBefore.has(t.id) && !skipped.has(t.id));
  if (type === "weekend") {
    const light = pool.slice(0, 6).find((t) => t.kind === "light");
    pool = light ? [light] : [];
  } else if (type === "work") {
    // the golden hour fits one step; prefer the next task that fits in ~60 minutes
    const fit = pool.slice(0, 4).find((t) => (t.minutes || 60) <= 60);
    if (fit) pool = [fit, ...pool.filter((t) => t !== fit)];
  }
  const steps = pool.slice(0, count).map((t, i) => ({ ...t, slot: slots[i] || slots[slots.length - 1] || "", done: (today.tasks || []).includes(t.id) }));
  // also show tasks she finished today that are no longer at the front
  for (const id of today.tasks || []) {
    if (!steps.find((s) => s.id === id)) {
      const t = expandRoadmap(roadmap).find((x) => x.id === id);
      if (t) steps.push({ ...t, slot: "إضافي", done: true });
    }
  }
  return { date, type, label: DAY_LABEL[type], steps };
}

export function taskXP(t) { return t && t.kind === "light" ? 30 : 60; }

/* ---- daily content track: posts every day, prep for tomorrow, YouTube pipeline by weekday ---- */
export function contentXP(id) {
  if (id === "prep") return 30;
  if (id === "yt2") return 60;
  if (id.startsWith("yt-")) return 40;
  return 10; // one post
}
export function contentKind(id) { return id === "prep" ? "prep" : id.startsWith("yt") ? id : "post"; }
export function contentFor(date, profile, state) {
  const c = profile.content; if (!c) return [];
  const wd = weekday(date);
  const done = new Set(dayEntry(state, date).content || []);
  const out = (c.posts || []).map((p) => ({ id: p.id, title: p.name, emoji: p.emoji, kind: "post" }));
  if (c.prep) out.push({ id: "prep", title: c.prep.name, detail: c.prep.detail, minutes: c.prep.minutes, kind: "prep" });
  const y = c.youtube_pipeline && c.youtube_pipeline[String(wd)];
  if (y) out.push({ id: `yt-${wd}`, title: y.title, detail: y.detail, minutes: y.minutes, kind: "yt" });
  if (wd === 6 && c.youtube_second) out.push({ id: "yt2", title: c.youtube_second.title, detail: c.youtube_second.detail, minutes: c.youtube_second.minutes, kind: "yt", optional: true });
  return out.map((x) => ({ ...x, xp: contentXP(x.id), done: done.has(x.id) }));
}

export function totalXP(state, roadmap) {
  const all = expandRoadmap(roadmap);
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  let xp = 0;
  for (const e of Object.values(state.days || {})) {
    for (const id of e.tasks || []) xp += taskXP(byId[id]);
    xp += (e.habits || []).length * HABIT_XP;
    for (const id of e.content || []) xp += contentXP(id);
  }
  return xp;
}
export function levelOf(xp) { return Math.min(MAX_LEVEL, Math.floor(xp / XP_PER_LEVEL) + 1); }
export function stageOf(level) { let s = 1; STAGES.forEach((l, i) => { if (level >= l) s = i + 1; }); return s; }
export function nextStageIn(level) { const n = STAGES.find((l) => l > level); return n ? n - level : null; }

function activeDay(e) { return (e.tasks || []).length > 0 || (e.habits || []).length >= 3 || (e.content || []).length >= 2; }
export function streak(state, today) {
  let d = today, n = 0;
  if (!activeDay(dayEntry(state, d))) d = addDays(d, -1); // today not finished yet: count from yesterday
  while (activeDay(dayEntry(state, d))) { n++; d = addDays(d, -1); }
  return n;
}

export function counters(state, roadmap, notes) {
  const all = expandRoadmap(roadmap);
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const habit = {}, goal = {}, content = {};
  let tasks = 0;
  for (const e of Object.values(state.days || {})) {
    (e.habits || []).forEach((h) => (habit[h] = (habit[h] || 0) + 1));
    (e.content || []).forEach((id) => { const k = contentKind(id); content[k] = (content[k] || 0) + 1; });
    (e.tasks || []).forEach((id) => { tasks++; const g = byId[id] && byId[id].goal; if (g) goal[g] = (goal[g] || 0) + 1; });
  }
  return { habit, goal, content, tasks, notes: (notes || []).length };
}

export function earnedItems(items, ctx) {
  const { c, level, streakNow } = ctx;
  return items.filter((it) => {
    const w = it.when;
    if (w.tasks) return c.tasks >= w.tasks;
    if (w.habit) return (c.habit[w.habit] || 0) >= w.count;
    if (w.goal_tasks) return (c.goal[w.goal_tasks] || 0) >= w.count;
    if (w.streak) return streakNow >= w.streak;
    if (w.level) return level >= w.level;
    if (w.notes) return c.notes >= w.notes;
    if (w.content) return ((c.content || {})[w.content] || 0) >= w.count;
    return false;
  });
}

export function autoGoalValue(goal, state) {
  if (!goal.auto) return goal.current;
  let n = 0;
  doneTaskSet(state).forEach((id) => { if (id.startsWith(goal.auto + "-")) n++; });
  return n;
}

export function motivationFor(date, list) {
  if (!list || !list.length) return "";
  const n = Math.floor(new Date(date + "T00:00:00Z").getTime() / 86400e3);
  return list[n % list.length];
}

export function meetingsOn(date, meetings) {
  return (meetings || []).filter((m) => m.date === date).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

/* ---- work expenses ---- */
export const USD_RATE = 3.75;
export const EXP_CATS = ["منصات", "اشتراكات وأدوات", "إعلانات", "أجهزة ومعدات", "تعليم وكورسات", "أخرى"];
export const toSAR = (e) => Number(e.amount || 0) * (e.currency === "USD" ? USD_RATE : 1);
const ym = (d) => d.slice(0, 7);
function activeIn(e, month) { return ym(e.date) <= month && (!e.end || ym(e.end) >= month); }
/** What she pays in a given month (YYYY-MM): monthly subs, yearly subs renewing that month, one-time payments that month. */
export function spentInMonth(expenses, month) {
  let total = 0; const byCat = {};
  for (const e of expenses || []) {
    let v = 0;
    if (e.kind === "monthly" && activeIn(e, month)) v = toSAR(e);
    else if (e.kind === "yearly" && activeIn(e, month) && e.date.slice(5, 7) === month.slice(5, 7)) v = toSAR(e);
    else if (e.kind === "once" && ym(e.date) === month) v = toSAR(e);
    if (v) { total += v; byCat[e.category || "أخرى"] = (byCat[e.category || "أخرى"] || 0) + v; }
  }
  return { total, byCat };
}
/** Average monthly cost of the subscriptions she has right now (yearly ÷ 12). */
export function monthlyRunRate(expenses, month) {
  return (expenses || []).filter((e) => e.kind !== "once" && activeIn(e, month)).reduce((s, e) => s + (e.kind === "yearly" ? toSAR(e) / 12 : toSAR(e)), 0);
}
export function spentInYear(expenses, year, uptoMonth) {
  let t = 0;
  for (let m = 1; m <= 12; m++) { const mm = `${year}-${String(m).padStart(2, "0")}`; if (uptoMonth && mm > uptoMonth) break; t += spentInMonth(expenses, mm).total; }
  return t;
}
/** Subscriptions that renew on the given date. */
export function renewalsOn(date, expenses) {
  return (expenses || []).filter((e) => {
    if (e.kind === "once" || !activeIn(e, ym(date)) || e.date >= date) return false;
    if (e.kind === "monthly") return Number(e.date.slice(8, 10)) === Number(date.slice(8, 10));
    return e.date.slice(5, 10) === date.slice(5, 10);
  });
}

/* ---- business income ---- */
export const INC_SOURCES = ["المعسكر", "عملاء الداشبورد", "منتجات رقمية", "تعاون وإعلانات", "أخرى"];
export function incomeInMonth(income, month) {
  let total = 0; const bySource = {};
  for (const x of income || []) if ((x.date || "").slice(0, 7) === month) { const v = toSAR(x); total += v; bySource[x.source || "أخرى"] = (bySource[x.source || "أخرى"] || 0) + v; }
  return { total, bySource };
}
/** One row per month of the year: income, expenses, net. */
export function yearTable(year, income, expenses) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const inc = incomeInMonth(income, month).total, exp = spentInMonth(expenses, month).total;
    return { month, income: inc, expenses: exp, net: inc - exp };
  });
}
export const MONTH_NAMES = MONTHS;

export function nextCheckpoint(date, profile) {
  return (profile.checkpoints || []).find((c) => c >= date) || null;
}

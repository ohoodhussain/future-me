import * as P from "./planner.js";

/* ---------------- storage ----------------
   GitHub mode: data lives in her PRIVATE repo, read/written with her own token (kept only on this phone).
   Local mode (?local or file:/localhost): reads ../data, writes stay in this browser (for testing). */
const CFG_KEY = "futureme.cfg";
const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch { return null; } };
const saveCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
let cfg = loadCfg();
const LOCAL = new URLSearchParams(location.search).has("local");

const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (str) => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

const api = (path) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
const ghHeaders = () => ({ Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json" });

async function readFile(path) {
  if (LOCAL) {
    try { const o = localStorage.getItem("futureme.local." + path); if (o) return { data: JSON.parse(o) }; } catch {}
    const r = await fetch(`../data/${path}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return { data: await r.json() };
  }
  const r = await fetch(api(path) + `?t=${Date.now()}`, { headers: ghHeaders(), cache: "no-store" });
  if (r.status === 401) throw new Error("auth");
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}

async function writeFile(path, data, sha, message) {
  const text = JSON.stringify(data, null, 2) + "\n";
  if (LOCAL) { try { localStorage.setItem("futureme.local." + path, text); } catch {} return { sha: null }; }
  const r = await fetch(api(path), { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: b64encode(text), sha }) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error(`save ${path}: ${r.status}`);
  return { sha: (await r.json()).content.sha };
}

// one write at a time; each write re-reads the file and re-applies the change, so the bot and the app never overwrite each other
let queue = Promise.resolve();
function update(path, mutate, message) {
  mutate(D[KEY[path]]); // instant on screen
  setSync("…");
  queue = queue.then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await readFile(path);
      mutate(cur.data);
      const res = await writeFile(path, cur.data, cur.sha, message);
      if (!res.conflict) { D[KEY[path]] = cur.data; return; }
    }
    throw new Error("conflict");
  }).then(() => setSync("محفوظ ✓"), (e) => { console.error(e); setSync("ما انحفظ، بنحاول لما تفتحين مرة ثانية", true); });
  return queue;
}

const FILES = { profile: "profile.json", roadmap: "roadmap.json", habits: "habits.json", goals: "goals.json", state: "state.json",
  notes: "notes.json", meetings: "meetings.json", motivation: "motivation.json", items: "items.json" };
const KEY = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [v, k]));
const D = {};

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setSync = (t, err) => { const el = $("sync"); el.textContent = t; el.classList.toggle("err", !!err); };
let toastTimer;
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3200); }
const today = () => P.localDate(D.profile?.timezone_offset_hours ?? 3);
const stageImg = (s) => `stages/s${s}.jpg`;
function dayOf(state, date) { state.days ||= {}; return (state.days[date] ||= { tasks: [], habits: [], skipped: [] }); }

/* ---------------- plant (grows every level) ---------------- */
function plantSVG(L) {
  const x = 50, base = 150; let s = "";
  if (L < 8) s = `<ellipse cx="${x}" cy="${base - 8}" rx="9" ry="11" fill="#9b7442"/><path d="M${x - 4} ${base - 12} q4 4 8 0" stroke="#5d4426" stroke-width="1.5" fill="none"/>`;
  else {
    const g = Math.min(1, L / 300), h = 18 + g * 110, top = base - h;
    s += `<path d="M${x} ${base} Q${x - 6} ${base - h / 2} ${x} ${top}" stroke="${L >= 200 ? "#7a5a36" : "#1d9a83"}" stroke-width="${3 + g * 5}" fill="none" stroke-linecap="round"/>`;
    const n = Math.min(18, 2 + Math.floor(L / 10));
    for (let i = 0; i < n; i++) { const t = 0.2 + 0.78 * (i / Math.max(1, n - 1)), y = base - h * t, side = i % 2 ? 1 : -1, len = 9 + g * 12, cx = x + side * len;
      s += `<ellipse cx="${cx}" cy="${y}" rx="${len}" ry="${3.5 + g * 3}" fill="${i % 3 ? "#3fc1a4" : "#1d9a83"}" transform="rotate(${side * -28} ${cx} ${y})"/>`; }
    if (L >= 300) for (let i = 0; i < 6; i++) s += `<circle cx="${x - 8 + i * 3.2}" cy="${top + 6 + (i % 2) * 4}" r="3" fill="#e3c27e"/>`;
  }
  return `<svg viewBox="0 0 100 160" aria-hidden="true"><ellipse cx="50" cy="152" rx="26" ry="6" fill="#0a2027" opacity=".9"/><path d="M34 150 L66 150 L62 160 L38 160Z" fill="#7a5a36"/>${s}</svg>`;
}

/* ---------------- render ---------------- */
let lastEarned = null;
function render() {
  const date = today(), { profile, roadmap, state, habits } = D;
  const plan = P.planFor(date, D);
  const xp = P.totalXP(state, roadmap), level = P.levelOf(xp), stage = P.stageOf(level), streakNow = P.streak(state, date);
  const inLevel = xp % P.XP_PER_LEVEL;

  $("date").textContent = P.dateLabel(date);
  $("dayType").textContent = plan.label;
  $("motivation").textContent = P.motivationFor(date, D.motivation);
  $("miniPortrait").style.backgroundImage = `url(${stageImg(stage)})`;
  $("lvN").textContent = P.ar(level); $("lvBig").textContent = P.ar(level);
  $("streak").textContent = P.ar(streakNow);
  $("xpBar").style.width = $("xpBar2").style.width = `${inLevel}%`;
  $("xpT").textContent = `${P.ar(inLevel)} / ${P.ar(P.XP_PER_LEVEL)} نقطة`;
  const ns = P.nextStageIn(level);
  $("surprise").textContent = ns ? `🎁 مفاجأة بعد ${P.ar(ns)} مستوى` : "🌴 وصلتي";

  // meetings today
  const mt = P.meetingsOn(date, D.meetings);
  $("todayMeetings").innerHTML = mt.map((m) => `<div class="meet-today"><span>📅</span><div><span class="t">${esc(m.time)}</span> · اجتماع مع ${esc(m.with)}<small>${esc(m.topic || "")}</small></div></div>`).join("");

  // steps
  const td = dayOf(state, date);
  $("stepsTitle").textContent = plan.type === "weekend" ? "خطوة خفيفة (اختيارية)" : "خطوات اليوم";
  $("steps").innerHTML = plan.steps.length ? plan.steps.map((s) => `
    <div class="step ${s.done ? "done" : ""}">
      <button class="box" data-task="${esc(s.id)}" aria-pressed="${s.done}" aria-label="تم: ${esc(s.title)}">✓</button>
      <div><span class="slot">${esc(s.slot)}</span><span class="t">${esc(s.title)}</span>${s.detail ? `<span class="d">${esc(s.detail)}</span>` : ""}
        <div class="meta"><span>⏱️ ${P.ar(s.minutes || 30)} د</span><span>+${P.ar(P.taskXP(s))} نقطة</span>${s.done ? "" : `<button class="later" data-later="${esc(s.id)}">أأجلها لبكرة</button>`}</div></div>
    </div>`).join("") : `<p class="empty-note">${plan.type === "weekend" ? "اليوم لك ولعائلتك 🤍 استمتعي." : "خلصتي كل خطوات الخطة 🎉 قولي لـClaude يضيف لك خطوات جديدة."}</p>`;

  const content = P.contentFor(date, profile, state);
  $("posts").innerHTML = content.filter((c) => c.kind === "post").map((c) => `<button class="habit ${c.done ? "on" : ""}" data-content="${c.id}" aria-pressed="${c.done}">${c.emoji} ${esc(c.title)}</button>`).join("");
  $("contentSteps").innerHTML = content.filter((c) => c.kind !== "post").map((s) => `
    <div class="step ${s.done ? "done" : ""}">
      <button class="box" data-content="${esc(s.id)}" aria-pressed="${s.done}" aria-label="تم: ${esc(s.title)}">✓</button>
      <div><span class="slot">${s.optional ? "اختياري" : s.kind === "yt" ? "يوتيوب الأسبوع" : "تجهيز"}</span><span class="t">${esc(s.title)}</span>${s.detail ? `<span class="d">${esc(s.detail)}</span>` : ""}
        <div class="meta"><span>⏱️ ${P.ar(s.minutes || 30)} د</span><span>+${P.ar(s.xp)} نقطة</span></div></div>
    </div>`).join("");
  $("habits").innerHTML = habits.map((h) => `<button class="habit ${td.habits.includes(h.id) ? "on" : ""}" data-habit="${h.id}" aria-pressed="${td.habits.includes(h.id)}">${h.emoji} ${esc(h.name)}</button>`).join("");
  const doneSteps = plan.steps.filter((s) => s.done).length;
  const postsDone = content.filter((c) => c.kind === "post" && c.done).length, postsAll = content.filter((c) => c.kind === "post").length;
  $("evening").textContent = `اليوم: ${P.ar(doneSteps)} من ${P.ar(plan.steps.length)} خطوات · ${P.ar(postsDone)} من ${P.ar(postsAll)} منشورات · ${P.ar(td.habits.length)} عادات`;

  // journey
  const img = $("stageImg");
  if (img.dataset.s !== String(stage)) { img.dataset.s = stage; img.src = stageImg(stage); }
  $("plant").innerHTML = plantSVG(level);
  const within = (() => { const st = P.STAGES[stage - 1], nx = P.STAGES[stage] || P.MAX_LEVEL + 1; return (level - st) / (nx - st); })();
  $("glow").style.boxShadow = `inset 0 0 ${20 + within * 60}px rgba(227,194,126,${0.08 + within * 0.35})`;
  $("journeyLine").textContent = streakNow ? `${P.ar(streakNow)} يوم ورا بعض 🔥` : "ابدئي اليوم سلسلتك";
  const c = P.counters(state, roadmap, D.notes);
  const earned = P.earnedItems(D.items, { c, level, streakNow });
  const lockedCount = Math.max(0, D.items.length - earned.length);
  $("treasureCount").textContent = `· ${P.ar(earned.length)} مكتشفة`;
  $("shelf").innerHTML = earned.map((it) => `<div class="treasure"><span>${it.emoji}</span>${esc(it.name)}</div>`).join("") +
    Array.from({ length: Math.min(4, lockedCount) }, () => `<div class="treasure locked"><span>🎁</span>؟</div>`).join("");

  // new treasure / new stage
  const ids = earned.map((e) => e.id);
  if (lastEarned) { const fresh = earned.filter((e) => !lastEarned.includes(e.id)); if (fresh.length) toast(`كنز جديد ${fresh[0].emoji} ${fresh[0].name}`); }
  lastEarned = ids;
  if (stage > (state.seen_stage || 1)) showReveal(stage);

  renderGoals(date, state);
  renderMeetings(date);
  renderNotes();
}

function showReveal(stage) {
  $("revealImg").src = stageImg(stage);
  $("revealText").textContent = "شوفي كيف كبرتي 🤍 هذي إنتي، بتعبك والتزامك.";
  $("reveal").hidden = false;
  $("revealClose").onclick = () => { $("reveal").hidden = true; update(FILES.state, (s) => { s.seen_stage = Math.max(s.seen_stage || 1, stage); }, `مرحلة ${stage}`); };
}

function renderGoals(date, state) {
  const cp = P.nextCheckpoint(date, D.profile);
  $("checkpoint").innerHTML = cp ? `<b>المحطة القادمة · ${P.dateLabel(cp)}</b><span>نقيس النتائج سوا. لو ما فيه نتيجة، نغير الخطة بهدوء وبدون جلد ذات.</span>` : "";
  const groups = {};
  D.goals.forEach((g) => (groups[g.group] ||= []).push(g));
  $("goalGroups").innerHTML = Object.entries(groups).map(([name, gs]) => `<div class="grp"><b>${esc(name)}</b>${gs.map((g) => {
    const cur = P.autoGoalValue(g, state), pct = g.target && cur != null ? Math.min(100, (cur / g.target) * 100) : null;
    return `<button class="goal" data-goal="${g.id}"><div class="row"><span>${esc(g.name)}</span><em>${P.arNum(cur)} / ${P.arNum(g.target)} ${esc(g.unit)}</em></div>
      <div class="bar ${pct == null ? "empty" : ""}"><i style="width:${pct ?? 0}%"></i></div></button>`; }).join("")}</div>`).join("");
}

function renderMeetings(date) {
  const up = (D.meetings || []).filter((m) => m.date >= date).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  let html = "", last = "";
  for (const m of up) {
    if (m.date !== last) { html += `<div class="day-h">${m.date === date ? "اليوم · " : ""}${P.dateLabel(m.date)}</div>`; last = m.date; }
    html += `<div class="item"><div class="txt"><b>${esc(m.time)}</b> · ${esc(m.with)}<small>${esc(m.topic || "")}</small></div><button class="del" data-delmeet="${esc(m.id)}">حذف</button></div>`;
  }
  $("meetList").innerHTML = `<div class="list">${html || `<p class="empty-note">ما عندك اجتماعات جاية. أضيفي اجتماعات الـ 1:1 هنا، ويوصلك تذكير الصبح وقبل الموعد.</p>`}</div>`;
}

function renderResearch() {
  const r = D.research;
  if (!r || !r.ideas) { $("research").innerHTML = ""; return; }
  $("research").innerHTML = `<div class="card research"><b>💡 أفكار الأسبوع <small>${esc(r.date || "")}</small></b>
    ${r.headline ? `<p>${esc(r.headline)}</p>` : ""}
    ${r.ideas.map((i) => `<details><summary><span class="pf">${esc(i.platform || "")}</span> ${esc(i.title)}</summary>${i.hook ? `<p><b>الهوك:</b> ${esc(i.hook)}</p>` : ""}${i.why ? `<p class="why">${esc(i.why)}</p>` : ""}</details>`).join("")}
    ${(r.competitors || []).length ? `<details><summary>👀 إيش يسوون المنافسين</summary>${r.competitors.map((c) => `<p><b>${esc(c.name)}</b> · ${esc(c.platform || "")}<br>${esc(c.what_worked || "")}${c.idea_for_you ? `<br><span class="why">فكرتك: ${esc(c.idea_for_you)}</span>` : ""}</p>`).join("")}</details>` : ""}
    ${(r.trends || []).length ? `<details><summary>📈 ترندات واحتياج السوق</summary><ul>${r.trends.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>` : ""}
  </div>`;
}

function renderNotes() {
  renderResearch();
  const notes = [...(D.notes || [])].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  $("noteList").innerHTML = `<div class="list">${notes.map((n) => `<div class="item"><div class="txt">${esc(n.text)}<small>${n.from === "telegram" ? "من تيليجرام · " : ""}${esc((n.at || "").slice(0, 10))}</small></div><button class="del" data-delnote="${esc(n.id)}">حذف</button></div>`).join("") || `<p class="empty-note">لسه ما فيه نوت.</p>`}</div>`;
}

/* ---------------- interactions ---------------- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const date = today();
  if (t.dataset.task) {
    const id = t.dataset.task;
    update(FILES.state, (s) => { const d = dayOf(s, date); const i = d.tasks.indexOf(id); i >= 0 ? d.tasks.splice(i, 1) : d.tasks.push(id); }, `خطوة: ${id}`);
    if (!dayOf(D.state, date).tasks.includes(id)) {} else toast("برافو 🌱 خطوة أقرب لعهود المستقبلية");
    render();
  } else if (t.dataset.later) {
    const id = t.dataset.later;
    update(FILES.state, (s) => { const d = dayOf(s, date); d.skipped ||= []; if (!d.skipped.includes(id)) d.skipped.push(id); }, `تأجيل: ${id}`);
    toast("أجلناها لبكرة، ولا يهمك 🤍"); render();
  } else if (t.dataset.content) {
    const id = t.dataset.content;
    update(FILES.state, (s) => { const d = dayOf(s, date); d.content ||= []; const i = d.content.indexOf(id); i >= 0 ? d.content.splice(i, 1) : d.content.push(id); }, `محتوى: ${id}`);
    if ((dayOf(D.state, date).content || []).includes(id)) toast(id.startsWith("yt") ? "خطوة يوتيوب ✓ 🎥" : id === "prep" ? "مقاطع بكرة جاهزة 🎬" : "انشر ✓ 🚀");
    render();
  } else if (t.dataset.habit) {
    const id = t.dataset.habit;
    update(FILES.state, (s) => { const d = dayOf(s, date); const i = d.habits.indexOf(id); i >= 0 ? d.habits.splice(i, 1) : d.habits.push(id); }, `عادة: ${id}`);
    render();
  } else if (t.dataset.v) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b === t));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "v-" + t.dataset.v));
    try { localStorage.setItem("futureme.tab", t.dataset.v); } catch {}
    window.scrollTo(0, 0);
  } else if (t.dataset.goal) {
    editGoal(t.dataset.goal);
  } else if (t.dataset.delmeet || t.dataset.delnote) {
    if (!t.classList.contains("arm")) { t.classList.add("arm"); t.textContent = "متأكدة؟"; setTimeout(() => { t.classList.remove("arm"); t.textContent = "حذف"; }, 3000); return; }
    if (t.dataset.delmeet) update(FILES.meetings, (m) => { const i = m.findIndex((x) => x.id === t.dataset.delmeet); if (i >= 0) m.splice(i, 1); }, "حذف اجتماع");
    else update(FILES.notes, (n) => { const i = n.findIndex((x) => x.id === t.dataset.delnote); if (i >= 0) n.splice(i, 1); }, "حذف نوت");
    render();
  }
});

$("meetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const m = { id: "m" + Date.now(), date: $("mDate").value, time: $("mTime").value, with: $("mWith").value.trim(), topic: $("mTopic").value.trim() };
  update(FILES.meetings, (arr) => { if (!arr.find((x) => x.id === m.id)) arr.push(m); }, "اجتماع جديد");
  e.target.reset(); $("mDate").value = today(); toast("انحفظ الاجتماع 📅 بيوصلك تذكير"); render();
});
$("noteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = { id: "n" + Date.now(), text: $("noteText").value.trim(), at: new Date().toISOString(), from: "app" };
  if (!n.text) return;
  update(FILES.notes, (arr) => { if (!arr.find((x) => x.id === n.id)) arr.push(n); }, "نوت جديدة");
  e.target.reset(); toast("انحفظت 📝"); render();
});

function sheet(title, html, onReady) {
  $("sheetTitle").textContent = title; $("sheetBody").innerHTML = html; $("sheet").hidden = false; onReady && onReady();
}
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet" || e.target.dataset.close != null) $("sheet").hidden = true; });

function editGoal(id) {
  const g = D.goals.find((x) => x.id === id);
  if (g.auto) { sheet(g.name, `<p>هذا الهدف يتحدث لحاله كل ما تخلصين خطوة تسجيل 🎙️</p><button class="btn ghost" data-close>تمام</button>`); return; }
  sheet(g.name, `<form class="form" id="goalForm">
      <label>وين وصلتي الحين؟ (${esc(g.unit)})<input id="gCur" type="number" inputmode="numeric" value="${g.current ?? ""}"></label>
      <label>الهدف (${esc(g.unit)})<input id="gTar" type="number" inputmode="numeric" value="${g.target ?? ""}"></label>
      <button class="btn" type="submit">احفظي</button><button class="btn ghost" type="button" data-close>إلغاء</button></form>`, () => {
    $("goalForm").onsubmit = (e) => {
      e.preventDefault();
      const cur = $("gCur").value === "" ? null : Number($("gCur").value), tar = $("gTar").value === "" ? null : Number($("gTar").value);
      update(FILES.goals, (arr) => { const x = arr.find((y) => y.id === id); if (x) { x.current = cur; x.target = tar; } }, `هدف: ${id}`);
      $("sheet").hidden = true; toast("تحدث الهدف 🎯"); render();
    };
  });
}

function settings(first) {
  const c = cfg || { owner: "ohoodhussain", repo: "future-me-data", token: "" };
  sheet(first ? "أهلاً يا عهود 🌱" : "الإعدادات", `
    ${first ? "<p>أول مرة بس: اربطي التطبيق بمستودع بياناتك الخاص. Claude يشرح لك الخطوات.</p>" : ""}
    <form class="form" id="cfgForm" autocomplete="off">
      <label>اسم حسابك في GitHub<input id="cOwner" value="${esc(c.owner)}" dir="ltr"></label>
      <label>اسم مستودع البيانات<input id="cRepo" value="${esc(c.repo)}" dir="ltr"></label>
      <label>المفتاح (Token)<input id="cTok" type="password" value="${esc(c.token)}" dir="ltr" placeholder="github_pat_…"></label>
      <small class="hint">المفتاح ينحفظ في جوالك بس.</small>
      <button class="btn" type="submit">احفظي وافتحي</button>
      ${first ? "" : `<button class="btn ghost" type="button" data-close>إغلاق</button>`}
    </form>`, () => {
    $("cfgForm").onsubmit = (e) => { e.preventDefault(); cfg = { owner: $("cOwner").value.trim(), repo: $("cRepo").value.trim(), token: $("cTok").value.trim() }; saveCfg(cfg); $("sheet").hidden = true; boot(); };
  });
}
$("openSettings").onclick = () => settings(false);

/* ---------------- boot ---------------- */
async function boot() {
  if (!LOCAL && !(cfg && cfg.token)) { settings(true); return; }
  setSync("…");
  try {
    const entries = await Promise.all(Object.entries(FILES).map(async ([k, f]) => [k, (await readFile(f)).data]));
    entries.forEach(([k, v]) => (D[k] = v));
    try { D.research = (await readFile("research/latest.json")).data; } catch { D.research = null; } // optional, written by the weekly research
    D.roadmap ||= { tasks: [] };
    setSync(LOCAL ? "تجربة محلية" : "محفوظ ✓");
    $("mDate").value = today();
    render();
    let tab = "today"; try { tab = localStorage.getItem("futureme.tab") || "today"; } catch {}
    document.querySelector(`.tabs button[data-v="${tab}"]`)?.click();
  } catch (e) {
    console.error(e);
    setSync("ما قدرت أفتح بياناتك", true);
    if (String(e.message) === "auth") settings(false);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && D.state) boot(); });
if ("serviceWorker" in navigator && !LOCAL) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();

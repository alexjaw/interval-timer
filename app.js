'use strict';

const APP_VERSION = '1.2.0';

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

function fmt(secs, pad = true) {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const ss = String(s).padStart(2, '0');
  if (h) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${pad ? String(m).padStart(2, '0') : m}:${ss}`;
}

const MAX_SECS = 99 * 60 + 59;
const ICON = {
  minus: '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>',
  resume: '<path d="M8 5v14l11-7z"/>',
};

/* ---------- state ---------- */
const DEFAULTS = {
  simple: { sets: 8, ready: 10, work: 20, rest: 10, cool: 0 },
  adv: {
    ready: 10, rounds: 3, roundRest: 30, cool: 0,
    items: [
      { name: 'Work', type: 'work', secs: 40 },
      { name: 'Rest', type: 'rest', secs: 20 },
    ],
  },
  settings: { sound: true, volume: 0.8, countdown: 0, voice: false, vibrate: true, wake: true },
};
const clone = o => JSON.parse(JSON.stringify(o));

let cur = Object.assign({ mode: 'simple', name: '', simple: clone(DEFAULTS.simple), adv: clone(DEFAULTS.adv) },
  LS.get('it.current', {}));
let settings = Object.assign(clone(DEFAULTS.settings), LS.get('it.settings', {}));
// v1.1: single beep per transition by default; countdown beeps are now opt-in
if (!settings.v11) { settings.countdown = 0; settings.v11 = true; LS.set('it.settings', settings); }
let presets = LS.get('it.presets', []);
let logs = LS.get('it.history', []);

const saveCur = () => LS.set('it.current', cur);
const saveSettings = () => LS.set('it.settings', settings);
const savePresets = () => LS.set('it.presets', presets);
const saveHistory = () => LS.set('it.history', logs);

/* ---------- workout -> steps ---------- */
function buildSteps(w) {
  const steps = [];
  if (w.mode === 'simple') {
    const c = w.simple;
    if (c.ready > 0) steps.push({ kind: 'ready', label: 'Get Ready', secs: c.ready });
    for (let i = 1; i <= c.sets; i++) {
      if (c.work > 0) steps.push({ kind: 'work', label: 'Work', secs: c.work, sub: `Set ${i} / ${c.sets}` });
      if (c.rest > 0 && i < c.sets) steps.push({ kind: 'rest', label: 'Rest', secs: c.rest, sub: `Set ${i} / ${c.sets}` });
    }
    if (c.cool > 0) steps.push({ kind: 'cool', label: 'Cool Down', secs: c.cool });
  } else {
    const c = w.adv;
    const items = c.items.filter(it => it.secs > 0);
    if (c.ready > 0) steps.push({ kind: 'ready', label: 'Get Ready', secs: c.ready });
    for (let r = 1; r <= c.rounds; r++) {
      items.forEach((it, i) => steps.push({
        kind: it.type, label: it.name || (it.type === 'work' ? 'Work' : 'Rest'), secs: it.secs,
        sub: `Round ${r} / ${c.rounds}` + (items.length > 1 ? ` · ${i + 1} / ${items.length}` : ''),
      }));
      if (c.roundRest > 0 && r < c.rounds && items.length)
        steps.push({ kind: 'rest', label: 'Round Rest', secs: c.roundRest, sub: `Round ${r} / ${c.rounds}` });
    }
    if (c.cool > 0) steps.push({ kind: 'cool', label: 'Cool Down', secs: c.cool });
  }
  return steps;
}
const totalOf = steps => steps.reduce((a, s) => a + s.secs, 0);

function summary(w) {
  if (w.mode === 'simple') {
    const c = w.simple;
    return `${c.sets} × ${fmt(c.work, false)}` + (c.rest ? ` / ${fmt(c.rest, false)} rest` : '');
  }
  const c = w.adv;
  return `${c.rounds} rounds × ${c.items.length} intervals`;
}

/* ---------- editor ---------- */
// press-and-hold repeat for +/- buttons
function holdRepeat(btn, fn) {
  let t1, t2, n;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault(); n = 0; fn(1);
    t1 = setTimeout(() => {
      t2 = setInterval(() => { n++; fn(n > 25 ? 10 : n > 10 ? 5 : 1); }, 90);
    }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

function pmButtons(onStep) {
  const minus = document.createElement('button');
  minus.className = 'pm'; minus.innerHTML = ICON.minus; minus.setAttribute('aria-label', 'Decrease');
  const plus = document.createElement('button');
  plus.className = 'pm'; plus.innerHTML = ICON.plus; plus.setAttribute('aria-label', 'Increase');
  holdRepeat(minus, k => onStep(-k));
  holdRepeat(plus, k => onStep(k));
  return [minus, plus];
}

function selectOnFocus(inp) { inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0)); }

// mm:ss field bound to obj[key]
function timeControl(obj, key, onChange) {
  const ctl = document.createElement('div');
  ctl.className = 'field-ctl';
  const vals = document.createElement('div');
  vals.className = 'vals';
  vals.innerHTML = `<input class="num" inputmode="numeric" maxlength="2" aria-label="minutes"><span>:</span><input class="num" inputmode="numeric" maxlength="2" aria-label="seconds">`;
  const [mi, si] = $$('input', vals);
  const show = () => {
    mi.value = String(Math.floor(obj[key] / 60)).padStart(2, '0');
    si.value = String(obj[key] % 60).padStart(2, '0');
  };
  const set = v => { obj[key] = clamp(v, 0, MAX_SECS); show(); onChange(); };
  const fromInputs = () => set((parseInt(mi.value, 10) || 0) * 60 + (parseInt(si.value, 10) || 0));
  [mi, si].forEach(inp => {
    selectOnFocus(inp);
    inp.addEventListener('change', fromInputs);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  const [minus, plus] = pmButtons(d => set(obj[key] + d));
  ctl.append(minus, vals, plus);
  show();
  return ctl;
}

function countControl(obj, key, min, max, onChange) {
  const ctl = document.createElement('div');
  ctl.className = 'field-ctl';
  const vals = document.createElement('div');
  vals.className = 'vals';
  vals.innerHTML = `<input class="num wide" inputmode="numeric" maxlength="3">`;
  const inp = $('input', vals);
  const show = () => { inp.value = obj[key]; };
  const set = v => { obj[key] = clamp(v, min, max); show(); onChange(); };
  selectOnFocus(inp);
  inp.addEventListener('change', () => set(parseInt(inp.value, 10) || min));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  const [minus, plus] = pmButtons(d => set(obj[key] + d));
  ctl.append(minus, vals, plus);
  show();
  return ctl;
}

function field(label, control) {
  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = `<div class="field-label">${esc(label)}</div>`;
  f.append(control);
  return f;
}

function changed() { saveCur(); updateTotal(); }

function renderEditor() {
  const ed = $('#editor');
  ed.innerHTML = '';
  $$('.seg').forEach(b => b.classList.toggle('active', b.dataset.mode === cur.mode));
  if (cur.mode === 'simple') {
    const c = cur.simple;
    ed.append(
      field('Sets', countControl(c, 'sets', 1, 999, changed)),
      field('Get Ready', timeControl(c, 'ready', changed)),
      field('Time per Set', timeControl(c, 'work', changed)),
      field('Rest', timeControl(c, 'rest', changed)),
      field('Cool Down', timeControl(c, 'cool', changed)),
    );
  } else {
    const c = cur.adv;
    ed.append(
      field('Get Ready', timeControl(c, 'ready', changed)),
      field('Rounds', countControl(c, 'rounds', 1, 999, changed)),
    );
    const head = document.createElement('div');
    head.className = 'adv-head';
    head.innerHTML = '<span>Intervals per round</span>';
    ed.append(head);
    const list = document.createElement('div');
    ed.append(list);
    const renderItems = () => {
      list.innerHTML = '';
      c.items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = `item ${it.type}`;
        row.innerHTML = `<div class="stripe"></div>
          <div class="item-main">
            <div class="item-row">
              <input class="name" maxlength="30" placeholder="Name" value="${esc(it.name)}">
              <select aria-label="Type"><option value="work">Work</option><option value="rest">Rest</option></select>
            </div>
          </div>
          <div class="item-tools">
            <button class="tool up" aria-label="Move up">${ICON.up}</button>
            <button class="tool del" aria-label="Delete">${ICON.del}</button>
            <button class="tool down" aria-label="Move down">${ICON.down}</button>
          </div>`;
        const tc = timeControl(it, 'secs', changed);
        $('.item-main', row).append(tc);
        const sel = $('select', row);
        sel.value = it.type;
        sel.addEventListener('change', () => { it.type = sel.value; row.className = `item ${it.type}`; changed(); });
        $('.name', row).addEventListener('input', e => { it.name = e.target.value; saveCur(); });
        $('.up', row).onclick = () => { if (i > 0) { [c.items[i - 1], c.items[i]] = [c.items[i], c.items[i - 1]]; renderItems(); changed(); } };
        $('.down', row).onclick = () => { if (i < c.items.length - 1) { [c.items[i + 1], c.items[i]] = [c.items[i], c.items[i + 1]]; renderItems(); changed(); } };
        $('.del', row).onclick = () => { c.items.splice(i, 1); renderItems(); changed(); };
        $('.up', row).disabled = i === 0;
        list.append(row);
      });
    };
    renderItems();
    const add = document.createElement('button');
    add.className = 'btn block';
    add.textContent = '+ Add interval';
    add.onclick = () => {
      const last = c.items[c.items.length - 1];
      const type = last && last.type === 'work' ? 'rest' : 'work';
      c.items.push({ name: type === 'work' ? 'Work' : 'Rest', type, secs: type === 'work' ? 30 : 15 });
      renderItems(); changed();
    };
    ed.append(add);
    ed.append(
      field('Rest between rounds', timeControl(c, 'roundRest', changed)),
      field('Cool Down', timeControl(c, 'cool', changed)),
    );
  }
  updateTotal();
}

function updateTotal() {
  const total = totalOf(buildSteps(cur));
  $('#totalTime').textContent = fmt(total);
  $('#playPill').disabled = total === 0;
  $('#title').textContent = cur.name || 'Interval Timer';
}

/* ---------- audio ---------- */
let actx = null, master = null, scheduled = [];
function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  master.gain.value = settings.volume;
  return actx;
}

function tone(when, freq, dur, track = true, tag = '') {
  if (!actx || !settings.sound) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(1, when + 0.01);
  g.gain.setValueAtTime(1, when + dur - 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + dur + 0.02);
  if (track) {
    const rec = { o, g, tag, when };
    scheduled.push(rec);
    o.onended = () => { g.disconnect(); scheduled = scheduled.filter(x => x !== rec); };
  }
}

// Stop scheduled beeps. keepTag lets the finish sound play out when the workout ends.
function cancelAudio(keepTag) {
  scheduled.forEach(({ o, g, tag }) => {
    if (keepTag && tag === keepTag) return;
    try { o.onended = null; o.stop(); g.disconnect(); } catch { /* not started */ }
  });
  scheduled = keepTag ? scheduled.filter(r => r.tag === keepTag) : [];
}

// Finish sound: three rising notes, distinct from the single set/rest beeps
function finishTones(when, track = true) {
  tone(when, 784, 0.18, track, 'end');
  tone(when + 0.2, 988, 0.18, track, 'end');
  tone(when + 0.4, 1319, 0.8, track, 'end');
}

// Cue for the start of a step (or the end of the workout when kind === 'end')
function cueTones(when, kind) {
  // exactly one beep per transition: higher when a set starts, lower when rest starts
  if (kind === 'work') tone(when, 1320, 0.5);
  else if (kind === 'end') finishTones(when);
  else tone(when, 660, 0.5);
}

// Schedule every beep from now to the end on the audio clock, so beeps stay on time
// even if the browser throttles JavaScript while the screen is off.
function scheduleAudio() {
  cancelAudio();
  if (!actx || !settings.sound || run.paused) return;
  const nowWall = Date.now();
  const offset = actx.currentTime - nowWall / 1000;
  const at = ms => ms / 1000 + offset;
  let end = run.endAt;
  for (let i = run.idx; i < run.steps.length; i++) {
    const st = run.steps[i];
    const start = end - st.secs * 1000;
    for (let k = 1; k <= settings.countdown; k++) {
      const t = end - k * 1000;
      if (t > nowWall + 30 && t > start + 400) tone(at(t), 880, 0.12);
    }
    const next = run.steps[i + 1];
    if (end > nowWall) cueTones(at(end), next ? next.kind : 'end');
    if (next) end += next.secs * 1000;
  }
}

function speak(text) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.volume = settings.volume;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

function vibrate(pattern) {
  if (settings.vibrate && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

/* ---------- wake lock ---------- */
let wakeLock = null;
async function lockScreen() {
  if (!settings.wake || !('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function unlockScreen() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }

/* ---------- runner ---------- */
const run = { active: false, steps: [], idx: 0, endAt: 0, remainMs: 0, paused: false, total: 0, name: '', timer: null, startedAt: 0 };

function startWorkout(w) {
  const steps = buildSteps(w);
  if (!steps.length) return;
  ensureAudio();
  Object.assign(run, {
    active: true, steps, idx: 0, paused: false, total: totalOf(steps),
    name: w.name || summary(w), startedAt: Date.now(), activeMs: 0, resumedAt: Date.now(),
  });
  run.endAt = Date.now() + steps[0].secs * 1000;
  $('#runner').hidden = false;
  $('#runner').className = 'runner';
  $('#runName').textContent = run.name;
  $('#runVolume').value = settings.volume;
  setPauseIcon();
  $('#pausedTag').hidden = true;
  onStepStart(true, false);
  scheduleAudio();
  lockScreen();
  clearInterval(run.timer);
  run.timer = setInterval(tick, 200);
  tick();
}

function elapsedMs(now = Date.now()) {
  let ms = 0;
  for (let i = 0; i < run.idx; i++) ms += run.steps[i].secs * 1000;
  const st = run.steps[run.idx];
  const remain = run.paused ? run.remainMs : Math.max(0, run.endAt - now);
  return ms + st.secs * 1000 - remain;
}

// real training time (excludes pauses and skipped intervals)
function activeMs(now = Date.now()) { return run.activeMs + (run.paused ? 0 : now - run.resumedAt); }

function onStepStart(live, withVibe = true) {
  const st = run.steps[run.idx];
  $('#runner').className = `runner ${st.kind}`;
  $('#phaseLabel').textContent = st.label;
  $('#phaseSub').textContent = st.sub || '';
  const nx = run.steps[run.idx + 1];
  $('#nextUp').textContent = nx ? `Next: ${nx.label} ${fmt(nx.secs, false)}` : 'Last interval';
  if (live) {
    speak(st.label);
    if (withVibe) vibrate(st.kind === 'work' ? [400] : [150, 100, 150]);
  }
}

function tick() {
  if (!run.active) return;
  const now = Date.now();
  if (!run.paused) {
    let advanced = false;
    while (now >= run.endAt) {
      if (run.idx >= run.steps.length - 1) { finish(true); return; }
      run.idx++;
      run.endAt += run.steps[run.idx].secs * 1000;
      advanced = true;
    }
    // only give voice/vibration cues if we're not catching up after a long freeze
    if (advanced) onStepStart(now - (run.endAt - run.steps[run.idx].secs * 1000) < 1500);
  }
  render(now);
}

function render(now = Date.now()) {
  const st = run.steps[run.idx];
  const remain = run.paused ? run.remainMs : Math.max(0, run.endAt - now);
  $('#bigTime').textContent = fmt(Math.ceil(remain / 1000 - 0.001));
  setRing(1 - remain / (st.secs * 1000));
  const el = elapsedMs(now) / 1000;
  $('#runElapsed').textContent = fmt(el, false);
  $('#runRemaining').textContent = fmt(run.total - el, false);
}

const RING_LEN = 2 * Math.PI * 88;
function setRing(frac) {
  const fg = $('#ringFg');
  fg.style.strokeDasharray = `${RING_LEN}`;
  fg.style.strokeDashoffset = `${RING_LEN * (1 - clamp(frac, 0, 1))}`;
}

function setPauseIcon() { $('#pauseIcon').innerHTML = run.paused ? ICON.resume : ICON.pause; }

function togglePause() {
  if (!run.active) { closeRunner(); return; }
  ensureAudio();
  const now = Date.now();
  if (run.paused) {
    run.paused = false;
    run.resumedAt = now;
    run.endAt = now + run.remainMs;
    scheduleAudio();
    lockScreen();
  } else {
    run.activeMs += now - run.resumedAt;
    run.paused = true;
    run.remainMs = Math.max(0, run.endAt - now);
    cancelAudio();
  }
  $('#pausedTag').hidden = !run.paused;
  setPauseIcon();
  render(now);
}

function jumpTo(idx) {
  run.idx = idx;
  const ms = run.steps[idx].secs * 1000;
  if (run.paused) run.remainMs = ms; else run.endAt = Date.now() + ms;
  onStepStart(!run.paused);
  if (!run.paused && actx) cueTones(actx.currentTime + 0.02, run.steps[idx].kind === 'work' ? 'work' : 'rest');
  scheduleAudio();
  render();
}

function nextStep() {
  if (!run.active) return;
  if (run.idx >= run.steps.length - 1) { finish(true); return; }
  jumpTo(run.idx + 1);
}

function prevStep() {
  if (!run.active) return;
  const st = run.steps[run.idx];
  const remain = run.paused ? run.remainMs : run.endAt - Date.now();
  const into = st.secs * 1000 - remain;
  jumpTo(into > 3000 || run.idx === 0 ? run.idx : run.idx - 1);
}

function logHistory(completed) {
  const el = Math.round(activeMs() / 1000);
  if (!completed && el < 10) return;
  logs.unshift({ ts: run.startedAt, name: run.name, planned: run.total, elapsed: el, completed });
  logs = logs.slice(0, 1000);
  saveHistory();
}

function finish(completed) {
  if (!run.active) return;
  logHistory(completed);
  if (completed) { run.idx = run.steps.length - 1; run.activeMs = activeMs(); run.paused = true; run.remainMs = 0; }
  run.active = false;
  clearInterval(run.timer);
  if (completed && actx && settings.sound) {
    // Keep the scheduled finish sound if it is playing now; otherwise (e.g. Next on the last set) play it right away.
    const t = actx.currentTime;
    const onTime = scheduled.some(r => r.tag === 'end' && r.when > t - 1.5 && r.when < t + 0.5);
    cancelAudio(onTime ? 'end' : undefined);
    if (!onTime) finishTones(t + 0.02, false);
  } else cancelAudio();
  unlockScreen();
  if (!completed) { $('#runner').hidden = true; renderStats(); return; }
  vibrate([500, 150, 500]);
  speak('Workout complete');
  $('#runner').className = 'runner done';
  $('#phaseLabel').textContent = 'Done!';
  $('#bigTime').textContent = fmt(run.total);
  $('#phaseSub').textContent = 'Workout complete';
  $('#runName').textContent = run.name;
  $('#nextUp').textContent = 'Tap to close';
  setRing(1);
  $('#runRemaining').textContent = '0:00';
  $('#runElapsed').textContent = fmt(run.total, false);
  $('#pausedTag').hidden = true;
  setPauseIcon();
  renderStats();
}

function closeRunner() { $('#runner').hidden = true; }

async function stopWorkout() {
  if (!run.active) { closeRunner(); return; }
  const wasRunning = !run.paused;
  if (wasRunning) togglePause();
  const ok = await modal({ title: 'Stop workout?', body: 'Progress so far is saved to your history.',
    buttons: [{ label: 'Continue', value: false }, { label: 'Stop', value: true, cls: 'danger' }] });
  if (ok) finish(false);
  else if (wasRunning) togglePause();
}

$('#pauseBtn').onclick = togglePause;
$('#nextBtn').onclick = nextStep;
$('#prevBtn').onclick = prevStep;
$('#restartBtn').onclick = () => { if (run.active) jumpTo(run.idx); };
$('#runVolume').addEventListener('input', e => {
  settings.volume = Number(e.target.value); saveSettings();
  if (master) master.gain.value = settings.volume;
  $('#setVolume').value = settings.volume;
});
$('#stopBtn').onclick = stopWorkout;
$('#runCenter').onclick = () => { if (run.active) togglePause(); else closeRunner(); };

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && run.active) {
    ensureAudio();
    if (!run.paused) lockScreen();
    tick();
    scheduleAudio();
  }
});

/* ---------- modal ---------- */
function modal({ title, body = '', input = null, buttons }) {
  return new Promise(resolve => {
    $('#modalTitle').textContent = title;
    const b = $('#modalBody');
    b.innerHTML = '';
    let inp = null;
    if (input) {
      inp = document.createElement('input');
      inp.type = 'text'; inp.value = input.value || ''; inp.placeholder = input.placeholder || ''; inp.maxLength = 40;
      b.append(inp);
    } else {
      b.innerHTML = `<p class="muted" style="margin:0">${esc(body)}</p>`;
    }
    const btns = $('#modalBtns');
    btns.innerHTML = '';
    const close = v => { $('#modal').hidden = true; resolve(v); };
    buttons.forEach(bt => {
      const el = document.createElement('button');
      el.className = `btn ${bt.cls || ''}`;
      el.textContent = bt.label;
      el.onclick = () => close(bt.value === 'input' ? inp.value.trim() : bt.value);
      btns.append(el);
    });
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value.trim()); });
    $('#modal').hidden = false;
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 50);
    $('#modal').onclick = e => { if (e.target.id === 'modal') close(null); };
  });
}

/* ---------- saved workouts ---------- */
async function saveWorkout() {
  const name = await modal({ title: 'Save workout', input: { value: cur.name, placeholder: 'e.g. Tabata, Core 30' },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'input', cls: 'primary' }] });
  if (!name) return;
  cur.name = name;
  const data = { id: uid(), name, mode: cur.mode, simple: clone(cur.simple), adv: clone(cur.adv), updated: Date.now() };
  const i = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) { data.id = presets[i].id; presets[i] = data; } else presets.push(data);
  savePresets(); saveCur(); updateTotal(); renderSaved();
  toast(`Saved “${name}”`);
}

function loadPreset(p) {
  cur = { mode: p.mode, name: p.name, simple: clone(p.simple), adv: clone(p.adv) };
  saveCur(); renderEditor();
}

function renderSaved() {
  const el = $('#savedList');
  if (!presets.length) {
    el.innerHTML = '<div class="empty">No saved workouts yet.<br>Set up a timer and tap the save icon.</div>';
    return;
  }
  el.innerHTML = '';
  [...presets].sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
    const row = document.createElement('div');
    row.className = 'saved';
    row.innerHTML = `<div class="saved-main"><div class="saved-name">${esc(p.name)}</div>
      <div class="saved-sub">${fmt(totalOf(buildSteps(p)))} · ${esc(summary(p))}</div></div>
      <button class="round-btn del" aria-label="Delete">${ICON.del}</button>
      <button class="round-btn go" aria-label="Start">${ICON.play}</button>`;
    $('.saved-main', row).onclick = () => { loadPreset(p); showView('timer'); };
    $('.go', row).onclick = () => { loadPreset(p); startWorkout(cur); };
    $('.del', row).onclick = async () => {
      const ok = await modal({ title: `Delete “${p.name}”?`, body: 'This cannot be undone.',
        buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, cls: 'danger' }] });
      if (ok) { presets = presets.filter(x => x.id !== p.id); savePresets(); renderSaved(); }
    };
    el.append(row);
  });
}

/* ---------- stats ---------- */
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function renderStats() {
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = from => {
    const h = logs.filter(x => x.ts >= +from);
    return { n: h.length, secs: h.reduce((a, x) => a + x.elapsed, 0) };
  };
  const w = agg(startOfWeek), m = agg(startOfMonth), a = agg(new Date(0));
  const hm = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)} min`;
  $('#statCards').innerHTML = [['This week', w], ['This month', m], ['All time', a]].map(([l, v]) =>
    `<div class="stat"><div class="lbl">${l}</div><b>${v.n}</b><small>${hm(v.secs)}</small></div>`).join('');

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ d, key: dayKey(d), secs: 0 });
  }
  const byKey = Object.fromEntries(days.map(x => [x.key, x]));
  logs.forEach(x => { const k = dayKey(new Date(x.ts)); if (byKey[k]) byKey[k].secs += x.elapsed; });
  const max = Math.max(60, ...days.map(x => x.secs));
  $('#chart').innerHTML = days.map(x => {
    const mins = Math.round(x.secs / 60);
    return `<div class="col" title="${x.d.toLocaleDateString()}: ${mins} min">
      <div class="b ${x.secs ? '' : 'zero'}" style="height:${x.secs ? Math.max(4, (x.secs / max) * 100) : 2}%"></div>
      <div class="d">${x.d.getDate()}</div></div>`;
  }).join('');

  const hl = $('#historyList');
  if (!logs.length) { hl.innerHTML = '<div class="empty">No workouts logged yet.</div>'; return; }
  hl.innerHTML = logs.slice(0, 100).map(x => {
    const d = new Date(x.ts);
    return `<div class="hist"><div><div class="h-name">${esc(x.name)}</div>
      <div class="h-date">${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
      <div class="h-time">${fmt(x.elapsed, false)}<small class="${x.completed ? 'ok' : 'stopped'}">${x.completed ? '✓ completed' : `stopped / ${fmt(x.planned, false)}`}</small></div></div>`;
  }).join('');
}

/* ---------- settings ---------- */
function initSettings() {
  const bind = (id, key, prop = 'checked', conv = v => v) => {
    const el = $(id);
    el[prop] = settings[key];
    el.addEventListener(prop === 'checked' ? 'change' : 'input', () => {
      settings[key] = conv(el[prop]); saveSettings();
      if (master) master.gain.value = settings.volume;
      if (key === 'wake' && !settings.wake) unlockScreen();
      if (run.active && ['sound', 'countdown'].includes(key)) scheduleAudio();
    });
  };
  bind('#setSound', 'sound');
  bind('#setVoice', 'voice');
  bind('#setVibrate', 'vibrate');
  bind('#setWake', 'wake');
  bind('#setVolume', 'volume', 'value', Number);
  $('#setCountdown').value = String(settings.countdown);
  $('#setCountdown').addEventListener('change', e => {
    settings.countdown = Number(e.target.value); saveSettings();
    if (run.active) scheduleAudio();
  });
  $('#testSound').onclick = () => {
    if (!ensureAudio()) return;
    const t = actx.currentTime + 0.05;
    const was = settings.sound; settings.sound = true;
    tone(t, 660, 0.5, false); tone(t + 1.2, 1320, 0.5, false); finishTones(t + 2.4, false);
    settings.sound = was;
    speak('Work');
  };
  $('#exportBtn').onclick = () => {
    const data = { app: 'interval-timer', version: APP_VERSION, exported: new Date().toISOString(), presets, history: logs, settings, current: cur };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interval-timer-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'interval-timer') throw new Error('not an interval-timer backup');
      const ok = await modal({ title: 'Import backup?', body: `Merges ${data.presets?.length || 0} workouts and ${data.history?.length || 0} history entries into this device.`,
        buttons: [{ label: 'Cancel', value: false }, { label: 'Import', value: true, cls: 'primary' }] });
      if (!ok) return;
      (data.presets || []).forEach(p => {
        const i = presets.findIndex(x => x.id === p.id || x.name === p.name);
        if (i >= 0) presets[i] = p; else presets.push(p);
      });
      const seen = new Set(logs.map(h => h.ts));
      (data.history || []).forEach(h => { if (!seen.has(h.ts)) logs.push(h); });
      logs.sort((a, b) => b.ts - a.ts);
      savePresets(); saveHistory(); renderSaved(); renderStats();
      toast('Backup imported');
    } catch (err) {
      modal({ title: 'Import failed', body: String(err.message || err), buttons: [{ label: 'OK', value: true }] });
    }
  };
  $('#clearHist').onclick = async () => {
    const ok = await modal({ title: 'Clear all history?', body: 'Saved workouts are kept. This cannot be undone.',
      buttons: [{ label: 'Cancel', value: false }, { label: 'Clear', value: true, cls: 'danger' }] });
    if (ok) { logs = []; saveHistory(); renderStats(); }
  };
  $('#version').textContent = `v${APP_VERSION}`;
}

/* ---------- toast ---------- */
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, { position: 'fixed', left: '50%', bottom: 'calc(var(--nav-h) + 20px)', transform: 'translateX(-50%)',
    background: '#333', color: '#fff', padding: '10px 18px', borderRadius: '999px', zIndex: 50, transition: 'opacity .3s' });
  document.body.append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1800);
}

/* ---------- navigation ---------- */
function showView(v) {
  $$('.view').forEach(s => s.classList.toggle('active', s.id === `view-${v}`));
  $$('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'saved') renderSaved();
  if (v === 'stats') renderStats();
  window.scrollTo(0, 0);
}
$$('.nav').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$$('.seg').forEach(b => b.addEventListener('click', () => { cur.mode = b.dataset.mode; saveCur(); renderEditor(); }));
$('#playPill').onclick = () => startWorkout(cur);
$('#saveBtn').onclick = saveWorkout;

/* ---------- boot ---------- */
initSettings();
renderEditor();
renderSaved();
renderStats();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

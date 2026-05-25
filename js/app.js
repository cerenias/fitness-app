import { getProfile, saveProfile, logWorkout, getWorkoutByDate, getAllWorkouts,
         getWeightHistory, getMeasurementHistory, getStepsHistory, getStepsByDate,
         logWeight, logMeasurements, logSteps, exportAllData, importAllData,
         toDateStr } from './db.js';
import { MOVES, SESSION_TEMPLATES, ALTERNATIVE_ACTIVITIES, EQUIPMENT_OPTIONS,
         getMoveById, getMovesByEquipment } from './data.js';
import { generateDefaultPlan, getTodaySession, resolveSession, getStreak,
         getSmartNudge, getMonthlyReport } from './plan.js';
import { SessionPlayer, formatTimer, repsLabel } from './session.js';
import { renderWeightChart, renderMeasurementsChart, renderStepsChart,
         renderActivityCalendar } from './charts.js';
import { initNotifications, showInAppNudge, notificationsConfigured,
         requestNotificationPermission, setTrainingDayTags } from './notifications.js';
import { BACKEND_URL, APP_SECRET } from './config.js';

// ─── State ─────────────────────────────────────────────────────────────────

const state = {
  profile: null,
  player: null,
  sessionData: null,
  previousHash: '#home',
  activeWorkoutTab: 'plan',
  activeProgressTab: 'weight',
  libraryFilter: 'all',
  librarySearch: '',
  ob: { step: 0, name: '', trainingDays: [1, 3, 5], notifyHour: 7, notifyMinute: 0, equipment: ['bodyweight', 'bands', 'dumbbells'], weight: '', waist: '', hip: '', thigh: '', healthNotes: '' },
  reportDate: { year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
  chatHistory: [],   // { role, content } pairs sent to API
  chatMessages: [],  // { role, text } for display
};

const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_SHORT  = ['S','M','T','W','T','F','S'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Chat persistence ───────────────────────────────────────────────────────

const CHAT_KEY = 'fittrack_chat_v1';

function saveChatToStorage() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      messages: state.chatMessages,
      history: state.chatHistory,
    }));
  } catch {}
}

function loadChatFromStorage() {
  try {
    const data = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}');
    state.chatMessages = data.messages || [];
    state.chatHistory  = data.history  || [];
  } catch {}
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.update(); // check for new SW on every page load
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }

  initNotifications();
  loadChatFromStorage();

  document.body.addEventListener('click', handleClick);
  window.addEventListener('hashchange', route);

  state.profile = await getProfile();

  if (!state.profile) {
    renderOnboarding();
    return;
  }

  route();

  const nudge = await getSmartNudge(state.profile.plan || {});
  if (nudge.show) showInAppNudge(nudge.message);
}

// ─── Router ────────────────────────────────────────────────────────────────

async function route() {
  const hash = window.location.hash || '#home';
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', '#' + el.dataset.route === hash);
  });
  if (hash !== '#coach') document.getElementById('main').classList.remove('coach-main');
  switch (hash) {
    case '#home':     await renderHome();     break;
    case '#workout':  await renderWorkout();  break;
    case '#session':  renderSessionView();    break;
    case '#coach':    await renderCoach();    break;
    case '#progress': await renderProgress(); break;
    case '#profile':  await renderProfile();  break;
    default:          await renderHome();
  }
}

function setView(html, title = 'FitTrack', showNav = true) {
  document.getElementById('main').innerHTML = html;
  document.querySelector('.header-logo').textContent = title;
  document.querySelector('.bottom-nav').style.display = showNav ? 'flex' : 'none';
}

// ─── Home View ─────────────────────────────────────────────────────────────

async function renderHome() {
  const profile = state.profile;
  if (!profile) { renderOnboarding(); return; }

  const plan = profile.plan || {};
  const todayKey = toDateStr(new Date());
  const todaySession = getTodaySession(plan);
  const completedToday = await getWorkoutByDate(todayKey);
  const streak = await getStreak(plan);
  const stepsEntry = await getStepsByDate(todayKey);
  const steps = stepsEntry?.count || 0;
  const goal = profile.stepGoal || 8000;
  const pct = Math.min(100, Math.round((steps / goal) * 100));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = profile.name?.split(' ')[0] || 'there';

  const streakHtml = streak > 0
    ? `<div class="streak-row">🔥 ${streak}-session streak</div>`
    : '';

  let mainCard = '';

  if (completedToday) {
    const dur = completedToday.durationMinutes || '?';
    const label = completedToday.isAlternative ? completedToday.alternativeName : completedToday.sessionName;
    mainCard = `
      <div class="card done-card">
        <div class="done-big-icon">🎉</div>
        <div class="done-title">Nice work!</div>
        <div class="done-subtitle">${label} — ${dur} min</div>
      </div>
      <div class="card steps-card">
        <div class="card-title">Rest Day Steps</div>
        <div class="steps-numbers">
          <span class="steps-current">${steps.toLocaleString()}</span>
          <span class="steps-goal">/ ${goal.toLocaleString()}</span>
        </div>
        <div class="steps-bar-wrap"><div class="steps-bar-fill" style="width:${pct}%"></div></div>
        <div class="steps-label">${pct >= 100 ? '🎯 Goal reached!' : `${goal - steps > 0 ? (goal - steps).toLocaleString() : 0} steps to go`}</div>
        <button class="btn btn-secondary btn-full btn-sm" data-action="log-steps">Update step count</button>
      </div>`;
  } else if (todaySession) {
    const resolved = resolveSession(todaySession);
    const exList = resolved.exercises.slice(0, 4).map(e =>
      `<div class="exercise-preview-item"><span class="dot"></span>${e.move?.name || e.moveId}</div>`
    ).join('') + (resolved.exercises.length > 4 ? `<div class="exercise-preview-item"><span class="dot"></span>+${resolved.exercises.length - 4} more</div>` : '');

    mainCard = `
      <div class="card today-card">
        <div class="today-badge">Today's Training</div>
        <div class="session-name">${todaySession.name}</div>
        <div class="session-focus">${todaySession.focus}</div>
        <div class="exercise-preview-list">${exList}</div>
        <div class="session-meta">${resolved.exercises.length} exercises · ~${resolved.exercises.length * 6} min</div>
        <button class="btn btn-primary btn-full btn-xl" data-action="start-session">Start Workout</button>
        <button class="btn btn-ghost btn-full" data-action="swap-session">Swap for alternative activity</button>
      </div>`;
  } else {
    mainCard = `
      <div class="card steps-card">
        <div class="today-badge">Rest Day — Steps Goal</div>
        <div class="steps-numbers">
          <span class="steps-current">${steps.toLocaleString()}</span>
          <span class="steps-goal">/ ${goal.toLocaleString()}</span>
        </div>
        <div class="steps-bar-wrap"><div class="steps-bar-fill" style="width:${pct}%"></div></div>
        <div class="steps-label">${pct >= 100 ? '🎯 Goal reached!' : `${(goal - steps).toLocaleString()} steps to go`}</div>
        <button class="btn btn-primary btn-full" data-action="log-steps">Update step count</button>
      </div>`;
  }

  setView(`
    <div class="view">
      <div>
        <div class="greeting">${greeting}, ${name}</div>
        <div class="greeting-sub">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      ${streakHtml}
      ${mainCard}
      <div class="card quick-log card-sm">
        <button class="btn btn-secondary btn-sm" data-action="log-weight">+ Weight</button>
        <button class="btn btn-secondary btn-sm" data-action="log-measurements">+ Measurements</button>
      </div>
    </div>`, 'FitTrack');
}

// ─── Thumbnail helper ─────────────────────────────────────────────────────

function thumbHTML(move, displayW = 90, displayH = null) {
  if (!move?.thumb) {
    return `<div class="move-thumb move-thumb-fallback">${move?.icon || '💪'}</div>`;
  }
  // Individual pre-cropped image
  if (typeof move.thumb === 'string' || move.thumb?.img) {
    const src = typeof move.thumb === 'string' ? move.thumb : move.thumb.img;
    const fit = move.thumb?.fit ?? 'cover';
    const dH = displayH ?? Math.round(displayW * 0.73);
    const style = `background-image:url('${src}');background-size:${fit};background-position:center;width:${displayW}px;height:${dH}px;`;
    return `<div class="move-thumb" style="${style}"></div>`;
  }
  // Sprite sheet
  const { sheet, cols, rows, col, row, cropH } = move.thumb;
  const cellW = 1536 / cols;
  const cellH = 1024 / rows;
  const scale = displayW / cellW;
  const bgW = Math.round(cols * displayW);
  const bgH = Math.round(rows * cellH * scale);
  const posX = -(col * displayW);
  const posY = -Math.round(row * cellH * scale);
  const dH = displayH ?? Math.round((cropH ?? cellH) * scale);
  const style = `background-image:url('${sheet}');background-size:${bgW}px ${bgH}px;background-position:${posX}px ${posY}px;width:${displayW}px;height:${dH}px;`;
  return `<div class="move-thumb" style="${style}"></div>`;
}

// ─── Workout View ──────────────────────────────────────────────────────────

async function renderWorkout() {
  const profile = state.profile;
  const plan = profile?.plan || {};
  const tab = state.activeWorkoutTab;

  const planHtml = renderPlanTab(plan);
  const libHtml  = renderLibraryTab();

  setView(`
    <div class="view">
      <div class="tab-pills">
        <button class="tab-pill ${tab === 'plan' ? 'active' : ''}" data-action="workout-tab" data-tab="plan">My Plan</button>
        <button class="tab-pill ${tab === 'library' ? 'active' : ''}" data-action="workout-tab" data-tab="library">Exercise Library</button>
      </div>
      <div id="tab-plan" ${tab !== 'plan' ? 'class="hidden"' : ''}>${planHtml}</div>
      <div id="tab-library" ${tab !== 'library' ? 'class="hidden"' : ''}>${libHtml}</div>
    </div>`, 'Training');
}

function renderPlanTab(plan) {
  const todayDay = new Date().getDay();
  const rows = DAY_NAMES.map((dayName, i) => {
    const session = plan[i];
    const isToday = i === todayDay;
    const rowClass = session ? (isToday ? 'day-row today-row' : 'day-row') : 'day-row rest-row';
    if (!session) {
      return `<div class="${rowClass}">
        <div class="day-row-header">
          <div class="day-name-badge">${dayName.slice(0,2)}</div>
          <div class="day-row-info"><div class="day-row-focus">Rest day</div></div>
          <div class="day-row-tag">REST</div>
        </div>
      </div>`;
    }
    const resolved = resolveSession(session);
    const exItems = resolved.exercises.map(e =>
      `<div class="day-exercise-item">${e.move?.name || e.moveId} · ${repsLabel(e)}</div>`
    ).join('');
    return `<div class="${rowClass}">
      <div class="day-row-header">
        <div class="day-name-badge">${dayName.slice(0,2)}</div>
        <div class="day-row-info">
          <div class="day-row-session">${session.name}</div>
          <div class="day-row-focus">${session.focus}</div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="start-any-session" data-day="${i}" style="flex-shrink:0">▶ Start</button>
      </div>
      <div class="day-exercises">${exItems}</div>
    </div>`;
  }).join('');

  return `<div class="week-grid">${rows}</div>`;
}

function renderLibraryTab() {
  const filter = state.libraryFilter;
  const search = state.librarySearch.toLowerCase();

  let moves = MOVES;
  if (filter !== 'all') moves = moves.filter(m => m.equipment.includes(filter));
  if (search) moves = moves.filter(m =>
    m.name.toLowerCase().includes(search) ||
    m.muscles.some(mu => mu.toLowerCase().includes(search)) ||
    m.category.toLowerCase().includes(search)
  );

  const cards = moves.map(m => `
    <div class="move-card" data-action="view-move" data-move-id="${m.id}">
      ${thumbHTML(m, 90, 72)}
      <div class="move-card-info">
        <div class="move-card-name">${m.name}</div>
        <div class="move-card-muscles">${m.muscles.join(' · ')}</div>
        <div class="equip-tags">${m.equipment.map(e => `<span class="equip-tag">${e}</span>`).join('')}</div>
      </div>
    </div>`).join('');

  return `
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input type="search" class="search-input" placeholder="Search exercises…" value="${state.librarySearch}" data-action="library-search">
    </div>
    <div class="chip-row">
      ${['all','bodyweight','bands','dumbbells'].map(f => `
        <button class="chip ${filter === f ? 'active' : ''}" data-action="library-filter" data-filter="${f}">
          ${f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
        </button>`).join('')}
    </div>
    <div class="move-list">${cards || '<div class="empty-state"><div class="empty-icon">🏋️</div><div class="empty-text">No exercises match your filter.</div></div>'}</div>`;
}

// ─── Session View ──────────────────────────────────────────────────────────

function renderSessionView() {
  if (!state.sessionData) { window.location.hash = '#home'; return; }

  document.querySelector('.bottom-nav').style.display = 'none';
  document.querySelector('.header-logo').textContent = state.sessionData.name;
  document.getElementById('main').innerHTML = `<div class="view-session" id="session-container"></div>`;

  if (state.player) state.player.destroy();

  state.player = new SessionPlayer(
    state.sessionData,
    () => renderSessionContent(state.player),
    () => { /* saved inside SessionPlayer */ }
  );

  renderSessionContent(state.player);
}

function renderSessionContent(player) {
  const container = document.getElementById('session-container');
  if (!container) return;

  const total = player.totalExercises;
  const ei    = player.exerciseIndex;
  const si    = player.setIndex;
  const ex    = player.currentExercise;
  const move  = player.currentMove;
  const progPct = Math.round(((ei + (si / (ex?.sets || 1)) * 0.5) / total) * 100);

  const dotsHtml = player.session.exercises.map((e, i) => {
    const m = getMoveById(e.moveId);
    const cls = i < ei ? 'exercise-dot done' : i === ei ? 'exercise-dot current' : 'exercise-dot';
    return `<button class="${cls}" data-action="jump-exercise" data-index="${i}" title="${m?.name || ''}">${i + 1}</button>`;
  }).join('');

  const header = `
    <div class="session-header">
      <div class="session-progress-bar-wrap">
        <div class="session-progress-bar-fill" style="width:${progPct}%"></div>
      </div>
      <span class="session-progress-label">${ei + 1}/${total}</span>
      <button class="exit-session-btn" data-action="exit-session">✕</button>
    </div>`;

  if (player.phase === 'done') {
    const dur = Math.round((Date.now() - player.startTime) / 60000);
    container.innerHTML = header + `
      <div class="session-done">
        <div class="session-done-icon">🏆</div>
        <div class="session-done-title">Session Complete!</div>
        <div class="session-done-stats">
          <div class="session-stat"><div class="session-stat-value">${total}</div><div class="session-stat-label">Exercises</div></div>
          <div class="session-stat"><div class="session-stat-value">${dur}</div><div class="session-stat-label">Minutes</div></div>
          <div class="session-stat"><div class="session-stat-value">${total * (ex?.sets || 3)}</div><div class="session-stat-label">Sets</div></div>
        </div>
        <button class="btn btn-primary btn-full btn-xl" data-action="finish-session">Back to Home</button>
        <button class="btn btn-ghost btn-full" data-action="log-weight">+ Log today's weight</button>
      </div>`;
    return;
  }

  if (player.phase === 'intro') {
    container.innerHTML = header + `
      <div class="phase-intro">
        <div class="exercise-number">Exercise ${ei + 1} of ${total}</div>
        ${move?.thumb ? thumbHTML(move, 200) : `<div style="font-size:56px;text-align:center;line-height:1.2">${move?.icon || '💪'}</div>`}
        <div class="exercise-title">${move?.name || ''}</div>
        <div class="muscles-tags">${(move?.muscles || []).map(m => `<span class="muscle-tag">${m}</span>`).join('')}</div>
        <div class="sets-reps-row">
          <div class="sets-reps-item">
            <div class="sets-reps-value">${si + 1}/${ex.sets}</div>
            <div class="sets-reps-label">Set</div>
          </div>
          <div class="sets-reps-divider">·</div>
          <div class="sets-reps-item editable" data-action="edit-reps" title="Tap to edit">
            <div class="sets-reps-value">${ex.duration ? ex.duration + 's' : ex.reps}</div>
            <div class="sets-reps-label">${ex.unit === 'each' ? 'Each side' : ex.duration ? 'Seconds' : 'Reps'} ✏️</div>
          </div>
          <div class="sets-reps-divider">·</div>
          <div class="sets-reps-item editable" data-action="edit-rest" title="Tap to edit">
            <div class="sets-reps-value">${ex.rest}s</div>
            <div class="sets-reps-label">Rest ✏️</div>
          </div>
        </div>
        <div class="instructions-box">${move?.instructions || ''}</div>
        ${move?.demo ? `<a href="${move.demo}" target="_blank" rel="noopener" class="btn btn-ghost btn-full btn-sm" style="text-align:center">▶ Watch demo on YouTube</a>` : ''}
        <button class="btn btn-primary btn-full btn-xl" data-action="start-set">Start Set</button>
        <button class="btn btn-ghost btn-full btn-sm" data-action="swap-exercise" data-index="${ei}">↔ Swap exercise</button>
        <div class="exercise-mini-nav">${dotsHtml}</div>
      </div>`;
    return;
  }

  if (player.phase === 'active') {
    if (player.isTimedExercise) {
      container.innerHTML = header + `
        <div class="phase-active">
          <div class="exercise-number">Exercise ${ei + 1} — Set ${si + 1} of ${ex.sets}</div>
          <div class="exercise-title">${move?.name || ''}</div>
          ${timerCircleSVG(player.timerValue, ex.duration, false)}
          <div class="instructions-box text-sm">${move?.instructions || ''}</div>
          <div class="exercise-mini-nav">${dotsHtml}</div>
        </div>`;
    } else {
      container.innerHTML = header + `
        <div class="phase-active" style="text-align:center">
          <div class="exercise-number">Exercise ${ei + 1} — Set ${si + 1} of ${ex.sets}</div>
          <div class="exercise-title">${move?.name || ''}</div>
          <div class="reps-big">${ex.reps}</div>
          <div class="reps-unit">${ex.unit === 'each' ? 'reps each side' : 'reps'}</div>
          <div class="instructions-box text-sm" style="text-align:left">${move?.instructions || ''}</div>
          <button class="btn btn-primary btn-full btn-xl" data-action="complete-set">Done ✓</button>
          <div class="exercise-mini-nav">${dotsHtml}</div>
        </div>`;
    }
    return;
  }

  if (player.phase === 'rest') {
    const nextEx = player.session.exercises[ei + (si >= ex.sets - 1 ? 1 : 0)];
    const nextMove = nextEx ? getMoveById(nextEx.moveId) : null;
    const upNext = nextMove ? `<div class="text-muted text-sm text-center">Up next: <strong>${nextMove.name}</strong></div>` : '';

    container.innerHTML = header + `
      <div class="phase-active" style="text-align:center">
        <div class="exercise-number">Set ${si + 1} of ${ex.sets} complete</div>
        <div class="exercise-title" style="color:var(--accent)">Rest</div>
        ${timerCircleSVG(player.timerValue, ex.rest, true)}
        ${upNext}
        <button class="btn btn-ghost btn-full" data-action="skip-rest">Skip rest →</button>
        <div class="exercise-mini-nav">${dotsHtml}</div>
      </div>`;
  }
}

function timerCircleSVG(value, total, isRest) {
  const r = 54, circ = 2 * Math.PI * r;
  const progress = total > 0 ? value / total : 1;
  const offset = circ * (1 - progress);
  const cls = isRest ? 'timer-arc rest-arc' : 'timer-arc';
  return `
    <div class="timer-circle-wrap">
      <svg class="timer-svg" viewBox="0 0 120 120">
        <circle class="timer-track" cx="60" cy="60" r="${r}"/>
        <circle class="${cls}" cx="60" cy="60" r="${r}"
          stroke-dasharray="${circ.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"/>
        <text class="timer-value-text" x="60" y="55">${formatTimer(value)}</text>
        <text class="timer-label-text" x="60" y="76">${isRest ? 'REST' : 'GO'}</text>
      </svg>
    </div>`;
}

// ─── Progress View ─────────────────────────────────────────────────────────

async function renderProgress() {
  const tab = state.activeProgressTab;
  const tabs = ['weight','measurements','steps','activity'];

  setView(`
    <div class="view">
      <div class="tab-pills">
        ${tabs.map(t => `<button class="tab-pill ${t === tab ? 'active' : ''}" data-action="progress-tab" data-tab="${t}">
          ${{weight:'Weight', measurements:'Body', steps:'Steps', activity:'Activity'}[t]}</button>`).join('')}
      </div>
      <div id="progress-content"></div>
    </div>`, 'Progress');

  await renderProgressTab(tab);
}

async function renderProgressTab(tab) {
  const el = document.getElementById('progress-content');
  if (!el) return;

  if (tab === 'weight') {
    const data = await getWeightHistory();
    const last = data[data.length - 1];
    const first = data[0];
    const change = last && first && data.length > 1 ? +(last.kg - first.kg).toFixed(1) : null;
    const changeHtml = change !== null
      ? `<span class="stat-change ${change < 0 ? 'pos' : 'neg'}">${change > 0 ? '+' : ''}${change} kg total</span>`
      : '';

    el.innerHTML = `
      <div class="card chart-card">
        <div class="card-title">Weight</div>
        <div class="chart-wrap"><canvas id="main-chart"></canvas></div>
      </div>
      <div class="card card-sm">
        <div class="stats-row">
          <div class="stat-box"><div class="stat-value">${last ? last.kg + ' kg' : '—'}</div><div class="stat-label">Current</div>${changeHtml}</div>
          <div class="stat-box"><div class="stat-value">${first ? first.kg + ' kg' : '—'}</div><div class="stat-label">Starting</div></div>
          <div class="stat-box"><div class="stat-value">${data.length}</div><div class="stat-label">Entries</div></div>
        </div>
      </div>`;
    if (data.length) renderWeightChart('main-chart', data);
    else el.querySelector('.chart-wrap').innerHTML = emptyChartMsg('No weight entries yet. Tap + Weight on the home screen.');
  }

  else if (tab === 'measurements') {
    const data = await getMeasurementHistory();
    const last = data[data.length - 1];
    el.innerHTML = `
      <div class="card chart-card">
        <div class="card-title">Body Measurements (cm)</div>
        <div class="chart-wrap"><canvas id="main-chart"></canvas></div>
      </div>
      <div class="card card-sm">
        <div class="stats-row">
          <div class="stat-box"><div class="stat-value">${last?.waist || '—'}</div><div class="stat-label">Waist</div></div>
          <div class="stat-box"><div class="stat-value">${last?.hip || '—'}</div><div class="stat-label">Hip</div></div>
          <div class="stat-box"><div class="stat-value">${last?.thigh || '—'}</div><div class="stat-label">Thigh</div></div>
        </div>
      </div>`;
    if (data.length) renderMeasurementsChart('main-chart', data);
    else el.querySelector('.chart-wrap').innerHTML = emptyChartMsg('No measurements yet. Tap + Measurements on the home screen.');
  }

  else if (tab === 'steps') {
    const data = await getStepsHistory();
    const goal = state.profile?.stepGoal || 8000;
    const daysHit = data.filter(d => d.count >= goal).length;
    const avg = data.length ? Math.round(data.reduce((s, d) => s + d.count, 0) / data.length) : 0;
    el.innerHTML = `
      <div class="card chart-card">
        <div class="card-title">Daily Steps (last 30 days)</div>
        <div class="chart-wrap"><canvas id="main-chart"></canvas></div>
      </div>
      <div class="card card-sm">
        <div class="stats-row">
          <div class="stat-box"><div class="stat-value">${avg.toLocaleString()}</div><div class="stat-label">Avg Steps</div></div>
          <div class="stat-box"><div class="stat-value">${daysHit}</div><div class="stat-label">Goals Hit</div></div>
          <div class="stat-box"><div class="stat-value">${goal.toLocaleString()}</div><div class="stat-label">Daily Goal</div></div>
        </div>
      </div>`;
    if (data.length) renderStepsChart('main-chart', data, goal);
    else el.querySelector('.chart-wrap').innerHTML = emptyChartMsg('No step entries yet. Log your steps on rest days.');
  }

  else if (tab === 'activity') {
    const workouts = await getAllWorkouts();
    const plan = state.profile?.plan || {};
    el.innerHTML = `
      <div class="card chart-card">
        <div class="card-title">Last 12 Weeks</div>
        <div id="cal-container"></div>
        <div style="display:flex;gap:16px;margin-top:12px;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)"><span style="width:14px;height:14px;border-radius:3px;background:var(--primary);display:inline-block"></span>Trained</span>
          <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)"><span style="width:14px;height:14px;border-radius:3px;background:var(--danger);opacity:0.5;display:inline-block"></span>Missed</span>
          <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)"><span style="width:14px;height:14px;border-radius:3px;background:var(--surface2);display:inline-block"></span>Rest</span>
        </div>
      </div>
      <div class="card card-sm">
        <div class="stats-row">
          <div class="stat-box"><div class="stat-value">${workouts.filter(w => w.completed).length}</div><div class="stat-label">Total Sessions</div></div>
          <div class="stat-box"><div class="stat-value">${workouts.filter(w => w.isAlternative).length}</div><div class="stat-label">Alternatives</div></div>
        </div>
      </div>`;
    renderActivityCalendar('cal-container', workouts, plan);
  }
}

function emptyChartMsg(text) {
  return `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">${text}</div></div>`;
}

// ─── Profile View ──────────────────────────────────────────────────────────

async function renderProfile() {
  const p = state.profile;
  if (!p) return;

  const { year, month } = state.reportDate;

  setView(`
    <div class="view">
      <div class="card">
        <div class="profile-name">${p.name || 'You'}</div>
        <div class="profile-goal-tags">
          <span class="goal-tag">Lose weight</span>
          <span class="goal-tag">Build muscle</span>
          <span class="goal-tag">Better posture</span>
        </div>
        <div class="text-muted text-sm mt-8">Training ${(Object.keys(p.plan || {}).length)} days/week · ${p.stepGoal?.toLocaleString() || '8,000'} step goal</div>
      </div>

      <div class="card">
        <div class="card-title">Health Notes</div>
        <textarea class="form-input" id="health-notes-input" rows="4" placeholder="Posture issues, injuries, things to be mindful of…">${p.healthNotes || ''}</textarea>
        <button class="btn btn-secondary btn-sm" data-action="save-health-notes" style="margin-top:10px">Save notes</button>
      </div>

      <div class="card">
        <div class="card-title">Training Schedule</div>
        <div class="day-picker">
          ${DAY_NAMES.map((name, i) => {
            const sel = Object.keys(p.plan || {}).map(Number).includes(i);
            return `<button class="day-pill ${sel ? 'selected' : ''}" data-action="toggle-training-day" data-day="${i}">${name.slice(0,2)}</button>`;
          }).join('')}
        </div>
        <div class="text-muted text-sm mt-8">Tap days to toggle. Plan regenerates automatically.</div>
      </div>

      <div class="card">
        <div class="card-title">Equipment Available</div>
        ${EQUIPMENT_OPTIONS.map(eq => {
          const checked = (p.equipment || []).includes(eq.id);
          return `<label class="check-item">
            <input type="checkbox" data-action="toggle-equipment" data-eq="${eq.id}" ${checked ? 'checked' : ''}>
            ${eq.label}
          </label>`;
        }).join('')}
      </div>

      ${notificationsConfigured() ? `
      <div class="card">
        <div class="card-title">Push Notifications</div>
        <div class="flex items-center justify-between">
          <span class="text-muted text-sm">Training reminders &amp; nudges</span>
          <button class="btn btn-secondary btn-sm" data-action="request-notifications">Enable</button>
        </div>
      </div>` : `
      <div class="card">
        <div class="card-title">Push Notifications</div>
        <div class="text-muted text-sm">Add your OneSignal App ID in <code>js/config.js</code> to enable push notifications. In-app nudges work without setup.</div>
      </div>`}

      <div class="card">
        <div class="card-title">Monthly Report</div>
        <div class="report-month-picker">
          <button data-action="report-prev">‹</button>
          <span class="report-month-label">${MONTH_NAMES[month - 1]} ${year}</span>
          <button data-action="report-next">›</button>
        </div>
        <div id="report-content" style="margin-top:12px"></div>
      </div>

      <div class="card">
        <div class="card-title">Data Backup</div>
        <div class="flex gap-8">
          <button class="btn btn-secondary btn-sm" data-action="export-data">Export JSON</button>
          <button class="btn btn-secondary btn-sm" data-action="import-data">Import JSON</button>
        </div>
        <div class="text-muted text-sm mt-8">Export to back up your data before changing phones.</div>
      </div>

      <div class="card">
        <button class="btn btn-danger btn-sm" data-action="reset-app">Reset &amp; clear all data</button>
      </div>
    </div>`, 'Profile');

  await loadMonthlyReport();
}

async function loadMonthlyReport() {
  const el = document.getElementById('report-content');
  if (!el || !state.profile) return;

  const { year, month } = state.reportDate;
  const report = await getMonthlyReport(state.profile.plan || {}, year, month);

  const pct = report.planned > 0 ? Math.round(((report.completed + report.alternatives) / report.planned) * 100) : 0;
  let summary = '';
  if (report.planned === 0) {
    summary = 'No training days planned for this month.';
  } else if (pct >= 90) {
    summary = `Outstanding month — you hit ${pct}% of your planned sessions. Keep this up!`;
  } else if (pct >= 70) {
    summary = `Solid effort — ${report.completed} sessions completed${report.alternatives > 0 ? ` plus ${report.alternatives} alternative activities` : ''}. A few missed but overall good consistency.`;
  } else if (pct >= 50) {
    summary = `${report.completed} of ${report.planned} sessions done (${pct}%). Room to improve — try scheduling sessions at a fixed time.`;
  } else {
    summary = `${report.completed} sessions completed this month. Life gets in the way — just aim for one more session next month.`;
  }

  el.innerHTML = `
    <div class="report-grid">
      <div class="report-cell"><div class="report-value">${report.planned}</div><div class="report-label">Planned Sessions</div></div>
      <div class="report-cell"><div class="report-value">${report.completed}</div><div class="report-label">Completed</div></div>
      <div class="report-cell"><div class="report-value">${report.alternatives}</div><div class="report-label">Alternatives</div></div>
      <div class="report-cell"><div class="report-value">${pct}%</div><div class="report-label">Consistency</div></div>
    </div>
    <div class="report-summary">${summary}</div>`;
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

function renderOnboarding() {
  document.querySelector('.bottom-nav').style.display = 'none';
  document.querySelector('.header-logo').textContent = 'FitTrack';
  const ob = state.ob;
  const steps = 6;

  const dots = Array.from({ length: steps }, (_, i) =>
    `<div class="ob-dot ${i <= ob.step ? 'active' : ''}"></div>`).join('');

  const stepContent = [
    // Step 0: Welcome + name
    `<div class="ob-title">Let's get you moving 💪</div>
     <div class="ob-subtitle">A few quick questions to set up your personal plan. Takes about 2 minutes.</div>
     <div class="ob-content">
       <div class="form-group">
         <label class="form-label">Your first name</label>
         <input type="text" class="form-input" id="ob-name" placeholder="e.g. Anna" value="${ob.name}" autocomplete="given-name">
       </div>
     </div>`,

    // Step 1: Training days
    `<div class="ob-title">When do you train?</div>
     <div class="ob-subtitle">Choose 3 days per week. You can always change this later.</div>
     <div class="ob-content">
       <div class="day-picker">
         ${DAY_NAMES.map((n, i) => `<button class="day-pill ${ob.trainingDays.includes(i) ? 'selected' : ''}" data-ob-day="${i}">${n.slice(0,2)}</button>`).join('')}
       </div>
       <div class="text-muted text-sm">Selected: ${ob.trainingDays.map(d => DAY_NAMES[d]).join(', ') || 'none'}</div>
     </div>`,

    // Step 2: Notification time
    `<div class="ob-title">When should we remind you?</div>
     <div class="ob-subtitle">We'll send a push notification on training days at this time.</div>
     <div class="ob-content">
       <div class="form-row">
         <div class="form-group">
           <label class="form-label">Hour</label>
           <select class="form-input" id="ob-hour">
             ${Array.from({length:24},(_,i)=>`<option value="${i}" ${ob.notifyHour===i?'selected':''}>${String(i).padStart(2,'0')}</option>`).join('')}
           </select>
         </div>
         <div class="form-group">
           <label class="form-label">Minute</label>
           <select class="form-input" id="ob-minute">
             ${[0,15,30,45].map(m=>`<option value="${m}" ${ob.notifyMinute===m?'selected':''}>${String(m).padStart(2,'0')}</option>`).join('')}
           </select>
         </div>
       </div>
       <div class="text-muted text-sm">You'll also get in-app nudges if you haven't trained in 2+ days — no setup needed for those.</div>
     </div>`,

    // Step 3: Equipment
    `<div class="ob-title">What equipment do you have?</div>
     <div class="ob-subtitle">We'll tailor your plan to what's available at home.</div>
     <div class="ob-content">
       ${EQUIPMENT_OPTIONS.map(eq => `<label class="check-item">
         <input type="checkbox" data-ob-eq="${eq.id}" ${ob.equipment.includes(eq.id) ? 'checked' : ''}>
         ${eq.label}
       </label>`).join('')}
     </div>`,

    // Step 4: Starting measurements (optional)
    `<div class="ob-title">Starting point <span style="color:var(--text-muted);font-size:16px">(optional)</span></div>
     <div class="ob-subtitle">Track your progress from day one. Skip if you prefer to add these later.</div>
     <div class="ob-content">
       <div class="form-row">
         <div class="form-group">
           <label class="form-label">Weight (kg)</label>
           <input type="number" class="form-input" id="ob-weight" placeholder="70" value="${ob.weight}" step="0.1" min="30" max="300">
         </div>
       </div>
       <div class="form-row">
         <div class="form-group"><label class="form-label">Waist (cm)</label><input type="number" class="form-input" id="ob-waist" placeholder="80" value="${ob.waist}"></div>
         <div class="form-group"><label class="form-label">Hip (cm)</label><input type="number" class="form-input" id="ob-hip" placeholder="95" value="${ob.hip}"></div>
       </div>
       <div class="form-row">
         <div class="form-group"><label class="form-label">Thigh (cm)</label><input type="number" class="form-input" id="ob-thigh" placeholder="55" value="${ob.thigh}"></div>
       </div>
     </div>`,

    // Step 5: Health notes
    `<div class="ob-title">Anything to keep in mind?</div>
     <div class="ob-subtitle">Posture issues, tension spots, injuries — note whatever is relevant. You can always edit this later.</div>
     <div class="ob-content">
       <div class="form-group">
         <label class="form-label">Health notes <span style="color:var(--text-muted)">(optional)</span></label>
         <textarea class="form-input" id="ob-notes" rows="5" placeholder="e.g. Bad posture and tension in upper back and neck. Can do all movements.">${ob.healthNotes}</textarea>
       </div>
     </div>`,
  ][ob.step] || '';

  const isLast = ob.step === steps - 1;

  document.getElementById('main').innerHTML = `
    <div class="onboarding">
      <div class="ob-progress">${dots}</div>
      ${stepContent}
      <div class="ob-actions">
        <button class="btn btn-primary btn-full btn-xl" data-action="ob-next">
          ${isLast ? 'Create My Plan 🚀' : 'Continue →'}
        </button>
        ${ob.step > 0 ? `<button class="btn btn-ghost btn-full btn-sm" data-action="ob-back">← Back</button>` : ''}
      </div>
    </div>`;
}

async function finishOnboarding() {
  const ob = state.ob;
  const plan = generateDefaultPlan(ob.trainingDays);

  const profile = {
    name: ob.name || 'You',
    goals: ['lose-weight', 'build-muscle', 'posture'],
    trainingDays: ob.trainingDays,
    notifyHour: ob.notifyHour,
    notifyMinute: ob.notifyMinute,
    equipment: ob.equipment,
    healthNotes: ob.healthNotes,
    stepGoal: 8000,
    plan,
    createdAt: new Date().toISOString(),
  };

  await saveProfile(profile);

  if (ob.weight) await logWeight(parseFloat(ob.weight));
  const hasM = ob.waist || ob.hip || ob.thigh;
  if (hasM) await logMeasurements({ waist: +ob.waist || null, hip: +ob.hip || null, thigh: +ob.thigh || null });

  state.profile = await getProfile();
  await setTrainingDayTags(ob.trainingDays, ob.notifyHour, ob.notifyMinute).catch(() => {});

  document.querySelector('.bottom-nav').style.display = 'flex';
  window.location.hash = '#home';
}

// ─── Modals ────────────────────────────────────────────────────────────────

function showModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // Swipe down to close
  const sheet = overlay.querySelector('.modal-sheet');
  let startY = 0, isDragging = false;
  sheet.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    isDragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', e => {
    if (!isDragging) return;
    isDragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transition = '';
    if (dy > 100) {
      sheet.style.transform = `translateY(100%)`;
      setTimeout(closeModal, 200);
    } else {
      sheet.style.transform = '';
    }
  });

  document.body.appendChild(overlay);
}

function closeModal() {
  document.getElementById('modal-overlay')?.remove();
}

function showLogWeight() {
  showModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Log Weight</div>
    <div class="form-group">
      <label class="form-label">Weight (kg)</label>
      <input type="number" class="form-input" id="modal-weight" placeholder="70.5" step="0.1" min="30" max="300">
    </div>
    <button class="btn btn-primary btn-full" data-action="save-weight">Save</button>
    <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
  setTimeout(() => document.getElementById('modal-weight')?.focus(), 100);
}

function showLogMeasurements() {
  showModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Log Measurements</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Waist (cm)</label><input type="number" class="form-input" id="modal-waist" placeholder="80"></div>
      <div class="form-group"><label class="form-label">Hip (cm)</label><input type="number" class="form-input" id="modal-hip" placeholder="95"></div>
    </div>
    <div class="form-group"><label class="form-label">Thigh (cm)</label><input type="number" class="form-input" id="modal-thigh" placeholder="55"></div>
    <button class="btn btn-primary btn-full" data-action="save-measurements">Save</button>
    <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
}

function showLogSteps() {
  showModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Log Steps</div>
    <div class="text-muted text-sm" style="margin-bottom:12px">Open your iPhone <strong>Health</strong> app → Steps → check today's count, then enter it below.</div>
    <div class="form-group">
      <label class="form-label">Steps today</label>
      <input type="number" inputmode="numeric" pattern="[0-9]*" class="form-input" id="modal-steps" placeholder="7500" min="0" max="100000" style="font-size:24px;text-align:center;padding:16px">
    </div>
    <button class="btn btn-primary btn-full btn-xl" data-action="save-steps" style="margin-top:8px">Save</button>
    <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
}

function showSwapSession() {
  const altItems = ALTERNATIVE_ACTIVITIES.map(a =>
    `<button class="alt-item" data-action="log-alternative" data-alt-id="${a.id}" data-alt-name="${a.name}">
      <span class="alt-icon">${a.icon}</span>${a.name}
    </button>`).join('');

  showModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">What are you doing instead?</div>
    <div class="text-muted text-sm" style="margin-bottom:12px">This counts as your training for today.</div>
    <div class="alt-list">${altItems}</div>
    <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
}

function showSwapExercise(index) {
  const equipment = state.profile?.equipment || [];
  const moves = MOVES.filter(m => m.equipment.some(e => equipment.includes(e)));

  const categories = [...new Set(moves.map(m => m.category))];
  const items = moves.map(m => `
    <button class="swap-move-item" data-action="confirm-swap" data-index="${index}" data-move-id="${m.id}">
      ${thumbHTML(m, 64, 48)}
      <div class="swap-move-info">
        <div class="swap-move-name">${m.name}</div>
        <div class="swap-move-muscles">${m.muscles.join(' · ')}</div>
      </div>
    </button>`).join('');

  showModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Swap Exercise</div>
    <div class="text-muted text-sm" style="margin-bottom:12px">Pick a replacement — sets and rest stay the same.</div>
    <div class="swap-move-list">${items}</div>
    <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
}

function showMoveDetail(moveId) {
  const move = getMoveById(moveId);
  if (!move) return;
  showModal(`
    <div class="modal-handle"></div>
    ${move.thumb ? thumbHTML(move, 240) : `<div style="font-size:48px;text-align:center;margin-bottom:4px">${move.icon || '💪'}</div>`}
    <div class="modal-title" style="text-align:center">${move.name}</div>
    <div class="muscles-tags" style="justify-content:center">${move.muscles.map(m => `<span class="muscle-tag">${m}</span>`).join('')}</div>
    <div class="equip-tags" style="margin-top:8px;justify-content:center">${move.equipment.map(e => `<span class="equip-tag">${e}</span>`).join('')}</div>
    <div class="instructions-box" style="margin-top:12px">${move.instructions}</div>
    <div class="flex gap-8" style="margin-top:4px">
      <div class="stat-box"><div class="stat-value">${move.defaultSets}</div><div class="stat-label">Sets</div></div>
      <div class="stat-box"><div class="stat-value">${move.defaultDuration ? move.defaultDuration + 's' : move.defaultReps}</div><div class="stat-label">${move.unit === 'each' ? 'Each Side' : move.defaultDuration ? 'Seconds' : 'Reps'}</div></div>
      <div class="stat-box"><div class="stat-value">${move.defaultRest}s</div><div class="stat-label">Rest</div></div>
    </div>
    ${move.demo ? `<a href="${move.demo}" target="_blank" rel="noopener" class="btn btn-accent btn-full" style="text-align:center">▶ Watch Demo on YouTube</a>` : ''}
    <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Close</button>`);
}

// ─── Event Handler ─────────────────────────────────────────────────────────

async function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    // Navigation
    case 'workout-tab':
      state.activeWorkoutTab = el.dataset.tab;
      await renderWorkout();
      break;
    case 'progress-tab':
      state.activeProgressTab = el.dataset.tab;
      await renderProgress();
      break;

    // Library
    case 'library-filter':
      state.libraryFilter = el.dataset.filter;
      state.activeWorkoutTab = 'library';
      await renderWorkout();
      break;
    case 'view-move':
      showMoveDetail(el.dataset.moveId);
      break;

    // Home actions
    case 'start-session': {
      const session = getTodaySession(state.profile.plan || {});
      if (!session) break;
      state.previousHash = window.location.hash || '#home';
      state.sessionData = resolveSession(session);
      window.location.hash = '#session';
      break;
    }
    case 'start-any-session': {
      const day = parseInt(el.dataset.day);
      const session = state.profile.plan?.[day];
      if (!session) break;
      state.previousHash = window.location.hash || '#home';
      state.sessionData = resolveSession(session);
      window.location.hash = '#session';
      break;
    }
    case 'swap-session':
      showSwapSession();
      break;
    case 'log-alternative': {
      await logWorkout({
        sessionKey: 'alt',
        sessionName: el.dataset.altName,
        completed: true,
        isAlternative: true,
        alternativeName: el.dataset.altName,
        durationMinutes: 45,
        exercisesCompleted: 0,
      });
      closeModal();
      await renderHome();
      break;
    }
    case 'log-weight':   showLogWeight();        break;
    case 'log-measurements': showLogMeasurements(); break;
    case 'log-steps':    showLogSteps();         break;

    // Saves from modals
    case 'save-weight': {
      const v = parseFloat(document.getElementById('modal-weight')?.value);
      if (!isNaN(v) && v > 0) { await logWeight(v); closeModal(); await renderHome(); }
      break;
    }
    case 'save-measurements': {
      const w = +document.getElementById('modal-waist')?.value || null;
      const h = +document.getElementById('modal-hip')?.value || null;
      const t = +document.getElementById('modal-thigh')?.value || null;
      if (w || h || t) { await logMeasurements({ waist: w, hip: h, thigh: t }); closeModal(); await renderHome(); }
      break;
    }
    case 'save-steps': {
      const s = parseInt(document.getElementById('modal-steps')?.value);
      if (isNaN(s) || s < 0) {
        document.getElementById('modal-steps').style.borderColor = 'var(--danger)';
        document.getElementById('modal-steps').placeholder = 'Enter a number first';
        break;
      }
      await logSteps(s);
      closeModal();
      await renderHome();
      break;
    }

    // Session player
    case 'start-set':      state.player?.startSet();      break;
    case 'complete-set':   state.player?.completeSet();   break;
    case 'skip-rest':      state.player?.skipRest();      break;
    case 'jump-exercise':  state.player?.jumpToExercise(parseInt(el.dataset.index)); break;
    case 'swap-exercise':  showSwapExercise(parseInt(el.dataset.index)); break;
    case 'edit-reps': {
      const ex = state.player?.currentExercise;
      if (!ex) break;
      const field = ex.duration ? 'duration' : 'reps';
      const label = ex.duration ? 'Seconds' : ex.unit === 'each' ? 'Reps each side' : 'Reps';
      const current = ex.duration || ex.reps;
      showModal(`
        <div class="modal-handle"></div>
        <div class="modal-title">Edit ${label}</div>
        <input type="number" inputmode="numeric" class="form-input" id="edit-val" value="${current}" min="1" max="300" style="font-size:28px;text-align:center;padding:16px">
        <button class="btn btn-primary btn-full" data-action="save-reps">Save</button>
        <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
      setTimeout(() => document.getElementById('edit-val')?.select(), 100);
      break;
    }
    case 'save-reps': {
      const val = parseInt(document.getElementById('edit-val')?.value);
      if (isNaN(val) || val < 1) break;
      const ex = state.player?.currentExercise;
      if (!ex) break;
      if (ex.duration) ex.duration = val;
      else ex.reps = val;
      closeModal();
      renderSessionContent(state.player);
      break;
    }
    case 'edit-rest': {
      const ex = state.player?.currentExercise;
      if (!ex) break;
      showModal(`
        <div class="modal-handle"></div>
        <div class="modal-title">Edit Rest (seconds)</div>
        <input type="number" inputmode="numeric" class="form-input" id="edit-rest-val" value="${ex.rest}" min="0" max="600" style="font-size:28px;text-align:center;padding:16px">
        <button class="btn btn-primary btn-full" data-action="save-rest">Save</button>
        <button class="btn btn-ghost btn-full btn-sm" data-action="close-modal">Cancel</button>`);
      setTimeout(() => document.getElementById('edit-rest-val')?.select(), 100);
      break;
    }
    case 'save-rest': {
      const val = parseInt(document.getElementById('edit-rest-val')?.value);
      if (isNaN(val) || val < 0) break;
      const ex = state.player?.currentExercise;
      if (!ex) break;
      ex.rest = val;
      closeModal();
      renderSessionContent(state.player);
      break;
    }
    case 'confirm-swap': {
      const idx = parseInt(el.dataset.index);
      const moveId = el.dataset.moveId;
      const move = getMoveById(moveId);
      if (!move || !state.sessionData) break;
      // Replace exercise keeping sets/rest from original
      const orig = state.sessionData.exercises[idx];
      state.sessionData.exercises[idx] = {
        ...orig,
        moveId: move.id,
        move,
        reps: move.defaultReps,
        duration: move.defaultDuration,
        unit: move.unit || 'reps',
      };
      closeModal();
      renderSessionContent(state.player);
      break;
    }
    case 'exit-session':
      if (confirm('Exit this session? Progress won\'t be saved.')) {
        state.player?.destroy();
        state.player = null;
        state.sessionData = null;
        window.location.hash = state.previousHash || '#home';
      }
      break;
    case 'finish-session':
      state.player?.destroy();
      state.player = null;
      state.sessionData = null;
      window.location.hash = state.previousHash || '#home';
      break;

    // Profile
    case 'save-health-notes': {
      const notes = document.getElementById('health-notes-input')?.value || '';
      await saveProfile({ ...state.profile, healthNotes: notes });
      state.profile = await getProfile();
      showToast('Notes saved');
      break;
    }
    case 'toggle-training-day': {
      const day = parseInt(el.dataset.day);
      const days = Object.keys(state.profile.plan || {}).map(Number);
      let newDays;
      if (days.includes(day)) {
        newDays = days.filter(d => d !== day);
      } else {
        newDays = [...days, day].sort((a, b) => a - b);
      }
      if (newDays.length < 1 || newDays.length > 6) break;
      const newPlan = generateDefaultPlan(newDays);
      await saveProfile({ ...state.profile, trainingDays: newDays, plan: newPlan });
      state.profile = await getProfile();
      await renderProfile();
      break;
    }
    case 'toggle-equipment': {
      const eq = el.dataset.eq;
      const equip = [...(state.profile.equipment || [])];
      const idx = equip.indexOf(eq);
      if (idx >= 0) equip.splice(idx, 1); else equip.push(eq);
      await saveProfile({ ...state.profile, equipment: equip });
      state.profile = await getProfile();
      break;
    }
    case 'request-notifications':
      await requestNotificationPermission();
      break;
    case 'report-prev': {
      let { year, month } = state.reportDate;
      month--; if (month < 1) { month = 12; year--; }
      state.reportDate = { year, month };
      document.querySelector('.report-month-label').textContent = `${MONTH_NAMES[month - 1]} ${year}`;
      await loadMonthlyReport();
      break;
    }
    case 'report-next': {
      let { year, month } = state.reportDate;
      month++; if (month > 12) { month = 1; year++; }
      state.reportDate = { year, month };
      document.querySelector('.report-month-label').textContent = `${MONTH_NAMES[month - 1]} ${year}`;
      await loadMonthlyReport();
      break;
    }
    case 'export-data': {
      const dbJson = await exportAllData();
      const dbData = JSON.parse(dbJson);
      // Include chat history in backup
      const chatRaw = localStorage.getItem(CHAT_KEY);
      if (chatRaw) dbData._chat = JSON.parse(chatRaw);
      const blob = new Blob([JSON.stringify(dbData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fittrack-backup-${toDateStr(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      break;
    }
    case 'import-data': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          // Restore chat history if present
          if (data._chat) {
            localStorage.setItem(CHAT_KEY, JSON.stringify(data._chat));
            state.chatMessages = data._chat.messages || [];
            state.chatHistory  = data._chat.history  || [];
            delete data._chat;
          }
          await importAllData(JSON.stringify(data));
          state.profile = await getProfile();
          window.location.hash = '#home';
          showToast('Data restored!');
        } catch {
          showToast('Import failed — check the file format.');
        }
      };
      input.click();
      break;
    }
    case 'reset-app':
      if (confirm('This will delete ALL your data. Are you sure?')) {
        await importAllData('{"profile":[],"workouts":[],"weight":[],"measurements":[],"steps":[]}');
        localStorage.removeItem(CHAT_KEY);
        state.profile = null;
        state.chatMessages = [];
        state.chatHistory = [];
        renderOnboarding();
      }
      break;

    // Maya / Coach
    case 'send-chat':          await sendChatMessage(); break;
    case 'maya-refresh-analysis': {
      addTypingIndicator();
      try {
        const userData = await buildUserData();
        const res = await fetch(`${BACKEND_URL}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-app-secret': APP_SECRET },
          body: JSON.stringify({ userData }),
        });
        const { analysis, error } = await res.json();
        removeTypingIndicator();
        if (error) throw new Error(error);
        state.chatMessages.push({ role: 'maya', text: analysis });
        state.chatHistory.push({ role: 'assistant', content: analysis });
        renderChatMessages();
        scrollChatToBottom();
      } catch {
        removeTypingIndicator();
        state.chatMessages.push({ role: 'maya', text: "Couldn't refresh right now. Try again in a moment." });
        renderChatMessages();
      }
      break;
    }

    // Modals
    case 'close-modal': closeModal(); break;

    // Onboarding
    case 'ob-next': collectObStep(); break;
    case 'ob-back':
      state.ob.step = Math.max(0, state.ob.step - 1);
      renderOnboarding();
      break;
  }
}

// Enter key in chat
document.addEventListener('keydown', async e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'chat-input') {
    await sendChatMessage();
  }
});

// Input event for library search — only re-render the move list, not the whole tab,
// so the search input keeps focus and cursor position while typing.
document.addEventListener('input', e => {
  if (e.target.dataset.action === 'library-search') {
    state.librarySearch = e.target.value;
    const moveListEl = document.querySelector('#tab-library .move-list');
    if (!moveListEl) return;

    const filter = state.libraryFilter;
    const search = state.librarySearch.toLowerCase();
    let moves = MOVES;
    if (filter !== 'all') moves = moves.filter(m => m.equipment.includes(filter));
    if (search) moves = moves.filter(m =>
      m.name.toLowerCase().includes(search) ||
      m.muscles.some(mu => mu.toLowerCase().includes(search)) ||
      m.category.toLowerCase().includes(search)
    );

    moveListEl.innerHTML = moves.map(m => `
      <div class="move-card" data-action="view-move" data-move-id="${m.id}">
        ${thumbHTML(m, 90, 72)}
        <div class="move-card-info">
          <div class="move-card-name">${m.name}</div>
          <div class="move-card-muscles">${m.muscles.join(' · ')}</div>
          <div class="equip-tags">${m.equipment.map(eq => `<span class="equip-tag">${eq}</span>`).join('')}</div>
        </div>
      </div>`).join('') ||
      '<div class="empty-state"><div class="empty-icon">🏋️</div><div class="empty-text">No exercises match.</div></div>';
  }
});

// Onboarding day pill clicks (delegated separately since they're inside #main)
document.addEventListener('click', e => {
  const dayBtn = e.target.closest('[data-ob-day]');
  if (dayBtn) {
    const day = parseInt(dayBtn.dataset.obDay);
    const days = state.ob.trainingDays;
    const idx = days.indexOf(day);
    if (idx >= 0) { days.splice(idx, 1); } else { days.push(day); }
    renderOnboarding();
  }
  const eqBox = e.target.closest('[data-ob-eq]');
  if (eqBox && eqBox.tagName === 'INPUT') {
    const eq = eqBox.dataset.obEq;
    const equip = state.ob.equipment;
    const idx = equip.indexOf(eq);
    if (eqBox.checked && idx < 0) equip.push(eq);
    else if (!eqBox.checked && idx >= 0) equip.splice(idx, 1);
  }
});

function collectObStep() {
  const ob = state.ob;
  switch (ob.step) {
    case 0: ob.name = document.getElementById('ob-name')?.value?.trim() || ''; break;
    case 2:
      ob.notifyHour = parseInt(document.getElementById('ob-hour')?.value || '7');
      ob.notifyMinute = parseInt(document.getElementById('ob-minute')?.value || '0');
      break;
    case 4:
      ob.weight = document.getElementById('ob-weight')?.value || '';
      ob.waist  = document.getElementById('ob-waist')?.value || '';
      ob.hip    = document.getElementById('ob-hip')?.value || '';
      ob.thigh  = document.getElementById('ob-thigh')?.value || '';
      break;
    case 5:
      ob.healthNotes = document.getElementById('ob-notes')?.value?.trim() || '';
      break;
  }

  if (ob.step < 5) {
    ob.step++;
    renderOnboarding();
  } else {
    finishOnboarding();
  }
}

// ─── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#1E293B;color:#F8FAFC;padding:10px 20px;border-radius:99px;font-size:14px;font-weight:600;z-index:300;box-shadow:0 4px 16px rgba(0,0,0,0.4);white-space:nowrap';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ─── Coach / Maya View ────────────────────────────────────────────────────

async function renderCoach() {
  document.getElementById('main').classList.add('coach-main');
  setView(`
    <div class="view coach-view">
      <div class="maya-header">
        <img src="icons/maya.svg" class="maya-avatar-lg" alt="Maya">
        <div class="maya-header-text">
          <div class="maya-name">Maya</div>
          <div class="maya-title">Your Personal Trainer</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="maya-refresh-analysis" title="Refresh analysis">↻</button>
      </div>

      <div class="chat-window" id="chat-window">
        ${state.chatMessages.map(m => chatBubble(m)).join('')}
        ${state.chatMessages.length === 0 ? `
          <div class="chat-bubble-wrap maya-wrap" id="analysis-bubble">
            <img src="icons/maya.svg" class="chat-maya-avatar" alt="Maya">
            <div class="chat-bubble maya-bubble">
              <div class="maya-typing"><span></span><span></span><span></span></div>
            </div>
          </div>` : ''}
      </div>

      <div class="chat-input-bar">
        <input type="text" id="chat-input" class="chat-input" placeholder="Ask Maya…" autocomplete="off">
        <button class="btn btn-primary chat-send-btn" data-action="send-chat">↑</button>
      </div>
    </div>`, 'Maya');

  // Load analysis into chat if no messages yet
  if (state.chatMessages.length === 0) await loadMayaAnalysis();

  scrollChatToBottom();
}

async function loadMayaAnalysis() {
  const analysisBubble = document.getElementById('analysis-bubble');

  if (!BACKEND_URL) {
    const fallback = "Hey! I'm Maya, your personal trainer. I'm not fully connected yet — once the backend is set up I'll be able to analyse your progress. For now, feel free to ask me anything! 💪";
    if (analysisBubble) analysisBubble.remove();
    state.chatMessages.push({ role: 'maya', text: fallback });
    state.chatHistory.push({ role: 'assistant', content: fallback });
    renderChatMessages();
    return;
  }

  try {
    const userData = await buildUserData();
    const res = await fetch(`${BACKEND_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': APP_SECRET },
      body: JSON.stringify({ userData }),
    });
    const { analysis, error } = await res.json();
    if (error) throw new Error(error);

    if (analysisBubble) analysisBubble.remove();
    state.chatMessages.push({ role: 'maya', text: analysis });
    state.chatHistory.push({ role: 'assistant', content: analysis });
    saveChatToStorage();
    renderChatMessages();
    scrollChatToBottom();
  } catch (e) {
    if (analysisBubble) analysisBubble.remove();
    state.chatMessages.push({ role: 'maya', text: "Hey! I'm Maya. I had trouble loading your analysis right now — but I'm here to chat. What's on your mind? 💪" });
    renderChatMessages();
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input?.value?.trim();
  if (!message) return;

  input.value = '';

  // Add user bubble immediately
  state.chatMessages.push({ role: 'user', text: message });
  state.chatHistory.push({ role: 'user', content: message });
  saveChatToStorage();
  renderChatMessages();
  scrollChatToBottom();

  if (!BACKEND_URL) {
    const fallback = "I'm not connected yet — add the Vercel backend URL to config.js to activate me.";
    state.chatMessages.push({ role: 'maya', text: fallback });
    renderChatMessages();
    return;
  }

  // Typing indicator
  addTypingIndicator();

  try {
    const userData = await buildUserData();
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': APP_SECRET },
      body: JSON.stringify({
        message,
        history: state.chatHistory.slice(-10),
        userData,
      }),
    });
    const { reply, action, error } = await res.json();
    removeTypingIndicator();

    if (error) throw new Error(error);

    state.chatMessages.push({ role: 'maya', text: reply });
    state.chatHistory.push({ role: 'assistant', content: reply });
    saveChatToStorage();
    renderChatMessages();
    scrollChatToBottom();

    if (action) await applyPlanAction(action);
  } catch (e) {
    removeTypingIndicator();
    state.chatMessages.push({ role: 'maya', text: "Something went wrong on my end. Try again in a moment." });
    renderChatMessages();
  }
}

function renderChatMessages() {
  const win = document.getElementById('chat-window');
  if (!win) return;
  win.innerHTML = state.chatMessages.map(m => chatBubble(m)).join('');
}

function chatBubble({ role, text }) {
  if (role === 'user') {
    return `<div class="chat-bubble-wrap user-wrap">
      <div class="chat-bubble user-bubble">${escHtml(text)}</div>
    </div>`;
  }
  return `<div class="chat-bubble-wrap maya-wrap">
    <img src="icons/maya.svg" class="chat-maya-avatar" alt="Maya">
    <div class="chat-bubble maya-bubble">${text.replace(/\n/g, '<br>')}</div>
  </div>`;
}

function addTypingIndicator() {
  const win = document.getElementById('chat-window');
  if (!win) return;
  win.insertAdjacentHTML('beforeend', `
    <div class="chat-bubble-wrap maya-wrap" id="typing-indicator">
      <img src="icons/maya.svg" class="chat-maya-avatar" alt="Maya">
      <div class="chat-bubble maya-bubble">
        <div class="maya-typing"><span></span><span></span><span></span></div>
      </div>
    </div>`);
  scrollChatToBottom();
}

function removeTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

function scrollChatToBottom() {
  const win = document.getElementById('chat-window');
  if (win) win.scrollTop = win.scrollHeight;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function applyPlanAction(action) {
  if (!state.profile || !action?.type) return;
  const plan = { ...(state.profile.plan || {}) };

  if (action.type === 'set_session') {
    const template = SESSION_TEMPLATES[action.sessionKey];
    if (!template) return;
    plan[action.day] = {
      ...template,
      sessionKey: action.sessionKey,
      exercises: template.exercises.map(e => ({ ...e })),
    };
  } else if (action.type === 'set_rest') {
    delete plan[action.day];
  } else {
    return;
  }

  await saveProfile({ ...state.profile, plan });
  state.profile = await getProfile();
  showToast('Schedule updated ✓');
}

async function buildUserData() {
  const [weightHistory, measurements, recentWorkouts, stepHistory] = await Promise.all([
    getWeightHistory(),
    getMeasurementHistory(),
    getAllWorkouts(),
    getStepsHistory(),
  ]);
  const streak = await getStreak(state.profile?.plan || {});
  return {
    profile: state.profile,
    weightHistory: weightHistory.slice(-20),
    measurements: measurements.slice(-10),
    recentWorkouts: recentWorkouts.slice(-20),
    stepHistory: stepHistory.slice(-14),
    streak,
  };
}

// ─── Start ─────────────────────────────────────────────────────────────────

init();

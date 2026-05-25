// Chart.js is loaded globally via CDN in index.html

const TEAL = '#2DD4BF';
const AMBER = '#F59E0B';
const PINK = '#F472B6';
const PURPLE = '#A78BFA';
const MUTED = '#475569';
const TEXT = '#94A3B8';

const BASE_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: TEXT, font: { size: 12 } } },
    tooltip: { backgroundColor: '#1E293B', titleColor: '#F8FAFC', bodyColor: TEXT },
  },
  scales: {
    x: { ticks: { color: TEXT, maxRotation: 45 }, grid: { color: '#1E293B' } },
    y: { ticks: { color: TEXT }, grid: { color: '#334155' } },
  },
};

function destroyChart(canvasId) {
  const existing = Chart.getChart(canvasId);
  if (existing) existing.destroy();
}

// ─── Weight chart ─────────────────────────────────────────────────────────

export function renderWeightChart(canvasId, data) {
  // data: [{ date, kg }]
  destroyChart(canvasId);
  if (!data.length) return;

  new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: data.map(d => formatDate(d.date)),
      datasets: [{
        label: 'Weight (kg)',
        data: data.map(d => d.kg),
        borderColor: TEAL,
        backgroundColor: TEAL + '22',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: TEAL,
      }],
    },
    options: {
      ...BASE_OPTIONS,
      plugins: {
        ...BASE_OPTIONS.plugins,
        legend: { display: false },
      },
    },
  });
}

// ─── Measurements chart ───────────────────────────────────────────────────

export function renderMeasurementsChart(canvasId, data) {
  // data: [{ date, waist, hip, thigh }]
  destroyChart(canvasId);
  const filtered = data.filter(d => d.waist || d.hip || d.thigh);
  if (!filtered.length) return;

  new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: filtered.map(d => formatDate(d.date)),
      datasets: [
        makeDataset('Waist (cm)', filtered.map(d => d.waist || null), AMBER),
        makeDataset('Hip (cm)',   filtered.map(d => d.hip || null),   PINK),
        makeDataset('Thigh (cm)', filtered.map(d => d.thigh || null), PURPLE),
      ],
    },
    options: BASE_OPTIONS,
  });
}

// ─── Steps chart ──────────────────────────────────────────────────────────

export function renderStepsChart(canvasId, data, goal = 8000) {
  // data: [{ date, count }]
  destroyChart(canvasId);
  if (!data.length) return;

  const recent = data.slice(-30);

  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: recent.map(d => formatDate(d.date)),
      datasets: [
        {
          label: 'Steps',
          data: recent.map(d => d.count),
          backgroundColor: recent.map(d => d.count >= goal ? TEAL + 'cc' : MUTED + 'cc'),
          borderRadius: 4,
        },
        {
          label: `Goal (${goal.toLocaleString()})`,
          data: recent.map(() => goal),
          type: 'line',
          borderColor: AMBER,
          borderDash: [6, 3],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      ...BASE_OPTIONS,
      plugins: {
        ...BASE_OPTIONS.plugins,
        legend: { labels: { color: TEXT, font: { size: 12 } } },
      },
    },
  });
}

// ─── Activity calendar heatmap ────────────────────────────────────────────

export function renderActivityCalendar(containerId, workouts, plan) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  // Anchor to Monday of current week
  const dow = today.getDay(); // 0=Sun
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + daysToMonday);

  // 3 weeks back → 1 week forward = 4 complete Mon–Sun rows
  const startDate = new Date(thisMonday);
  startDate.setDate(thisMonday.getDate() - 21);

  const doneSet = new Set(workouts.filter(w => w.completed).map(w => w.date));
  const altSet  = new Set(workouts.filter(w => w.isAlternative).map(w => w.date));
  const trainingDays = new Set(Object.keys(plan || {}).map(Number));

  // Build 4 week arrays
  const weeks = [];
  const cur = new Date(startDate);
  for (let w = 0; w < 4; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Day headers Mon–Sun
  const dayHeaders = ['M','T','W','T','F','S','S'];

  let html = '<div class="cal-container">';

  // Header
  html += `<div class="cal-header">
    <div class="cal-month-col"></div>
    <div class="cal-days-header">${dayHeaders.map(l => `<span>${l}</span>`).join('')}</div>
  </div>`;

  let prevMonth = -1;

  for (const week of weeks) {
    const monday = week[0];
    const weekMonth = monday.getMonth();

    // Detect if this week row crosses a month boundary (for separator line)
    const crossesBoundary = week.some(d => d.getDate() === 1) && weeks.indexOf(week) > 0;
    const showLabel = weekMonth !== prevMonth;
    const monthLabel = monday.toLocaleDateString('en-GB', { month: 'short' });
    prevMonth = weekMonth;

    html += `<div class="cal-week-row${crossesBoundary ? ' cal-month-start' : ''}">`;
    html += `<div class="cal-month-label">${showLabel ? monthLabel : ''}</div>`;
    html += `<div class="cal-week">`;

    for (const d of week) {
      const dateStr = toDateStr(d);
      const isDone     = doneSet.has(dateStr);
      const isAlt      = altSet.has(dateStr);
      const isFuture   = d > today;
      const isToday    = dateStr === todayStr;
      const isTraining = trainingDays.has(d.getDay());

      let cls = 'cal-day';
      if (isDone || isAlt)              cls += ' cal-done';
      else if (isTraining && !isFuture) cls += ' cal-missed';
      else if (isFuture)                cls += ' cal-future';
      if (isToday)                      cls += ' cal-today';

      const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      html += `<div class="${cls}" title="${label}"></div>`;
    }

    html += '</div></div>';
  }

  html += '</div>';

  // Legend
  html += `<div class="cal-legend">
    <span class="cal-legend-dot" style="background:var(--primary)"></span><span>Done</span>
    <span class="cal-legend-dot" style="background:var(--danger);opacity:.5"></span><span>Missed</span>
    <span class="cal-legend-dot" style="background:var(--surface2)"></span><span>Rest</span>
  </div>`;

  container.innerHTML = html;
}

// ─── Strength / Rep progression chart ────────────────────────────────────

export function renderStrengthChart(canvasId, data) {
  // data: [{ date, value, unit, moveName }] — best value per date, sorted by date
  destroyChart(canvasId);
  if (!data.length) return;

  const unit = data[0]?.unit || 'reps';

  new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: data.map(d => formatDate(d.date)),
      datasets: [{
        label: unit === 'seconds' ? 'Seconds' : 'Reps',
        data: data.map(d => d.value),
        borderColor: PURPLE,
        backgroundColor: PURPLE + '22',
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: PURPLE,
        pointHoverRadius: 7,
      }],
    },
    options: {
      ...BASE_OPTIONS,
      plugins: {
        ...BASE_OPTIONS.plugins,
        legend: { display: false },
        tooltip: {
          ...BASE_OPTIONS.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.parsed.y} ${unit}`,
          },
        },
      },
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeDataset(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color + '22',
    fill: false,
    tension: 0.3,
    pointRadius: 4,
    pointBackgroundColor: color,
    spanGaps: true,
  };
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

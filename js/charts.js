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
  const weeks = 12;
  const days = weeks * 7;

  // Build a set of completed workout dates
  const doneSet = new Set(workouts.filter(w => w.completed).map(w => w.date));
  const altSet  = new Set(workouts.filter(w => w.isAlternative).map(w => w.date));
  const trainingDays = new Set(Object.keys(plan || {}).map(Number));

  let html = '<div class="cal-grid">';
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - days + 1);

  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dateStr = toDateStr(d);
    const isTraining = trainingDays.has(d.getDay());
    const isDone = doneSet.has(dateStr);
    const isAlt  = altSet.has(dateStr);
    const isFuture = d > today;

    let cls = 'cal-day';
    if (isDone || isAlt) cls += ' cal-done';
    else if (isTraining && !isFuture) cls += ' cal-missed';
    else if (isFuture) cls += ' cal-future';

    const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    html += `<div class="${cls}" title="${label}"></div>`;
  }

  html += '</div>';

  // Week day labels
  const dayLabels = ['S','M','T','W','T','F','S'];
  let labelsHtml = '<div class="cal-labels">' + dayLabels.map(l => `<span>${l}</span>`).join('') + '</div>';

  container.innerHTML = labelsHtml + html;
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

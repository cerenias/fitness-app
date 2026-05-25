import { SESSION_TEMPLATES, getMoveById } from './data.js';
import { getWorkoutsInRange, getAllWorkouts, toDateStr } from './db.js';

// ─── Plan helpers ──────────────────────────────────────────────────────────

const SESSION_ROTATION = ['A', 'B', 'C'];

export function generateDefaultPlan(trainingDays) {
  // trainingDays: array of weekday numbers [0-6], Sun=0
  // Returns a plan object: { [weekday]: { sessionKey, exercises } }
  const plan = {};
  trainingDays.forEach((day, i) => {
    const key = SESSION_ROTATION[i % 3];
    const template = SESSION_TEMPLATES[key];
    plan[day] = {
      sessionKey: key,
      name: template.name,
      focus: template.focus,
      exercises: template.exercises.map(e => ({ ...e })),
    };
  });
  return plan;
}

export function getTodaySession(plan) {
  const weekday = new Date().getDay();
  return plan[weekday] || null;
}

export function getSessionForDay(plan, weekday) {
  return plan[weekday] || null;
}

export function resolveSession(planSession) {
  if (!planSession) return null;
  return {
    ...planSession,
    exercises: planSession.exercises.map(e => {
      const move = getMoveById(e.moveId);
      return {
        ...e,
        unit: move?.unit || 'reps',   // carry unit so repsLabel() works everywhere
        move,
      };
    }),
  };
}

// ─── Streak ───────────────────────────────────────────────────────────────

export async function getStreak(plan) {
  const all = await getAllWorkouts();
  if (!all.length) return 0;

  const trainingDays = Object.keys(plan).map(Number);
  let streak = 0;
  const today = new Date();

  // Walk backwards from today counting completed sessions on scheduled training days
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayOfWeek = d.getDay();
    if (!trainingDays.includes(dayOfWeek)) continue;

    const dateStr = toDateStr(d);
    const done = all.find(w => w.date === dateStr);
    if (done) {
      streak++;
    } else {
      // Allow one missed day tolerance before today
      if (i === 0) continue;
      break;
    }
  }
  return streak;
}

// ─── Smart nudge ──────────────────────────────────────────────────────────

export async function getSmartNudge(plan) {
  const all = await getAllWorkouts();
  if (!all.length) {
    return { show: true, message: "Let's kick things off — your first session is ready!" };
  }

  const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));
  const lastDate = new Date(sorted[0].date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((today - lastDate) / 86400000);

  const trainingDays = Object.keys(plan).map(Number);
  const todayIsTraining = trainingDays.includes(today.getDay());

  if (daysSince === 0) return { show: false, message: '' };

  if (daysSince >= 3) {
    return { show: true, message: `It's been ${daysSince} days since your last session. Time to move!` };
  }

  if (daysSince === 2 && todayIsTraining) {
    return { show: true, message: "Today's a training day — your body is ready for it." };
  }

  return { show: false, message: '' };
}

// ─── Monthly report ───────────────────────────────────────────────────────

export async function getMonthlyReport(plan, year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  const workouts = await getWorkoutsInRange(from, to);

  // Count how many training days were in this month
  let plannedCount = 0;
  const trainingDays = Object.keys(plan).map(Number);
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    if (trainingDays.includes(d.getDay())) plannedCount++;
    d.setDate(d.getDate() + 1);
  }

  const alternatives = workouts.filter(w => w.isAlternative).length;
  const completed = workouts.filter(w => w.completed && !w.isAlternative).length;

  return { planned: plannedCount, completed, alternatives, workouts };
}

// ─── Swap session ─────────────────────────────────────────────────────────

export function swapSessionExercise(session, exerciseIndex, newMoveId, newSets, newReps, newDuration, newRest) {
  const updated = { ...session };
  updated.exercises = [...session.exercises];
  updated.exercises[exerciseIndex] = {
    moveId: newMoveId,
    sets: newSets,
    reps: newReps,
    duration: newDuration,
    rest: newRest,
    move: getMoveById(newMoveId),
  };
  return updated;
}

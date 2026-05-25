import Dexie from 'https://unpkg.com/dexie@3/dist/dexie.mjs';

const db = new Dexie('FitTrackDB');

db.version(1).stores({
  profile:      '++id',
  workouts:     '++id, date, sessionKey, isAlternative',
  weight:       '++id, date',
  measurements: '++id, date',
  steps:        '++id, date',
});

db.version(2).stores({
  profile:      '++id',
  workouts:     '++id, date, sessionKey, isAlternative',
  weight:       '++id, date',
  measurements: '++id, date',
  steps:        '++id, date',
  setLogs:      '++id, date, moveId',
});

// ─── Profile ───────────────────────────────────────────────────────────────

export async function getProfile() {
  return db.profile.toCollection().first();
}

export async function saveProfile(data) {
  const existing = await db.profile.toCollection().first();
  if (existing) {
    await db.profile.update(existing.id, data);
  } else {
    await db.profile.add(data);
  }
}

// ─── Workouts ──────────────────────────────────────────────────────────────

export async function logWorkout(entry) {
  return db.workouts.add({ ...entry, date: toDateStr(new Date()) });
}

export async function getWorkoutByDate(dateStr) {
  return db.workouts.where('date').equals(dateStr).first();
}

export async function getWorkoutsInRange(from, to) {
  return db.workouts.where('date').between(from, to, true, true).toArray();
}

export async function getAllWorkouts() {
  return db.workouts.orderBy('date').toArray();
}

// ─── Weight ────────────────────────────────────────────────────────────────

export async function logWeight(kg) {
  const date = toDateStr(new Date());
  const existing = await db.weight.where('date').equals(date).first();
  if (existing) {
    await db.weight.update(existing.id, { kg });
  } else {
    await db.weight.add({ date, kg });
  }
}

export async function getWeightHistory() {
  return db.weight.orderBy('date').toArray();
}

export async function getLatestWeight() {
  const all = await db.weight.orderBy('date').toArray();
  return all.length ? all[all.length - 1] : null;
}

// ─── Measurements ──────────────────────────────────────────────────────────

export async function logMeasurements(entry) {
  const date = toDateStr(new Date());
  const existing = await db.measurements.where('date').equals(date).first();
  if (existing) {
    await db.measurements.update(existing.id, entry);
  } else {
    await db.measurements.add({ date, ...entry });
  }
}

export async function getMeasurementHistory() {
  return db.measurements.orderBy('date').toArray();
}

export async function getLatestMeasurements() {
  const all = await db.measurements.orderBy('date').toArray();
  return all.length ? all[all.length - 1] : null;
}

// ─── Steps ─────────────────────────────────────────────────────────────────

export async function logSteps(count) {
  const date = toDateStr(new Date());
  const existing = await db.steps.where('date').equals(date).first();
  if (existing) {
    await db.steps.update(existing.id, { count });
  } else {
    await db.steps.add({ date, count });
  }
}

export async function getStepsByDate(dateStr) {
  return db.steps.where('date').equals(dateStr).first();
}

export async function getStepsHistory() {
  return db.steps.orderBy('date').toArray();
}

// ─── Set Logs (per-set rep/seconds tracking) ──────────────────────────────

export async function logSetResult({ date, moveId, moveName, setIndex, value, unit }) {
  return db.setLogs.add({ date, moveId, moveName, setIndex, value, unit });
}

export async function getSetLogsByMove(moveId) {
  return db.setLogs.where('moveId').equals(moveId).sortBy('date');
}

export async function getAllSetLogs() {
  return db.setLogs.orderBy('date').toArray();
}

// ─── Export / Import ───────────────────────────────────────────────────────

export async function exportAllData() {
  const [profile, workouts, weight, measurements, steps, setLogs] = await Promise.all([
    db.profile.toArray(),
    db.workouts.toArray(),
    db.weight.toArray(),
    db.measurements.toArray(),
    db.steps.toArray(),
    db.setLogs.toArray(),
  ]);
  return JSON.stringify({ profile, workouts, weight, measurements, steps, setLogs, exportedAt: new Date().toISOString() }, null, 2);
}

export async function importAllData(jsonStr) {
  const data = JSON.parse(jsonStr);
  await db.transaction('rw', db.profile, db.workouts, db.weight, db.measurements, db.steps, db.setLogs, async () => {
    await Promise.all([
      db.profile.clear(),
      db.workouts.clear(),
      db.weight.clear(),
      db.measurements.clear(),
      db.steps.clear(),
      db.setLogs.clear(),
    ]);
    await Promise.all([
      db.profile.bulkAdd(data.profile || []),
      db.workouts.bulkAdd(data.workouts || []),
      db.weight.bulkAdd(data.weight || []),
      db.measurements.bulkAdd(data.measurements || []),
      db.steps.bulkAdd(data.steps || []),
      db.setLogs.bulkAdd(data.setLogs || []),
    ]);
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

export function dateStrToDate(str) {
  return new Date(str + 'T00:00:00');
}

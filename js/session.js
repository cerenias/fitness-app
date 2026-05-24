import { getMoveById } from './data.js';
import { logWorkout, toDateStr } from './db.js';
import { updateLastWorkoutTag } from './notifications.js';

// ─── SessionPlayer ─────────────────────────────────────────────────────────
// Manages the state machine for an active workout session.
// Phases: intro → active → rest → (next set / next exercise) → done

export class SessionPlayer {
  constructor(session, onRender, onComplete) {
    this.session = session; // resolved session with move objects
    this.onRender = onRender;
    this.onComplete = onComplete;

    this.exerciseIndex = 0;
    this.setIndex = 0;
    this.phase = 'intro'; // 'intro' | 'active' | 'rest' | 'done'
    this.timerValue = 0;
    this.timerInterval = null;
    this.startTime = Date.now();
    this.completedSets = []; // track for logging
  }

  get currentExercise() {
    return this.session.exercises[this.exerciseIndex];
  }

  get totalExercises() {
    return this.session.exercises.length;
  }

  get currentMove() {
    return this.currentExercise.move;
  }

  get isTimedExercise() {
    return !!this.currentExercise.duration;
  }

  // ─── Phase transitions ───────────────────────────────────────────────────

  startSet() {
    this.phase = 'active';
    if (this.isTimedExercise) {
      this.startTimer(this.currentExercise.duration, () => this.completeSet());
    }
    this.onRender();
  }

  completeSet() {
    this.clearTimer();
    this.completedSets.push({
      exerciseIndex: this.exerciseIndex,
      setIndex: this.setIndex,
    });

    const totalSets = this.currentExercise.sets;
    const isLastSet = this.setIndex >= totalSets - 1;
    const isLastExercise = this.exerciseIndex >= this.totalExercises - 1;

    if (isLastSet && isLastExercise) {
      this.phase = 'done';
      this._saveWorkout();
      this.onRender();
      return;
    }

    this.phase = 'rest';
    const restSecs = this.currentExercise.rest || 45;
    this.startTimer(restSecs, () => {
      if (isLastSet) {
        this.exerciseIndex++;
        this.setIndex = 0;
        this.phase = 'intro';
      } else {
        this.setIndex++;
        this.phase = 'active';
        if (this.isTimedExercise) {
          this.startTimer(this.currentExercise.duration, () => this.completeSet());
          return;
        }
      }
      this.onRender();
    });
    this.onRender();
  }

  skipRest() {
    this.clearTimer();
    const totalSets = this.currentExercise.sets;
    const isLastSet = this.setIndex >= totalSets - 1;
    const isLastExercise = this.exerciseIndex >= this.totalExercises - 1;

    if (isLastSet) {
      if (isLastExercise) {
        this.phase = 'done';
        this._saveWorkout();
      } else {
        this.exerciseIndex++;
        this.setIndex = 0;
        this.phase = 'intro';
      }
    } else {
      this.setIndex++;
      this.phase = 'active';
      if (this.isTimedExercise) {
        this.startTimer(this.currentExercise.duration, () => this.completeSet());
        this.onRender();
        return;
      }
    }
    this.onRender();
  }

  jumpToExercise(index) {
    this.clearTimer();
    this.exerciseIndex = Math.min(index, this.totalExercises - 1);
    this.setIndex = 0;
    this.phase = 'intro';
    this.onRender();
  }

  // ─── Timer ───────────────────────────────────────────────────────────────

  startTimer(seconds, onDone) {
    this.clearTimer();
    this.timerValue = seconds;
    this.onRender();
    this.timerInterval = setInterval(() => {
      this.timerValue--;
      if (this.timerValue <= 0) {
        this.clearTimer();
        onDone();
      } else {
        this.onRender();
      }
    }, 1000);
  }

  clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  destroy() {
    this.clearTimer();
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  async _saveWorkout() {
    const duration = Math.round((Date.now() - this.startTime) / 1000 / 60);
    await logWorkout({
      sessionKey: this.session.sessionKey,
      sessionName: this.session.name,
      completed: true,
      isAlternative: false,
      durationMinutes: duration,
      exercisesCompleted: this.totalExercises,
    });
    await updateLastWorkoutTag();
    this.onComplete?.();
  }
}

// ─── Format helpers ───────────────────────────────────────────────────────

export function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
}

export function repsLabel(exercise) {
  if (exercise.duration) return `${exercise.duration}s`;
  if (exercise.unit === 'each') return `${exercise.reps} each side`;
  return `${exercise.reps} reps`;
}

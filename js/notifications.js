import { ONESIGNAL_APP_ID } from './config.js';

// ─── OneSignal init ────────────────────────────────────────────────────────

export function initNotifications() {
  if (!ONESIGNAL_APP_ID) return;

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async (OneSignal) => {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      safari_web_id: '',
      notifyButton: { enable: false },
      allowLocalhostAsSecureOrigin: true,
    });
  });
}

export async function requestNotificationPermission() {
  if (!ONESIGNAL_APP_ID) {
    return { granted: false, reason: 'no-config' };
  }

  try {
    await window.OneSignal.Notifications.requestPermission();
    const granted = window.OneSignal.Notifications.permission;
    return { granted };
  } catch (e) {
    return { granted: false, reason: e.message };
  }
}

export async function setTrainingDayTags(trainingDays, notifyHour, notifyMinute) {
  if (!ONESIGNAL_APP_ID || !window.OneSignal) return;
  // Tags let OneSignal's automated messages target this user
  await window.OneSignal.User.addTags({
    training_days: trainingDays.join(','),
    notify_hour: String(notifyHour),
    notify_minute: String(notifyMinute),
    last_workout_date: '',
  });
}

export async function updateLastWorkoutTag() {
  if (!ONESIGNAL_APP_ID || !window.OneSignal) return;
  const today = new Date().toISOString().slice(0, 10);
  await window.OneSignal.User.addTag('last_workout_date', today);
}

// ─── In-app nudge (no backend needed) ─────────────────────────────────────

export function showInAppNudge(message, onDismiss) {
  const existing = document.getElementById('nudge-banner');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'nudge-banner';
  el.className = 'nudge-banner';
  el.innerHTML = `
    <span class="nudge-icon">💪</span>
    <span class="nudge-text">${message}</span>
    <button class="nudge-close" aria-label="Dismiss">✕</button>
  `;
  el.querySelector('.nudge-close').addEventListener('click', () => {
    el.remove();
    onDismiss?.();
  });
  document.body.prepend(el);
}

// ─── Notification permission status ───────────────────────────────────────

export function notificationsAvailable() {
  return !!ONESIGNAL_APP_ID;
}

export function notificationsConfigured() {
  return !!ONESIGNAL_APP_ID;
}

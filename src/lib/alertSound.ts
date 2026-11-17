/**
 * Звуковой сигнал срабатывания ценового алерта.
 * Звук синтезируется браузером (Web Audio), отдельных аудиофайлов нет.
 * Настройка «звук вкл/выкл» хранится на устройстве.
 */

const STORAGE_KEY = 'aegisquant_alert_sound';

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

export function isAlertSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlertSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // хранилище недоступно: настройка не сохранится, звук всё равно работает в этой сессии
  }
}

/** Браузер разрешает звук только после касания пользователя — «разблокируем» звук при первом касании. */
export function installAudioUnlock(): void {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, volume: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Мягкий восходящий сигнал из трёх нот + вибрация на Android. Если звук выключен или запрещён браузером — тихо ничего не делает. */
export function playAlertChime(force = false): void {
  try {
    if (!force && !isAlertSoundEnabled()) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 70, 120]);
    }
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime + 0.02;
    tone(ctx, 659.25, t0, 0.22, 0.12); // E5
    tone(ctx, 880, t0 + 0.14, 0.22, 0.12); // A5
    tone(ctx, 1318.5, t0 + 0.28, 0.45, 0.1); // E6
  } catch {
    // звук недоступен — не мешаем работе приложения
  }
}

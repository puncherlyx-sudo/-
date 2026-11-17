/** Лёгкая вибрация-отклик на Android (Chrome). Тихо ничего не делает там, где не поддерживается. */
export function hapticTap(durationMs = 8): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(durationMs);
  } catch {
    // вибрация недоступна — не страшно
  }
}

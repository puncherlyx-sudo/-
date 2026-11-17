import { FREE_MAX_ACTIVE_ALERTS, PRO_MAX_ACTIVE_ALERTS } from '../data/strategies.ts';

export function maxActiveAlertsFor(isPro: boolean): number {
  return isPro ? PRO_MAX_ACTIVE_ALERTS : FREE_MAX_ACTIVE_ALERTS;
}

/**
 * Оставляет активными (то есть отслеживаемыми сервером) не больше max алертов — первые по порядку.
 * Остальные активные помечаются неактивными для мониторинга; в базе пользователя они не меняются.
 */
export function capActiveAlerts<T extends { active: boolean }>(
  alerts: T[],
  max: number
): { alerts: T[]; monitored: number; overLimit: number } {
  let active = 0;
  let overLimit = 0;
  const capped = alerts.map((a) => {
    if (!a.active) return a;
    if (active < max) {
      active += 1;
      return a;
    }
    overLimit += 1;
    return { ...a, active: false };
  });
  return { alerts: capped, monitored: active, overLimit };
}

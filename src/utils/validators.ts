/**
 * Централизованный модуль строгой валидации бизнес-логики,
 * защиты от XSS/открытых редиректов (URL) и SSRF-защиты вебхуков VERNIER.
 */

import type { PlanTier } from '../types/domain';

export interface ValidationResult<T = number> {
  ok: boolean;
  value?: T;
  error?: string;
}

const SCIENTIFIC_NOTATION_REGEX = /[eE][+-]?\d+/;
const STRICT_DECIMAL_REGEX = /^\d+(?:[.,]\d+)?$/;

/**
 * Проверка отсутствия экспоненциальной записи (например, 1e5, 1E-3) и инъекций.
 */
export function hasScientificNotation(raw: string): boolean {
  return SCIENTIFIC_NOTATION_REGEX.test(raw.trim());
}

/**
 * Строгий парсинг положительного числа (> 0):
 * отклоняет NaN, Infinity, <= 0, отрицательные значения и научную нотацию (1e5).
 */
export function parseStrictPositiveNumber(
  raw: string | number,
  options?: {
    fieldLabel?: string;
    min?: number;
    max?: number;
    allowZero?: boolean;
  }
): ValidationResult<number> {
  const label = options?.fieldLabel || 'Значение';
  const min = options?.min ?? (options?.allowZero ? 0 : Number.MIN_VALUE);
  const max = options?.max ?? 1_000_000_000;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || Number.isNaN(raw)) {
      return { ok: false, error: `${label}: некорректное число.` };
    }
    if (options?.allowZero ? raw < 0 : raw <= 0) {
      return { ok: false, error: `${label} должно быть строго больше 0.` };
    }
    if (raw < min || raw > max) {
      return { ok: false, error: `${label} вне допустимого диапазона (${min} – ${max}).` };
    }
    return { ok: true, value: raw };
  }

  const trimmed = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!trimmed) {
    return { ok: false, error: `${label}: поле не может быть пустым.` };
  }
  if (hasScientificNotation(trimmed)) {
    return { ok: false, error: `${label}: экспоненциальная запись (1e5) запрещена.` };
  }
  if (!STRICT_DECIMAL_REGEX.test(trimmed)) {
    return { ok: false, error: `${label}: допускаются только положительные числа.` };
  }

  const normalized = trimmed.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return { ok: false, error: `${label}: некорректное числовое значение.` };
  }
  if (options?.allowZero ? num < 0 : num <= 0) {
    return { ok: false, error: `${label} должно быть строго больше 0.` };
  }
  if (num < min) {
    return { ok: false, error: `${label} не может быть меньше ${min}.` };
  }
  if (num > max) {
    return { ok: false, error: `${label} не может превышать ${max}.` };
  }

  return { ok: true, value: num };
}

export function validatePrice(raw: string | number, fieldLabel = 'Цена'): ValidationResult<number> {
  return parseStrictPositiveNumber(raw, {
    fieldLabel,
    min: 0.0000001,
    max: 10_000_000,
  });
}

export function validateQuantity(raw: string | number, fieldLabel = 'Количество'): ValidationResult<number> {
  return parseStrictPositiveNumber(raw, {
    fieldLabel,
    min: 0.000001,
    max: 100_000_000,
  });
}

export function validateDepositUsdt(raw: string | number, fieldLabel = 'Депозит'): ValidationResult<number> {
  return parseStrictPositiveNumber(raw, {
    fieldLabel,
    min: 1,
    max: 100_000_000,
  });
}

/**
 * Валидация риска на сделку: строго от 0.1% до 25%.
 */
export function validateRiskPct(raw: string | number): ValidationResult<number> {
  return parseStrictPositiveNumber(raw, {
    fieldLabel: 'Риск на сделку (%)',
    min: 0.1,
    max: 25,
  });
}

/**
 * Валидация кредитного плеча: от 1x до 50x с учётом потолка тарифа.
 */
export function validateLeverage(raw: string | number, tier: PlanTier = 'max'): ValidationResult<number> {
  const tierCap = tier === 'free' ? 3 : tier === 'pro' ? 20 : 50;
  const parsed = parseStrictPositiveNumber(raw, {
    fieldLabel: 'Кредитное плечо',
    min: 1,
    max: tierCap,
  });
  if (!parsed.ok || parsed.value === undefined) return parsed;
  if (!Number.isInteger(parsed.value)) {
    return { ok: false, error: 'Кредитное плечо должно быть целым числом.' };
  }
  return parsed;
}

/**
 * Валидация непротиворечивости ордера:
 *  - LONG / BUY: Stop-Loss < Entry < Take-Profit
 *  - SHORT / SELL: Take-Profit < Entry < Stop-Loss
 */
export function validateOrderPrices(params: {
  direction: 'LONG' | 'SHORT' | 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
}): ValidationResult<true> {
  const { direction, entryPrice, stopLoss, takeProfit } = params;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { ok: false, error: 'Цена входа должна быть строго больше 0.' };
  }

  const isLong = direction === 'LONG' || direction === 'BUY';

  if (stopLoss !== undefined) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      return { ok: false, error: 'Stop-Loss должен быть строго больше 0.' };
    }
    if (isLong && stopLoss >= entryPrice) {
      return {
        ok: false,
        error: 'Для LONG-сделки Stop-Loss должен быть строго ниже цены входа (SL < Entry).',
      };
    }
    if (!isLong && stopLoss <= entryPrice) {
      return {
        ok: false,
        error: 'Для SHORT-сделки Stop-Loss должен быть строго выше цены входа (Entry < SL).',
      };
    }
  }

  if (takeProfit !== undefined) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      return { ok: false, error: 'Take-Profit должен быть строго больше 0.' };
    }
    if (isLong && takeProfit <= entryPrice) {
      return {
        ok: false,
        error: 'Для LONG-сделки Take-Profit должен быть строго выше цены входа (Entry < TP).',
      };
    }
    if (!isLong && takeProfit >= entryPrice) {
      return {
        ok: false,
        error: 'Для SHORT-сделки Take-Profit должен быть строго ниже цены входа (TP < Entry).',
      };
    }
  }

  if (stopLoss !== undefined && takeProfit !== undefined) {
    if (isLong && !(stopLoss < entryPrice && entryPrice < takeProfit)) {
      return { ok: false, error: 'Для LONG требуется строгое условие: SL < Вход < TP.' };
    }
    if (!isLong && !(takeProfit < entryPrice && entryPrice < stopLoss)) {
      return { ok: false, error: 'Для SHORT требуется строгое условие: TP < Вход < SL.' };
    }
  }

  return { ok: true, value: true };
}

/**
 * Санитизация внешних ссылок: допускается только протокол https://.
 * Блокирует javascript:, data:, vbscript:, file: и небезопасные схемы.
 */
export function sanitizeExternalUrl(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Отсекаем явные попытки XSS-схем и управляющие символы
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.hostname.length > 253) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  'instance-data',
]);

/**
 * SSRF-защита для Webhook URL:
 * разрешает только публичный https:// и блокирует localhost, loopback,
 * приватные IPv4/IPv6 диапазоны и облачные metadata-эндпоинты.
 */
export function validateWebhookUrl(raw: string): ValidationResult<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Укажите HTTPS URL вебхука.' };
  }
  if (/[\u0000-\u001F\u007F\s]/.test(trimmed)) {
    return { ok: false, error: 'URL содержит недопустимые символы или пробелы.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Некорректный формат URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Разрешён только защищённый протокол https:// (http:// запрещён).' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Передача учётных данных в URL вебхука запрещена.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { ok: false, error: 'Некорректный домен вебхука.' };
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return { ok: false, error: 'Локальные и внутренние адреса заблокированы политикой SSRF-защиты.' };
  }

  // Проверка IPv4 (включая целочисленные/восьмеричные/hex IP-адреса)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return { ok: false, error: 'Числовые IP-адреса заблокированы политикой SSRF-защиты.' };
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (PRIVATE_IPV4_PATTERNS.some((re) => re.test(host))) {
      return { ok: false, error: 'Приватные и link-local IPv4-адреса запрещены (SSRF-защита).' };
    }
  }

  // Проверка IPv6 loopback / ULA (fc00::/7) / link-local (fe80::/10)
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.') ||
      host.startsWith('::ffff:169.254.')
    ) {
      return { ok: false, error: 'Приватные и локальные IPv6-адреса запрещены (SSRF-защита).' };
    }
  }

  return { ok: true, value: parsed.toString() };
}

/**
 * Маскировка токена Telegram-бота в UI и логах (оставляет только префикс и 4 символа).
 */
export function maskTelegramBotToken(tokenOrUrl: string): string {
  const trimmed = tokenOrUrl.trim();
  if (!trimmed) return '';
  // Маскируем шаблон bot<digits>:<secret> внутри URL или сырого токена
  return trimmed.replace(/(bot)?(\d{5,12}):([A-Za-z0-9_-]{8,})/g, (_m, prefix: string | undefined, botId: string, secret: string) => {
    const tail = secret.slice(-4);
    return `${prefix || ''}${botId}:••••••••••••${tail}`;
  });
}

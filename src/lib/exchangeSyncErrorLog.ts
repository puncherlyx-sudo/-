import type { ExchangeId } from '../types/domain';

const SYNC_ERROR_LOG_PREFIX = 'aegisquant_exchange_sync_errors_v1:';
const MAX_SYNC_LOGS = 60;

export type ExchangeSyncErrorCategory =
  | 'success'
  | 'rate_limit'
  | 'auth'
  | 'network'
  | 'exchange_api'
  | 'unknown';

export type ExchangeSyncSeverity = 'success' | 'warning' | 'critical';

export interface ExchangeSyncErrorLogEntry {
  id: string;
  keyId: string;
  exchange: ExchangeId;
  label: string;
  testnet: boolean;
  severity: ExchangeSyncSeverity;
  category: ExchangeSyncErrorCategory;
  errorMessage: string;
  balanceUsdt?: number;
  assetsCount?: number;
  occurredAt: string;
  occurredAtMs: number;
  source: 'background' | 'manual';
}

export type ExchangeSyncLogEntry = ExchangeSyncErrorLogEntry;

export type ExchangeSyncQuickFixActionType = 'pause_key' | 'edit_key' | 'retry_sync';

export interface ExchangeSyncQuickFixSuggestion {
  category: ExchangeSyncErrorCategory;
  title: string;
  suggestion: string;
  recommendedAction: ExchangeSyncQuickFixActionType;
  actionLabel: string;
  secondaryAction?: ExchangeSyncQuickFixActionType;
  secondaryActionLabel?: string;
  cooldownRemainingMs: number;
  cooldownLabel: string | null;
}

export const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

function getStorageKey(uid: string): string {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return `${SYNC_ERROR_LOG_PREFIX}${safeUid}`;
}

export function classifyExchangeSyncError(message: string): ExchangeSyncErrorCategory {
  const lower = message.toLowerCase();
  if (
    /429|418|-1003|50011|rate[\s_-]*limit|too many requests|ip weight|10006|10016|лимит/i.test(
      lower
    )
  ) {
    return 'rate_limit';
  }
  if (
    /401|403|-2015|-2014|-1022|10003|10004|10005|50111|50112|50113|50114|50119|invalid api|signature|passphrase|permission|apikey|secret|расшифровать|decrypt|переподключите|подпис|ключ|доступ/i.test(
      lower
    )
  ) {
    return 'auth';
  }
  if (
    /timeout|failed to fetch|network|abort|econn|502|503|504|offline|-1021|10002|recvwindow|рассинхронизац|сеть|таймаут/i.test(
      lower
    )
  ) {
    return 'network';
  }
  return message.trim() ? 'exchange_api' : 'unknown';
}

export function classifyExchangeSyncSeverity(
  category: ExchangeSyncErrorCategory
): ExchangeSyncSeverity {
  if (category === 'success') return 'success';
  if (category === 'rate_limit' || category === 'network') return 'warning';
  return 'critical';
}

function formatCooldownMmSs(remainingMs: number): string {
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function mapSyncErrorToQuickFix(
  errorMessage: string,
  options?: {
    exchange?: ExchangeId;
    testnet?: boolean;
    category?: ExchangeSyncErrorCategory;
    occurredAtMs?: number;
    nowMs?: number;
  }
): ExchangeSyncQuickFixSuggestion {
  const cleanMsg = errorMessage.trim();
  const lower = cleanMsg.toLowerCase();
  const category =
    options?.category && options.category !== 'success'
      ? options.category
      : classifyExchangeSyncError(cleanMsg);

  const nowMs = options?.nowMs ?? Date.now();
  const occurredAtMs = options?.occurredAtMs ?? nowMs;
  const elapsedMs = Math.max(0, nowMs - occurredAtMs);
  const cooldownRemainingMs =
    category === 'rate_limit' ? Math.max(0, RATE_LIMIT_COOLDOWN_MS - elapsedMs) : 0;
  const cooldownLabel = cooldownRemainingMs > 0 ? formatCooldownMmSs(cooldownRemainingMs) : null;

  if (category === 'rate_limit') {
    if (cooldownRemainingMs > 0 && cooldownLabel) {
      return {
        category,
        title: 'Лимит запросов API биржи',
        suggestion: `Превышен лимит запросов биржи. Подождите 15 минут (осталось ${cooldownLabel}), либо поставьте ключ на паузу.`,
        recommendedAction: 'pause_key',
        actionLabel: 'Пауза на 15 мин',
        cooldownRemainingMs,
        cooldownLabel,
      };
    }
    return {
      category,
      title: 'Окно ожидания (15 мин) завершено',
      suggestion: 'Период охлаждения лимитов API завершён — можно безопасно повторить синхронизацию.',
      recommendedAction: 'retry_sync',
      actionLabel: 'Повторить',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (/расшифровать|decrypt|переподключите/i.test(lower)) {
    return {
      category: 'auth',
      title: 'Требуется переподключение ключа',
      suggestion:
        'Не удалось расшифровать сохранённые реквизиты. Откройте редактирование ключа и введите API Key и Secret заново.',
      recommendedAction: 'edit_key',
      actionLabel: 'Редактировать ключ',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (/passphrase|50113|кодовая фраза/i.test(lower)) {
    return {
      category: 'auth',
      title: 'Ошибка Passphrase (OKX)',
      suggestion:
        'Кодовая фраза (Passphrase) для OKX отсутствует или неверна. Откройте редактирование ключа и укажите корректный Passphrase.',
      recommendedAction: 'edit_key',
      actionLabel: 'Редактировать ключ',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (/ip-ограничен|whitelist|unmatched ip|ip address|\bip\b/i.test(lower)) {
    return {
      category,
      title: 'Ограничение доступа по IP',
      suggestion:
        'Биржа отклонила запрос из-за белого списка IP. Разрешите доступ для чтения в настройках API на бирже или обновите ключ.',
      recommendedAction: 'edit_key',
      actionLabel: 'Редактировать ключ',
      secondaryAction: 'retry_sync',
      secondaryActionLabel: 'Повторить',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (/testnet|sandbox|demo/i.test(lower)) {
    return {
      category,
      title: 'Проверьте режим Testnet / Mainnet',
      suggestion: options?.testnet
        ? 'Ключ подключён как Testnet. Если вы вводили ключ от основного счёта — отключите Testnet в окне редактирования ключа.'
        : 'Если используется тестовый API-ключ, включите режим Testnet в окне редактирования ключа.',
      recommendedAction: 'edit_key',
      actionLabel: 'Редактировать ключ',
      secondaryAction: 'retry_sync',
      secondaryActionLabel: 'Повторить',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (/-1021|10002|timestamp|recvwindow|рассинхронизац/i.test(lower)) {
    return {
      category: 'network',
      title: 'Рассинхронизация времени подписи',
      suggestion:
        'Временная погрешность метки времени (recvWindow). Повторите синхронизацию — запрос подпишется актуальным временем сервера.',
      recommendedAction: 'retry_sync',
      actionLabel: 'Повторить',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (category === 'auth') {
    return {
      category,
      title: 'Недействительный API-ключ или права',
      suggestion:
        'API Key, Secret или права доступа отклонены биржей. Проверьте разрешение Read/Spot в кабинете биржи и обновите ключ.',
      recommendedAction: 'edit_key',
      actionLabel: 'Редактировать ключ',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  if (category === 'network') {
    return {
      category,
      title: 'Сетевой сбой или таймаут биржи',
      suggestion:
        'Временный таймаут ответа от API биржи. Закэшированные данные сохранены — повторите синхронизацию.',
      recommendedAction: 'retry_sync',
      actionLabel: 'Повторить',
      cooldownRemainingMs: 0,
      cooldownLabel: null,
    };
  }

  return {
    category,
    title: 'Сбой синхронизации API',
    suggestion:
      'Проверьте параметры API-ключа и режим Mainnet / Testnet или повторите синхронизацию вручную.',
    recommendedAction: 'edit_key',
    actionLabel: 'Редактировать ключ',
    secondaryAction: 'retry_sync',
    secondaryActionLabel: 'Повторить',
    cooldownRemainingMs: 0,
    cooldownLabel: null,
  };
}

export function getExchangeSyncQuickFix(
  entry: Pick<
    ExchangeSyncErrorLogEntry,
    'errorMessage' | 'severity' | 'category' | 'occurredAtMs' | 'exchange' | 'testnet'
  >,
  nowMs: number = Date.now()
): ExchangeSyncQuickFixSuggestion | null {
  if (entry.severity === 'success') return null;
  return mapSyncErrorToQuickFix(entry.errorMessage, {
    exchange: entry.exchange,
    testnet: entry.testnet,
    category: entry.category,
    occurredAtMs: entry.occurredAtMs,
    nowMs,
  });
}

function sanitizeEntry(raw: unknown): ExchangeSyncErrorLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ExchangeSyncErrorLogEntry>;
  if (obj.exchange !== 'binance' && obj.exchange !== 'bybit' && obj.exchange !== 'okx') {
    return null;
  }
  if (typeof obj.errorMessage !== 'string' || !obj.errorMessage.trim()) {
    return null;
  }
  const occurredAtMs = Number(obj.occurredAtMs);
  const safeMs = Number.isFinite(occurredAtMs) && occurredAtMs > 0 ? occurredAtMs : Date.now();
  const category: ExchangeSyncErrorCategory =
    obj.category === 'success' ||
    obj.category === 'rate_limit' ||
    obj.category === 'auth' ||
    obj.category === 'network' ||
    obj.category === 'exchange_api' ||
    obj.category === 'unknown'
      ? obj.category
      : classifyExchangeSyncError(obj.errorMessage);

  const severity: ExchangeSyncSeverity =
    obj.severity === 'success' || obj.severity === 'warning' || obj.severity === 'critical'
      ? obj.severity
      : classifyExchangeSyncSeverity(category);

  const balanceUsdt = Number(obj.balanceUsdt);
  const assetsCount = Number(obj.assetsCount);

  return {
    id:
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.slice(0, 80)
        : `synclog_${safeMs}_${Math.random().toString(36).slice(2, 6)}`,
    keyId: typeof obj.keyId === 'string' ? obj.keyId.slice(0, 80) : '',
    exchange: obj.exchange,
    label:
      typeof obj.label === 'string' && obj.label.trim()
        ? obj.label.slice(0, 64)
        : obj.exchange.toUpperCase(),
    testnet: Boolean(obj.testnet),
    severity,
    category,
    errorMessage: obj.errorMessage.slice(0, 300),
    balanceUsdt: Number.isFinite(balanceUsdt) && balanceUsdt >= 0 ? balanceUsdt : undefined,
    assetsCount: Number.isFinite(assetsCount) && assetsCount >= 0 ? Math.floor(assetsCount) : undefined,
    occurredAt:
      typeof obj.occurredAt === 'string' && obj.occurredAt.trim()
        ? obj.occurredAt.slice(0, 64)
        : new Date(safeMs).toISOString(),
    occurredAtMs: safeMs,
    source: obj.source === 'manual' ? 'manual' : 'background',
  };
}

export function readExchangeSyncErrorLogs(
  uid: string | null | undefined
): ExchangeSyncErrorLogEntry[] {
  if (!uid || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeEntry)
      .filter((item): item is ExchangeSyncErrorLogEntry => item !== null)
      .slice(0, MAX_SYNC_LOGS);
  } catch {
    return [];
  }
}

function persistLogs(uid: string, logs: ExchangeSyncErrorLogEntry[]): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getStorageKey(uid),
      JSON.stringify(logs.slice(0, MAX_SYNC_LOGS))
    );
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function appendExchangeSyncSuccessLog(
  uid: string,
  params: {
    keyId: string;
    exchange: ExchangeId;
    label: string;
    testnet: boolean;
    totalBalanceUsdt: number;
    assetsCount: number;
    source?: 'background' | 'manual';
  }
): ExchangeSyncErrorLogEntry[] {
  const nowMs = Date.now();
  const safeBalance = Math.max(0, Number(params.totalBalanceUsdt) || 0);
  const safeAssets = Math.max(0, Math.floor(Number(params.assetsCount) || 0));
  const sourceLabel = params.source === 'manual' ? 'Ручная синхронизация' : 'Фоновое обновление';
  const summaryMessage = `${sourceLabel}: баланс $${safeBalance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} (${safeAssets} актив.)`;

  const current = readExchangeSyncErrorLogs(uid);
  const duplicateRecent = current.find(
    (entry) =>
      entry.keyId === params.keyId &&
      entry.severity === 'success' &&
      entry.errorMessage === summaryMessage &&
      nowMs - entry.occurredAtMs < 5000
  );
  if (duplicateRecent) {
    return current;
  }

  const nextEntry: ExchangeSyncErrorLogEntry = {
    id: `synclog_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    keyId: params.keyId.slice(0, 80),
    exchange: params.exchange,
    label: params.label.trim().slice(0, 64) || params.exchange.toUpperCase(),
    testnet: Boolean(params.testnet),
    severity: 'success',
    category: 'success',
    errorMessage: summaryMessage,
    balanceUsdt: safeBalance,
    assetsCount: safeAssets,
    occurredAt: new Date(nowMs).toISOString(),
    occurredAtMs: nowMs,
    source: params.source ?? 'background',
  };

  const next = [nextEntry, ...current].slice(0, MAX_SYNC_LOGS);
  persistLogs(uid, next);
  return next;
}

export function appendExchangeSyncErrorLog(
  uid: string,
  params: {
    keyId: string;
    exchange: ExchangeId;
    label: string;
    testnet: boolean;
    errorMessage: string;
    source?: 'background' | 'manual';
  }
): ExchangeSyncErrorLogEntry[] {
  const nowMs = Date.now();
  const cleanMessage = params.errorMessage.trim().slice(0, 300) || 'Неизвестная ошибка синхронизации';
  const current = readExchangeSyncErrorLogs(uid);

  const duplicateRecent = current.find(
    (entry) =>
      entry.keyId === params.keyId &&
      entry.errorMessage === cleanMessage &&
      nowMs - entry.occurredAtMs < 5000
  );
  if (duplicateRecent) {
    return current;
  }

  const category = classifyExchangeSyncError(cleanMessage);
  const nextEntry: ExchangeSyncErrorLogEntry = {
    id: `synclog_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    keyId: params.keyId.slice(0, 80),
    exchange: params.exchange,
    label: params.label.trim().slice(0, 64) || params.exchange.toUpperCase(),
    testnet: Boolean(params.testnet),
    severity: classifyExchangeSyncSeverity(category),
    category,
    errorMessage: cleanMessage,
    occurredAt: new Date(nowMs).toISOString(),
    occurredAtMs: nowMs,
    source: params.source ?? 'background',
  };

  const next = [nextEntry, ...current].slice(0, MAX_SYNC_LOGS);
  persistLogs(uid, next);
  return next;
}

export function clearExchangeSyncErrorLogs(uid: string): ExchangeSyncErrorLogEntry[] {
  if (!uid || typeof window === 'undefined') return [];
  try {
    window.localStorage.removeItem(getStorageKey(uid));
  } catch {
    // Ignore storage errors
  }
  return [];
}

export interface GroupedExchangeSyncLogEntry {
  entry: ExchangeSyncErrorLogEntry;
  repeatCount: number;
  firstOccurredAtMs: number;
  lastOccurredAtMs: number;
  entryIds: string[];
}

function getBackgroundErrorSignature(entry: ExchangeSyncErrorLogEntry): string {
  const keyScope = entry.keyId || `${entry.exchange}:${entry.label}:${entry.testnet ? 't' : 'm'}`;
  return [
    keyScope,
    entry.exchange,
    entry.testnet ? '1' : '0',
    entry.severity,
    entry.category,
    entry.errorMessage.trim(),
  ].join('|');
}

/**
 * Группирует идентичные ошибки, возникающие подряд в фоновом режиме (per-key),
 * в одну запись со счетчиком повторений. Успешные проверки, ручные запуски или
 * другая ошибка по тому же ключу прерывают текущую серию.
 */
export function groupConsecutiveBackgroundSyncErrors(
  logs: ExchangeSyncErrorLogEntry[]
): GroupedExchangeSyncLogEntry[] {
  const grouped: GroupedExchangeSyncLogEntry[] = [];
  const activeStreakByKey = new Map<string, { group: GroupedExchangeSyncLogEntry; signature: string }>();

  for (const entry of logs) {
    const keyScope = entry.keyId || `${entry.exchange}:${entry.label}:${entry.testnet ? 't' : 'm'}`;
    const isGroupableBackgroundError =
      entry.source === 'background' && entry.severity !== 'success';

    if (!isGroupableBackgroundError) {
      activeStreakByKey.delete(keyScope);
      grouped.push({
        entry,
        repeatCount: 1,
        firstOccurredAtMs: entry.occurredAtMs,
        lastOccurredAtMs: entry.occurredAtMs,
        entryIds: [entry.id],
      });
      continue;
    }

    const signature = getBackgroundErrorSignature(entry);
    const activeStreak = activeStreakByKey.get(keyScope);

    if (activeStreak && activeStreak.signature === signature) {
      activeStreak.group.repeatCount += 1;
      activeStreak.group.firstOccurredAtMs = Math.min(
        activeStreak.group.firstOccurredAtMs,
        entry.occurredAtMs
      );
      activeStreak.group.lastOccurredAtMs = Math.max(
        activeStreak.group.lastOccurredAtMs,
        entry.occurredAtMs
      );
      activeStreak.group.entryIds.push(entry.id);
      if (entry.occurredAtMs > activeStreak.group.entry.occurredAtMs) {
        activeStreak.group.entry = entry;
      }
    } else {
      const nextGroup: GroupedExchangeSyncLogEntry = {
        entry,
        repeatCount: 1,
        firstOccurredAtMs: entry.occurredAtMs,
        lastOccurredAtMs: entry.occurredAtMs,
        entryIds: [entry.id],
      };
      activeStreakByKey.set(keyScope, { group: nextGroup, signature });
      grouped.push(nextGroup);
    }
  }

  return grouped;
}


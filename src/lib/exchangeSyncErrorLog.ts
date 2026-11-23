import type { ExchangeId } from '../types/domain';

const SYNC_ERROR_LOG_PREFIX = 'aegisquant_exchange_sync_errors_v1:';
const SYNC_LOG_AUTO_CLEANUP_PREFIX = 'aegisquant_exchange_sync_autoclean_30d_v1:';
const MAX_SYNC_LOGS = 60;
const MAX_TECHNICAL_FIELD_CHARS = 1600;
export const SYNC_LOG_AUTO_CLEANUP_DAYS = 30;
export const SYNC_LOG_AUTO_CLEANUP_MS = SYNC_LOG_AUTO_CLEANUP_DAYS * 24 * 60 * 60 * 1000;

export type ExchangeSyncErrorCategory =
  | 'success'
  | 'rate_limit'
  | 'auth'
  | 'network'
  | 'exchange_api'
  | 'unknown';

export type ExchangeSyncSeverity = 'success' | 'warning' | 'critical';

export interface ExchangeSyncTechnicalDetails {
  stackTrace?: string;
  rawApiResponse?: string;
  httpStatus?: number;
  endpoint?: string;
}

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
  technicalDetails?: ExchangeSyncTechnicalDetails;
}

export class ExchangeSyncClientError extends Error {
  technicalDetails?: ExchangeSyncTechnicalDetails;

  constructor(message: string, technicalDetails?: ExchangeSyncTechnicalDetails) {
    super(message);
    this.name = 'ExchangeSyncClientError';
    this.technicalDetails = technicalDetails;
  }
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

function getAutoCleanupStorageKey(uid: string): string {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return `${SYNC_LOG_AUTO_CLEANUP_PREFIX}${safeUid}`;
}

export function sanitizeTechnicalString(value: unknown, maxLength = MAX_TECHNICAL_FIELD_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .replace(
      /((?:api[_-]?key|api[_-]?secret|secret|passphrase|signature|token|authorization|bearer|x-mbx-apikey|x-bapi-api-key|ok-access-key|ok-access-passphrase|ok-access-sign)["']?\s*[:=\s]\s*["']?)([^"',\s}\n]+)/gi,
      '$1[скрыто]'
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[скрыто]')
    .slice(0, maxLength);
}

export function sanitizeTechnicalDetails(
  raw: unknown
): ExchangeSyncTechnicalDetails | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<ExchangeSyncTechnicalDetails>;
  const stackTrace = sanitizeTechnicalString(obj.stackTrace, MAX_TECHNICAL_FIELD_CHARS);
  const rawApiResponse = sanitizeTechnicalString(obj.rawApiResponse, MAX_TECHNICAL_FIELD_CHARS);
  const endpoint = sanitizeTechnicalString(obj.endpoint, 240);
  const httpStatusNum = Number(obj.httpStatus);
  const httpStatus =
    Number.isInteger(httpStatusNum) && httpStatusNum >= 100 && httpStatusNum <= 599
      ? httpStatusNum
      : undefined;

  if (!stackTrace && !rawApiResponse && !endpoint && httpStatus === undefined) {
    return undefined;
  }
  return {
    ...(stackTrace ? { stackTrace } : {}),
    ...(rawApiResponse ? { rawApiResponse } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

export function extractExchangeSyncTechnicalDetails(
  err: unknown,
  fallbackEndpoint?: string
): ExchangeSyncTechnicalDetails | undefined {
  const embedded =
    err instanceof ExchangeSyncClientError
      ? err.technicalDetails
      : err && typeof err === 'object' && 'technicalDetails' in err
        ? (err as { technicalDetails?: ExchangeSyncTechnicalDetails }).technicalDetails
        : undefined;

  const stackTrace =
    embedded?.stackTrace ??
    (err instanceof Error && typeof err.stack === 'string' ? err.stack : undefined);

  const rawApiResponse =
    embedded?.rawApiResponse ??
    (err instanceof Error
      ? JSON.stringify(
          {
            name: err.name,
            message: err.message,
          },
          null,
          2
        )
      : undefined);

  return sanitizeTechnicalDetails({
    stackTrace,
    rawApiResponse,
    httpStatus: embedded?.httpStatus,
    endpoint: embedded?.endpoint ?? fallbackEndpoint,
  });
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
    /401|403|-2015|-2014|-1022|10003|10004|10005|33004|50101|50111|50112|50113|50114|50119|expired|revoked|ист[её]к|отозван|invalid api|signature|passphrase|permission|apikey|secret|расшифровать|decrypt|переподключите|подпис|ключ|доступ/i.test(
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

  if (/33004|expired|revoked|ист[её]к|отозван|50119/i.test(lower)) {
    return {
      category: 'auth',
      title: 'Срок действия API-ключа истёк',
      suggestion:
        'Биржа сообщила об истечении или отзыве API-ключа. Создайте новый ключ на бирже и обновите реквизиты в окне редактирования.',
      recommendedAction: 'edit_key',
      actionLabel: 'Устранить',
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
      actionLabel: 'Устранить',
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
      actionLabel: 'Устранить',
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

  const technicalDetails = sanitizeTechnicalDetails(obj.technicalDetails);

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
    ...(technicalDetails ? { technicalDetails } : {}),
  };
}

export function pruneExchangeSyncLogsOlderThan(
  logs: ExchangeSyncErrorLogEntry[],
  maxAgeDays: number = SYNC_LOG_AUTO_CLEANUP_DAYS,
  nowMs: number = Date.now()
): { logs: ExchangeSyncErrorLogEntry[]; removedCount: number } {
  const safeDays = Math.max(1, Math.floor(Number(maxAgeDays) || SYNC_LOG_AUTO_CLEANUP_DAYS));
  const cutoffMs = nowMs - safeDays * 24 * 60 * 60 * 1000;
  const kept = logs.filter((entry) => entry.occurredAtMs >= cutoffMs);
  return {
    logs: kept,
    removedCount: Math.max(0, logs.length - kept.length),
  };
}

export function countExchangeSyncLogsOlderThan(
  logs: ExchangeSyncErrorLogEntry[],
  maxAgeDays: number = SYNC_LOG_AUTO_CLEANUP_DAYS,
  nowMs: number = Date.now()
): number {
  const safeDays = Math.max(1, Math.floor(Number(maxAgeDays) || SYNC_LOG_AUTO_CLEANUP_DAYS));
  const cutoffMs = nowMs - safeDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const entry of logs) {
    if (entry.occurredAtMs < cutoffMs) count += 1;
  }
  return count;
}

export function estimateExchangeSyncLogsBytes(logs: ExchangeSyncErrorLogEntry[]): number {
  if (logs.length === 0) return 0;
  try {
    const serialized = JSON.stringify(logs);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).length;
    }
    return serialized.length * 2;
  } catch {
    return 0;
  }
}

export function readExchangeSyncAutoCleanupEnabled(
  uid: string | null | undefined
): boolean {
  if (!uid || typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(getAutoCleanupStorageKey(uid));
    if (raw === null) return true;
    return raw !== '0' && raw !== 'false';
  } catch {
    return true;
  }
}

export function writeExchangeSyncAutoCleanupEnabled(
  uid: string | null | undefined,
  enabled: boolean
): boolean {
  if (!uid || typeof window === 'undefined') return enabled;
  try {
    window.localStorage.setItem(getAutoCleanupStorageKey(uid), enabled ? '1' : '0');
  } catch {
    // Ignore storage quota or private browsing errors
  }
  return enabled;
}

function readRawExchangeSyncLogs(uid: string): ExchangeSyncErrorLogEntry[] {
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

export function readExchangeSyncErrorLogs(
  uid: string | null | undefined
): ExchangeSyncErrorLogEntry[] {
  if (!uid || typeof window === 'undefined') return [];
  const entries = readRawExchangeSyncLogs(uid);
  if (entries.length === 0) return [];
  if (!readExchangeSyncAutoCleanupEnabled(uid)) {
    return entries;
  }
  const { logs: pruned, removedCount } = pruneExchangeSyncLogsOlderThan(
    entries,
    SYNC_LOG_AUTO_CLEANUP_DAYS
  );
  if (removedCount > 0) {
    persistLogs(uid, pruned);
  }
  return pruned;
}

export function runExchangeSyncLogAutoCleanup(
  uid: string,
  maxAgeDays: number = SYNC_LOG_AUTO_CLEANUP_DAYS,
  nowMs: number = Date.now()
): { logs: ExchangeSyncErrorLogEntry[]; removedCount: number } {
  if (!uid || typeof window === 'undefined') {
    return { logs: [], removedCount: 0 };
  }
  const entries = readRawExchangeSyncLogs(uid);
  const result = pruneExchangeSyncLogsOlderThan(entries, maxAgeDays, nowMs);
  if (result.removedCount > 0) {
    persistLogs(uid, result.logs);
  }
  return result;
}

export function persistExchangeSyncLogs(uid: string, logs: ExchangeSyncErrorLogEntry[]): void {
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

function persistLogs(uid: string, logs: ExchangeSyncErrorLogEntry[]): void {
  persistExchangeSyncLogs(uid, logs);
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
    technicalDetails?: ExchangeSyncTechnicalDetails;
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
  const sanitizedTech = sanitizeTechnicalDetails(params.technicalDetails);
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
    ...(sanitizedTech ? { technicalDetails: sanitizedTech } : {}),
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

export interface KnownSyncErrorCodeMatch {
  code: string;
  label: string;
  reason: string;
  canResolveByEditingKey: boolean;
}

const KNOWN_KEY_FIX_RULES: Array<{
  pattern: RegExp;
  code: string;
  label: string;
  reason: string;
}> = [
  {
    pattern: /(?:\b33004\b|api\s*key\s*(?:has\s*)?expired|ист[её]к(?:ший)?\s*(?:срок|api|ключ)|ключ\s*ист[её]к)/i,
    code: '33004',
    label: 'API-ключ истёк',
    reason: 'Срок действия ключа завершён — замените API Key и Secret.',
  },
  {
    pattern: /-2015\b/i,
    code: '-2015',
    label: 'Binance -2015',
    reason: 'Ключ отклонён, истёк или заблокирован по IP / правам.',
  },
  {
    pattern: /-2014\b/i,
    code: '-2014',
    label: 'Binance -2014',
    reason: 'Некорректный формат API-ключа Binance.',
  },
  {
    pattern: /-1022\b/i,
    code: '-1022',
    label: 'Binance -1022',
    reason: 'Неверная подпись API Secret.',
  },
  {
    pattern: /\b10003\b/i,
    code: '10003',
    label: 'Bybit 10003',
    reason: 'Недействительный или истёкший API-ключ Bybit.',
  },
  {
    pattern: /\b10004\b/i,
    code: '10004',
    label: 'Bybit 10004',
    reason: 'Ошибка подписи API Secret Bybit.',
  },
  {
    pattern: /\b10005\b/i,
    code: '10005',
    label: 'Bybit 10005',
    reason: 'Недостаточно прав доступа у ключа Bybit.',
  },
  {
    pattern: /\b50119\b/i,
    code: '50119',
    label: 'OKX 50119',
    reason: 'API-ключ OKX не существует, удалён или истёк.',
  },
  {
    pattern: /\b50111\b/i,
    code: '50111',
    label: 'OKX 50111',
    reason: 'Недействительный OK-ACCESS-KEY.',
  },
  {
    pattern: /\b50113\b/i,
    code: '50113',
    label: 'OKX 50113',
    reason: 'Неверная подпись или Passphrase OKX.',
  },
  {
    pattern: /\b50114\b/i,
    code: '50114',
    label: 'OKX 50114',
    reason: 'Ошибка авторизации API-ключа OKX.',
  },
  {
    pattern: /\b50101\b/i,
    code: '50101',
    label: 'OKX 50101',
    reason: 'Несовпадение режима Mainnet / Testnet для ключа OKX.',
  },
  {
    pattern: /(?:расшифровать|decrypt|переподключите)/i,
    code: 'DECRYPT',
    label: 'Ошибка расшифровки',
    reason: 'Сохранённый ключ требует повторного ввода реквизитов.',
  },
  {
    pattern: /(?:passphrase|кодовая фраза)/i,
    code: 'PASSPHRASE',
    label: 'Неверный Passphrase',
    reason: 'Проверьте кодовую фразу (Passphrase) для API-ключа.',
  },
  {
    pattern: /(?:revoked|отозван|invalid api|permission|whitelist|ip-ограничен)/i,
    code: 'AUTH',
    label: 'Ошибка прав / ключа',
    reason: 'Обновите API Key, Secret или права доступа ключа.',
  },
];

/**
 * Распознаёт известные коды ошибок бирж (Binance/Bybit/OKX/HTTP 401/403, истечение ключа),
 * которые можно напрямую устранить через окно редактирования API-ключа.
 */
export function detectKnownExchangeSyncError(
  entry: Pick<
    ExchangeSyncErrorLogEntry,
    'severity' | 'category' | 'errorMessage' | 'technicalDetails'
  >
): KnownSyncErrorCodeMatch | null {
  if (entry.severity === 'success') return null;

  const haystack = [
    entry.errorMessage,
    entry.technicalDetails?.rawApiResponse ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  for (const rule of KNOWN_KEY_FIX_RULES) {
    if (rule.pattern.test(haystack)) {
      return {
        code: rule.code,
        label: rule.label,
        reason: rule.reason,
        canResolveByEditingKey: true,
      };
    }
  }

  const httpStatus = entry.technicalDetails?.httpStatus;
  if (httpStatus === 401 || httpStatus === 403 || /\b(?:401|403)\b/.test(entry.errorMessage)) {
    const code = httpStatus === 403 || /\b403\b/.test(entry.errorMessage) ? 'HTTP 403' : 'HTTP 401';
    return {
      code,
      label: code,
      reason: 'Биржа отклонила авторизацию API-ключа — обновите ключ и права доступа.',
      canResolveByEditingKey: true,
    };
  }

  if (entry.category === 'auth') {
    return {
      code: 'AUTH',
      label: 'Ошибка API-ключа',
      reason: 'Проверьте API Key, Secret и режим Mainnet / Testnet.',
      canResolveByEditingKey: true,
    };
  }

  return null;
}

export interface HourlyErrorIntensityPoint {
  hourStartMs: number;
  label: string;
  fullRangeLabel: string;
  errors: number;
  critical: number;
  warning: number;
  isAnomaly: boolean;
}

export interface HourlyErrorIntensitySeries {
  windowHours: 24 | 72;
  points: HourlyErrorIntensityPoint[];
  totalErrors: number;
  criticalErrors: number;
  warningErrors: number;
  peakErrorsPerHour: number;
  peakHourLabel: string;
  avgErrorsPerHour: number;
  anomalyThreshold: number;
  anomalyHoursCount: number;
}

/**
 * Агрегирует ошибки синхронизации (warning + critical) по часам за выбранное скользящее окно
 * (24ч или 72ч) и помечает часы с аномальной интенсивностью сбоев.
 */
export function buildHourlyErrorIntensitySeries(
  logs: ExchangeSyncErrorLogEntry[],
  options?: {
    windowHours?: 24 | 72;
    nowMs?: number;
  }
): HourlyErrorIntensitySeries {
  const windowHours: 24 | 72 = options?.windowHours === 72 ? 72 : 24;
  const HOUR_MS = 60 * 60 * 1000;
  const nowMs = options?.nowMs ?? Date.now();
  const currentHourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const firstHourStartMs = currentHourStartMs - (windowHours - 1) * HOUR_MS;

  const points: HourlyErrorIntensityPoint[] = Array.from({ length: windowHours }, (_, idx) => {
    const hourStartMs = firstHourStartMs + idx * HOUR_MS;
    const dt = new Date(hourStartMs);
    const hh = String(dt.getHours()).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const label = windowHours === 72 ? `${dd}.${mm} ${hh}:00` : `${hh}:00`;
    const fullRangeLabel = `${dd}.${mm}, ${hh}:00–${hh}:59`;
    return {
      hourStartMs,
      label,
      fullRangeLabel,
      errors: 0,
      critical: 0,
      warning: 0,
      isAnomaly: false,
    };
  });

  let totalErrors = 0;
  let criticalErrors = 0;
  let warningErrors = 0;

  for (const entry of logs) {
    if (entry.severity === 'success') continue;
    const bucketIndex = Math.floor((entry.occurredAtMs - firstHourStartMs) / HOUR_MS);
    if (bucketIndex < 0 || bucketIndex >= windowHours) continue;
    const bucket = points[bucketIndex];
    if (!bucket) continue;
    bucket.errors += 1;
    totalErrors += 1;
    if (entry.severity === 'critical') {
      bucket.critical += 1;
      criticalErrors += 1;
    } else {
      bucket.warning += 1;
      warningErrors += 1;
    }
  }

  const avgRaw = totalErrors / windowHours;
  const variance =
    points.reduce((acc, p) => acc + (p.errors - avgRaw) ** 2, 0) / windowHours;
  const stdDev = Math.sqrt(variance);
  const anomalyThreshold = Math.max(2, Math.ceil(avgRaw + Math.max(1, 1.5 * stdDev)));

  let peakErrorsPerHour = 0;
  let peakHourLabel = '—';
  let anomalyHoursCount = 0;

  for (const point of points) {
    if (point.errors >= anomalyThreshold && point.errors > 0) {
      point.isAnomaly = true;
      anomalyHoursCount += 1;
    }
    if (point.errors > peakErrorsPerHour) {
      peakErrorsPerHour = point.errors;
      peakHourLabel = `${point.label} (${point.errors}/ч)`;
    }
  }

  return {
    windowHours,
    points,
    totalErrors,
    criticalErrors,
    warningErrors,
    peakErrorsPerHour,
    peakHourLabel,
    avgErrorsPerHour: Number(avgRaw.toFixed(2)),
    anomalyThreshold,
    anomalyHoursCount,
  };
}



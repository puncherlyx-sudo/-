import type { ExchangeId } from '../types/domain';
import {
  detectKnownExchangeSyncError,
  sanitizeTechnicalString,
  type ExchangeSyncErrorLogEntry,
} from './exchangeSyncErrorLog';

export const MAX_SUPPORT_SUBJECT_LEN = 140;
export const MAX_SUPPORT_MESSAGE_LEN = 2000;

export interface BuildSyncErrorSupportReportInput {
  logs: ExchangeSyncErrorLogEntry[];
  exchangeFilter?: 'all' | ExchangeId;
  userComment?: string;
  maxLogs?: number;
  appVersion?: string;
}

export interface SyncErrorSupportReport {
  subject: string;
  message: string;
  attachedLogs: ExchangeSyncErrorLogEntry[];
  totalErrorCount: number;
  criticalCount: number;
  warningCount: number;
  exchangesAffected: string[];
  truncated: boolean;
}

const EXCHANGE_NAMES: Record<string, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Ключ/Доступ',
  rate_limit: 'Rate Limit',
  network: 'Сеть/Таймаут',
  exchange_api: 'API биржи',
  unknown: 'Прочее',
  success: 'Успех',
};

function formatExchangeTitle(exchange: string): string {
  return EXCHANGE_NAMES[exchange] ?? exchange.toUpperCase();
}

function formatCompactIso(ms: number, fallbackIso?: string): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : Date.now();
  try {
    const iso = new Date(safeMs).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
  } catch {
    return (fallbackIso || '').slice(0, 19);
  }
}

function formatSingleLogBlock(entry: ExchangeSyncErrorLogEntry, index: number, compact = false): string {
  const timeStr = formatCompactIso(entry.occurredAtMs, entry.occurredAt);
  const exName = formatExchangeTitle(entry.exchange);
  const netTag = entry.testnet ? 'Testnet' : 'Mainnet';
  const sevTag = entry.severity === 'critical' ? 'CRIT' : entry.severity === 'warning' ? 'WARN' : 'OK';
  const catLabel = CATEGORY_LABELS[entry.category] ?? entry.category;
  const known = detectKnownExchangeSyncError(entry);
  const safeMsg = sanitizeTechnicalString(entry.errorMessage, compact ? 110 : 180) ?? 'Нет описания';
  const safeLabel = sanitizeTechnicalString(entry.label, 40) ?? 'Ключ';

  const headerParts = [
    `#${index + 1} [${timeStr}] ${exName} (${netTag}, ${safeLabel})`,
    `${sevTag}/${catLabel}`,
    entry.source === 'background' ? 'bg' : 'manual',
  ];
  if (known) {
    headerParts.push(`code=${known.code}`);
  }
  if (entry.technicalDetails?.httpStatus) {
    headerParts.push(`HTTP ${entry.technicalDetails.httpStatus}`);
  }

  const lines: string[] = [headerParts.join(' | '), `Msg: ${safeMsg}`];

  if (entry.technicalDetails?.endpoint) {
    const safeEndpoint = sanitizeTechnicalString(entry.technicalDetails.endpoint, 90);
    if (safeEndpoint) lines.push(`Endpoint: ${safeEndpoint}`);
  }

  if (!compact && entry.technicalDetails?.rawApiResponse) {
    const oneLineRaw = entry.technicalDetails.rawApiResponse.replace(/\s+/g, ' ').trim();
    const safeRaw = sanitizeTechnicalString(oneLineRaw, 160);
    if (safeRaw) lines.push(`Raw: ${safeRaw}`);
  }

  if (!compact && entry.technicalDetails?.stackTrace) {
    const firstFrame = entry.technicalDetails.stackTrace
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' -> ');
    const safeStack = sanitizeTechnicalString(firstFrame, 140);
    if (safeStack) lines.push(`Trace: ${safeStack}`);
  }

  return lines.join('\n');
}

/**
 * Формирует структурированный и полностью очищенный от секретов отчёт об ошибках
 * синхронизации бирж для отправки в службу поддержки (в пределах лимита 140 / 2000 символов).
 */
export function buildSyncErrorSupportReport(
  input: BuildSyncErrorSupportReportInput
): SyncErrorSupportReport {
  const maxLogs = Math.max(1, Math.min(10, input.maxLogs ?? 5));
  const exchangeFilter = input.exchangeFilter ?? 'all';

  const scopedLogs = (input.logs ?? [])
    .filter((entry) => exchangeFilter === 'all' || entry.exchange === exchangeFilter)
    .slice()
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs);

  const errorLogs = scopedLogs.filter((entry) => entry.severity !== 'success');
  const criticalCount = errorLogs.filter((entry) => entry.severity === 'critical').length;
  const warningCount = errorLogs.filter((entry) => entry.severity === 'warning').length;

  const targetPool = errorLogs.length > 0 ? errorLogs : scopedLogs;
  const attachedLogs = targetPool.slice(0, maxLogs);

  const exchangesAffected = Array.from(
    new Set(targetPool.map((entry) => formatExchangeTitle(entry.exchange)))
  );

  const exchangeTag =
    exchangeFilter !== 'all'
      ? formatExchangeTitle(exchangeFilter)
      : exchangesAffected.length > 0
        ? exchangesAffected.slice(0, 3).join(', ')
        : 'Биржи';

  const rawSubject =
    errorLogs.length > 0
      ? `Ошибки синхронизации (${exchangeTag}): ${errorLogs.length} сб. (крит: ${criticalCount})`
      : `Диагностика синхронизации бирж (${exchangeTag})`;
  const subject = rawSubject.slice(0, MAX_SUPPORT_SUBJECT_LEN);

  const safeComment = sanitizeTechnicalString(input.userComment ?? '', 420);
  const summaryLines = [
    `Сводка синхронизации: ошибок ${errorLogs.length} (крит: ${criticalCount}, пред: ${warningCount}), биржи: ${
      exchangesAffected.length > 0 ? exchangesAffected.join(', ') : 'нет'
    }.`,
  ];
  if (input.appVersion) {
    summaryLines.push(`Среда: ${sanitizeTechnicalString(input.appVersion, 80) ?? 'VERNIER Web'}`);
  }
  if (safeComment) {
    summaryLines.push(`Комментарий пользователя: ${safeComment}`);
  }

  const headerText = summaryLines.join('\n');
  const logsHeader =
    attachedLogs.length > 0
      ? `\n\n--- Технические логи (последние ${attachedLogs.length}, секреты скрыты) ---`
      : '\n\nТехнические логи синхронизации отсутствуют.';

  let body = `${headerText}${logsHeader}`;
  let truncated = false;

  if (attachedLogs.length > 0) {
    const detailedBlocks = attachedLogs.map((entry, idx) => formatSingleLogBlock(entry, idx, false));
    const detailedCandidate = `${body}\n${detailedBlocks.join('\n\n')}`;

    if (detailedCandidate.length <= MAX_SUPPORT_MESSAGE_LEN) {
      body = detailedCandidate;
    } else {
      // Переходим в компактный режим, чтобы вместить максимум последних событий в лимит 2000 символов
      const compactBlocks = attachedLogs.map((entry, idx) => formatSingleLogBlock(entry, idx, true));
      const fitted: string[] = [];
      let currentLen = body.length;

      for (const block of compactBlocks) {
        const addition = `\n${block}`;
        if (currentLen + addition.length <= MAX_SUPPORT_MESSAGE_LEN - 28) {
          fitted.push(block);
          currentLen += addition.length;
        } else {
          truncated = true;
          break;
        }
      }

      if (fitted.length > 0) {
        body = `${body}\n${fitted.join('\n')}`;
      }
      if (truncated) {
        body = `${body}\n[+ ещё записи обрезаны по лимиту]`.slice(0, MAX_SUPPORT_MESSAGE_LEN);
      }
    }
  }

  if (body.length > MAX_SUPPORT_MESSAGE_LEN) {
    body = body.slice(0, MAX_SUPPORT_MESSAGE_LEN);
    truncated = true;
  }

  return {
    subject,
    message: body,
    attachedLogs,
    totalErrorCount: errorLogs.length,
    criticalCount,
    warningCount,
    exchangesAffected,
    truncated,
  };
}

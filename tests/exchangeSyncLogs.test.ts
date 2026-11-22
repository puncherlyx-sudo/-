import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHourlyErrorIntensitySeries,
  countExchangeSyncLogsOlderThan,
  detectKnownExchangeSyncError,
  estimateExchangeSyncLogsBytes,
  ExchangeSyncClientError,
  extractExchangeSyncTechnicalDetails,
  pruneExchangeSyncLogsOlderThan,
  sanitizeTechnicalDetails,
  SYNC_LOG_AUTO_CLEANUP_DAYS,
  type ExchangeSyncErrorLogEntry,
} from '../src/lib/exchangeSyncErrorLog.ts';

function makeEntry(overrides: Partial<ExchangeSyncErrorLogEntry>): ExchangeSyncErrorLogEntry {
  const now = overrides.occurredAtMs ?? Date.now();
  return {
    id: overrides.id ?? `log_${now}`,
    keyId: overrides.keyId ?? 'key_1',
    exchange: overrides.exchange ?? 'binance',
    label: overrides.label ?? 'Main Spot',
    testnet: overrides.testnet ?? false,
    severity: overrides.severity ?? 'critical',
    category: overrides.category ?? 'auth',
    errorMessage: overrides.errorMessage ?? 'Binance отклонил ключ (-2015)',
    occurredAt: new Date(now).toISOString(),
    occurredAtMs: now,
    source: overrides.source ?? 'background',
    ...(overrides.technicalDetails ? { technicalDetails: overrides.technicalDetails } : {}),
  };
}

test('sanitizeTechnicalDetails redacts secrets, signatures, and long tokens', () => {
  const sanitized = sanitizeTechnicalDetails({
    httpStatus: 400,
    endpoint: 'GET https://api.binance.com/api/v3/account?signature=abcdef1234567890abcdef1234567890abcdef12',
    rawApiResponse: JSON.stringify({
      code: -2015,
      msg: 'Invalid API-key, IP, or permissions for action.',
      apiKey: 'MY_SUPER_SECRET_BINANCE_KEY_1234567890123456',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_SUPERLONGTOKEN123456789',
    }),
    stackTrace: 'Error: Invalid key\n    at syncExchangeKey (app.js:12:4)\n    secret=topSecretValue123456',
  });

  assert.ok(sanitized);
  assert.equal(sanitized.httpStatus, 400);
  assert.ok(!sanitized.endpoint?.includes('abcdef1234567890'));
  assert.ok(!sanitized.rawApiResponse?.includes('MY_SUPER_SECRET_BINANCE_KEY'));
  assert.ok(!sanitized.rawApiResponse?.includes('eyJhbGciOiJIUzI1NiI'));
  assert.ok(!sanitized.stackTrace?.includes('topSecretValue123456'));
  assert.ok(sanitized.rawApiResponse?.includes('[скрыто]'));
});

test('extractExchangeSyncTechnicalDetails preserves ExchangeSyncClientError diagnostics and stack trace', () => {
  const clientErr = new ExchangeSyncClientError('Ошибка Bybit API (10003): Invalid apiKey', {
    httpStatus: 400,
    endpoint: 'GET https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED',
    rawApiResponse: '{"retCode":10003,"retMsg":"Invalid apiKey"}',
  });

  const extracted = extractExchangeSyncTechnicalDetails(clientErr, 'POST /api/exchanges/sync');
  assert.ok(extracted);
  assert.equal(extracted.httpStatus, 400);
  assert.equal(extracted.endpoint, 'GET https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED');
  assert.ok(extracted.rawApiResponse?.includes('"retCode":10003'));
  assert.ok(extracted.stackTrace && extracted.stackTrace.includes('ExchangeSyncClientError'));

  const genericErr = new Error('Failed to fetch');
  const extractedGeneric = extractExchangeSyncTechnicalDetails(genericErr, 'POST /api/exchanges/sync');
  assert.ok(extractedGeneric);
  assert.equal(extractedGeneric.endpoint, 'POST /api/exchanges/sync');
  assert.ok(extractedGeneric.rawApiResponse?.includes('Failed to fetch'));
  assert.ok(extractedGeneric.stackTrace?.includes('Failed to fetch'));
});

test('pruneExchangeSyncLogsOlderThan removes logs older than 30 days and keeps recent entries', () => {
  const nowMs = Date.UTC(2026, 10, 21, 12, 0, 0);
  const DAY_MS = 24 * 60 * 60 * 1000;

  const recent29d = makeEntry({ id: 'recent_29d', occurredAtMs: nowMs - 29 * DAY_MS });
  const recentToday = makeEntry({ id: 'recent_today', occurredAtMs: nowMs - 60_000 });
  const old31d = makeEntry({ id: 'old_31d', occurredAtMs: nowMs - 31 * DAY_MS });
  const old60d = makeEntry({ id: 'old_60d', occurredAtMs: nowMs - 60 * DAY_MS });

  const allLogs = [recentToday, recent29d, old31d, old60d];

  assert.equal(countExchangeSyncLogsOlderThan(allLogs, SYNC_LOG_AUTO_CLEANUP_DAYS, nowMs), 2);

  const { logs: pruned, removedCount } = pruneExchangeSyncLogsOlderThan(
    allLogs,
    SYNC_LOG_AUTO_CLEANUP_DAYS,
    nowMs
  );

  assert.equal(removedCount, 2);
  assert.deepEqual(
    pruned.map((item) => item.id),
    ['recent_today', 'recent_29d']
  );
  assert.equal(estimateExchangeSyncLogsBytes([]), 0);
  assert.ok(estimateExchangeSyncLogsBytes(pruned) > 100);
});

test('buildHourlyErrorIntensitySeries aggregates errors/hour, ignores success logs, and flags anomalous spike hours', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const nowMs = Date.UTC(2026, 10, 21, 15, 30, 0);
  const spikeHourMs = Date.UTC(2026, 10, 21, 13, 15, 0);

  const logs: ExchangeSyncErrorLogEntry[] = [
    // 5 errors concentrated in a single spike hour -> clear anomaly
    makeEntry({ id: 's1', occurredAtMs: spikeHourMs, severity: 'critical' }),
    makeEntry({ id: 's2', occurredAtMs: spikeHourMs + 10_000, severity: 'critical' }),
    makeEntry({ id: 's3', occurredAtMs: spikeHourMs + 20_000, severity: 'warning', category: 'rate_limit' }),
    makeEntry({ id: 's4', occurredAtMs: spikeHourMs + 30_000, severity: 'critical' }),
    makeEntry({ id: 's5', occurredAtMs: spikeHourMs + 40_000, severity: 'warning', category: 'network' }),
    // 1 isolated error in another hour
    makeEntry({ id: 'n1', occurredAtMs: nowMs - 6 * HOUR_MS, severity: 'warning', category: 'network' }),
    // Success events must not count as errors
    makeEntry({ id: 'ok1', occurredAtMs: nowMs - 10_000, severity: 'success', category: 'success' }),
    // Out-of-window entry (30 hours ago) should be excluded in 24h mode
    makeEntry({ id: 'old1', occurredAtMs: nowMs - 30 * HOUR_MS, severity: 'critical' }),
  ];

  const series = buildHourlyErrorIntensitySeries(logs, { windowHours: 24, nowMs });

  assert.equal(series.points.length, 24);
  assert.equal(series.totalErrors, 6);
  assert.equal(series.criticalErrors, 3);
  assert.equal(series.warningErrors, 3);
  assert.equal(series.peakErrorsPerHour, 5);
  assert.equal(series.anomalyHoursCount, 1);
  assert.equal(series.points.filter((p) => p.isAnomaly).length, 1);
});

test('detectKnownExchangeSyncError recognizes expired API key and exchange error codes while skipping transient network errors', () => {
  const expiredBybit = detectKnownExchangeSyncError(
    makeEntry({
      exchange: 'bybit',
      errorMessage: 'Ошибка Bybit API (33004): API key has expired',
    })
  );
  assert.ok(expiredBybit);
  assert.equal(expiredBybit.code, '33004');
  assert.equal(expiredBybit.canResolveByEditingKey, true);

  const okxFromRaw = detectKnownExchangeSyncError(
    makeEntry({
      exchange: 'okx',
      category: 'exchange_api',
      errorMessage: 'Ошибка синхронизации OKX',
      technicalDetails: {
        httpStatus: 401,
        rawApiResponse: '{"code":"50119","msg":"API key does not exist"}',
      },
    })
  );
  assert.ok(okxFromRaw);
  assert.equal(okxFromRaw.code, '50119');
  assert.equal(okxFromRaw.canResolveByEditingKey, true);

  const networkTimeout = detectKnownExchangeSyncError(
    makeEntry({
      severity: 'warning',
      category: 'network',
      errorMessage: 'Превышено время ожидания ответа от API биржи (504).',
    })
  );
  assert.equal(networkTimeout, null);

  const successEntry = detectKnownExchangeSyncError(
    makeEntry({
      severity: 'success',
      category: 'success',
      errorMessage: 'Ручная синхронизация: баланс $1,250.00',
    })
  );
  assert.equal(successEntry, null);
});

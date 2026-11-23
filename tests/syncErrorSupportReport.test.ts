import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSyncErrorSupportReport,
  MAX_SUPPORT_MESSAGE_LEN,
  MAX_SUPPORT_SUBJECT_LEN,
} from '../src/lib/exchangeSyncSupportReport.ts';
import type { ExchangeSyncErrorLogEntry } from '../src/lib/exchangeSyncErrorLog.ts';

function makeLog(overrides: Partial<ExchangeSyncErrorLogEntry> = {}): ExchangeSyncErrorLogEntry {
  const now = 1_770_000_000_000;
  return {
    id: `log_${Math.random().toString(36).slice(2, 8)}`,
    keyId: 'key_binance_1',
    exchange: 'binance',
    label: 'Binance Main',
    testnet: false,
    severity: 'critical',
    category: 'auth',
    errorMessage: 'API-key expired (-2015) api_key=mySuperSecretKey12345678901234567890',
    occurredAt: new Date(now).toISOString(),
    occurredAtMs: now,
    source: 'background',
    technicalDetails: {
      httpStatus: 401,
      endpoint: '/api/v3/account?signature=abcdef1234567890abcdef1234567890abcdef',
      rawApiResponse:
        '{"code":-2015,"msg":"Invalid API-key, IP, or permissions","secret":"TOP_SECRET_VALUE_999999999999999999999999"}',
      stackTrace: 'Error: Binance 401\n  at syncExchange (server/exchanges.ts:142:11)\n  at handler (server.ts:912:5)',
    },
    ...overrides,
  };
}

test('buildSyncErrorSupportReport redacts secrets, prioritizes errors, and stays within ticket limits', () => {
  const logs: ExchangeSyncErrorLogEntry[] = [
    makeLog({
      id: 'ok_1',
      severity: 'success',
      category: 'success',
      errorMessage: 'Синхронизация успешна',
      occurredAtMs: 1_770_000_050_000,
    }),
    makeLog({
      id: 'err_1',
      exchange: 'bybit',
      label: 'Bybit Testnet',
      testnet: true,
      severity: 'warning',
      category: 'rate_limit',
      errorMessage: 'HTTP 429 rate limit exceeded (10006)',
      occurredAtMs: 1_770_000_040_000,
      technicalDetails: {
        httpStatus: 429,
        endpoint: '/v5/account/wallet-balance',
      },
    }),
    makeLog({
      id: 'err_2',
      exchange: 'binance',
      severity: 'critical',
      category: 'auth',
      occurredAtMs: 1_770_000_030_000,
    }),
  ];

  const report = buildSyncErrorSupportReport({
    logs,
    userComment: 'Ошибка повторилась после ротации ключа, token=BearerVeryLongTokenValue1234567890123456',
    maxLogs: 5,
    appVersion: 'VERNIER Web Test',
  });

  assert.equal(report.totalErrorCount, 2);
  assert.equal(report.criticalCount, 1);
  assert.equal(report.warningCount, 1);
  assert.equal(report.attachedLogs.length, 2, 'Should prioritize only error logs when errors exist');
  assert.ok(report.subject.length >= 3 && report.subject.length <= MAX_SUPPORT_SUBJECT_LEN);
  assert.ok(report.message.length >= 10 && report.message.length <= MAX_SUPPORT_MESSAGE_LEN);

  // Verify zero secret leakage
  assert.doesNotMatch(report.message, /mySuperSecretKey/i);
  assert.doesNotMatch(report.message, /TOP_SECRET_VALUE/i);
  assert.doesNotMatch(report.message, /BearerVeryLongTokenValue/i);
  assert.match(report.message, /\[скрыто\]/);
  assert.match(report.message, /Bybit \(Testnet/);
  assert.match(report.message, /HTTP 401/);
  assert.match(report.message, /HTTP 429/);
});

test('buildSyncErrorSupportReport respects exchangeFilter and enforces 2000-char hard cap on large payloads', () => {
  const manyLogs: ExchangeSyncErrorLogEntry[] = Array.from({ length: 12 }, (_, idx) =>
    makeLog({
      id: `okx_${idx}`,
      exchange: idx % 2 === 0 ? 'okx' : 'binance',
      occurredAtMs: 1_770_000_000_000 + idx * 1000,
      errorMessage: `Exchange API error #${idx}: ${'x'.repeat(180)}`,
      technicalDetails: {
        httpStatus: 500,
        endpoint: `/api/v5/account/balance?attempt=${idx}`,
        rawApiResponse: `{"code":"50011","detail":"${'y'.repeat(400)}"}`,
        stackTrace: `Error: fail ${idx}\n${'at fn (file.ts:10:2)\n'.repeat(10)}`,
      },
    })
  );

  const report = buildSyncErrorSupportReport({
    logs: manyLogs,
    exchangeFilter: 'okx',
    maxLogs: 10,
  });

  assert.equal(report.totalErrorCount, 6);
  assert.deepEqual(report.exchangesAffected, ['OKX']);
  assert.ok(report.subject.includes('OKX'));
  assert.ok(
    report.message.length <= MAX_SUPPORT_MESSAGE_LEN,
    `Expected message length <= ${MAX_SUPPORT_MESSAGE_LEN}, got ${report.message.length}`
  );
  assert.ok(
    report.subject.length <= MAX_SUPPORT_SUBJECT_LEN,
    `Expected subject length <= ${MAX_SUPPORT_SUBJECT_LEN}, got ${report.subject.length}`
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnomalyPdfReportData,
  buildPdfFromJpegPages,
} from '../src/utils/anomalyPdfReport.ts';
import type { ExchangeSyncErrorLogEntry } from '../src/lib/exchangeSyncErrorLog.ts';

function makeEntry(overrides: Partial<ExchangeSyncErrorLogEntry>): ExchangeSyncErrorLogEntry {
  const ts = overrides.occurredAtMs ?? Date.now();
  return {
    id: overrides.id ?? `log_${ts}`,
    keyId: overrides.keyId ?? 'key_1',
    exchange: overrides.exchange ?? 'binance',
    label: overrides.label ?? 'Main Spot',
    testnet: overrides.testnet ?? false,
    severity: overrides.severity ?? 'critical',
    category: overrides.category ?? 'auth',
    errorMessage: overrides.errorMessage ?? 'Binance отклонил ключ (-2015)',
    occurredAt: new Date(ts).toISOString(),
    occurredAtMs: ts,
    source: overrides.source ?? 'background',
  };
}

test('buildAnomalyPdfReportData aggregates anomalies, exchange breakdown, redacts secrets, and respects exchange filter', () => {
  const nowMs = Date.UTC(2026, 10, 21, 16, 10, 0);
  const spikeHourMs = Date.UTC(2026, 10, 21, 14, 15, 0);

  const logs: ExchangeSyncErrorLogEntry[] = [
    makeEntry({
      id: 'b1',
      exchange: 'bybit',
      occurredAtMs: spikeHourMs,
      errorMessage: 'Ошибка Bybit API (33004): API key has expired apiKey=SUPERSECRETKEY12345678901234567890',
    }),
    makeEntry({ id: 'b2', exchange: 'bybit', occurredAtMs: spikeHourMs + 10_000 }),
    makeEntry({ id: 'b3', exchange: 'bybit', occurredAtMs: spikeHourMs + 20_000 }),
    makeEntry({ id: 'b4', exchange: 'bybit', occurredAtMs: spikeHourMs + 30_000 }),
    makeEntry({ id: 'n1', exchange: 'binance', occurredAtMs: spikeHourMs + 40_000, severity: 'warning', category: 'rate_limit' }),
    makeEntry({ id: 'ok1', exchange: 'binance', occurredAtMs: nowMs - 5_000, severity: 'success', category: 'success' }),
  ];

  const reportAll = buildAnomalyPdfReportData(logs, { windowHours: 24, exchangeFilter: 'all', nowMs });
  assert.equal(reportAll.exchangeScopeLabel, 'Все биржи');
  assert.equal(reportAll.series.totalErrors, 5);
  assert.equal(reportAll.anomalies.length, 1);
  assert.equal(reportAll.anomalies[0]?.errors, 5);
  assert.equal(reportAll.exchangeBreakdown[0]?.exchange, 'bybit');
  assert.equal(reportAll.exchangeBreakdown[0]?.errors, 4);
  assert.equal(reportAll.recentIncidents.length, 5);

  const bybitIncident = reportAll.recentIncidents.find((i) => i.knownCode === '33004');
  assert.ok(bybitIncident);
  assert.ok(!bybitIncident.message.includes('SUPERSECRETKEY'));
  assert.ok(bybitIncident.message.includes('[скрыто]'));

  const reportBinanceOnly = buildAnomalyPdfReportData(logs, {
    windowHours: 24,
    exchangeFilter: 'binance',
    nowMs,
  });
  assert.equal(reportBinanceOnly.exchangeScopeLabel, 'BINANCE');
  assert.equal(reportBinanceOnly.series.totalErrors, 1);
  assert.equal(reportBinanceOnly.anomalies.length, 0);
});

test('buildPdfFromJpegPages produces a valid PDF 1.4 binary with accurate xref table and DCTDecode image object', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const pdfBytes = buildPdfFromJpegPages([
    { jpegBytes: fakeJpeg, widthPx: 1240, heightPx: 1754 },
  ]);

  const text = new TextDecoder('latin1').decode(pdfBytes);
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes('/Type /Pages'));
  assert.ok(text.includes('/Type /Page'));
  assert.ok(text.includes('/Subtype /Image /Width 1240 /Height 1754'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.ok(text.includes('xref\n0 6\n'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));

  // Verify startxref points directly at 'xref'
  const match = text.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(match);
  const xrefPos = Number(match[1]);
  assert.equal(text.slice(xrefPos, xrefPos + 4), 'xref');
});

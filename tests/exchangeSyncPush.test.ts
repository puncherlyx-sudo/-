import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCriticalSyncPushMessage,
  notifyCriticalExchangeSyncError,
} from '../server/push.ts';

test('buildCriticalSyncPushMessage routes auth errors to exchanges section and redacts long secret tokens', () => {
  const payload = buildCriticalSyncPushMessage({
    keyId: 'key_binance_1',
    exchange: 'binance',
    label: 'Основной Binance',
    category: 'auth',
    errorMessage: 'Invalid API-key, IP, or permissions for action: ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    testnet: false,
  });

  assert.equal(payload.category, 'exchange_sync_critical');
  assert.equal(payload.impact, 'HIGH');
  assert.equal(payload.url, '/?tab=security&section=exchanges');
  assert.match(payload.title, /API-ключ BINANCE требует обновления/);
  assert.ok(!payload.body.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'), 'Long secret tokens must be redacted');
  assert.ok(payload.body.includes('[скрыто]'));
});

test('buildCriticalSyncPushMessage routes exchange_api critical failures to sync log section', () => {
  const payload = buildCriticalSyncPushMessage({
    keyId: 'key_okx_2',
    exchange: 'okx',
    label: 'OKX Test',
    category: 'exchange_api',
    errorMessage: 'Биржа отклонила запрос синхронизации баланса (50004).',
    testnet: true,
  });

  assert.equal(payload.url, '/?tab=security&section=audit&sub=log');
  assert.match(payload.title, /Критический сбой синхронизации OKX/);
  assert.match(payload.body, /\(Testnet\)/);
});

test('notifyCriticalExchangeSyncError skips cleanly when user has no active push subscriptions', async () => {
  const res = await notifyCriticalExchangeSyncError('uid_without_push_sub', {
    keyId: 'key_bybit_1',
    exchange: 'bybit',
    label: 'Bybit Main',
    category: 'auth',
    errorMessage: 'API key expired (10003).',
  });

  assert.equal(res.sent, 0);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'no_subscriptions');
});

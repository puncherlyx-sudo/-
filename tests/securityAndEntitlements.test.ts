import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  consumeUserCredits,
  normalizeFirestoreState,
  parseTimestampMs,
  refundUserCredits,
  resolveAuthoritativePlan,
} from '../server/entitlements.ts';
import {
  decryptSecret,
  decryptSecretWithAad,
  encryptSecret,
  encryptSecretWithAad,
  generateBackupCodes,
  generateBase32Secret,
  generateTotpCode,
  hashBackupCode,
  matchBackupCodeHash,
  verifyTotpCodeWithStep,
} from '../server/security.ts';
import { verifyIpnSignature } from '../server/billing.ts';

test('A2: Free user with expired ISO nextResetAt resets to 25 credits and ISO +7 days', () => {
  const now = Date.now();
  const pastIso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const parsed = parseTimestampMs(pastIso);
  assert.ok(parsed !== null && parsed > 0 && parsed < now, 'ISO string must parse to valid past epoch ms');

  const { snapshot, patch } = normalizeFirestoreState(
    'uid_free_reset',
    {
      plan: 'free',
      creditsRemaining: 0,
      weeklyQuota: 25,
      nextResetAt: pastIso,
    },
    now
  );

  assert.equal(snapshot.plan, 'free');
  assert.equal(snapshot.creditsRemaining, 25);
  assert.equal(snapshot.weeklyQuota, 25);
  assert.ok(patch !== null, 'Expected Firestore patch on quota reset');
  assert.equal(typeof patch?.nextResetAt, 'string', 'nextResetAt patch must be ISO string for firestore.rules');
  assert.ok(snapshot.nextResetAt > now + 6 * 24 * 60 * 60 * 1000);
});

test('A3: Active annual PRO and MAX×10/×20 subscriptions refresh monthly credits every 30 days', () => {
  const now = Date.now();
  const futureYearMs = now + 300 * 24 * 60 * 60 * 1000;
  const expiredCycleIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const proRes = normalizeFirestoreState(
    'uid_pro_annual',
    {
      plan: 'pro',
      proUntil: futureYearMs,
      creditsRemaining: 4,
      weeklyQuota: 100,
      nextResetAt: expiredCycleIso,
    },
    now
  );
  assert.equal(proRes.snapshot.plan, 'pro');
  assert.equal(proRes.snapshot.creditsRemaining, 100);
  assert.equal(proRes.snapshot.weeklyQuota, 100);
  assert.ok(proRes.patch !== null);

  const max20Res = normalizeFirestoreState(
    'uid_max20_annual',
    {
      plan: 'max',
      maxMultiplier: 20,
      proUntil: futureYearMs,
      creditsRemaining: 12,
      weeklyQuota: 2000,
      nextResetAt: expiredCycleIso,
    },
    now
  );
  assert.equal(max20Res.snapshot.plan, 'max');
  assert.equal(max20Res.snapshot.creditsRemaining, 2000);
  assert.equal(max20Res.snapshot.weeklyQuota, 2000);
  assert.ok(max20Res.patch !== null);
});

test('A5: consumeUserCredits and refundUserCredits maintain exact credit balance', async () => {
  const uid = `test_uid_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const first = await consumeUserCredits(uid, 'ai_analysis');
  assert.equal(first.deducted, 1);
  assert.equal(first.snapshot.creditsRemaining, 24);

  const refunded = await refundUserCredits(uid, 'ai_analysis');
  assert.ok(refunded !== null);
  assert.equal(refunded.creditsRemaining, 25);

  const zeroCostBacktest = await consumeUserCredits(uid, 'pnl_backtest');
  assert.equal(zeroCostBacktest.deducted, 0);
  assert.equal(zeroCostBacktest.snapshot.creditsRemaining, 25);

  const zeroCostSentiment = await consumeUserCredits(uid, 'sentiment_pro');
  assert.equal(zeroCostSentiment.deducted, 0);
  assert.equal(zeroCostSentiment.snapshot.creditsRemaining, 25);
});

test('B1: Unauthenticated resolveAuthoritativePlan always resolves to free', async () => {
  const resolved = await resolveAuthoritativePlan(undefined);
  assert.equal(resolved, 'free');
});

test('C2: Purpose-separated encryption prevents cross-purpose decryption and rejects AAD tampering', () => {
  const uid = 'uid_vault_isolation_test';
  const secret = 'JBSWY3DPEHPK3PXP';

  const totpCipher = encryptSecret(secret, uid, 'totp');
  assert.ok(totpCipher.startsWith('v2:totp:'), 'Expected v2 purpose-scoped format');
  assert.equal(decryptSecret(totpCipher, uid, 'totp'), secret);

  assert.throws(
    () => decryptSecret(totpCipher, uid, 'exchange'),
    /purpose|Unsupported|authenticate|несовместим/i,
    'Exchange purpose must not decrypt TOTP ciphertext'
  );

  assert.throws(
    () => decryptSecret(totpCipher, 'other_uid', 'totp'),
    /Unsupported state or unable to authenticate data/i,
    'Different UID must fail GCM authentication'
  );

  const exchangeCipher = encryptSecretWithAad('api_secret_value', uid, 'binance:testnet:secret', 'exchange');
  assert.ok(exchangeCipher.startsWith('v3:exchange:'), 'Expected v3 purpose-scoped AAD format');
  assert.equal(
    decryptSecretWithAad(exchangeCipher, uid, 'binance:testnet:secret', 'exchange'),
    'api_secret_value'
  );
  assert.throws(
    () => decryptSecretWithAad(exchangeCipher, uid, 'binance:mainnet:secret', 'exchange'),
    /Unsupported state or unable to authenticate data/i,
    'Tampered AAD must fail GCM authentication'
  );
});

test('C3: 10-char HMAC-SHA256 backup codes and TOTP step verification work cleanly', () => {
  const { plaintext: codes, hashes } = generateBackupCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(hashes.length, 8);
  for (const code of codes) {
    assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/, 'Backup code must be 10-char grouped XXXXX-XXXXX');
  }

  const hash = hashBackupCode(codes[0]);
  assert.equal(hash.length, 64);
  assert.equal(matchBackupCodeHash(codes[0], hashes), hash);
  assert.equal(matchBackupCodeHash(codes[0].replace('-', ''), hashes), hash);
  assert.equal(matchBackupCodeHash('AAAAA-BBBBB', hashes), null);

  const totpSecret = generateBase32Secret();
  const now = Date.now();
  const codeNow = generateTotpCode(totpSecret, 0, now);
  const verified = verifyTotpCodeWithStep(totpSecret, codeNow, 1, now);
  assert.equal(verified.valid, true);
  assert.equal(typeof verified.matchedStep, 'number');
});

test('A4: NOWPayments IPN HMAC-SHA512 signature verification accepts valid and rejects tampered payloads', () => {
  const previousSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  const testSecret = 'unit_test_ipn_secret_key_2026';
  process.env.NOWPAYMENTS_IPN_SECRET = testSecret;

  try {
    const payload = {
      payment_status: 'finished',
      order_id: 'v2_uid123_pro_month_10_1700000000000',
      price_amount: 29,
      pay_currency: 'usdttrc20',
    };
    const canonical = JSON.stringify(
      Object.keys(payload)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = payload[key as keyof typeof payload];
          return acc;
        }, {})
    );
    const validSig = crypto.createHmac('sha512', testSecret).update(canonical).digest('hex');

    assert.equal(verifyIpnSignature(payload, validSig), true);
    assert.equal(
      verifyIpnSignature({ ...payload, price_amount: 0.01 }, validSig),
      false,
      'Tampered payload must be rejected'
    );
    assert.equal(verifyIpnSignature(payload, undefined), false);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.NOWPAYMENTS_IPN_SECRET;
    } else {
      process.env.NOWPAYMENTS_IPN_SECRET = previousSecret;
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize2faMutation,
  requireStepUpForUser,
  resetSecurityGuardStateForTests,
  setMemoryStepUpUntil,
  setMemoryTotpRecord,
  STEP_UP_TTL_MS,
} from '../server/securityGuard.ts';
import { encryptSecret, generateBackupCodes, generateBase32Secret, generateTotpCode } from '../server/security.ts';
import {
  computeSubscriptionTransition,
  getMaxMultiplierPlans,
  getTieredPlanPrices,
} from '../server/billing.ts';
import {
  AiServiceError,
  consumeGeminiDailyBudgetOrThrow,
  resetGeminiBudgetForTests,
} from '../server/aiAnalyst.ts';
import { IMMUTABLE_CREDIT_COSTS } from '../server/entitlements.ts';
import { DEFAULT_MAX_AUTH_AGE_SECONDS, isAuthTimeFresh } from '../server/auth.ts';

test('G1: authorize2faMutation blocks 2FA takeover without step-up or current code, allows with step-up or valid TOTP/backup code', async () => {
  resetSecurityGuardStateForTests();
  const uid = 'user_g1_takeover';
  const plainSecret = generateBase32Secret(20);
  const encrypted = encryptSecret(plainSecret, uid, 'totp');
  const { plaintext: backupPlain, hashes: backupHashes } = generateBackupCodes(8);
  const nowMs = Date.now();

  // 2FA активна, но step-up истёк
  setMemoryTotpRecord(uid, {
    totpEncryptedSecret: encrypted,
    backupCodeHashes: backupHashes,
    lastTotpStep: -1,
    stepUpUntil: nowMs - 5_000,
    updatedAtMs: nowMs,
  });

  // Попытка злоумышленника перенастроить/перезаписать 2FA без кода и без step-up -> 403 STEP_UP_REQUIRED
  const blocked = await authorize2faMutation(uid, { isProd: false, adminDb: null, nowMs });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, 'STEP_UP_REQUIRED');

  // Попытка с неверным кодом -> 403
  const wrongCode = await authorize2faMutation(uid, {
    currentCode: '000000',
    isProd: false,
    adminDb: null,
    nowMs,
  });
  assert.equal(wrongCode.ok, false);
  assert.equal(wrongCode.status, 403);

  // Попытка с валидным текущим TOTP-кодом -> разрешена
  const validTotp = generateTotpCode(plainSecret, 0, nowMs);
  const allowedByTotp = await authorize2faMutation(uid, {
    currentCode: validTotp,
    isProd: false,
    adminDb: null,
    nowMs,
  });
  assert.equal(allowedByTotp.ok, true);
  assert.equal(allowedByTotp.verifiedVia, 'totp');

  // Попытка с валидным резервным кодом -> разрешена
  const allowedByBackup = await authorize2faMutation(uid, {
    currentCode: backupPlain[0],
    isProd: false,
    adminDb: null,
    nowMs,
  });
  assert.equal(allowedByBackup.ok, true);
  assert.equal(allowedByBackup.verifiedVia, 'backup_code');

  // После свежего step-up -> разрешена без повторного ввода кода
  setMemoryStepUpUntil(uid, nowMs + STEP_UP_TTL_MS);
  const allowedByStepUp = await authorize2faMutation(uid, { isProd: false, adminDb: null, nowMs });
  assert.equal(allowedByStepUp.ok, true);
  assert.equal(allowedByStepUp.verifiedVia, 'step_up');

  resetSecurityGuardStateForTests();
});

test('G2: requireStepUpForUser enforces step-up when 2FA enabled and fails closed (503) in production without Admin SDK', async () => {
  resetSecurityGuardStateForTests();
  const uid = 'user_g2_stepup';
  const nowMs = Date.now();

  // В production без Admin SDK -> fail-closed 503 SECURITY_UNAVAILABLE
  const prodFailClosed = await requireStepUpForUser(uid, {
    isProd: true,
    adminDb: null,
    nowMs,
  });
  assert.equal(prodFailClosed.ok, false);
  assert.equal(prodFailClosed.status, 503);
  assert.equal(prodFailClosed.code, 'SECURITY_UNAVAILABLE');

  // В dev без 2FA -> пропускает
  const devNo2fa = await requireStepUpForUser(uid, { isProd: false, adminDb: null, nowMs });
  assert.equal(devNo2fa.ok, true);

  // Включаем 2FA с истёкшим step-up -> 403 STEP_UP_REQUIRED
  const plainSecret = generateBase32Secret(20);
  setMemoryTotpRecord(uid, {
    totpEncryptedSecret: encryptSecret(plainSecret, uid, 'totp'),
    backupCodeHashes: [],
    lastTotpStep: -1,
    stepUpUntil: nowMs - 1_000,
    updatedAtMs: nowMs,
  });
  const expired = await requireStepUpForUser(uid, {
    actionLabel: 'подключения API-ключа',
    isProd: false,
    adminDb: null,
    nowMs,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.status, 403);
  assert.equal(expired.code, 'STEP_UP_REQUIRED');

  // Продлеваем step-up -> пропускает
  setMemoryStepUpUntil(uid, nowMs + STEP_UP_TTL_MS);
  const active = await requireStepUpForUser(uid, { isProd: false, adminDb: null, nowMs });
  assert.equal(active.ok, true);

  resetSecurityGuardStateForTests();
});

test('H1: computeSubscriptionTransition prorates remaining days by day-value across PRO <-> MAXx10 <-> MAXx20 without burning or inflating', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.UTC(2026, 10, 22, 12, 0, 0);

  // 1. Продление того же тарифа (PRO -> PRO): остаток дней сохраняется 1:1 (10 + 30 = 40 дн.)
  const proRenew = computeSubscriptionTransition({
    currentPlan: 'pro',
    currentMultiplier: 10,
    currentUntilMs: nowMs + 10 * DAY_MS,
    targetTier: 'pro',
    targetMultiplier: 10,
    targetPeriod: 'month',
    nowMs,
  });
  assert.equal(proRenew.isSamePlan, true);
  assert.equal(proRenew.proratedCreditDays, 0);
  assert.equal(Math.round((proRenew.proUntil - nowMs) / DAY_MS), 40);

  const proMonthUsd = getTieredPlanPrices().pro.month.priceUsd;
  const max10MonthUsd = getMaxMultiplierPlans()[10].month.priceUsd;
  const max20MonthUsd = getMaxMultiplierPlans()[20].month.priceUsd;

  // 2. Апгрейд PRO -> MAX×10 при остатке 30 дней PRO
  //    Пропорциональный зачёт: round(30 * proMonthUsd / max10MonthUsd) — остаток не сгорает и не раздувается 1:1
  const proToMax10 = computeSubscriptionTransition({
    currentPlan: 'pro',
    currentMultiplier: 10,
    currentUntilMs: nowMs + 30 * DAY_MS,
    targetTier: 'max',
    targetMultiplier: 10,
    targetPeriod: 'month',
    nowMs,
  });
  const expectedProToMax10 = Math.round((30 * proMonthUsd) / max10MonthUsd);
  assert.equal(proToMax10.isSamePlan, false);
  assert.equal(proToMax10.proratedCreditDays, expectedProToMax10);
  assert.equal(Math.round((proToMax10.proUntil - nowMs) / DAY_MS), 30 + expectedProToMax10);

  // 3. Апгрейд MAX×10 -> MAX×20 при остатке 20 дней
  const max10ToMax20 = computeSubscriptionTransition({
    currentPlan: 'max',
    currentMultiplier: 10,
    currentUntilMs: nowMs + 20 * DAY_MS,
    targetTier: 'max',
    targetMultiplier: 20,
    targetPeriod: 'month',
    nowMs,
  });
  const expectedMax10To20 = Math.round((20 * max10MonthUsd) / max20MonthUsd);
  assert.equal(max10ToMax20.isSamePlan, false);
  assert.equal(max10ToMax20.proratedCreditDays, expectedMax10To20);

  // 4. Даунгрейд MAX×20 -> PRO при остатке 5 дней MAX×20
  const max20ToPro = computeSubscriptionTransition({
    currentPlan: 'max',
    currentMultiplier: 20,
    currentUntilMs: nowMs + 5 * DAY_MS,
    targetTier: 'pro',
    targetMultiplier: 10,
    targetPeriod: 'month',
    nowMs,
  });
  const expectedMax20ToPro = Math.round((5 * max20MonthUsd) / proMonthUsd);
  assert.equal(max20ToPro.proratedCreditDays, expectedMax20ToPro);

  // 5. Истёкшая подписка не добавляет просроченных дней
  const expiredSwitch = computeSubscriptionTransition({
    currentPlan: 'pro',
    currentMultiplier: 10,
    currentUntilMs: nowMs - 5 * DAY_MS,
    targetTier: 'max',
    targetMultiplier: 10,
    targetPeriod: 'month',
    nowMs,
  });
  assert.equal(expiredSwitch.proratedCreditDays, 0);
  assert.equal(Math.round((expiredSwitch.proUntil - nowMs) / DAY_MS), 30);
});

test('H2: Gemini daily budget enforces per-user isolation and global cap', async () => {
  const prevGlobal = process.env.GEMINI_DAILY_BUDGET;
  const prevFree = process.env.GEMINI_USER_DAILY_LIMIT_FREE;
  try {
    process.env.GEMINI_DAILY_BUDGET = '4';
    process.env.GEMINI_USER_DAILY_LIMIT_FREE = '2';
    resetGeminiBudgetForTests();

    // User A uses 2/2 free calls
    await consumeGeminiDailyBudgetOrThrow({ uid: 'user_a', tier: 'free' });
    await consumeGeminiDailyBudgetOrThrow({ uid: 'user_a', tier: 'free' });

    // User A 3rd call blocked by per-user limit
    await assert.rejects(
      () => consumeGeminiDailyBudgetOrThrow({ uid: 'user_a', tier: 'free' }),
      (err: unknown) => err instanceof AiServiceError && err.code === 'USER_DAILY_BUDGET_EXCEEDED'
    );

    // User B is unaffected by User A's per-user cap and can still consume remaining global quota (2 calls)
    await consumeGeminiDailyBudgetOrThrow({ uid: 'user_b', tier: 'free' });
    await consumeGeminiDailyBudgetOrThrow({ uid: 'user_b', tier: 'free' });

    // User C hits global daily budget (4/4)
    await assert.rejects(
      () => consumeGeminiDailyBudgetOrThrow({ uid: 'user_c', tier: 'pro' }),
      (err: unknown) => err instanceof AiServiceError && err.code === 'DAILY_BUDGET_EXCEEDED'
    );
  } finally {
    if (prevGlobal === undefined) delete process.env.GEMINI_DAILY_BUDGET;
    else process.env.GEMINI_DAILY_BUDGET = prevGlobal;
    if (prevFree === undefined) delete process.env.GEMINI_USER_DAILY_LIMIT_FREE;
    else process.env.GEMINI_USER_DAILY_LIMIT_FREE = prevFree;
    resetGeminiBudgetForTests();
  }
});

test('H3 & I2: strategy_scan credit cost aligns to 0 and isAuthTimeFresh enforces 24h window', () => {
  assert.equal(IMMUTABLE_CREDIT_COSTS.strategy_scan, 0);

  const nowMs = Date.UTC(2026, 10, 22, 12, 0, 0);
  const nowSec = Math.floor(nowMs / 1000);
  assert.equal(isAuthTimeFresh(nowSec - 3600, DEFAULT_MAX_AUTH_AGE_SECONDS, nowMs), true);
  assert.equal(isAuthTimeFresh(nowSec - DEFAULT_MAX_AUTH_AGE_SECONDS, DEFAULT_MAX_AUTH_AGE_SECONDS, nowMs), true);
  assert.equal(isAuthTimeFresh(nowSec - DEFAULT_MAX_AUTH_AGE_SECONDS - 60, DEFAULT_MAX_AUTH_AGE_SECONDS, nowMs), false);
  assert.equal(isAuthTimeFresh(0, DEFAULT_MAX_AUTH_AGE_SECONDS, nowMs), false);
});

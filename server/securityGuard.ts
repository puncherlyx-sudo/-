import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from './entitlements.ts';
import { serverLogger } from './logger.ts';
import { dispatchPushToUser } from './push.ts';
import { decryptSecret, matchBackupCodeHash, verifyTotpCodeWithStep } from './security.ts';

/**
 * Централизованный серверный модуль защиты 2FA и Step-Up аутентификации (Audit G1, G2, G3).
 *
 * Гарантии:
 *  - G1: Повторная настройка / перезапись / отключение 2FA невозможны без активного stepUpUntil
 *        ИЛИ действующего текущего кода 2FA (TOTP / резервного кода).
 *  - G2: Единый guard `requireStepUpForUser` применяется ко всем чувствительным маршрутам.
 *        В production без Admin SDK возвращает 503 (fail-closed).
 *  - G3: Легаси-пользователи с `twoFactorEnabled: true` или `private/security` без `serverSecurity/totp`
 *        корректно определяются (`needsMigration: true`) и не пропускаются как «без 2FA».
 */

export const STEP_UP_TTL_MS = 10 * 60_000;
const MAX_SECURITY_CACHE_SIZE = 5_000;

export interface ServerTotpMemoryRecord {
  totpEncryptedSecret: string;
  backupCodeHashes: string[];
  lastTotpStep: number;
  stepUpUntil: number;
  updatedAtMs: number;
}

export interface User2faState {
  enabled: boolean;
  hasServerSecret: boolean;
  needsMigration: boolean;
  stepUpUntil: number;
  totpEncryptedSecret: string;
  backupCodeHashes: string[];
  lastTotpStep: number;
  source: 'server_security' | 'legacy_firestore' | 'memory' | 'none';
}

export interface GuardDecision {
  ok: boolean;
  status?: number;
  code?: string;
  error?: string;
  state?: User2faState;
}

const memoryTotpByUid = new Map<string, ServerTotpMemoryRecord>();
const memoryLastTotpStepByUid = new Map<string, number>();
const memoryStepUpUntilByUid = new Map<string, number>();

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= MAX_SECURITY_CACHE_SIZE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export function getMemoryTotpRecord(uid: string): ServerTotpMemoryRecord | undefined {
  return memoryTotpByUid.get(uid);
}

export function setMemoryTotpRecord(uid: string, record: ServerTotpMemoryRecord): void {
  setBoundedMap(memoryTotpByUid, uid, record);
  setBoundedMap(memoryLastTotpStepByUid, uid, record.lastTotpStep);
  setBoundedMap(memoryStepUpUntilByUid, uid, record.stepUpUntil);
}

export function clearMemoryTotpRecord(uid: string): void {
  memoryTotpByUid.delete(uid);
  memoryLastTotpStepByUid.delete(uid);
  memoryStepUpUntilByUid.delete(uid);
}

export function getMemoryStepUpUntil(uid: string): number {
  return memoryStepUpUntilByUid.get(uid) ?? 0;
}

export function setMemoryStepUpUntil(uid: string, untilMs: number): void {
  setBoundedMap(memoryStepUpUntilByUid, uid, untilMs);
  const existing = memoryTotpByUid.get(uid);
  if (existing) {
    existing.stepUpUntil = untilMs;
    existing.updatedAtMs = Date.now();
  }
}

export function getMemoryLastTotpStep(uid: string): number {
  return memoryLastTotpStepByUid.get(uid) ?? -1;
}

export function setMemoryLastTotpStep(uid: string, step: number): void {
  setBoundedMap(memoryLastTotpStepByUid, uid, step);
  const existing = memoryTotpByUid.get(uid);
  if (existing) {
    existing.lastTotpStep = step;
    existing.updatedAtMs = Date.now();
  }
}

/** Очистка памяти для unit-тестов */
export function resetSecurityGuardStateForTests(): void {
  memoryTotpByUid.clear();
  memoryLastTotpStepByUid.clear();
  memoryStepUpUntilByUid.clear();
}

export async function resolveUser2faState(
  uid: string,
  options?: { adminDb?: Firestore | null },
): Promise<User2faState> {
  const adminDb = options && 'adminDb' in options ? options.adminDb : getAdminDb();
  const mem = memoryTotpByUid.get(uid);
  const memStepUp = memoryStepUpUntilByUid.get(uid) ?? 0;
  const memLastStep = memoryLastTotpStepByUid.get(uid) ?? -1;

  if (adminDb) {
    const totpRef = adminDb.collection('users').doc(uid).collection('serverSecurity').doc('totp');
    const totpSnap = await totpRef.get();
    if (totpSnap.exists) {
      const d = (totpSnap.data() || {}) as {
        totpEncryptedSecret?: unknown;
        backupCodeHashes?: unknown;
        lastTotpStep?: unknown;
        stepUpUntil?: unknown;
      };
      const secret = typeof d.totpEncryptedSecret === 'string' ? d.totpEncryptedSecret : '';
      if (secret.length > 0) {
        return {
          enabled: true,
          hasServerSecret: true,
          needsMigration: false,
          stepUpUntil: Math.max(typeof d.stepUpUntil === 'number' ? d.stepUpUntil : 0, memStepUp),
          totpEncryptedSecret: secret,
          backupCodeHashes: Array.isArray(d.backupCodeHashes)
            ? d.backupCodeHashes.filter((h): h is string => typeof h === 'string')
            : [],
          lastTotpStep: Math.max(typeof d.lastTotpStep === 'number' ? d.lastTotpStep : -1, memLastStep),
          source: 'server_security',
        };
      }
    }

    // G3: Проверяем legacy-флаг users/{uid}.twoFactorEnabled или users/{uid}/private/security
    const [userSnap, privSnap] = await Promise.all([
      adminDb.collection('users').doc(uid).get(),
      adminDb.collection('users').doc(uid).collection('private').doc('security').get(),
    ]);
    const userFlag = Boolean(userSnap.exists && userSnap.data()?.twoFactorEnabled === true);
    const privSecret =
      privSnap.exists && typeof privSnap.data()?.totpEncryptedSecret === 'string'
        ? String(privSnap.data()!.totpEncryptedSecret)
        : '';

    if (userFlag || privSecret.length > 0) {
      return {
        enabled: true,
        hasServerSecret: false,
        needsMigration: true,
        stepUpUntil: 0,
        totpEncryptedSecret: '',
        backupCodeHashes: [],
        lastTotpStep: -1,
        source: 'legacy_firestore',
      };
    }

    return {
      enabled: false,
      hasServerSecret: false,
      needsMigration: false,
      stepUpUntil: memStepUp,
      totpEncryptedSecret: '',
      backupCodeHashes: [],
      lastTotpStep: memLastStep,
      source: 'none',
    };
  }

  // Dev/preview режим без Admin SDK: опираемся на серверный in-memory реестр
  if (mem && mem.totpEncryptedSecret) {
    return {
      enabled: true,
      hasServerSecret: true,
      needsMigration: false,
      stepUpUntil: Math.max(mem.stepUpUntil, memStepUp),
      totpEncryptedSecret: mem.totpEncryptedSecret,
      backupCodeHashes: [...mem.backupCodeHashes],
      lastTotpStep: Math.max(mem.lastTotpStep, memLastStep),
      source: 'memory',
    };
  }

  return {
    enabled: false,
    hasServerSecret: false,
    needsMigration: false,
    stepUpUntil: memStepUp,
    totpEncryptedSecret: '',
    backupCodeHashes: [],
    lastTotpStep: memLastStep,
    source: 'none',
  };
}

/**
 * Единый серверный Step-Up Guard (Audit G2).
 * Блокирует чувствительные операции (403 STEP_UP_REQUIRED), если у пользователя включена 2FA
 * и нет свежего подтверждения (10 мин). В production без Admin SDK закрывается в fail-closed (503).
 */
export async function requireStepUpForUser(
  uid: string,
  options?: {
    actionLabel?: string;
    isProd?: boolean;
    adminDb?: Firestore | null;
    nowMs?: number;
  },
): Promise<GuardDecision> {
  const isProd = options?.isProd ?? process.env.NODE_ENV === 'production';
  const adminDb = options && 'adminDb' in options ? options.adminDb : getAdminDb();
  const nowMs = options?.nowMs ?? Date.now();
  const actionLabel = options?.actionLabel || 'выполнения этой операции';

  if (isProd && !adminDb) {
    return {
      ok: false,
      status: 503,
      code: 'SECURITY_UNAVAILABLE',
      error: 'Служба проверки 2FA временно недоступна в production (Admin SDK не настроен).',
    };
  }

  const state = await resolveUser2faState(uid, { adminDb });

  if (state.needsMigration) {
    return {
      ok: false,
      status: 403,
      code: '2FA_MIGRATION_REQUIRED',
      error: 'Требуется обновление конфигурации 2FA. Откройте Центр защиты → 2FA и завершите повторную настройку.',
      state,
    };
  }

  if (state.enabled && state.stepUpUntil <= nowMs) {
    return {
      ok: false,
      status: 403,
      code: 'STEP_UP_REQUIRED',
      error: `Требуется свежее подтверждение 2FA для ${actionLabel}.`,
      state,
    };
  }

  return { ok: true, state };
}

/**
 * Проверка права на изменение/перенастройку/отключение 2FA (Audit G1).
 * Если 2FA уже активна — требует действующий stepUpUntil ИЛИ валидный текущий код TOTP / резервный код.
 */
export async function authorize2faMutation(
  uid: string,
  options?: {
    currentCode?: string;
    requireCodeEvenWithStepUp?: boolean;
    isProd?: boolean;
    adminDb?: Firestore | null;
    nowMs?: number;
  },
): Promise<
  GuardDecision & {
    isAlreadyEnabled?: boolean;
    verifiedVia?: 'not_enabled' | 'migration' | 'step_up' | 'totp' | 'backup_code';
    consumedBackupHash?: string | null;
    matchedStep?: number | null;
  }
> {
  const isProd = options?.isProd ?? process.env.NODE_ENV === 'production';
  const adminDb = options && 'adminDb' in options ? options.adminDb : getAdminDb();
  const nowMs = options?.nowMs ?? Date.now();
  const currentCode = typeof options?.currentCode === 'string' ? options.currentCode.trim() : '';

  if (isProd && !adminDb) {
    return {
      ok: false,
      status: 503,
      code: 'SECURITY_UNAVAILABLE',
      error: 'Управление 2FA недоступно в production без Firebase Admin SDK.',
    };
  }

  const state = await resolveUser2faState(uid, { adminDb });

  if (!state.enabled) {
    return { ok: true, state, isAlreadyEnabled: false, verifiedVia: 'not_enabled' };
  }

  // G3: Легаси-пользователь без serverSecurity/totp должен иметь возможность завершить миграцию через /setup + /confirm
  if (state.needsMigration && !options?.requireCodeEvenWithStepUp) {
    return { ok: true, state, isAlreadyEnabled: true, verifiedVia: 'migration' };
  }

  const hasFreshStepUp = state.stepUpUntil > nowMs;
  if (hasFreshStepUp && !options?.requireCodeEvenWithStepUp) {
    return { ok: true, state, isAlreadyEnabled: true, verifiedVia: 'step_up' };
  }

  // Проверяем переданный текущий код (TOTP или backup code)
  if (currentCode && state.totpEncryptedSecret) {
    try {
      const plainSecret = decryptSecret(state.totpEncryptedSecret, uid, 'totp');
      const totpCheck = verifyTotpCodeWithStep(plainSecret, currentCode, 1, nowMs);
      if (totpCheck.valid && totpCheck.matchedStep !== null && totpCheck.matchedStep > state.lastTotpStep) {
        return {
          ok: true,
          state,
          isAlreadyEnabled: true,
          verifiedVia: 'totp',
          matchedStep: totpCheck.matchedStep,
        };
      }
      const matchedBackup = matchBackupCodeHash(currentCode, state.backupCodeHashes);
      if (matchedBackup) {
        return {
          ok: true,
          state,
          isAlreadyEnabled: true,
          verifiedVia: 'backup_code',
          consumedBackupHash: matchedBackup,
        };
      }
    } catch {
      // Падение расшифровки обрабатывается как отказ ниже
    }
  }

  return {
    ok: false,
    status: 403,
    code: 'STEP_UP_REQUIRED',
    error:
      '2FA уже активна. Для перенастройки или отключения подтвердите действие текущим кодом 2FA или пройдите Step-Up проверку.',
    state,
    isAlreadyEnabled: true,
  };
}

/**
 * Запись серверного неизменяемого события безопасности в `users/{uid}/securityLog`
 * и отправка Push-уведомления владельцу (Audit G1).
 */
export async function recordServerSecurityEvent(
  uid: string,
  params: {
    event: string;
    title: string;
    details: string;
    severity: 'info' | 'warning' | 'critical';
    sendPush?: boolean;
  },
): Promise<void> {
  const nowMs = Date.now();
  const logId = `seclog_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
  const adminDb = getAdminDb();

  if (adminDb) {
    try {
      await adminDb
        .collection('users')
        .doc(uid)
        .collection('securityLog')
        .doc(logId)
        .set({
          id: logId,
          userId: uid,
          event: params.event.slice(0, 64),
          details: params.details.slice(0, 300),
          severity: params.severity,
          createdAtMs: nowMs,
          createdAtIso: new Date(nowMs).toISOString(),
        });
    } catch (err) {
      serverLogger.warn(
        'securityLog',
        `Не удалось записать событие ${params.event}:`,
        err instanceof Error ? err.message : 'unknown',
      );
    }
  }

  if (params.sendPush !== false) {
    void dispatchPushToUser(uid, {
      title: params.title.slice(0, 120),
      body: params.details.slice(0, 300),
      tag: `sec-${params.event.toLowerCase()}`,
      url: '/?tab=security',
      impact: 'HIGH',
      category: 'auth_login',
    }).catch(() => undefined);
  }
}

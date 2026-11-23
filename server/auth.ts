import fs from 'fs';
import path from 'path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { NextFunction, Request, Response } from 'express';
import { getAdminDb } from './entitlements.ts';
import { serverLogger } from './logger.ts';

/**
 * Серверная проверка личности пользователя.
 *
 * Клиент присылает Firebase ID-токен в заголовке `Authorization: Bearer <token>`.
 * Сервер проверяет подпись токена публичными ключами Google, издателя (iss),
 * аудиторию (aud) и срок действия. Идентификатор пользователя (uid) берётся
 * ТОЛЬКО из проверенного токена, а не из тела запроса.
 */

function loadProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  const raw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8');
  const parsed = JSON.parse(raw) as { projectId?: string };
  if (!parsed.projectId) {
    throw new Error('Не найден projectId Firebase для проверки токенов.');
  }
  return parsed.projectId;
}

const PROJECT_ID = loadProjectId();
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
  { cooldownDuration: 30_000, cacheMaxAge: 60 * 60 * 1000 },
);

const UID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
export const DEFAULT_MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // 24 часа

export interface VerifiedUser {
  uid: string;
  email: string | null;
  authTime: number; // Unix seconds
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: VerifiedUser;
    rawBearerToken?: string;
  }
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
    algorithms: ['RS256'],
  });
  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  if (!uid || !UID_PATTERN.test(uid)) {
    throw new Error('Некорректный идентификатор пользователя в токене.');
  }
  const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : 0;
  if (authTime > Math.floor(Date.now() / 1000) + 60) {
    throw new Error('Некорректное время аутентификации в токене.');
  }
  return {
    uid,
    email: typeof payload.email === 'string' ? payload.email : null,
    authTime,
  };
}

let revocationWarnLogged = false;

/**
 * Проверка отзыва refresh-токена через Firebase Admin Auth (checkRevoked = true).
 * Если Admin SDK не сконфигурирован (dev / Starter Tier без IAM), возвращает { skipped: true }.
 */
export async function checkTokenRevocationIfAdminAvailable(
  token: string,
): Promise<{ ok: boolean; revoked?: boolean; skipped?: boolean }> {
  const adminDb = getAdminDb();
  if (!adminDb || getApps().length === 0) {
    return { ok: true, skipped: true };
  }
  try {
    await getAuth(getApps()[0]).verifyIdToken(token, true);
    return { ok: true };
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') {
      return { ok: false, revoked: true };
    }
    if (!revocationWarnLogged) {
      revocationWarnLogged = true;
      serverLogger.warn(
        'auth',
        `Admin checkRevoked недоступен (${code || 'unknown'}) — используется проверка подписи JWKS и auth_time.`,
      );
    }
    return { ok: true, skipped: true };
  }
}

/** Отзыв всех активных refresh-токенов пользователя через Firebase Admin SDK (I2). */
export async function revokeUserRefreshTokens(
  uid: string,
): Promise<{ revoked: boolean; reason?: string }> {
  const adminDb = getAdminDb();
  if (!adminDb || getApps().length === 0) {
    return { revoked: false, reason: 'ADMIN_UNAVAILABLE' };
  }
  try {
    await getAuth(getApps()[0]).revokeRefreshTokens(uid);
    return { revoked: true };
  } catch (err) {
    serverLogger.warn(
      'auth',
      'Не удалось отозвать refresh-токены через Admin Auth:',
      err instanceof Error ? err.message : 'unknown',
    );
    return { revoked: false, reason: 'REVOKE_FAILED' };
  }
}

/** Чистая проверка свежести auth_time (в секундах). */
export function isAuthTimeFresh(
  authTimeSeconds: number,
  maxAgeSeconds = DEFAULT_MAX_AUTH_AGE_SECONDS,
  nowMs = Date.now(),
): boolean {
  if (!Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0) return false;
  const nowSec = Math.floor(nowMs / 1000);
  return nowSec - authTimeSeconds <= maxAgeSeconds;
}

/** Middleware: пропускает только запросы с валидным Firebase ID-токеном. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.uid) {
    next();
    return;
  }
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match) {
    res.status(401).json({ error: 'Требуется вход в аккаунт.' });
    return;
  }
  try {
    req.rawBearerToken = match[1];
    req.user = await verifyFirebaseIdToken(match[1]);
    next();
  } catch {
    res.status(401).json({ error: 'Сессия недействительна. Войдите в аккаунт заново.' });
  }
}

/**
 * Middleware (I2): проверка свежести входа (auth_time <= 24ч) и отзыва токенов
 * на чувствительных маршрутах (биржевые ключи, 2FA, отзыв сессий).
 */
export function requireFreshAuth(maxAgeSeconds = DEFAULT_MAX_AUTH_AGE_SECONDS) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.uid) {
      res.status(401).json({ error: 'Требуется вход в аккаунт.' });
      return;
    }

    if (req.user.authTime > 0 && !isAuthTimeFresh(req.user.authTime, maxAgeSeconds)) {
      res.status(401).json({
        error: 'Для этой операции требуется свежий вход в аккаунт (не старше 24 часов). Войдите заново.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const token =
      req.rawBearerToken ||
      (typeof req.headers.authorization === 'string'
        ? (/^Bearer\s+(\S+)$/i.exec(req.headers.authorization)?.[1] ?? '')
        : '');

    if (token) {
      const revCheck = await checkTokenRevocationIfAdminAvailable(token);
      if (!revCheck.ok && revCheck.revoked) {
        res.status(401).json({
          error: 'Ваша сессия была отозвана. Выполните повторный вход в аккаунт.',
          code: 'TOKEN_REVOKED',
        });
        return;
      }
    }

    next();
  };
}

/** Допустимые хосты push-сервисов браузеров. Защита от SSRF через произвольный endpoint. */
const PUSH_HOST_PATTERNS: RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^updates-autopush\.(stage\.)?mozaws\.net$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
  /^push\.services\.mozilla\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port) return false;
    return PUSH_HOST_PATTERNS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

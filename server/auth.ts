import fs from 'fs';
import path from 'path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';

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

export interface VerifiedUser {
  uid: string;
  email: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: VerifiedUser;
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
  return { uid, email: typeof payload.email === 'string' ? payload.email : null };
}

/** Middleware: пропускает только запросы с валидным Firebase ID-токеном. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match) {
    res.status(401).json({ error: 'Требуется вход в аккаунт.' });
    return;
  }
  try {
    req.user = await verifyFirebaseIdToken(match[1]);
    next();
  } catch {
    res.status(401).json({ error: 'Сессия недействительна. Войдите в аккаунт заново.' });
  }
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

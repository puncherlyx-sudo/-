import { auth } from './firebase';

const CSRF_COOKIE_NAME = 'vernier_csrf';
const CLIENT_FP_STORAGE_KEY = 'vernier_client_fp_v1';

let cachedCsrfToken: string | null = null;
let csrfInFlight: Promise<string | null> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function getClientFingerprint(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.sessionStorage.getItem(CLIENT_FP_STORAGE_KEY);
    if (existing && /^[0-9a-f]{24,32}$/.test(existing)) return existing;
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    const fp = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    window.sessionStorage.setItem(CLIENT_FP_STORAGE_KEY, fp);
    return fp;
  } catch {
    return 'ephemeral';
  }
}

export function invalidateCsrfTokenCache(): void {
  cachedCsrfToken = null;
}

export async function ensureCsrfToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  if (!forceRefresh) {
    const fromCookie = readCookie(CSRF_COOKIE_NAME);
    if (fromCookie && /^[0-9a-f]{64}$/.test(fromCookie)) {
      cachedCsrfToken = fromCookie;
      return fromCookie;
    }
    if (cachedCsrfToken && /^[0-9a-f]{64}$/.test(cachedCsrfToken)) {
      return cachedCsrfToken;
    }
  }

  if (csrfInFlight && !forceRefresh) {
    return csrfInFlight;
  }

  csrfInFlight = fetch('/api/security/csrf-token', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { csrfToken?: unknown };
      if (typeof data.csrfToken === 'string' && /^[0-9a-f]{64}$/.test(data.csrfToken)) {
        cachedCsrfToken = data.csrfToken;
        return data.csrfToken;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      csrfInFlight = null;
    });

  return csrfInFlight;
}

function isMutatingMethod(method?: string): boolean {
  const m = (method || 'GET').toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

function isLocalApiUrl(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return raw.startsWith('/api/') || raw === '/api';
}

/**
 * Подготавливает заголовки CSRF (Double Submit Cookie) и отпечаток сессии
 * для всех мутирующих запросов к локальным /api/* маршрутам.
 */
export async function attachSecurityHeaders(
  input: RequestInfo | URL,
  init: RequestInit = {},
  forceCsrfRefresh = false
): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  if (isLocalApiUrl(input)) {
    headers.set('X-Vernier-Client-FP', getClientFingerprint());
    if (isMutatingMethod(init.method)) {
      const csrfToken = await ensureCsrfToken(forceCsrfRefresh);
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }
  }
  return {
    ...init,
    credentials: isLocalApiUrl(input) ? 'same-origin' : init.credentials,
    headers,
  };
}

/**
 * fetch с подписанным токеном входа Firebase (Authorization: Bearer ...)
 * и автоматическим CSRF Double-Submit заголовком для мутирующих запросов.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  const securedInit = await attachSecurityHeaders(input, init, false);
  const headers = new Headers(securedInit.headers);
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  let res = await fetch(input, { ...securedInit, headers });

  // Однократный авто-перевыпуск CSRF-токена при истёкшей cookie
  if (res.status === 403 && isLocalApiUrl(input) && isMutatingMethod(init.method)) {
    const cloneText = await res.clone().text().catch(() => '');
    if (cloneText.includes('CSRF_INVALID')) {
      invalidateCsrfTokenCache();
      const refreshedInit = await attachSecurityHeaders(input, init, true);
      const retryHeaders = new Headers(refreshedInit.headers);
      if (user) {
        const token = await user.getIdToken();
        retryHeaders.set('Authorization', `Bearer ${token}`);
      }
      res = await fetch(input, { ...refreshedInit, headers: retryHeaders });
    }
  }

  return res;
}

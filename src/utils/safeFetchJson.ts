export interface SafeFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage: string | null;
}

export async function parseJsonResponse<T extends Record<string, unknown>>(
  res: Response
): Promise<SafeFetchResult<T>> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {
      ok: res.ok,
      status: res.status,
      data: null,
      errorMessage: res.ok
        ? null
        : `Сервер вернул пустой ответ (HTTP ${res.status}). Повторите попытку.`,
    };
  }

  const looksLikeHtml =
    trimmed.startsWith('<') ||
    trimmed.toLowerCase().startsWith('<!doctype') ||
    contentType.includes('text/html');

  if (looksLikeHtml) {
    return {
      ok: false,
      status: res.status,
      data: null,
      errorMessage:
        'Сервер временно недоступен или обновляется (получена HTML-страница вместо JSON). Повторите запрос через пару секунд.',
    };
  }

  let parsed: T;
  try {
    parsed = JSON.parse(trimmed) as T;
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      errorMessage: `Некорректный формат ответа сервера (HTTP ${res.status}). Попробуйте ещё раз.`,
    };
  }

  if (!res.ok) {
    const serverErr =
      typeof parsed.error === 'string' && parsed.error.trim()
        ? parsed.error.trim()
        : `Ошибка сервера (HTTP ${res.status}).`;
    return {
      ok: false,
      status: res.status,
      data: parsed,
      errorMessage: serverErr,
    };
  }

  return {
    ok: true,
    status: res.status,
    data: parsed,
    errorMessage: null,
  };
}

/**
 * Safely parses JSON API responses even if an upstream proxy, CDN, or restarting dev server
 * returns an HTML error page (e.g. "<!doctype html>") or empty body.
 */
export async function safeFetchJson<T extends Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<SafeFetchResult<T>> {
  const { timeoutMs = 15000, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const externalSignal = fetchInit.signal;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
    return await parseJsonResponse<T>(res);
  } catch (err) {
    const isAbort =
      err instanceof DOMException
        ? err.name === 'AbortError'
        : err instanceof Error && err.name === 'AbortError';

    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: isAbort
        ? 'Превышено время ожидания ответа от сервера. Повторите попытку.'
        : err instanceof Error
          ? err.message
          : 'Ошибка соединения с сервером.',
    };
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

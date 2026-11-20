/**
 * Безопасный клиентский логгер с усиленной regex-редакцией чувствительных данных
 * и глубокой санитизацией Error-объектов (включая cause, stack и custom-поля),
 * чтобы console.error никогда не допускал утечку PII, токенов или API-ключей
 * даже при неожиданных сбоях и исключениях.
 */

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|api[_-]?secret|secret|token|id[_-]?token|access[_-]?token|refresh[_-]?token|csrf|password|passwd|pwd|passphrase|pin|pinhash|pinsalt|authorization|auth[_-]?header|cookie|set-cookie|private[_-]?key|public[_-]?key|mnemonic|seed|totp|bearer|email|phone|mobile|ssn|passport|card[_-]?number|pan|cvv|cvc|iban|signature|hmac|webhook[_-]?url|session[_-]?id|client[_-]?secret)/i;

const STRING_REDACT_RULES: Array<[RegExp, string | ((match: string) => string)]> = [
  // PEM-блоки приватных ключей и сертификатов
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, '[REDACTED_PEM_KEY]'],
  // JWT (header.payload.signature)
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  // Известные префиксы API-ключей (Google, OpenAI, Anthropic, Stripe, GitHub, Slack, AWS)
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g, '[REDACTED_API_KEY]'],
  [/\bsk-(?:proj-|ant-)?[0-9A-Za-z_-]{16,}\b/g, '[REDACTED_SECRET_KEY]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}\b/g, '[REDACTED_GH_TOKEN]'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  // Заголовки авторизации (Bearer / Basic / ApiKey)
  [/\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{10,}/gi, '[REDACTED_AUTH_HEADER]'],
  // Токены Telegram-ботов и webhook-секреты
  [/\b\d{8,11}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_TG_TOKEN]'],
  // Приватные криптоключи (64 hex-символа с 0x)
  [/\b0x[a-fA-F0-9]{64}\b/g, '[REDACTED_PRIVATE_KEY]'],
  // Криптографические хэши (PBKDF2, bcrypt, Argon2)
  [/pbkdf2[_-]v\d+:[A-Za-z0-9+/=:-]+/gi, '[REDACTED_HASH]'],
  [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[REDACTED_BCRYPT_HASH]'],
  [/\$argon2(?:id|i|d)\$[^\s"']+/gi, '[REDACTED_ARGON2_HASH]'],
  // Query-параметры URL с чувствительными именами
  [
    /([?&](?:api[_-]?key|api[_-]?secret|key|token|access_token|id_token|refresh_token|auth|sig|signature|secret|password|passphrase|session|code|email)=)[^&#\s"'<>]+/gi,
    '$1[REDACTED]',
  ],
  // Пары ключ-значение в JSON, заголовках и строках ошибок
  [
    /(["']?(?:api[_-]?key|api[_-]?secret|id[_-]?token|access[_-]?token|refresh[_-]?token|token|pin|pinHash|pinSalt|secret|password|passphrase|authorization|cookie|private[_-]?key|mnemonic|seed|totp|signature|webhookUrl)["']?\s*[:=]\s*["']?)[^"'\s,}\]]+/gi,
    '$1[REDACTED]',
  ],
  // Email-адреса (PII)
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]'],
  // Банковские карты (13-19 цифр с разделителями)
  [
    /\b(?:\d[ -]*?){13,19}\b/g,
    (match: string) => {
      const digits = match.replace(/\D/g, '');
      // Не трогаем timestamp в миллисекундах (13 цифр, начинающиеся с 16-19)
      if (digits.length === 13 && /^1[6-9]\d{11}$/.test(digits)) return match;
      return digits.length >= 13 && digits.length <= 19 ? '[REDACTED_CARD]' : match;
    },
  ],
  // Международные номера телефонов (+7..., +1..., +44...)
  [/(?<!\w)\+\d{1,3}[\s.-]?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\w)/g, '[REDACTED_PHONE]'],
];

export function redactSensitiveString(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input.length > 4000 ? `${input.slice(0, 4000)}…[TRUNCATED]` : input;
  for (const [pattern, replacement] of STRING_REDACT_RULES) {
    out = typeof replacement === 'function' ? out.replace(pattern, replacement) : out.replace(pattern, replacement);
  }
  return out;
}

function sanitizeErrorObject(
  err: Error,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  if (seen.has(err)) return { name: err.name || 'Error', message: '[CIRCULAR_ERROR]' };
  seen.add(err);

  const sanitized: Record<string, unknown> = {
    name: redactSensitiveString(String(err.name || 'Error')),
    message: redactSensitiveString(String(err.message || 'Unknown error')),
  };

  const errRecord = err as unknown as Record<string, unknown>;
  if (typeof errRecord.code === 'string' || typeof errRecord.code === 'number') {
    sanitized.code = redactSensitiveString(String(errRecord.code));
  }
  if (typeof errRecord.status === 'number' || typeof errRecord.statusCode === 'number') {
    sanitized.status = errRecord.status ?? errRecord.statusCode;
  }

  // Санитизируем stack trace (в DEV — первые 6 строк, в PROD — только очищенный заголовок без локальных путей)
  if (typeof err.stack === 'string' && err.stack.length > 0) {
    const lines = redactSensitiveString(err.stack).split('\n');
    if (import.meta.env.DEV) {
      sanitized.stack = lines.slice(0, 6).join('\n');
    } else {
      sanitized.stack = lines[0];
    }
  }

  // Рекурсивно очищаем error.cause (ES2022)
  if ('cause' in err && errRecord.cause !== undefined && depth < 4) {
    sanitized.cause = sanitizeLogValue(errRecord.cause, depth + 1, seen);
  }

  // Очищаем дополнительные enumerable-поля (например, FirebaseError.customData или HTTP-метаданные)
  if (depth < 3) {
    try {
      for (const [k, v] of Object.entries(errRecord)) {
        if (k === 'name' || k === 'message' || k === 'stack' || k === 'cause' || k === 'code' || k === 'status') {
          continue;
        }
        if (SENSITIVE_KEY_PATTERN.test(k)) {
          sanitized[k] = '[REDACTED]';
        } else {
          sanitized[k] = sanitizeLogValue(v, depth + 1, seen);
        }
      }
    } catch {
      sanitized._extra = '[UNSERIALIZABLE_PROPS]';
    }
  }

  return sanitized;
}

export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactSensitiveString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return '[Function]';

    if (value instanceof Error) {
      return sanitizeErrorObject(value, depth, seen);
    }

    if (value instanceof URL) {
      return redactSensitiveString(value.toString());
    }

    if (depth >= 4) return '[TRUNCATED]';

    if (typeof value === 'object') {
      if (seen.has(value)) return '[CIRCULAR]';
      seen.add(value);

      if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1, seen));
      }

      // Обработка Error-подобных объектов из сторонних библиотек / кросс-фреймов
      const maybeErr = value as Record<string, unknown>;
      if (
        typeof maybeErr.message === 'string' &&
        (typeof maybeErr.stack === 'string' || typeof maybeErr.name === 'string')
      ) {
        const cleanErr: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(maybeErr)) {
          if (SENSITIVE_KEY_PATTERN.test(k)) {
            cleanErr[k] = '[REDACTED]';
          } else if (k === 'stack' && typeof v === 'string') {
            const lines = redactSensitiveString(v).split('\n');
            cleanErr[k] = import.meta.env.DEV ? lines.slice(0, 6).join('\n') : lines[0];
          } else {
            cleanErr[k] = sanitizeLogValue(v, depth + 1, seen);
          }
        }
        return cleanErr;
      }

      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(maybeErr)) {
        if (SENSITIVE_KEY_PATTERN.test(k)) {
          clean[k] = '[REDACTED]';
        } else {
          clean[k] = sanitizeLogValue(v, depth + 1, seen);
        }
      }
      return clean;
    }

    return redactSensitiveString(String(value));
  } catch {
    return '[REDACTION_FALLBACK]';
  }
}

function formatArgs(scope: string, args: unknown[]): unknown[] {
  try {
    return [`[${redactSensitiveString(scope)}]`, ...args.map((a) => sanitizeLogValue(a))];
  } catch {
    return ['[logger]', '[SANITIZATION_ERROR]'];
  }
}

export const logger = {
  debug(scope: string, ...args: unknown[]): void {
    if (!import.meta.env.DEV) return;
    globalThis.console.debug(...formatArgs(scope, args));
  },
  info(scope: string, ...args: unknown[]): void {
    if (!import.meta.env.DEV) return;
    globalThis.console.info(...formatArgs(scope, args));
  },
  warn(scope: string, ...args: unknown[]): void {
    globalThis.console.warn(...formatArgs(scope, args));
  },
  error(scope: string, ...args: unknown[]): void {
    globalThis.console.error(...formatArgs(scope, args));
  },
};

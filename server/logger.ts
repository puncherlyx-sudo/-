/**
 * Безопасный серверный логгер с автоматической редакцией чувствительных данных
 * (API-ключи, Bearer-токены, PIN-коды, секреты бирж, Telegram-токены, email).
 */

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|api[_-]?secret|secret|token|password|passphrase|pin|authorization|cookie|private[_-]?key|mnemonic|seed|totp|bearer|email|master[_-]?key)/i;

const STRING_REDACT_RULES: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_GOOGLE_KEY]'],
  [/sk-[0-9A-Za-z_-]{16,}/g, '[REDACTED_SECRET_KEY]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/\b\d{8,11}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_TG_TOKEN]'],
  [/\b0x[a-fA-F0-9]{64}\b/g, '[REDACTED_PRIVATE_KEY]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]'],
  [/(["']?(?:apiKey|apiSecret|token|pin|secret|password|passphrase)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[REDACTED]'],
];

export function redactServerString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of STRING_REDACT_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function sanitizeServerValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactServerString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return `${value.name}: ${redactServerString(value.message)}`;
  }
  if (depth >= 4) return '[TRUNCATED]';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => sanitizeServerValue(item, depth + 1, seen));
    }
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      clean[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : sanitizeServerValue(v, depth + 1, seen);
    }
    return clean;
  }
  return String(value);
}

export const serverLogger = {
  info(scope: string, ...args: unknown[]): void {
    globalThis.console.info(`[${scope}]`, ...args.map((a) => sanitizeServerValue(a)));
  },
  warn(scope: string, ...args: unknown[]): void {
    globalThis.console.warn(`[${scope}]`, ...args.map((a) => sanitizeServerValue(a)));
  },
  error(scope: string, ...args: unknown[]): void {
    globalThis.console.error(`[${scope}]`, ...args.map((a) => sanitizeServerValue(a)));
  },
};

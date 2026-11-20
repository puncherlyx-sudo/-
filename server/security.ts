import crypto from 'crypto';
import { serverLogger } from './logger.ts';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const MIN_MASTER_KEY_LEN = 32;
let ephemeralDevMasterKey: Buffer | null = null;
let devKeyWarningShown = false;

function resolveMasterKeyMaterial(): Buffer {
  const configured = (process.env.TOTP_MASTER_KEY || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured.length >= MIN_MASTER_KEY_LEN) {
    return Buffer.from(configured, 'utf8');
  }

  if (isProduction) {
    throw new Error(
      '[security] FATAL: TOTP_MASTER_KEY не задан или короче 32 символов. Запуск в production без криптографического мастер-ключа запрещён.',
    );
  }

  if (!ephemeralDevMasterKey) {
    ephemeralDevMasterKey = crypto.randomBytes(32);
  }
  if (!devKeyWarningShown) {
    devKeyWarningShown = true;
    serverLogger.warn(
      'security',
      'DEV WARNING: TOTP_MASTER_KEY не задан (мин. 32 символа). Сгенерирован временный эфемерный ключ для текущей сессии процесса. Задайте TOTP_MASTER_KEY в .env.'
    );
  }
  return ephemeralDevMasterKey;
}

export function assertSecurityEnvConfigured(): void {
  resolveMasterKeyMaterial();
}

function getVaultKey(uid: string): Buffer {
  const masterMaterial = resolveMasterKeyMaterial();
  const derived = crypto.hkdfSync(
    'sha256',
    masterMaterial,
    Buffer.from(`vernier:vault:${uid}`, 'utf8'),
    Buffer.from('vernier-aes256gcm-v2', 'utf8'),
    32,
  );
  return Buffer.from(derived);
}

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpCode(secretBase32: string, stepOffset = 0, timestampMs = Date.now()): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, candidate: string, window = 1): boolean {
  const normalized = candidate.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset++) {
    const expected = generateTotpCode(secretBase32, offset, now);
    if (crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(email: string, issuer: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function encryptSecret(plainText: string, uid: string): string {
  const key = getVaultKey(uid);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText: string, uid: string): string {
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [ivHex, tagHex, encHex] = parts;
  const key = getVaultKey(uid);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function hashBackupCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function generateBackupCodes(count = 8): { plaintext: string[]; hashes: string[] } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const plaintext: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let raw = '';
    for (let j = 0; j < 8; j++) {
      raw += chars[bytes[j] % chars.length];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plaintext.push(formatted);
    hashes.push(hashBackupCode(formatted));
  }
  return { plaintext, hashes };
}

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

export type VaultKeyPurpose = 'default' | 'totp' | 'exchange';

function getVaultKey(uid: string, purpose: VaultKeyPurpose = 'default'): Buffer {
  const masterMaterial = resolveMasterKeyMaterial();
  const info = purpose === 'default' ? 'vernier-aes256gcm-v2' : `vernier-aes256gcm-v2:${purpose}`;
  const derived = crypto.hkdfSync(
    'sha256',
    masterMaterial,
    Buffer.from(`vernier:vault:${uid}`, 'utf8'),
    Buffer.from(info, 'utf8'),
    32,
  );
  return Buffer.from(derived);
}

function getBackupCodePepper(): Buffer {
  const configured = (process.env.BACKUP_CODE_PEPPER || '').trim();
  if (configured.length >= 16) {
    return Buffer.from(configured, 'utf8');
  }
  const masterMaterial = resolveMasterKeyMaterial();
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      masterMaterial,
      Buffer.from('vernier:backup-pepper', 'utf8'),
      Buffer.from('vernier-backup-hmac-v2', 'utf8'),
      32,
    ),
  );
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

/**
 * Проверяет 6-значный TOTP-код и возвращает принятый 30-секундный шаг (step),
 * чтобы сервер мог заблокировать повторное использование того же кода (replay protection).
 */
export function verifyTotpCodeWithStep(
  secretBase32: string,
  candidate: string,
  window = 1,
  timestampMs = Date.now(),
): { valid: boolean; matchedStep: number | null } {
  const normalized = candidate.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, matchedStep: null };
  const baseStep = Math.floor(timestampMs / 1000 / 30);
  for (let offset = -window; offset <= window; offset++) {
    const expected = generateTotpCode(secretBase32, offset, timestampMs);
    if (crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) {
      return { valid: true, matchedStep: baseStep + offset };
    }
  }
  return { valid: false, matchedStep: null };
}

export function verifyTotpCode(secretBase32: string, candidate: string, window = 1): boolean {
  return verifyTotpCodeWithStep(secretBase32, candidate, window).valid;
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

const HEX_IV_RE = /^[0-9a-f]{24}$/i;
const HEX_TAG_RE = /^[0-9a-f]{32}$/i;
const HEX_EVEN_RE = /^[0-9a-f]{2,4096}$/i;

export function encryptSecret(
  plainText: string,
  uid: string,
  purpose: VaultKeyPurpose = 'default',
): string {
  const key = getVaultKey(uid, purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const prefix = purpose === 'default' ? 'v2:' : `v2:${purpose}:`;
  return `${prefix}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(
  cipherText: string,
  uid: string,
  expectedPurpose?: VaultKeyPurpose,
): string {
  const parts = cipherText.split(':');
  let ivHex = '';
  let tagHex = '';
  let encHex = '';
  let purpose: VaultKeyPurpose = 'default';

  if (parts.length === 5 && parts[0] === 'v2' && (parts[1] === 'totp' || parts[1] === 'exchange' || parts[1] === 'default')) {
    purpose = parts[1];
    [, , ivHex, tagHex, encHex] = parts;
    if (expectedPurpose && purpose !== expectedPurpose) {
      throw new Error('Encrypted secret purpose mismatch');
    }
  } else if (parts.length === 4 && parts[0] === 'v2') {
    purpose = expectedPurpose ?? 'default';
    [, ivHex, tagHex, encHex] = parts;
  } else if (parts.length === 3) {
    // Legacy v1 format without version prefix
    purpose = 'default';
    [ivHex, tagHex, encHex] = parts;
  } else {
    throw new Error('Invalid encrypted secret format');
  }

  if (!HEX_IV_RE.test(ivHex) || !HEX_TAG_RE.test(tagHex) || !HEX_EVEN_RE.test(encHex) || encHex.length % 2 !== 0) {
    throw new Error('Malformed encrypted secret payload');
  }

  const tryDecrypt = (keyPurpose: VaultKeyPurpose): string => {
    const key = getVaultKey(uid, keyPurpose);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  };

  try {
    return tryDecrypt(purpose);
  } catch (err) {
    if (purpose !== 'default' && parts.length <= 4) {
      return tryDecrypt('default');
    }
    throw err;
  }
}

/**
 * AES-256-GCM с криптографической привязкой контекста (AAD) и разделением ключей по назначению:
 * гарантирует, что зашифрованный ключ нельзя переиспользовать с другими правами,
 * биржей, режимом testnet/mainnet или другим UID — даже после перезапуска сервера.
 */
export function encryptSecretWithAad(
  plainText: string,
  uid: string,
  aadContext: string,
  purpose: VaultKeyPurpose = 'exchange',
): string {
  const key = getVaultKey(uid, purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aadContext, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v3:${purpose}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecretWithAad(
  cipherText: string,
  uid: string,
  expectedAadContext: string,
  expectedPurpose: VaultKeyPurpose = 'exchange',
): string {
  const parts = cipherText.split(':');
  let ivHex = '';
  let tagHex = '';
  let encHex = '';
  let purpose: VaultKeyPurpose = expectedPurpose;

  if (parts.length === 5 && parts[0] === 'v3' && (parts[1] === 'exchange' || parts[1] === 'totp' || parts[1] === 'default')) {
    purpose = parts[1];
    if (purpose !== expectedPurpose) {
      throw new Error('v3 encrypted secret purpose mismatch');
    }
    [, , ivHex, tagHex, encHex] = parts;
  } else if (parts.length === 4 && parts[0] === 'v3') {
    // Backward compatibility with earlier v3 format without explicit purpose segment
    purpose = 'default';
    [, ivHex, tagHex, encHex] = parts;
  } else {
    throw new Error('Invalid v3 encrypted secret format');
  }

  if (!HEX_IV_RE.test(ivHex) || !HEX_TAG_RE.test(tagHex) || !HEX_EVEN_RE.test(encHex) || encHex.length % 2 !== 0) {
    throw new Error('Malformed v3 encrypted secret payload');
  }

  const key = getVaultKey(uid, purpose);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAAD(Buffer.from(expectedAadContext, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function hashBackupCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHmac('sha256', getBackupCodePepper()).update(normalized).digest('hex');
}

export function hashLegacyBackupCodeSha256(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function matchBackupCodeHash(code: string, storedHashes: string[]): string | null {
  if (!Array.isArray(storedHashes) || storedHashes.length === 0) return null;
  const hmacCandidate = Buffer.from(hashBackupCode(code), 'hex');
  const legacyCandidate = Buffer.from(hashLegacyBackupCodeSha256(code), 'hex');

  for (const h of storedHashes) {
    if (typeof h !== 'string' || !/^[0-9a-f]{64}$/i.test(h)) continue;
    const storedBuf = Buffer.from(h, 'hex');
    if (storedBuf.length === hmacCandidate.length && crypto.timingSafeEqual(storedBuf, hmacCandidate)) {
      return h;
    }
    if (storedBuf.length === legacyCandidate.length && crypto.timingSafeEqual(storedBuf, legacyCandidate)) {
      return h;
    }
  }
  return null;
}

export function generateBackupCodes(count = 8): { plaintext: string[]; hashes: string[] } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const plaintext: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 символов из 32-символьного алфавита = 50 бит энтропии
    const bytes = crypto.randomBytes(10);
    let raw = '';
    for (let j = 0; j < 10; j++) {
      raw += chars[bytes[j] % chars.length];
    }
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plaintext.push(formatted);
    hashes.push(hashBackupCode(formatted));
  }
  return { plaintext, hashes };
}

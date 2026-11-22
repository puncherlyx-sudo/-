import crypto from 'crypto';
import type {
  ExchangeAssetBalance,
  ExchangeId,
  ExchangeKeyPermissions,
  ExchangeOrderResult,
  ExchangeSyncResult,
  MarketType,
} from '../src/types/domain.ts';
import { getMarketOverview } from './market.ts';
import {
  decryptSecret,
  decryptSecretWithAad,
  encryptSecretWithAad,
} from './security.ts';

const STABLE_COINS = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'USDE']);

export interface ExchangeApiErrorDetails {
  httpStatus?: number;
  endpoint?: string;
  rawResponse?: string;
}

function sanitizeRawExchangeResponse(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  let serialized = '';
  try {
    serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch {
    serialized = String(data);
  }
  const trimmed = serialized.trim();
  if (!trimmed) return undefined;
  return trimmed
    .replace(
      /((?:api[_-]?key|api[_-]?secret|secret|passphrase|signature|token|authorization|x-mbx-apikey|x-bapi-api-key|ok-access-key|ok-access-passphrase|ok-access-sign)["']?\s*[:=]\s*["']?)([^"',\s}\n]+)/gi,
      '$1[скрыто]'
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[скрыто]')
    .slice(0, 1600);
}

export class ExchangeApiError extends Error {
  statusCode: number;
  httpStatus?: number;
  endpoint?: string;
  rawResponse?: string;

  constructor(message: string, statusCode = 400, details?: ExchangeApiErrorDetails) {
    super(message);
    this.statusCode = statusCode;
    this.httpStatus = details?.httpStatus;
    this.endpoint = details?.endpoint;
    this.rawResponse = details?.rawResponse;
  }
}

export function isValidExchangeId(val: unknown): val is ExchangeId {
  return val === 'binance' || val === 'bybit' || val === 'okx';
}

export function isValidPermissions(val: unknown): val is ExchangeKeyPermissions {
  return val === 'read_only' || val === 'trade';
}

export function maskApiKey(apiKey: string): string {
  const clean = apiKey.trim();
  if (clean.length <= 8) return `${clean.slice(0, 2)}••••${clean.slice(-2)}`;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { rawText: text.slice(0, 240) };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const safeEndpoint = (() => {
      try {
        const parsed = new URL(url);
        return `${init.method || 'GET'} ${parsed.origin}${parsed.pathname}`;
      } catch {
        return undefined;
      }
    })();
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ExchangeApiError('Превышено время ожидания ответа от API биржи.', 504, {
        httpStatus: 504,
        endpoint: safeEndpoint,
        rawResponse: JSON.stringify({ error: 'AbortError', timeoutMs }, null, 2),
      });
    }
    throw new ExchangeApiError(
      err instanceof Error ? `Сетевая ошибка при обращении к бирже: ${err.message}` : 'Сетевая ошибка биржи',
      502,
      {
        httpStatus: 502,
        endpoint: safeEndpoint,
        rawResponse: sanitizeRawExchangeResponse({
          error: err instanceof Error ? err.name : 'NetworkError',
          message: err instanceof Error ? err.message : String(err),
        }),
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

function formatOrderQty(num: number): string {
  if (!Number.isFinite(num) || num <= 0) return '0';
  return Number(num.toFixed(6)).toString();
}

function toOkxInstId(symbol: string, marketType: MarketType): string {
  const upper = symbol.toUpperCase();
  const base = upper.endsWith('USDT') ? upper.slice(0, -4) : upper;
  return marketType === 'futures' ? `${base}-USDT-SWAP` : `${base}-USDT`;
}

async function getSpotPriceMap(): Promise<Map<string, number>> {
  const tickers = await getMarketOverview('spot');
  const map = new Map<string, number>();
  for (const t of tickers) {
    map.set(t.baseAsset.toUpperCase(), t.price);
    map.set(t.symbol.toUpperCase(), t.price);
  }
  for (const stable of STABLE_COINS) {
    map.set(stable, 1);
  }
  return map;
}

function translateBinanceError(code: unknown, msg: unknown): string {
  const num = Number(code);
  const text = typeof msg === 'string' ? msg : '';
  if (num === -2015) {
    return 'Binance отклонил ключ (-2015): проверьте API Key, включите право Read/Spot и проверьте IP-ограничения.';
  }
  if (num === -1022) {
    return 'Неверная подпись API Secret для Binance (-1022). Проверьте секретный ключ.';
  }
  if (num === -1021) {
    return 'Рассинхронизация времени с сервером Binance (-1021). Повторите попытку.';
  }
  if (num === -2010) {
    return `Ордер отклонён Binance: ${text || 'недостаточно средств или нарушен фильтр лота'}`;
  }
  return text ? `Ошибка Binance API (${num || 'API'}): ${text}` : 'Ошибка запроса к Binance API.';
}

async function fetchBinanceBalances(
  apiKey: string,
  apiSecret: string,
  testnet: boolean
): Promise<ExchangeSyncResult> {
  const bases = testnet
    ? ['https://testnet.binance.vision']
    : ['https://api.binance.com', 'https://api1.binance.com', 'https://api3.binance.com'];

  const qs = `timestamp=${Date.now()}&recvWindow=10000`;
  const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');

  let lastError: string | null = null;
  let lastErrorDetails: ExchangeApiErrorDetails | undefined;
  let accountPayload: { balances?: Array<{ asset: string; free: string; locked: string }>; accountType?: string } | null = null;

  for (const base of bases) {
    const endpointLabel = `GET ${base}/api/v3/account`;
    try {
      const { ok, status, data } = await fetchJsonWithTimeout(
        `${base}/api/v3/account?${qs}&signature=${sig}`,
        {
          method: 'GET',
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );
      const record = (data ?? {}) as Record<string, unknown>;
      if (!ok || typeof record.code === 'number') {
        lastError = translateBinanceError(record.code, record.msg);
        lastErrorDetails = {
          httpStatus: status,
          endpoint: endpointLabel,
          rawResponse: sanitizeRawExchangeResponse(record),
        };
        // Auth/signature errors shouldn't retry other mirrors
        if (record.code === -2015 || record.code === -1022 || record.code === -2014) {
          throw new ExchangeApiError(lastError, 400, lastErrorDetails);
        }
        continue;
      }
      accountPayload = record as {
        balances?: Array<{ asset: string; free: string; locked: string }>;
        accountType?: string;
      };
      break;
    } catch (err) {
      if (err instanceof ExchangeApiError && err.statusCode === 400) throw err;
      if (err instanceof ExchangeApiError) {
        lastError = err.message;
        lastErrorDetails = {
          httpStatus: err.httpStatus ?? err.statusCode,
          endpoint: err.endpoint ?? endpointLabel,
          rawResponse: err.rawResponse,
        };
      } else {
        lastError = err instanceof Error ? err.message : 'Сбой подключения к Binance';
        lastErrorDetails = {
          httpStatus: 502,
          endpoint: endpointLabel,
          rawResponse: sanitizeRawExchangeResponse({ message: lastError }),
        };
      }
    }
  }

  if (!accountPayload) {
    throw new ExchangeApiError(lastError || 'Не удалось получить баланс с Binance.', 502, lastErrorDetails);
  }

  const priceMap = await getSpotPriceMap();
  const assets: ExchangeAssetBalance[] = [];

  for (const b of accountPayload.balances || []) {
    const asset = String(b.asset || '').toUpperCase();
    const free = Number(b.free || 0);
    const locked = Number(b.locked || 0);
    const total = free + locked;
    if (!asset || !Number.isFinite(total) || total <= 1e-7) continue;

    const priceUsdt = STABLE_COINS.has(asset) ? 1 : (priceMap.get(asset) ?? 0);
    const valueUsdt = Number((total * priceUsdt).toFixed(2));
    if (priceUsdt === 0 && total < 0.0001) continue;

    assets.push({
      asset,
      symbol: STABLE_COINS.has(asset) ? `${asset}USDT` : `${asset}USDT`,
      free,
      locked,
      total,
      priceUsdt,
      valueUsdt,
    });
  }

  assets.sort((a, b) => b.valueUsdt - a.valueUsdt);
  const totalBalanceUsdt = Number(
    assets.reduce((acc, a) => acc + a.valueUsdt, 0).toFixed(2)
  );

  return {
    exchange: 'binance',
    testnet,
    totalBalanceUsdt,
    assets: assets.slice(0, 40),
    syncedAt: new Date().toISOString(),
    accountType: accountPayload.accountType || 'SPOT',
  };
}

async function fetchBybitBalances(
  apiKey: string,
  apiSecret: string,
  testnet: boolean
): Promise<ExchangeSyncResult> {
  const host = testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  const recvWindow = '10000';

  const queryBalances = async (accountType: 'UNIFIED' | 'SPOT') => {
    const ts = String(Date.now());
    const query = `accountType=${accountType}`;
    const signPayload = `${ts}${apiKey}${recvWindow}${query}`;
    const sign = crypto.createHmac('sha256', apiSecret).update(signPayload).digest('hex');

    const { ok, status, data } = await fetchJsonWithTimeout(`${host}/v5/account/wallet-balance?${query}`, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
    });
    return {
      ok,
      status,
      endpoint: `GET ${host}/v5/account/wallet-balance?${query}`,
      data: (data ?? {}) as Record<string, unknown>,
    };
  };

  let resp = await queryBalances('UNIFIED');
  if (resp.data.retCode !== 0) {
    // Fallback for classic SPOT accounts
    const spotTry = await queryBalances('SPOT');
    if (spotTry.ok && spotTry.data.retCode === 0) {
      resp = spotTry;
    }
  }

  if (!resp.ok || resp.data.retCode !== 0) {
    const retMsg = typeof resp.data.retMsg === 'string' ? resp.data.retMsg : 'Неверный ключ или права Bybit API';
    throw new ExchangeApiError(
      `Ошибка Bybit API (${String(resp.data.retCode ?? 'ERR')}): ${retMsg}`,
      400,
      {
        httpStatus: resp.status,
        endpoint: resp.endpoint,
        rawResponse: sanitizeRawExchangeResponse(resp.data),
      }
    );
  }

  const priceMap = await getSpotPriceMap();
  const list = ((resp.data.result as { list?: Array<Record<string, unknown>> } | undefined)?.list || [])[0];
  const coins = (list?.coin as Array<Record<string, unknown>> | undefined) || [];
  const assets: ExchangeAssetBalance[] = [];

  for (const c of coins) {
    const asset = String(c.coin || '').toUpperCase();
    const total = Number(c.walletBalance ?? c.equity ?? 0);
    const locked = Number(c.locked ?? 0);
    const free = Math.max(0, total - locked);
    if (!asset || !Number.isFinite(total) || total <= 1e-7) continue;

    const exchangeUsd = Number(c.usdValue ?? 0);
    const fallbackPrice = STABLE_COINS.has(asset) ? 1 : (priceMap.get(asset) ?? 0);
    const priceUsdt =
      exchangeUsd > 0 && total > 0 ? exchangeUsd / total : fallbackPrice;
    const valueUsdt = Number((exchangeUsd > 0 ? exchangeUsd : total * priceUsdt).toFixed(2));

    assets.push({
      asset,
      symbol: `${asset}USDT`,
      free,
      locked,
      total,
      priceUsdt,
      valueUsdt,
    });
  }

  assets.sort((a, b) => b.valueUsdt - a.valueUsdt);
  const walletTotalUsd = Number(list?.totalEquity ?? list?.totalWalletBalance ?? 0);
  const sumAssets = assets.reduce((acc, a) => acc + a.valueUsdt, 0);
  const totalBalanceUsdt = Number((walletTotalUsd > 0 ? walletTotalUsd : sumAssets).toFixed(2));

  return {
    exchange: 'bybit',
    testnet,
    totalBalanceUsdt,
    assets: assets.slice(0, 40),
    syncedAt: new Date().toISOString(),
    accountType: String(list?.accountType || 'UNIFIED'),
  };
}

async function fetchOkxBalances(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  testnet: boolean
): Promise<ExchangeSyncResult> {
  if (!passphrase) {
    throw new ExchangeApiError('Для подключения OKX API требуется указать Passphrase.', 400);
  }
  const requestPath = '/api/v5/account/balance';
  const ts = new Date().toISOString();
  const sign = crypto
    .createHmac('sha256', apiSecret)
    .update(`${ts}GET${requestPath}`)
    .digest('base64');

  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': passphrase,
  };
  if (testnet) headers['x-simulated-trading'] = '1';

  const { ok, status, data } = await fetchJsonWithTimeout(`https://www.okx.com${requestPath}`, {
    method: 'GET',
    headers,
  });

  const payload = (data ?? {}) as Record<string, unknown>;
  if (!ok || payload.code !== '0') {
    const msg = typeof payload.msg === 'string' ? payload.msg : 'Проверьте ключи и Passphrase OKX API';
    throw new ExchangeApiError(`Ошибка OKX API (${String(payload.code ?? 'ERR')}): ${msg}`, 400, {
      httpStatus: status,
      endpoint: `GET https://www.okx.com${requestPath}`,
      rawResponse: sanitizeRawExchangeResponse(payload),
    });
  }

  const priceMap = await getSpotPriceMap();
  const account = ((payload.data as Array<Record<string, unknown>> | undefined) || [])[0] || {};
  const details = (account.details as Array<Record<string, unknown>> | undefined) || [];
  const assets: ExchangeAssetBalance[] = [];

  for (const d of details) {
    const asset = String(d.ccy || '').toUpperCase();
    const total = Number(d.eq ?? d.cashBal ?? 0);
    const free = Number(d.availBal ?? d.availEq ?? total);
    const locked = Number(d.frozenBal ?? Math.max(0, total - free));
    if (!asset || !Number.isFinite(total) || total <= 1e-7) continue;

    const eqUsd = Number(d.eqUsd ?? 0);
    const fallbackPrice = STABLE_COINS.has(asset) ? 1 : (priceMap.get(asset) ?? 0);
    const priceUsdt = eqUsd > 0 && total > 0 ? eqUsd / total : fallbackPrice;
    const valueUsdt = Number((eqUsd > 0 ? eqUsd : total * priceUsdt).toFixed(2));

    assets.push({
      asset,
      symbol: `${asset}USDT`,
      free,
      locked,
      total,
      priceUsdt,
      valueUsdt,
    });
  }

  assets.sort((a, b) => b.valueUsdt - a.valueUsdt);
  const totalEq = Number(account.totalEq ?? 0);
  const sumAssets = assets.reduce((acc, a) => acc + a.valueUsdt, 0);
  const totalBalanceUsdt = Number((totalEq > 0 ? totalEq : sumAssets).toFixed(2));

  return {
    exchange: 'okx',
    testnet,
    totalBalanceUsdt,
    assets: assets.slice(0, 40),
    syncedAt: new Date().toISOString(),
    accountType: 'OKX_V5',
  };
}

export const MAX_TESTNET_ORDER_USDT = (() => {
  const configured = Number(process.env.MAX_TESTNET_ORDER_USDT);
  if (Number.isFinite(configured) && configured >= 10 && configured <= 25_000) {
    return Math.floor(configured);
  }
  return 5_000;
})();

export const REQUIRED_ORDER_CONFIRM_STATEMENT = 'VERNIER_API_ORDER_CONFIRMED';

interface VerifiedKeyRecord {
  uid: string;
  exchange: ExchangeId;
  permissions: ExchangeKeyPermissions;
  testnet: boolean;
  registeredAt: number;
}

// Серверный реестр прав ключей (клиентское поле permissions при исполнении ордера НЕ принимается).
const MAX_VERIFIED_KEY_REGISTRY = 2_000;
const serverVerifiedKeyRegistry = new Map<string, VerifiedKeyRecord>();

function computeKeyRegistryId(uid: string, encryptedApiKey: string): string {
  return crypto.createHash('sha256').update(`${uid}:${encryptedApiKey}`).digest('hex');
}

function buildExchangeKeyAad(
  uid: string,
  exchange: ExchangeId,
  testnet: boolean,
  permissions: ExchangeKeyPermissions,
): string {
  return `vernier:exch:v3:${uid}:${exchange}:${testnet ? 'testnet' : 'mainnet'}:${permissions}`;
}

function setVerifiedKeyRecord(id: string, record: VerifiedKeyRecord): void {
  if (serverVerifiedKeyRegistry.size >= MAX_VERIFIED_KEY_REGISTRY) {
    const oldestKey = serverVerifiedKeyRegistry.keys().next().value;
    if (oldestKey) serverVerifiedKeyRegistry.delete(oldestKey);
  }
  serverVerifiedKeyRegistry.set(id, record);
}

function decryptExchangeSecretForSync(
  cipherText: string,
  uid: string,
  exchange: ExchangeId,
  testnet: boolean,
): string {
  if (cipherText.startsWith('v3:')) {
    try {
      return decryptSecretWithAad(cipherText, uid, buildExchangeKeyAad(uid, exchange, testnet, 'read_only'));
    } catch {
      return decryptSecretWithAad(cipherText, uid, buildExchangeKeyAad(uid, exchange, testnet, 'trade'));
    }
  }
  return decryptSecret(cipherText, uid);
}

export async function connectAndEncryptExchange(params: {
  uid: string;
  exchange: ExchangeId;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  permissions: ExchangeKeyPermissions;
  testnet: boolean;
}): Promise<{
  apiKeyPreview: string;
  encryptedApiKey: string;
  encryptedApiSecret: string;
  encryptedPassphrase: string;
  effectivePermissions: ExchangeKeyPermissions;
  sync: ExchangeSyncResult;
}> {
  const apiKey = params.apiKey.trim();
  const apiSecret = params.apiSecret.trim();
  const passphrase = (params.passphrase || '').trim();

  if (apiKey.length < 10 || apiKey.length > 160) {
    throw new ExchangeApiError('Некорректная длина API Key (ожидается от 10 символов).', 400);
  }
  if (apiSecret.length < 10 || apiSecret.length > 200) {
    throw new ExchangeApiError('Некорректная длина API Secret (ожидается от 10 символов).', 400);
  }

  // На живых аккаунтах (не Testnet) сервер принудительно ограничивает права до Read-Only.
  const effectivePermissions: ExchangeKeyPermissions =
    params.testnet && params.permissions === 'trade' ? 'trade' : 'read_only';

  let sync: ExchangeSyncResult;
  if (params.exchange === 'binance') {
    sync = await fetchBinanceBalances(apiKey, apiSecret, params.testnet);
  } else if (params.exchange === 'bybit') {
    sync = await fetchBybitBalances(apiKey, apiSecret, params.testnet);
  } else {
    sync = await fetchOkxBalances(apiKey, apiSecret, passphrase, params.testnet);
  }

  const aadContext = buildExchangeKeyAad(params.uid, params.exchange, params.testnet, effectivePermissions);
  const encryptedApiKey = encryptSecretWithAad(apiKey, params.uid, aadContext);
  const encryptedApiSecret = encryptSecretWithAad(apiSecret, params.uid, aadContext);
  const encryptedPassphrase = passphrase ? encryptSecretWithAad(passphrase, params.uid, aadContext) : '';

  setVerifiedKeyRecord(computeKeyRegistryId(params.uid, encryptedApiKey), {
    uid: params.uid,
    exchange: params.exchange,
    permissions: effectivePermissions,
    testnet: params.testnet,
    registeredAt: Date.now(),
  });

  return {
    apiKeyPreview: maskApiKey(apiKey),
    encryptedApiKey,
    encryptedApiSecret,
    encryptedPassphrase,
    effectivePermissions,
    sync,
  };
}

export async function syncEncryptedExchangeBalances(params: {
  uid: string;
  exchange: ExchangeId;
  encryptedApiKey: string;
  encryptedApiSecret: string;
  encryptedPassphrase?: string;
  testnet: boolean;
}): Promise<ExchangeSyncResult> {
  let apiKey = '';
  let apiSecret = '';
  let passphrase = '';
  try {
    apiKey = decryptExchangeSecretForSync(params.encryptedApiKey, params.uid, params.exchange, params.testnet);
    apiSecret = decryptExchangeSecretForSync(params.encryptedApiSecret, params.uid, params.exchange, params.testnet);
    passphrase = params.encryptedPassphrase
      ? decryptExchangeSecretForSync(params.encryptedPassphrase, params.uid, params.exchange, params.testnet)
      : '';
  } catch {
    throw new ExchangeApiError('Не удалось расшифровать API-ключи. Переподключите биржу.', 400);
  }

  if (params.exchange === 'binance') {
    return fetchBinanceBalances(apiKey, apiSecret, params.testnet);
  }
  if (params.exchange === 'bybit') {
    return fetchBybitBalances(apiKey, apiSecret, params.testnet);
  }
  return fetchOkxBalances(apiKey, apiSecret, passphrase, params.testnet);
}

export async function executeEncryptedExchangeOrder(params: {
  uid: string;
  exchange: ExchangeId;
  encryptedApiKey: string;
  encryptedApiSecret: string;
  encryptedPassphrase?: string;
  testnet: boolean;
  confirmResponsibility: boolean;
  confirmStatement: string;
  symbol: string;
  marketType: MarketType;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}): Promise<ExchangeOrderResult> {
  // 1. Жёсткий серверный запрет на исполнение реальных (Live) ордеров
  if (!params.testnet) {
    throw new ExchangeApiError(
      'Исполнение реальных ордеров (Live Trade) отключено на уровне сервера. Доступны только режимы Read-Only и Testnet.',
      403
    );
  }

  // 2. Обязательное серверное подтверждение ответственности пользователя
  if (
    params.confirmResponsibility !== true ||
    params.confirmStatement !== REQUIRED_ORDER_CONFIRM_STATEMENT
  ) {
    throw new ExchangeApiError(
      'Необходимо подтвердить персональную финансовую ответственность перед отправкой ордера.',
      400
    );
  }

  // 3. Криптографическая проверка прав ключа (fail-closed даже после перезапуска сервера)
  const isV3Key = params.encryptedApiKey.startsWith('v3:') && params.encryptedApiSecret.startsWith('v3:');
  const keyRecord = serverVerifiedKeyRegistry.get(
    computeKeyRegistryId(params.uid, params.encryptedApiKey),
  );
  if (keyRecord) {
    if (keyRecord.uid !== params.uid || keyRecord.exchange !== params.exchange) {
      throw new ExchangeApiError('Несоответствие владельца или биржи для API-ключа.', 403);
    }
    if (!keyRecord.testnet || keyRecord.permissions !== 'trade') {
      throw new ExchangeApiError(
        'Ключ зарегистрирован в режиме Read-Only. Отправка ордеров запрещена на сервере.',
        403
      );
    }
  } else if (!isV3Key) {
    throw new ExchangeApiError(
      'Права этого ключа не подтверждены сервером после обновления сессии. Переподключите Testnet API-ключ.',
      403
    );
  }

  const symbol = params.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
    throw new ExchangeApiError('Некорректный тикер торговой пары.', 400);
  }
  if (!Number.isFinite(params.quantity) || params.quantity <= 0 || params.quantity > 100_000) {
    throw new ExchangeApiError('Укажите корректное количество (> 0 и ≤ 100 000) для ордера.', 400);
  }
  if (
    params.orderType === 'LIMIT' &&
    (!Number.isFinite(params.limitPrice) || (params.limitPrice ?? 0) <= 0 || (params.limitPrice ?? 0) > 10_000_000)
  ) {
    throw new ExchangeApiError('Для лимитного ордера укажите корректную цену (> 0).', 400);
  }

  // 4. Серверный лимит максимального объёма ордера и проверка непротиворечивости SL/TP (строго fail-closed)
  const priceMap = await getSpotPriceMap();
  const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const referencePrice =
    params.orderType === 'LIMIT' && params.limitPrice
      ? params.limitPrice
      : (priceMap.get(symbol) ?? priceMap.get(baseAsset) ?? 0);

  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new ExchangeApiError(
      `Не удалось получить актуальную рыночную цену для ${symbol}, чтобы проверить серверный лимит Testnet-ордера ($${MAX_TESTNET_ORDER_USDT} USDT). Повторите запрос или укажите LIMIT-цену.`,
      503
    );
  }

  const estimatedNotional = params.quantity * referencePrice;
  if (!Number.isFinite(estimatedNotional) || estimatedNotional > MAX_TESTNET_ORDER_USDT) {
    throw new ExchangeApiError(
      `Превышен серверный лимит Testnet-ордера: $${estimatedNotional.toFixed(2)} > $${MAX_TESTNET_ORDER_USDT} USDT.`,
      400
    );
  }
  if (params.stopLoss !== undefined && params.stopLoss > 0) {
    if (params.side === 'BUY' && params.stopLoss >= referencePrice) {
      throw new ExchangeApiError('Для LONG/BUY ордера Stop-Loss должен быть строго ниже цены входа.', 400);
    }
    if (params.side === 'SELL' && params.stopLoss <= referencePrice) {
      throw new ExchangeApiError('Для SHORT/SELL ордера Stop-Loss должен быть строго выше цены входа.', 400);
    }
  }
  if (params.takeProfit !== undefined && params.takeProfit > 0) {
    if (params.side === 'BUY' && params.takeProfit <= referencePrice) {
      throw new ExchangeApiError('Для LONG/BUY ордера Take-Profit должен быть строго выше цены входа.', 400);
    }
    if (params.side === 'SELL' && params.takeProfit >= referencePrice) {
      throw new ExchangeApiError('Для SHORT/SELL ордера Take-Profit должен быть строго ниже цены входа.', 400);
    }
  }

  let apiKey = '';
  let apiSecret = '';
  let passphrase = '';
  try {
    if (isV3Key) {
      const requiredTradeAad = buildExchangeKeyAad(params.uid, params.exchange, true, 'trade');
      apiKey = decryptSecretWithAad(params.encryptedApiKey, params.uid, requiredTradeAad);
      apiSecret = decryptSecretWithAad(params.encryptedApiSecret, params.uid, requiredTradeAad);
      passphrase = params.encryptedPassphrase
        ? decryptSecretWithAad(params.encryptedPassphrase, params.uid, requiredTradeAad)
        : '';
    } else {
      apiKey = decryptSecret(params.encryptedApiKey, params.uid);
      apiSecret = decryptSecret(params.encryptedApiSecret, params.uid);
      passphrase = params.encryptedPassphrase
        ? decryptSecret(params.encryptedPassphrase, params.uid)
        : '';
    }
  } catch {
    throw new ExchangeApiError(
      'Ключ зарегистрирован только для чтения (Read-Only) или не соответствует параметрам Testnet.',
      403
    );
  }

  const qtyStr = formatOrderQty(params.quantity);

  if (params.exchange === 'binance') {
    const baseUrl =
      params.marketType === 'futures'
        ? params.testnet
          ? 'https://testnet.binancefuture.com/fapi/v1/order'
          : 'https://fapi.binance.com/fapi/v1/order'
        : params.testnet
          ? 'https://testnet.binance.vision/api/v3/order'
          : 'https://api.binance.com/api/v3/order';

    const search = new URLSearchParams({
      symbol,
      side: params.side,
      type: params.orderType,
      quantity: qtyStr,
      timestamp: String(Date.now()),
      recvWindow: '10000',
    });
    if (params.orderType === 'LIMIT' && params.limitPrice) {
      search.set('timeInForce', 'GTC');
      search.set('price', String(params.limitPrice));
    }
    const sig = crypto.createHmac('sha256', apiSecret).update(search.toString()).digest('hex');
    search.set('signature', sig);

    const { ok, data } = await fetchJsonWithTimeout(`${baseUrl}?${search.toString()}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    });

    const record = (data ?? {}) as Record<string, unknown>;
    if (!ok || typeof record.code === 'number') {
      throw new ExchangeApiError(translateBinanceError(record.code, record.msg), 400);
    }

    return {
      exchange: 'binance',
      orderId: String(record.orderId ?? ''),
      symbol,
      marketType: params.marketType,
      side: params.side,
      orderType: params.orderType,
      status: String(record.status ?? 'SUBMITTED'),
      executedQty: Number(record.executedQty ?? qtyStr),
      price: Number(record.price || params.limitPrice || 0),
      testnet: params.testnet,
      submittedAt: new Date().toISOString(),
    };
  }

  if (params.exchange === 'bybit') {
    const host = params.testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
    const ts = String(Date.now());
    const recvWindow = '10000';
    const bodyObj: Record<string, unknown> = {
      category: params.marketType === 'futures' ? 'linear' : 'spot',
      symbol,
      side: params.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: params.orderType === 'LIMIT' ? 'Limit' : 'Market',
      qty: qtyStr,
    };
    if (params.orderType === 'LIMIT' && params.limitPrice) {
      bodyObj.price = String(params.limitPrice);
    }
    if (params.stopLoss && params.stopLoss > 0) {
      bodyObj.stopLoss = String(params.stopLoss);
    }
    if (params.takeProfit && params.takeProfit > 0) {
      bodyObj.takeProfit = String(params.takeProfit);
    }

    const bodyJson = JSON.stringify(bodyObj);
    const sign = crypto
      .createHmac('sha256', apiSecret)
      .update(`${ts}${apiKey}${recvWindow}${bodyJson}`)
      .digest('hex');

    const { ok, data } = await fetchJsonWithTimeout(`${host}/v5/order/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body: bodyJson,
    });

    const record = (data ?? {}) as Record<string, unknown>;
    if (!ok || record.retCode !== 0) {
      const msg = typeof record.retMsg === 'string' ? record.retMsg : 'Bybit отклонил ордер';
      throw new ExchangeApiError(`Ошибка ордера Bybit (${String(record.retCode ?? 'ERR')}): ${msg}`, 400);
    }

    const result = (record.result ?? {}) as Record<string, unknown>;
    return {
      exchange: 'bybit',
      orderId: String(result.orderId ?? ''),
      symbol,
      marketType: params.marketType,
      side: params.side,
      orderType: params.orderType,
      status: 'SUBMITTED',
      executedQty: Number(qtyStr),
      price: Number(params.limitPrice || 0),
      testnet: params.testnet,
      submittedAt: new Date().toISOString(),
    };
  }

  // OKX V5
  if (!passphrase) {
    throw new ExchangeApiError('Для отправки ордеров на OKX требуется Passphrase.', 400);
  }
  const requestPath = '/api/v5/trade/order';
  const ts = new Date().toISOString();
  const bodyObj: Record<string, unknown> = {
    instId: toOkxInstId(symbol, params.marketType),
    tdMode: params.marketType === 'futures' ? 'cross' : 'cash',
    side: params.side.toLowerCase(),
    ordType: params.orderType.toLowerCase(),
    sz: qtyStr,
  };
  if (params.orderType === 'LIMIT' && params.limitPrice) {
    bodyObj.px = String(params.limitPrice);
  }

  const bodyJson = JSON.stringify(bodyObj);
  const sign = crypto
    .createHmac('sha256', apiSecret)
    .update(`${ts}POST${requestPath}${bodyJson}`)
    .digest('base64');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': passphrase,
  };
  if (params.testnet) headers['x-simulated-trading'] = '1';

  const { ok, data } = await fetchJsonWithTimeout(`https://www.okx.com${requestPath}`, {
    method: 'POST',
    headers,
    body: bodyJson,
  });

  const payload = (data ?? {}) as Record<string, unknown>;
  const orderItem = ((payload.data as Array<Record<string, unknown>> | undefined) || [])[0];
  if (!ok || payload.code !== '0' || (orderItem && orderItem.sCode && orderItem.sCode !== '0')) {
    const errMsg =
      (orderItem && typeof orderItem.sMsg === 'string' && orderItem.sMsg) ||
      (typeof payload.msg === 'string' && payload.msg) ||
      'OKX отклонил ордер';
    throw new ExchangeApiError(`Ошибка ордера OKX: ${errMsg}`, 400);
  }

  return {
    exchange: 'okx',
    orderId: String(orderItem?.ordId ?? ''),
    symbol,
    marketType: params.marketType,
    side: params.side,
    orderType: params.orderType,
    status: 'SUBMITTED',
    executedQty: Number(qtyStr),
    price: Number(params.limitPrice || 0),
    testnet: params.testnet,
    submittedAt: new Date().toISOString(),
  };
}

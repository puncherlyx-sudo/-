import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import { TRADING_PAIRS } from '../data/strategies';
import type { ExchangeSyncCacheMap } from '../lib/exchangeSyncCache';
import { triggerHaptic } from '../lib/securityDlp';
import { ApiFieldTooltip } from './ApiFieldTooltip';
import { ExchangeApiGuide } from './ExchangeApiGuide';
import { LegalDocumentModal, type LegalDocKind } from './LegalConsentModal';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';
import type {
  ExchangeAssetBalance,
  ExchangeId,
  ExchangeKeyPermissions,
  ExchangeKeyRecord,
  ExchangeOrderResult,
  ExchangeSyncResult,
  MarketType,
} from '../types/domain';

interface ExchangeIntegrationPanelProps {
  exchangeKeys: ExchangeKeyRecord[];
  exchangeSyncCache?: ExchangeSyncCacheMap;
  backgroundSyncingKeyIds?: string[];
  activePortfolioExchange?: ExchangeId;
  activePortfolioMode: 'manual' | 'exchange';
  onConnectExchange: (params: {
    exchange: ExchangeId;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
    permissions: ExchangeKeyPermissions;
    testnet: boolean;
  }) => Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }>;
  onSyncExchange: (key: ExchangeKeyRecord, applyToPortfolio: boolean) => Promise<ExchangeSyncResult>;
  onEditKey?: (key: ExchangeKeyRecord) => void;
  onToggleExchange: (keyId: string, nextEnabled: boolean) => Promise<void>;
  onDeleteExchange: (keyId: string) => Promise<void>;
  onPlaceOrder: (
    key: ExchangeKeyRecord,
    orderParams: {
      symbol: string;
      marketType: MarketType;
      side: 'BUY' | 'SELL';
      orderType: 'MARKET' | 'LIMIT';
      quantity: number;
      limitPrice?: number;
    }
  ) => Promise<ExchangeOrderResult>;
}

const EXCHANGE_META: Record<
  ExchangeId,
  { name: string; subtitle: string; badgeClass: string; placeholderLabel: string }
> = {
  binance: {
    name: 'Binance',
    subtitle: 'Spot & Futures · HMAC-SHA256',
    badgeClass: 'border-amber-500/35 bg-amber-500/12 text-amber-300',
    placeholderLabel: 'Binance Основной',
  },
  bybit: {
    name: 'Bybit',
    subtitle: 'Unified V5 Spot & Linear · HMAC-SHA256',
    badgeClass: 'border-cyan-500/35 bg-cyan-500/12 text-cyan-300',
    placeholderLabel: 'Bybit UTA',
  },
  okx: {
    name: 'OKX',
    subtitle: 'Account V5 Spot & Swap · API + Passphrase',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300',
    placeholderLabel: 'OKX Trading',
  },
};

function formatSyncTime(iso: string): string {
  if (!iso) return 'Ещё не синхронизирован';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ExchangeIntegrationPanel: React.FC<ExchangeIntegrationPanelProps> = ({
  exchangeKeys,
  exchangeSyncCache,
  backgroundSyncingKeyIds = [],
  activePortfolioExchange,
  activePortfolioMode,
  onConnectExchange,
  onSyncExchange,
  onEditKey,
  onToggleExchange,
  onDeleteExchange,
  onPlaceOrder,
}) => {
  const [showAddForm, setShowAddForm] = useState(exchangeKeys.length === 0);
  const [showApiGuide, setShowApiGuide] = useState(exchangeKeys.length === 0);
  const [exchange, setExchange] = useState<ExchangeId>('binance');
  const [label, setLabel] = useState('Binance Основной');
  const [permissions, setPermissions] = useState<ExchangeKeyPermissions>('read_only');
  const [testnet, setTestnet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [acceptedApiResponsibility, setAcceptedApiResponsibility] = useState(false);
  const [openLegalDoc, setOpenLegalDoc] = useState<LegalDocKind | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null);
  const [syncedAssetsByKey, setSyncedAssetsByKey] = useState<Record<string, ExchangeAssetBalance[]>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Quick Order Ticket State
  const [orderTicketKeyId, setOrderTicketKeyId] = useState<string | null>(null);
  const [orderSymbol, setOrderSymbol] = useState('BTCUSDT');
  const [orderMarketType, setOrderMarketType] = useState<MarketType>('spot');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [orderQty, setOrderQty] = useState('0.001');
  const [orderLimitPrice, setOrderLimitPrice] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const handleExchangePick = (nextEx: ExchangeId) => {
    setExchange(nextEx);
    setLabel(EXCHANGE_META[nextEx].placeholderLabel);
    setFormError(null);
  };

  const handlePasteField = async (target: 'apiKey' | 'apiSecret' | 'passphrase') => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setPasteNotice('Буфер обмена недоступен в этом браузере — вставьте ключ вручную.');
      return;
    }
    try {
      const raw = await navigator.clipboard.readText();
      const cleaned = target === 'passphrase' ? raw.trim() : raw.replace(/\s+/g, '');
      if (!cleaned) {
        setPasteNotice('Буфер обмена пуст.');
        return;
      }
      triggerHaptic(8);
      if (target === 'apiKey') setApiKey(cleaned);
      if (target === 'apiSecret') setApiSecret(cleaned);
      if (target === 'passphrase') setPassphrase(cleaned);
      const hadWhitespace = cleaned.length !== raw.length;
      setPasteNotice(
        hadWhitespace
          ? 'Вставлено из буфера (лишние пробелы и переносы строк удалены автоматически).'
          : 'Значение вставлено из буфера обмена.'
      );
      window.setTimeout(() => setPasteNotice(null), 3200);
    } catch {
      setPasteNotice('Разрешите доступ к буферу обмена или вставьте ключ долгим нажатием.');
    }
  };

  const duplicateKeySecretWarning =
    apiKey.trim().length > 6 && apiSecret.trim().length > 6 && apiKey.trim() === apiSecret.trim();

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusBanner(null);

    if (!apiKey.trim() || !apiSecret.trim()) {
      setFormError('Введите API Key и API Secret с вашей биржи.');
      return;
    }
    if (exchange === 'okx' && !passphrase.trim()) {
      setFormError('Для OKX необходимо указать Passphrase.');
      return;
    }
    if (!acceptedApiResponsibility) {
      setFormError(
        'Подтвердите добровольную передачу API-ключей, согласие с Политикой конфиденциальности, отключение Withdrawals и личную финансовую ответственность.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const { key, sync } = await onConnectExchange({
        exchange,
        label: label.trim() || EXCHANGE_META[exchange].placeholderLabel,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        passphrase: passphrase.trim(),
        permissions,
        testnet,
      });
      setSyncedAssetsByKey((prev) => ({ ...prev, [key.id]: sync.assets }));
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      setAcceptedApiResponsibility(false);
      setShowAddForm(false);
      setStatusBanner(
        `Биржа ${EXCHANGE_META[exchange].name} подключена и проверена. Текущий баланс: $${sync.totalBalanceUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${sync.assets.length} актив.).`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Не удалось подключить биржу.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncClick = async (key: ExchangeKeyRecord, applyToPortfolio: boolean) => {
    setSyncingKeyId(key.id);
    setFormError(null);
    setStatusBanner(null);
    try {
      const sync = await onSyncExchange(key, applyToPortfolio);
      setSyncedAssetsByKey((prev) => ({ ...prev, [key.id]: sync.assets }));
      setStatusBanner(
        applyToPortfolio
          ? `Портфель синхронизирован с ${EXCHANGE_META[key.exchange].name} (${key.label}): $${sync.totalBalanceUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : `Баланс ${EXCHANGE_META[key.exchange].name} обновлён: $${sync.totalBalanceUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка синхронизации баланса.');
    } finally {
      setSyncingKeyId(null);
    }
  };

  const handleOrderSubmit = async (e: React.FormEvent, key: ExchangeKeyRecord) => {
    e.preventDefault();
    setOrderFeedback(null);
    const qty = Number(orderQty);
    const limit = orderType === 'LIMIT' ? Number(orderLimitPrice) : undefined;
    if (!Number.isFinite(qty) || qty <= 0) {
      setOrderFeedback({ tone: 'err', text: 'Укажите количество больше 0.' });
      return;
    }
    if (orderType === 'LIMIT' && (!limit || !Number.isFinite(limit) || limit <= 0)) {
      setOrderFeedback({ tone: 'err', text: 'Укажите корректную лимитную цену.' });
      return;
    }

    setSubmittingOrder(true);
    try {
      const res = await onPlaceOrder(key, {
        symbol: orderSymbol,
        marketType: orderMarketType,
        side: orderSide,
        orderType,
        quantity: qty,
        limitPrice: limit,
      });
      setOrderFeedback({
        tone: 'ok',
        text: `Ордер отправлен на ${EXCHANGE_META[res.exchange].name} (#${res.orderId || 'OK'}) · ${res.side} ${res.executedQty} ${res.symbol} · ${res.status}`,
      });
    } catch (err) {
      setOrderFeedback({
        tone: 'err',
        text: err instanceof Error ? err.message : 'Ошибка отправки ордера.',
      });
    } finally {
      setSubmittingOrder(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Main Header + Vault Architecture Notice */}
      <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Интеграция сторонних бирж (API-ключи)</span>
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-2xl">
              Подключите Binance, Bybit или OKX для автоматической синхронизации реального баланса портфеля и исполнения ордеров по сигналам. Если вашей биржи нет в списке — стратегии, графики и Push-сигналы работают универсально без API-ключей.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setShowApiGuide((v) => !v);
              }}
              className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                showApiGuide
                  ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                  : 'border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>{showApiGuide ? 'Скрыть гайд' : 'Гайд по API'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setShowAddForm((v) => !v);
                setFormError(null);
              }}
              className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>{showAddForm ? 'Скрыть форму' : 'Добавить API-ключ'}</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3.5 flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 leading-relaxed space-y-1">
            <div>
              <strong className="text-amber-200">Строго Non-Custodial:</strong>{' '}
              VERNIER <strong>не принимает, не хранит и не оперирует деньгами клиентов напрямую</strong>. Вход в позицию выполняется только на вашей бирже через ваш API-ключ и исключительно с вашего явного подтверждения при каждом запуске. Ключи шифруются <span className="font-mono text-emerald-300">AES-256-GCM</span>.
            </div>
            <div className="text-[11px] text-slate-400">
              Обязательно: в кабинете биржи всегда <span className="text-rose-300 font-medium">отключайте право на вывод средств (Withdrawals)</span> — оставляйте только Read или Spot/Futures Trading. Вы самостоятельно несёте полную финансовую ответственность за все сделки.
            </div>
          </div>
        </div>

        {statusBanner && (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusBanner}</span>
          </div>
        )}

        {formError && (
          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Connect Exchange Form */}
        {showAddForm && (
          <form
            onSubmit={(e) => void handleConnectSubmit(e)}
            className="rounded-xl border border-white/10 bg-[#0B0F17] p-4 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['binance', 'bybit', 'okx'] as ExchangeId[]).map((exId) => {
                const meta = EXCHANGE_META[exId];
                const active = exchange === exId;
                return (
                  <button
                    key={exId}
                    type="button"
                    onClick={() => handleExchangePick(exId)}
                    className={`min-h-[54px] px-3.5 py-2.5 rounded-xl border text-left transition-colors ${
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/12 text-white'
                        : 'border-white/10 bg-[#111827] text-slate-300 hover:border-white/20'
                    }`}
                  >
                    <div className="text-xs font-bold">{meta.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{meta.subtitle}</div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Название профиля</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={64}
                  placeholder="Напр., Binance Основной"
                  className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#111827] px-3.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </label>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-300">Права ключа</span>
                  <ApiFieldTooltip
                    title="Почему нужен режим Read-Only?"
                    body="Для синхронизации реального баланса и портфеля достаточно прав «Только чтение» (Read-Only). VERNIER никогда не запрашивает права «Withdraw» (вывод средств) — деньги всегда остаются на вашем аккаунте биржи."
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#111827] border border-white/10">
                  <button
                    type="button"
                    onClick={() => setPermissions('read_only')}
                    className={`min-h-[34px] rounded-lg text-xs font-medium transition-colors ${
                      permissions === 'read_only'
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Только чтение
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermissions('trade')}
                    className={`min-h-[34px] rounded-lg text-xs font-medium transition-colors ${
                      permissions === 'trade'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Торговля (ордера)
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5">
                    <label htmlFor="ex-api-key-input" className="text-xs font-medium text-slate-300">
                      API Key
                    </label>
                    <ApiFieldTooltip
                      title="Публичный API Key"
                      body="Идентификатор подключения вашего аккаунта биржи. Сам по себе API Key не позволяет выводить средства или управлять деньгами; используйте ключ с отключённым правом Withdraw."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePasteField('apiKey')}
                    className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 transition-colors"
                  >
                    <ClipboardPaste className="w-3 h-3 shrink-0" />
                    <span>Вставить</span>
                  </button>
                </div>
                <input
                  id="ex-api-key-input"
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value.replace(/\s+/g, ''))}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Вставьте публичный API Key"
                  className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#111827] px-3.5 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5">
                    <label htmlFor="ex-api-secret-input" className="text-xs font-medium text-slate-300">
                      API Secret
                    </label>
                    <ApiFieldTooltip
                      title="Секретный ключ подписи (HMAC)"
                      body="Нужен бирже для криптографической подписи запроса баланса. В VERNIER шифруется по AES-256-GCM и никогда не имеет прав на вывод средств, если на бирже выключен пункт «Withdrawals»."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePasteField('apiSecret')}
                    className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 transition-colors"
                  >
                    <ClipboardPaste className="w-3 h-3 shrink-0" />
                    <span>Вставить</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="ex-api-secret-input"
                    type={showSecret ? 'text' : 'password'}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value.replace(/\s+/g, ''))}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder="Вставьте Secret Key"
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#111827] pl-3.5 pr-10 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    aria-label={showSecret ? 'Скрыть секрет' : 'Показать секрет'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {exchange === 'okx' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5">
                    <label htmlFor="ex-passphrase-input" className="text-xs font-medium text-slate-300">
                      Passphrase (обязательно для OKX)
                    </label>
                    <ApiFieldTooltip
                      title="Кодовая фраза OKX API V5"
                      body="Уникальная фраза, которую вы придумываете при создании API-ключа на OKX (не пароль от аккаунта). Нужна для проверки Read-Only подписи; вывод средств остаётся отключённым."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePasteField('passphrase')}
                    className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 transition-colors"
                  >
                    <ClipboardPaste className="w-3 h-3 shrink-0" />
                    <span>Вставить</span>
                  </button>
                </div>
                <input
                  id="ex-passphrase-input"
                  type={showSecret ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Кодовая фраза API OKX"
                  className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#111827] px-3.5 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            {pasteNotice && (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] text-cyan-200">
                {pasteNotice}
              </div>
            )}

            {duplicateKeySecretWarning && (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>API Key и API Secret совпадают — проверьте, что вы вставили два разных значения с биржи.</span>
              </div>
            )}

            <label className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 cursor-pointer text-xs text-slate-200 leading-relaxed">
              <input
                type="checkbox"
                checked={acceptedApiResponsibility}
                onChange={(e) => setAcceptedApiResponsibility(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
              />
              <span>
                Я подтверждаю, что самостоятельно и добровольно передаю API-ключи биржи, принимаю{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenLegalDoc('privacy');
                  }}
                  className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-medium"
                >
                  Политику конфиденциальности
                </button>{' '}
                и{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenLegalDoc('terms');
                  }}
                  className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-medium"
                >
                  Условия использования
                </button>
                , право вывода средств (Withdrawals) отключено, VERNIER не хранит и не управляет моими деньгами, а всю ответственность за операции я беру на себя (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenLegalDoc('disclaimer');
                  }}
                  className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  Отказ от ответственности
                </button>
                ).
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setTestnet((v) => !v)}
                aria-pressed={testnet}
                className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-2 transition-colors ${
                  testnet
                    ? 'border-cyan-500/40 bg-cyan-500/12 text-cyan-200'
                    : 'border-white/10 bg-[#111827] text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    testnet ? 'bg-cyan-400' : 'bg-slate-600'
                  }`}
                />
                <span>{testnet ? 'Режим Testnet / Demo включён' : 'Mainnet (реальный счёт)'}</span>
              </button>

              <button
                type="submit"
                disabled={submitting || !acceptedApiResponsibility}
                className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold text-white inline-flex items-center gap-2 transition-all"
              >
                <KeyRound className="w-4 h-4" />
                <span>{submitting ? 'Проверка подписи и баланса...' : 'Проверить ключ и подключить'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Detailed Step-by-Step Exchange API Connection Guide */}
        {showApiGuide && (
          <ExchangeApiGuide
            initialExchange={exchange}
            onSelectExchange={(nextEx) => {
              if (showAddForm) {
                handleExchangePick(nextEx);
              }
            }}
            onClose={() => setShowApiGuide(false)}
          />
        )}
      </div>

      {/* Connected Exchange Keys List */}
      <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-cyan-400" />
              <span>Подключённые биржи ({exchangeKeys.length})</span>
            </h3>
            {backgroundSyncingKeyIds.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-cyan-300">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Фоновое обновление...</span>
              </span>
            )}
          </div>
          {activePortfolioMode === 'exchange' && activePortfolioExchange && (
            <span className="text-[11px] font-medium text-emerald-300 bg-emerald-500/12 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
              Портфель синхронизирован с {EXCHANGE_META[activePortfolioExchange].name}
            </span>
          )}
        </div>

        {exchangeKeys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#0B0F17]/60 p-6 text-center space-y-2">
            <p className="text-xs text-slate-300 font-medium">
              Пока нет подключённых биржевых аккаунтов.
            </p>
            <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
              Добавьте API-ключ Binance, Bybit или OKX выше, чтобы автоматически подгружать баланс в портфель и открывать позиции прямо по сигналам терминала.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {exchangeKeys.map((item) => {
              const meta = EXCHANGE_META[item.exchange];
              const cachedEntry = exchangeSyncCache?.[item.id];
              const isManualSyncing = syncingKeyId === item.id;
              const isBackgroundSyncing = backgroundSyncingKeyIds.includes(item.id);
              const isSyncing = isManualSyncing;
              const hasFreshLocalAssets = Boolean(syncedAssetsByKey[item.id]);
              const syncedAssets = syncedAssetsByKey[item.id] ?? cachedEntry?.assets;
              const displayBalanceUsdt = cachedEntry
                ? cachedEntry.totalBalanceUsdt
                : Number(item.lastBalanceUsdt || 0);
              const displaySyncedAt = cachedEntry?.syncedAt || item.lastSyncedAt;
              const isTicketOpen = orderTicketKeyId === item.id;
              const isDeleting = confirmDeleteId === item.id;

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/10 bg-[#0B0F17] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${meta.badgeClass}`}
                        >
                          {meta.name}
                        </span>
                        <span className="text-sm font-semibold text-white truncate">
                          {item.label}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-md border ${
                            item.permissions === 'trade'
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                              : 'border-cyan-500/35 bg-cyan-500/10 text-cyan-300'
                          }`}
                        >
                          {item.permissions === 'trade' ? 'Торговля + Чтение' : 'Только чтение'}
                        </span>
                        {item.testnet && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md border border-slate-600 bg-slate-800 text-slate-300">
                            Testnet
                          </span>
                        )}
                        {!item.enabled && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md border border-amber-500/35 bg-amber-500/10 text-amber-300">
                            Пауза
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] font-mono tabular-nums text-slate-400 flex flex-wrap items-center gap-2">
                        <span>Ключ: {item.apiKeyPreview}</span>
                        <span aria-hidden="true">·</span>
                        <span>Синхр.: {formatSyncTime(displaySyncedAt)}</span>
                        {isBackgroundSyncing ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-sans text-cyan-300">Обновление в фоне...</span>
                          </>
                        ) : (
                          cachedEntry &&
                          !hasFreshLocalAssets && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans text-slate-500">Локальный кэш</span>
                            </>
                          )
                        )}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-[10px] font-sans text-slate-500">
                        {isBackgroundSyncing ? 'Кэш (обновляется...)' : 'Баланс биржи'}
                      </div>
                      <div className="text-base font-bold text-white">
                        ${displayBalanceUsdt.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </div>

                  {item.lastSyncError && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                      {item.lastSyncError}
                    </div>
                  )}

                  {/* Actions Row */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isSyncing || !item.enabled}
                      onClick={() => void handleSyncClick(item, true)}
                      className="min-h-[36px] px-3 rounded-lg border border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 disabled:opacity-50 text-xs font-semibold text-emerald-200 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>{isSyncing ? 'Синхронизация...' : 'Синхр. в портфель'}</span>
                    </button>

                    {item.permissions === 'trade' && item.enabled && (
                      <button
                        type="button"
                        onClick={() => {
                          setOrderTicketKeyId(isTicketOpen ? null : item.id);
                          setOrderFeedback(null);
                        }}
                        className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                          isTicketOpen
                            ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                            : 'border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200'
                        }`}
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>Исполнить ордер</span>
                      </button>
                    )}

                    {onEditKey && (
                      <button
                        type="button"
                        onClick={() => onEditKey(item)}
                        className="min-h-[36px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-slate-200 inline-flex items-center gap-1.5 transition-colors ml-auto"
                      >
                        <Pencil className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Изменить</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void onToggleExchange(item.id, !item.enabled)}
                      className={`min-h-[36px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-slate-300 inline-flex items-center gap-1.5 transition-colors ${
                        onEditKey ? '' : 'ml-auto'
                      }`}
                    >
                      {item.enabled ? (
                        <>
                          <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                          <span>Пауза</span>
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Включить</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (isDeleting) {
                          void onDeleteExchange(item.id);
                          setConfirmDeleteId(null);
                        } else {
                          setConfirmDeleteId(item.id);
                        }
                      }}
                      onBlur={() => setConfirmDeleteId(null)}
                      className={`min-h-[36px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                        isDeleting
                          ? 'border-rose-500/60 bg-rose-500/25 text-rose-100'
                          : 'border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isDeleting ? 'Подтвердить' : 'Удалить'}</span>
                    </button>
                  </div>

                  {/* Live / Cached Synced Assets Preview */}
                  {syncedAssets && syncedAssets.length > 0 && (
                    <div className="pt-2 border-t border-white/8 space-y-1.5">
                      <div className="text-[11px] text-slate-400">
                        {isBackgroundSyncing
                          ? 'Активы с биржи (кэш · фоновое обновление):'
                          : cachedEntry && !hasFreshLocalAssets
                            ? 'Активы с биржи (из локального кэша):'
                            : 'Полученные активы с биржи (топ по стоимости):'}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {syncedAssets.slice(0, 8).map((a) => (
                          <span
                            key={`${item.id}-${a.asset}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#111827] border border-white/8 px-2.5 py-1 text-[11px] font-mono tabular-nums text-slate-200"
                          >
                            <span className="font-bold text-white">{a.asset}</span>
                            <span className="text-slate-400">
                              {a.total.toLocaleString('en-US', { maximumFractionDigits: 5 })}
                            </span>
                            {a.valueUsdt > 0 && (
                              <span className="text-emerald-400">${a.valueUsdt.toFixed(2)}</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Order Execution Form */}
                  {isTicketOpen && item.permissions === 'trade' && item.enabled && (
                    <form
                      onSubmit={(e) => void handleOrderSubmit(e, item)}
                      className="mt-2 pt-3 border-t border-white/10 space-y-3"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-cyan-200">
                          Прямой ордер на {meta.name} {item.testnet ? '(Testnet)' : '(Mainnet)'}
                        </span>
                        <span className="text-[11px] text-slate-400">Подписывается сервером HMAC-SHA256</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <select
                          value={orderSymbol}
                          onChange={(e) => setOrderSymbol(e.target.value)}
                          className="min-h-[38px] rounded-lg border border-white/10 bg-[#111827] px-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                        >
                          {TRADING_PAIRS.slice(0, 20).map((p) => (
                            <option key={p.symbol} value={p.symbol}>
                              {p.symbol}
                            </option>
                          ))}
                        </select>

                        <select
                          value={orderMarketType}
                          onChange={(e) => setOrderMarketType(e.target.value as MarketType)}
                          className="min-h-[38px] rounded-lg border border-white/10 bg-[#111827] px-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="spot">Spot</option>
                          <option value="futures">Futures</option>
                        </select>

                        <select
                          value={orderSide}
                          onChange={(e) => setOrderSide(e.target.value as 'BUY' | 'SELL')}
                          className="min-h-[38px] rounded-lg border border-white/10 bg-[#111827] px-2.5 text-xs font-semibold text-white focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="BUY">BUY / LONG</option>
                          <option value="SELL">SELL / SHORT</option>
                        </select>

                        <select
                          value={orderType}
                          onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT')}
                          className="min-h-[38px] rounded-lg border border-white/10 bg-[#111827] px-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="MARKET">MARKET</option>
                          <option value="LIMIT">LIMIT</option>
                        </select>

                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={orderQty}
                          onChange={(e) => setOrderQty(e.target.value)}
                          placeholder="Кол-во"
                          className="min-h-[38px] rounded-lg border border-white/10 bg-[#111827] px-2.5 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
                        />
                      </div>

                      {orderType === 'LIMIT' && (
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={orderLimitPrice}
                          onChange={(e) => setOrderLimitPrice(e.target.value)}
                          placeholder="Лимитная цена в USDT"
                          className="w-full sm:w-56 min-h-[38px] rounded-lg border border-white/10 bg-[#111827] px-3 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
                        />
                      )}

                      {orderFeedback && (
                        <div
                          className={`rounded-lg border px-3 py-2 text-xs ${
                            orderFeedback.tone === 'ok'
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                              : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                          }`}
                        >
                          {orderFeedback.text}
                        </div>
                      )}

                      <NonCustodialRiskNotice
                        text="Перед отправкой ордера откроется обязательное окно подтверждения: вы подтверждаете параметры сделки и полную личную ответственность за свои финансы. VERNIER не хранит и не оперирует вашими деньгами."
                      />

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={submittingOrder}
                          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors ${
                            orderSide === 'BUY'
                              ? 'bg-emerald-600 hover:bg-emerald-500'
                              : 'bg-rose-600 hover:bg-rose-500'
                          }`}
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>
                            {submittingOrder
                              ? 'Ожидание подтверждения / отправка...'
                              : `Отправить ${orderSide} ${orderType} через API`}
                          </span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <LegalDocumentModal doc={openLegalDoc} onClose={() => setOpenLegalDoc(null)} />
    </div>
  );
};

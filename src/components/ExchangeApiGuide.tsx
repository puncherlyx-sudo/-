import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { triggerHaptic } from '../lib/securityDlp';
import type { ExchangeId } from '../types/domain';
import binanceGuideImg from '../assets/images/api_guide_binance_1795184299334.jpg';
import bybitGuideImg from '../assets/images/api_guide_bybit_1795183868488.jpg';
import okxGuideImg from '../assets/images/api_guide_okx_1795183862613.jpg';

const EXCHANGE_GUIDE_VISUALS: Record<
  ExchangeId,
  { src: string; alt: string; caption: string }
> = {
  binance: {
    src: binanceGuideImg,
    alt: 'Визуальная схема создания API-ключа Binance с включённым Enable Reading и отключённым Withdrawals',
    caption: 'Binance API Management: включите «Enable Reading» ✓ · оставьте «Enable Withdrawals» выключенным ✕',
  },
  bybit: {
    src: bybitGuideImg,
    alt: 'Визуальная схема настройки Bybit V5 Unified Trading API с правами Read-Only и запретом вывода',
    caption: 'Bybit V5 API: выберите «Read-Only» ✓ · блок «Wallet / Withdraw» строго выключен ✕',
  },
  okx: {
    src: okxGuideImg,
    alt: 'Визуальная схема создания ключа OKX API V5 с Passphrase, правами Read и запретом Withdraw',
    caption: 'OKX API V5: задайте Passphrase + включите «Read» ✓ · «Withdraw» строго выключен ✕',
  },
};

interface ExchangeGuideSpec {
  id: ExchangeId;
  name: string;
  apiType: string;
  portalPath: string;
  mobilePath: string;
  officialUrl: string;
  testnetUrl: string;
  needsPassphrase: boolean;
  steps: Array<{
    title: string;
    detail: string;
  }>;
  enablePermissions: string[];
  forbidPermissions: string[];
  proTip: string;
}

const EXCHANGE_GUIDES: Record<ExchangeId, ExchangeGuideSpec> = {
  binance: {
    id: 'binance',
    name: 'Binance',
    apiType: 'Spot & Futures · HMAC-SHA256',
    portalPath: 'Профиль → Аккаунт → Управление API (API Management)',
    mobilePath: 'Ещё (More) → Другие сервисы → Управление API',
    officialUrl: 'https://www.binance.com/ru/my/settings/api-management',
    testnetUrl: 'https://testnet.binance.vision/',
    needsPassphrase: false,
    steps: [
      {
        title: 'Создайте системный API-ключ',
        detail:
          'Откройте «Управление API» → нажмите «Создать API» → выберите тип «Сгенерированный системой» (HMAC-SHA256) и задайте имя, например «VERNIER».',
      },
      {
        title: 'Пройдите проверку безопасности биржи',
        detail:
          'Подтвердите создание через 2FA-аутентификатор и код из Email/SMS. Сразу скопируйте API Key и Secret Key — Secret показывается только один раз.',
      },
      {
        title: 'Настройте права доступа (Permissions)',
        detail:
          'Нажмите «Редактировать ограничения». Для просмотра баланса оставьте только «Включить чтение» (Enable Reading). Для Live-ордеров добавьте «Спотовая и маржинальная торговля» и/или «Фьючерсы».',
      },
      {
        title: 'Проверьте запрет вывода и IP-ограничения',
        detail:
          'Убедитесь, что галочка «Включить вывод средств» (Enable Withdrawals) НЕ отмечена. Примечание Binance: для торговых прав без выделенного IP ключ действует 90 дней — при истечении просто перевыпустите его.',
      },
      {
        title: 'Вставьте ключи в VERNIER',
        detail:
          'Выберите Binance в форме подключения, вставьте API Key и API Secret, выберите режим Read-Only или Trade и нажмите «Проверить ключ и подключить».',
      },
    ],
    enablePermissions: [
      'Enable Reading (Чтение баланса — обязательно)',
      'Enable Spot & Margin Trading (только если нужен Trade-режим)',
      'Enable Futures (только для фьючерсных стратегий)',
    ],
    forbidPermissions: [
      'Enable Withdrawals (Вывод средств — строго ВЫКЛ)',
      'Enable Internal Transfer (Внутренние переводы — ВЫКЛ)',
      'Permits Universal Transfer (Универсальные переводы — ВЫКЛ)',
    ],
    proTip:
      'Для безопасного теста сначала создайте ключ на Binance Spot Testnet и включите переключатель «Testnet / Demo» в форме VERNIER.',
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    apiType: 'Unified Trading V5 · HMAC-SHA256',
    portalPath: 'Профиль → API → Создать новый ключ',
    mobilePath: 'Главная → Ещё → API-управление (или веб-кабинет)',
    officialUrl: 'https://www.bybit.com/app/user/api-management',
    testnetUrl: 'https://testnet.bybit.com/',
    needsPassphrase: false,
    steps: [
      {
        title: 'Откройте API Management и создайте ключ',
        detail:
          'Перейдите в раздел API → нажмите «Создать новый ключ» → выберите «Системно-сгенерированные API-ключи» (System-generated).',
      },
      {
        title: 'Выберите тип транзакций и уровень прав',
        detail:
          'Выберите «Транзакции через API», задайте название «VERNIER». Для синхронизации баланса выберите «Только чтение» (Read-Only), для исполнения ордеров — «Чтение-Запись» (Read-Write).',
      },
      {
        title: 'Отметьте права Единого торгового аккаунта (UTA)',
        detail:
          'В блоке «Единый торговый аккаунт» (Unified Trading) включите «Ордера» и «Позиции» (для Trade-режима). Блок «Активы» (Assets / Withdraw) оставьте полностью пустым.',
      },
      {
        title: 'Подтвердите 2FA и сохраните API Secret',
        detail:
          'Введите код из Google Authenticator и Email. Скопируйте API Key и API Secret сразу после создания — после закрытия окна секрет больше не отобразится.',
      },
      {
        title: 'Подключите в VERNIER',
        detail:
          'Выберите Bybit, вставьте API Key и API Secret (Passphrase для Bybit не нужен) и выполните проверку подписи и баланса.',
      },
    ],
    enablePermissions: [
      'Read-Only (для синхронизации портфеля без торговли)',
      'Unified Trading → Orders & Positions (только для Live Execution)',
      'Spot / Linear Contract (по нужным рынкам)',
    ],
    forbidPermissions: [
      'Assets → Account Transfer / Subaccount Transfer (ВЫКЛ)',
      'Wallet → Withdraw / Вывод средств (строго ВЫКЛ)',
      'NFT / Copy Trading Management (не требуется)',
    ],
    proTip:
      'VERNIER использует современный протокол Bybit V5 Unified Trading Account (UTA). Если аккаунт старого типа, переведите его на Единый торговый аккаунт в настройках Bybit.',
  },
  okx: {
    id: 'okx',
    name: 'OKX',
    apiType: 'Account V5 · API Key + Secret + Passphrase',
    portalPath: 'Профиль → API → Создать ключ API V5',
    mobilePath: 'Меню профиля → API → Создать ключ API V5',
    officialUrl: 'https://www.okx.com/account/my-api',
    testnetUrl: 'https://www.okx.com/trade-spot (переключитесь в Demo Trading)',
    needsPassphrase: true,
    steps: [
      {
        title: 'Создайте ключ API V5 в кабинете OKX',
        detail:
          'Перейдите в «API» → «Создать ключ API V5». В поле назначения выберите «API-торговля» (API trading) и укажите имя ключа «VERNIER».',
      },
      {
        title: 'Придумайте и запишите Passphrase (обязательно)',
        detail:
          'OKX требует кодовую фразу (Passphrase) длиной 8–32 символа. Её нельзя восстановить на бирже — сохраните её вместе с ключом, так как VERNIER запрашивает все 3 поля.',
      },
      {
        title: 'Укажите разрешения Read / Trade',
        detail:
          'Оставьте «Чтение» (Read) для мониторинга портфеля или добавьте «Торговля» (Trade) для исполнения ордеров. Флаг «Вывод» (Withdraw) оставляйте строго выключенным.',
      },
      {
        title: 'Проверьте режим Demo Trading (при необходимости)',
        detail:
          'Если хотите протестировать на виртуальных средствах, переключите аккаунт OKX в режим «Демо-торговля» и создайте API-ключ именно внутри Demo-кабинета, затем включите «Testnet / Demo» в VERNIER.',
      },
      {
        title: 'Подключите ключ в VERNIER',
        detail:
          'Выберите OKX в форме подключения, введите API Key, API Secret и Passphrase, подтвердите некастодиальную ответственность и нажмите «Проверить ключ и подключить».',
      },
    ],
    enablePermissions: [
      'Read / Чтение (обязательно для синхронизации балансов)',
      'Trade / Торговля (только если планируете исполнение ордеров)',
    ],
    forbidPermissions: [
      'Withdraw / Вывод средств (строго ВЫКЛ)',
      'Sub-account Transfer (ВЫКЛ)',
    ],
    proTip:
      'Частая причина ошибки на OKX — несовпадение регистра символов в Passphrase или использование обычного ключа в режиме Demo Trading (ключи Mainnet и Demo раздельные).',
  },
};

const TROUBLESHOOTING_ITEMS = [
  {
    id: 'invalid-sig',
    title: 'Ошибка «Invalid API-Key / Invalid Signature»',
    body: 'Проверьте, что не перепутаны поля API Key и API Secret, нет лишних пробелов в начале/конце и для OKX указан точный Passphrase с учётом регистра. Также убедитесь, что переключатель Mainnet / Testnet совпадает с тем, где был создан ключ.',
  },
  {
    id: 'permission-denied',
    title: 'Баланс виден, но ордер отклоняется (Permission Denied)',
    body: 'Ключ создан с правами «Только чтение» (Read-Only) или не отмечены разрешения Spot/Futures Trading на бирже. Отредактируйте права ключа в кабинете биржи и обновите профиль ключа в VERNIER.',
  },
  {
    id: 'ip-restriction',
    title: 'Ошибка доступа по IP (401 / 403 IP Whitelist)',
    body: 'Если в настройках ключа на бирже включена привязка к конкретному IP-адресу, серверные запросы с другого IP будут отклоняться. Для тестирования снимите жёсткую привязку IP или добавьте актуальный исходящий IP вашего сервера.',
  },
  {
    id: 'other-exchange',
    title: 'Что делать, если я торгую на BingX, Bitget, KuCoin или MEXC?',
    body: 'Все графики, индикаторы, AI-анализ, сканер и поток сигналов работают универсально без привязки к API. Используйте кнопку «Копировать план» на любом сигнале, чтобы в 1 клик перенести цену входа, Stop-Loss и Take-Profit в терминал вашей биржи.',
  },
];

const SECURITY_CHECKLIST = [
  'Право вывода средств (Withdrawals) на бирже выключено',
  'API Secret (и Passphrase для OKX) скопированы без лишних пробелов',
  'Для первого запуска выбран Read-Only или режим Testnet / Demo',
  'Понимаю Non-Custodial модель: средства всегда остаются на бирже',
];

interface ExchangeApiGuideProps {
  initialExchange?: ExchangeId;
  compact?: boolean;
  onSelectExchange?: (exchange: ExchangeId) => void;
  onClose?: () => void;
}

export const ExchangeApiGuide: React.FC<ExchangeApiGuideProps> = ({
  initialExchange = 'binance',
  compact = false,
  onSelectExchange,
  onClose,
}) => {
  const [activeExchange, setActiveExchange] = useState<ExchangeId>(initialExchange);
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [openTroubleId, setOpenTroubleId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const spec = EXCHANGE_GUIDES[activeExchange];
  const visual = EXCHANGE_GUIDE_VISUALS[activeExchange];
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

  const handleExchangeSwitch = (ex: ExchangeId) => {
    triggerHaptic(6);
    setActiveExchange(ex);
    onSelectExchange?.(ex);
  };

  const toggleChecklist = (idx: number) => {
    triggerHaptic(6);
    setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div
      className={`rounded-2xl border border-cyan-500/25 bg-[#0B0F17] ${
        compact ? 'p-4 space-y-4' : 'p-5 space-y-5'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="text-xs text-cyan-300 font-medium">
            Подключение бирж · Пошаговая инструкция
          </div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Руководство по подключению API</span>
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            Выберите вашу биржу ниже. Ключи шифруются на сервере по стандарту AES-256-GCM и используются только для чтения баланса (Read-Only) или подтверждённых вами ордеров — вывод средств никогда не запрашивается.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(6);
              onClose();
            }}
            aria-label="Закрыть инструкцию"
            className="min-h-[38px] min-w-[38px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Exchange Selector Segmented Control */}
      <div
        role="tablist"
        aria-label="Выбор биржи для инструкции"
        className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#111827] border border-white/10"
      >
        {(['binance', 'bybit', 'okx'] as ExchangeId[]).map((exId) => {
          const item = EXCHANGE_GUIDES[exId];
          const active = activeExchange === exId;
          return (
            <button
              key={exId}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleExchangeSwitch(exId)}
              className={`min-h-[42px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                active
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {item.name}
            </button>
          );
        })}
      </div>

      {/* Exchange Quick Metadata & Direct Links */}
      <div className="rounded-xl border border-white/8 bg-[#111827] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white">{spec.name}</div>
            <div className="text-[11px] text-slate-400 font-mono">
              {spec.apiType}
              {spec.needsPassphrase ? ' · Требуется Passphrase' : ' · Без Passphrase'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={spec.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[34px] px-3 rounded-lg border border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-[11px] font-semibold text-emerald-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <span>Кабинет API {spec.name}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-white/8 text-[11px]">
          <div className="text-slate-300">
            <span className="text-slate-500 block">Веб-версия:</span>
            <span className="font-medium">{spec.portalPath}</span>
          </div>
          <div className="text-slate-300">
            <span className="text-slate-500 block">Мобильное приложение:</span>
            <span className="font-medium">{spec.mobilePath}</span>
          </div>
        </div>
      </div>

      {/* Visual Step Illustration (Binance / Bybit / OKX) */}
      <figure className="rounded-xl border border-emerald-500/25 bg-[#080C12] overflow-hidden">
        {!failedImages[activeExchange] ? (
          <div className="relative aspect-[16/9] w-full bg-[#06090F] overflow-hidden">
            <img
              src={visual.src}
              alt={visual.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() =>
                setFailedImages((prev) => ({ ...prev, [activeExchange]: true }))
              }
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="p-4 bg-[#0B121B] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="font-semibold text-white">Схема прав API · {spec.name}</div>
              <div className="text-[11px] text-slate-300">
                1. Создайте ключ HMAC · 2. Включите Read-Only · 3. Проверьте запрет Withdraw
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300">
                Read ✓
              </span>
              <span className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/35 text-rose-300">
                Withdraw ✕
              </span>
            </div>
          </div>
        )}
        <figcaption className="px-3.5 py-2.5 border-t border-white/8 bg-[#111827]/90 text-[11px] text-slate-300 flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{visual.caption}</span>
        </figcaption>
      </figure>

      {/* Numbered Step-by-Step Instructions */}
      <ol className="space-y-2.5">
        {spec.steps.map((step, idx) => (
          <li
            key={`${spec.id}-step-${idx}`}
            className="rounded-xl border border-white/8 bg-[#111827]/80 p-3 flex items-start gap-3"
          >
            <span className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
              {idx + 1}
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="text-xs font-semibold text-white">{step.title}</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Permissions Matrix: Allow vs Forbid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5 space-y-2">
          <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Что разрешить на бирже</span>
          </div>
          <ul className="space-y-1.5 text-[11px] text-slate-200 leading-snug">
            {spec.enablePermissions.map((perm) => (
              <li key={perm} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>{perm}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3.5 space-y-2">
          <div className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Что строго запретить</span>
          </div>
          <ul className="space-y-1.5 text-[11px] text-slate-200 leading-snug">
            {spec.forbidPermissions.map((perm) => (
              <li key={perm} className="flex items-start gap-2">
                <X className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <span>{perm}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Exchange Pro Tip */}
      <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] p-3 text-xs text-slate-200 leading-relaxed flex items-start gap-2.5">
        <KeyRound className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-cyan-200">Совет для {spec.name}:</strong> {spec.proTip}
        </div>
      </div>

      {/* Read-Only vs Trade Quick Comparison */}
      <div className="rounded-xl border border-white/8 bg-[#111827] p-3.5 space-y-2">
        <div className="text-xs font-semibold text-white">Сравнение режимов подключения</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
          <div className="rounded-lg border border-cyan-500/20 bg-[#0B0F17] p-2.5 space-y-1">
            <div className="font-semibold text-cyan-300">Только чтение (Read-Only)</div>
            <p className="text-slate-400 leading-relaxed">
              Загружает реальный баланс и активы в портфель VERNIER. Идеально для старта — ордера не отправляются, но вы видите точный капитал для расчёта риска.
            </p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-[#0B0F17] p-2.5 space-y-1">
            <div className="font-semibold text-emerald-300">Торговля (Trade + Verified Live)</div>
            <p className="text-slate-400 leading-relaxed">
              Открывает режим Live Execution в стратегиях и прямой ордер по сигналу. Каждый ордер всё равно проходит через ваше явное подтверждение с риском и 2FA.
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Pre-Flight Security Checklist */}
      <div className="rounded-xl border border-white/8 bg-[#111827] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Чек-лист перед вставкой ключа</span>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-emerald-300">
            {checkedCount}/{SECURITY_CHECKLIST.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {SECURITY_CHECKLIST.map((item, idx) => {
            const done = Boolean(checkedItems[idx]);
            return (
              <button
                key={item}
                type="button"
                onClick={() => toggleChecklist(idx)}
                className={`w-full min-h-[38px] px-3 py-2 rounded-lg border text-left text-xs flex items-center gap-2.5 transition-colors ${
                  done
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
                    : 'border-white/8 bg-[#0B0F17] text-slate-300 hover:border-white/15'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    done
                      ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                      : 'border-slate-600 bg-transparent'
                  }`}
                >
                  {done && <Check className="w-3 h-3 stroke-[3]" />}
                </span>
                <span className={done ? 'line-through opacity-85' : ''}>{item}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Troubleshooting Accordion */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Частые ошибки и решения</span>
        </div>
        <div className="space-y-1.5">
          {TROUBLESHOOTING_ITEMS.map((item) => {
            const isOpen = openTroubleId === item.id;
            return (
              <div
                key={item.id}
                className="rounded-xl border border-white/8 bg-[#111827] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(6);
                    setOpenTroubleId((prev) => (prev === item.id ? null : item.id));
                  }}
                  aria-expanded={isOpen}
                  className="w-full min-h-[42px] px-3.5 py-2.5 text-left text-xs font-medium text-slate-200 hover:text-white flex items-center justify-between gap-2 transition-colors"
                >
                  <span>{item.title}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-cyan-300' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-3 pt-1 text-[11px] text-slate-300 leading-relaxed border-t border-white/6">
                    {item.body}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface ExchangeApiGuideModalProps {
  open: boolean;
  initialExchange?: ExchangeId;
  onClose: () => void;
  onOpenExchangeIntegrations?: () => void;
}

export const ExchangeApiGuideModal: React.FC<ExchangeApiGuideModalProps> = ({
  open,
  initialExchange = 'binance',
  onClose,
  onOpenExchangeIntegrations,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Подробная инструкция по подключению API бирж"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-white/12 bg-[#080C12] p-4 sm:p-5 space-y-4 shadow-2xl">
        <div className="w-10 h-1.5 rounded-full bg-slate-700 mx-auto sm:hidden" aria-hidden="true" />
        <ExchangeApiGuide initialExchange={initialExchange} compact onClose={onClose} />
        {onOpenExchangeIntegrations && (
          <div className="flex justify-end gap-2 pt-1 pb-safe">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onClose();
                window.requestAnimationFrame(() => {
                  window.setTimeout(() => {
                    onOpenExchangeIntegrations();
                  }, 60);
                });
              }}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>Перейти к подключению ключа</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

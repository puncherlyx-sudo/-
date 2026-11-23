import React, { useMemo, useState } from 'react';
import { BookOpen, HelpCircle, Search, Send, ShieldCheck, X } from 'lucide-react';
import { Accordion, type AccordionEntry } from './Accordion';
import { triggerHaptic } from '../lib/securityDlp';

type SyncFaqCategory = 'all' | 'sync' | 'errors' | 'security' | 'cloud';

interface SecuritySyncFaqItem {
  id: string;
  category: Exclude<SyncFaqCategory, 'all'>;
  categoryLabel: string;
  meta: string;
  question: string;
  answer: string;
  keywords: string[];
}

const SECURITY_SYNC_FAQ_ITEMS: SecuritySyncFaqItem[] = [
  {
    id: 'sync-key-encryption',
    category: 'security',
    categoryLabel: 'Безопасность',
    meta: 'AES-256-GCM · Non-Custodial',
    question: 'Как хранятся API-ключи бирж и может ли терминал вывести средства?',
    answer:
      'API-секреты шифруются на сервере алгоритмом AES-256-GCM с привязкой к вашему UID и параметрам биржи (AAD). Права на вывод (Withdrawals) и переводы строго запрещены — терминал проверяет права ключа и работает по Non-Custodial модели.',
    keywords: ['aes', 'шифрование', 'ключ', 'вывод', 'withdraw', 'non-custodial', 'хранение'],
  },
  {
    id: 'sync-expired-key-fix',
    category: 'errors',
    categoryLabel: 'Ошибки синхронизации',
    meta: 'Коды -2015 / 33004 / 50111',
    question: 'Что делать при ошибке истечения или невалидности API-ключа (-2015, 33004, 50111)?',
    answer:
      'Перевыпустите ключ в кабинете Binance, Bybit или OKX (с правами только Read / Spot-Futures без вывода), затем откройте «Логи синхронизации» и нажмите кнопку «Устранить» на записи ошибки — сразу откроется форма обновления этого ключа.',
    keywords: ['-2015', '33004', '50111', '401', 'истек', 'истёк', 'устранить', 'обновить', 'ключ'],
  },
  {
    id: 'sync-rate-limit',
    category: 'errors',
    categoryLabel: 'Ошибки синхронизации',
    meta: 'HTTP 429 · Код 10006 / 50011',
    question: 'Почему возникает предупреждение Rate Limit (HTTP 429) при фоновой синхронизации?',
    answer:
      'Биржа временно ограничивает частоту запросов с одного IP или API-ключа. В журнале логов для таких записей автоматически включается защитный таймер охлаждения (15 мин) и кнопка быстрой паузы ключа, чтобы избежать блокировки.',
    keywords: ['429', '10006', '50011', 'rate limit', 'лимит', 'частота', 'пауза', 'бан'],
  },
  {
    id: 'sync-okx-passphrase-testnet',
    category: 'sync',
    categoryLabel: 'Синхронизация',
    meta: 'Binance · Bybit · OKX',
    question: 'Как правильно подключить OKX с Passphrase и протестировать синхронизацию на Testnet?',
    answer:
      'Для OKX обязательно укажите Passphrase (кодовую фразу, заданную при создании ключа, с учётом регистра). Если ключ создан на тестнете (Binance Testnet, Bybit Testnet, OKX Demo), включите переключатель «Testnet / Demo» в настройках ключа.',
    keywords: ['okx', 'passphrase', 'bybit', 'binance', 'testnet', 'demo', 'подключить'],
  },
  {
    id: 'sync-critical-push',
    category: 'cloud',
    categoryLabel: 'Push и облако',
    meta: 'Web Push · Мгновенно',
    question: 'Как работают Push-уведомления при критических ошибках синхронизации?',
    answer:
      'При критическом сбое (например, истечении API-ключа или отказе авторизации) сервер отправляет фоновое Web Push-уведомление на ваши устройства с анти-спам защитой. Включите Push в разделе «Безопасность → Push-уведомления».',
    keywords: ['push', 'пуш', 'уведомление', 'критическая', 'ошибка', 'фон'],
  },
  {
    id: 'sync-cloud-firestore-cleanup',
    category: 'cloud',
    categoryLabel: 'Push и облако',
    meta: 'PRO Firestore · Авто-очистка 30 дн.',
    question: 'Сохраняются ли логи ошибок между устройствами и как экономить память?',
    answer:
      'На тарифах PRO и MAX локальные логи синхронизации автоматически дублируются в защищённую коллекцию Firestore с маскировкой секретов. Для экономии localStorage включите тумблер «Авто-очистка логов старше 30 дней» в журнале синхронизации.',
    keywords: ['firestore', 'облако', 'pro', 'устройства', '30 дней', 'очистка', 'localstorage', 'память'],
  },
  {
    id: 'security-2fa-stepup',
    category: 'security',
    categoryLabel: 'Безопасность',
    meta: 'TOTP RFC 6238 · Step-Up',
    question: 'Зачем нужен 2FA (TOTP) и резервные коды при управлении ключами бирж?',
    answer:
      'Включённая двухфакторная аутентификация (Google Authenticator / Authy) защищает добавление, редактирование и удаление API-ключей, а также смену параметров стратегий через Step-Up проверку. Сохраните 8 одноразовых резервных кодов на случай потери телефона.',
    keywords: ['2fa', 'totp', 'step-up', 'резервные', 'коды', 'authenticator', 'pin', 'блокировка'],
  },
  {
    id: 'sync-support-report',
    category: 'sync',
    categoryLabel: 'Синхронизация',
    meta: 'PDF-отчёт · Тикет в поддержку',
    question: 'Безопасно ли отправлять отчёт об ошибках синхронизации в службу поддержки?',
    answer:
      'Да. Перед отправкой тикета и при генерации PDF-отчёта все API-ключи, секреты, passphrase, подписи и длинные токены автоматически вырезаются и заменяются на [скрыто] прямо на клиенте.',
    keywords: ['поддержка', 'отчет', 'отчёт', 'pdf', 'секреты', 'маскировка', 'логи', 'тикет'],
  },
];

const CATEGORY_OPTIONS: Array<{ id: SyncFaqCategory; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'sync', label: 'Синхронизация' },
  { id: 'errors', label: 'Ошибки и коды' },
  { id: 'security', label: '2FA и защита' },
  { id: 'cloud', label: 'Push и облако' },
];

interface SecuritySyncFaqWidgetProps {
  onOpenFullFaq?: () => void;
  onOpenSupportReport?: () => void;
}

export const SecuritySyncFaqWidget: React.FC<SecuritySyncFaqWidgetProps> = ({
  onOpenFullFaq,
  onOpenSupportReport,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SyncFaqCategory>('all');
  const [openIds, setOpenIds] = useState<string[]>([SECURITY_SYNC_FAQ_ITEMS[0].id]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SECURITY_SYNC_FAQ_ITEMS.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.meta.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q))
      );
    });
  }, [query, category]);

  const accordionItems: AccordionEntry[] = useMemo(
    () =>
      filteredItems.map((item) => ({
        id: item.id,
        title: item.question,
        badge: item.categoryLabel,
        meta: item.meta,
        content: <p>{item.answer}</p>,
      })),
    [filteredItems]
  );

  return (
    <section
      aria-labelledby="security-sync-faq-widget-title"
      className="rounded-2xl border border-white/10 bg-[var(--surface-1)] p-4 sm:p-5 space-y-3.5"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id="security-sync-faq-widget-title"
              className="text-sm font-semibold text-white inline-flex items-center gap-2"
            >
              <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Быстрый FAQ: безопасность и синхронизация</span>
            </h3>
            <span className="font-mono text-[10px] tabular-nums px-2 py-0.5 rounded-md border border-white/10 bg-[var(--surface-0)] text-slate-300">
              {filteredItems.length} / {SECURITY_SYNC_FAQ_ITEMS.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Поиск по кодам ошибок (-2015, 429, 10006), шифрованию ключей, 2FA и облачной синхронизации логов.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {onOpenSupportReport && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onOpenSupportReport();
              }}
              className="min-h-[32px] px-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-medium text-cyan-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Send className="w-3 h-3 shrink-0" />
              <span>Отчёт в поддержку</span>
            </button>
          )}
          {onOpenFullFaq && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onOpenFullFaq();
              }}
              className="min-h-[32px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Весь FAQ</span>
            </button>
          )}
        </div>
      </div>

      {/* Search + Category Filters */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              const nextVal = e.target.value;
              setQuery(nextVal);
              if (nextVal.trim()) {
                const lower = nextVal.trim().toLowerCase();
                const firstMatch = SECURITY_SYNC_FAQ_ITEMS.find(
                  (it) =>
                    it.question.toLowerCase().includes(lower) ||
                    it.answer.toLowerCase().includes(lower) ||
                    it.keywords.some((k) => k.toLowerCase().includes(lower))
                );
                if (firstMatch) setOpenIds([firstMatch.id]);
              }
            }}
            placeholder="Поиск: -2015, 429, Passphrase, AES-256, 2FA, Firestore, 30 дней…"
            aria-label="Поиск по вопросам безопасности и синхронизации"
            className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-0)] pl-9 pr-9 text-xs text-white placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск FAQ"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Фильтр тем FAQ безопасности и синхронизации"
          className="flex flex-wrap items-center gap-1"
        >
          {CATEGORY_OPTIONS.map((opt) => {
            const active = category === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  triggerHaptic(6);
                  setCategory(opt.id);
                }}
                className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                  active
                    ? 'border-emerald-500/45 bg-emerald-500/18 text-emerald-200'
                    : 'border-white/8 bg-[var(--surface-0)] text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Accordion Results */}
      {accordionItems.length === 0 ? (
        <div className="py-6 text-center space-y-2.5 border-t border-white/8">
          <p className="text-xs text-slate-300">
            По запросу «{query}» ничего не найдено в базе безопасности и синхронизации.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCategory('all');
              }}
              className="min-h-[34px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
            >
              Сбросить поиск
            </button>
            {onOpenSupportReport && (
              <button
                type="button"
                onClick={onOpenSupportReport}
                className="min-h-[34px] px-3 rounded-lg border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/20 text-xs font-medium text-cyan-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Задать вопрос поддержке</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <Accordion
          items={accordionItems}
          openIds={openIds}
          compact
          onToggle={(id, nextOpen) => setOpenIds(nextOpen ? [id] : [])}
        />
      )}

      <div className="pt-1 border-t border-white/8 flex items-center gap-2 text-[11px] text-slate-400">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>Все ответы актуальны для текущей архитектуры шифрования VERNIER и синхронизации бирж.</span>
      </div>
    </section>
  );
};

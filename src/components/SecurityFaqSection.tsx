import React, { useMemo, useState } from 'react';
import { ChevronDown, Compass, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

type FaqCategory = 'all' | '2fa' | 'credits' | 'pwa';

interface FaqItem {
  id: string;
  category: Exclude<FaqCategory, 'all'>;
  categoryLabel: string;
  question: string;
  answer: string;
  meta: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: '2fa-how-it-works',
    category: '2fa',
    categoryLabel: '2FA и защита',
    question: 'Как работает двухфакторная аутентификация (TOTP) и какие приложения подходят?',
    answer:
      'Vernier использует стандарт RFC 6238: каждые 30 секунд приложение-аутентификатор генерирует одноразовый 6-значный код. Подходят Google Authenticator, Authy, Microsoft Authenticator, 1Password и встроенные менеджеры паролей. Секретный ключ шифруется алгоритмом AES-256-GCM с привязкой к вашему аккаунту.',
    meta: 'TOTP RFC 6238 · AES-256-GCM',
  },
  {
    id: '2fa-lost-device',
    category: '2fa',
    categoryLabel: '2FA и защита',
    question: 'Что делать, если потерян доступ к телефону с аутентификатором?',
    answer:
      'При подключении 2FA выдаются 8 одноразовых резервных кодов. В базе данных хранятся только их криптографические SHA-256 хеши, поэтому восстановить коды задним числом невозможно. Введите любой неиспользованный резервный код вместо 6-значного TOTP-кода на экране блокировки или при отключении 2FA — использованный код автоматически аннулируется.',
    meta: '8 резервных кодов · Одноразовое применение',
  },
  {
    id: '2fa-protected-actions',
    category: '2fa',
    categoryLabel: '2FA и защита',
    question: 'Какие операции защищает 2FA и как настроить автоблокировку терминала?',
    answer:
      'При активной 2FA одноразовый код запрашивается перед изменением правил Spot/Futures стратегий, дневных лимитов сигналов, переключением тарифа Free/PRO и отключением 2FA. В блоке «Автоблокировка при бездействии» можно выбрать таймер 5, 15, 30 или 60 минут, либо заблокировать терминал мгновенно кнопкой «Заблокировать терминал сейчас».',
    meta: 'Step-Up проверка · Таймер 5–60 мин',
  },
  {
    id: '2fa-non-custodial',
    category: '2fa',
    categoryLabel: '2FA и защита',
    question: 'Имеет ли Vernier доступ к моим средствам на бирже?',
    answer:
      'Нет. Терминал работает по Non-Custodial модели: для графиков, ставок фандинга и открытого интереса используются публичные рыночные данные, а торговые или выводные API-ключи бирж не запрашиваются и не хранятся.',
    meta: 'Non-Custodial · Без ключей вывода',
  },
  {
    id: 'credits-weekly-quota',
    category: 'credits',
    categoryLabel: 'Кредиты и PRO',
    question: 'Как работают 15 бесплатных кредитов и когда они обновляются?',
    answer:
      'На бесплатном тарифе (Free) каждый пользователь получает 15 кредитов каждые 7 дней. Spot AI-анализ списывает 1 кредит, глубокий Futures-анализ (Funding Rate, Open Interest, цена ликвидации) — 2 кредита, а ручной пересчёт симуляции бэктеста PnL — 1 кредит. По истечении недели квота автоматически восстанавливается до 15.',
    meta: 'Free · 15 кредитов каждые 7 дней',
  },
  {
    id: 'credits-pro-limits',
    category: 'credits',
    categoryLabel: 'Кредиты и PRO',
    question: 'Какие функции открываются только в подписке PRO?',
    answer:
      'Подписка PRO даёт 100 кредитов в месяц, полностью снимает дневное ограничение на количество сигналов на стратегию (или позволяет задать свой порог 1–100) и разблокирует: 5 продвинутых стратегий (всего 9 вместо 4), стакан ордеров TOP-10, конструктор периодов MA Ribbon (EMA/SMA), фьючерсное плечо 6x–20x, расширенный бэктест 4H («Все 9») и экспорт скринера и портфеля в CSV.',
    meta: 'PRO · 100 кр./мес. · Все 9 стратегий',
  },
  {
    id: 'credits-limit-alerts',
    category: 'credits',
    categoryLabel: 'Кредиты и PRO',
    question: 'Как получать уведомления при достижении лимита сигналов или кредитов?',
    answer:
      'Включите фоновые Push-уведомления в разделе «Безопасность» и оставьте активным критический тумблер «Достижение лимитов сигналов». При исчерпании недельных кредитов или достижении дневного лимита сигналов по стратегии устройство получит мгновенное оповещение.',
    meta: 'Критический Push · Контроль квот',
  },
  {
    id: 'pwa-android-install',
    category: 'pwa',
    categoryLabel: 'PWA и Push',
    question: 'Как установить приложение на экран смартфона Android как PWA?',
    answer:
      'Откройте Vernier в Chrome на Android и нажмите кнопку «Установить PWA» в верхней панели (или меню браузера ⋮ → «Установить приложение» / «Добавить на главный экран»). Приложение откроется в полноэкранном режиме без адресной строки и сохранит интерфейс в кэш Service Worker для работы при нестабильной сети.',
    meta: 'Android Chrome · Service Worker кэш',
  },
  {
    id: 'pwa-push-troubleshooting',
    category: 'pwa',
    categoryLabel: 'PWA и Push',
    question: 'Почему не приходят фоновые Push-уведомления на Android или ПК?',
    answer:
      'Убедитесь в трёх пунктах: 1) В разделе «Безопасность» нажата кнопка «Включить Push-уведомления» и статус канала показывает «Активны в фоне»; 2) В настройках браузера и Android для этого сайта и Chrome разрешены уведомления и отключена жёсткая экономия батареи в фоне; 3) Включён нужный тумблер категории. Проверьте доставку кнопкой «Тест Push».',
    meta: 'Web Push VAPID · Кнопка «Тест Push»',
  },
  {
    id: 'pwa-critical-security-push',
    category: 'pwa',
    categoryLabel: 'PWA и Push',
    question: 'Какие критические события безопасности можно отслеживать через Push?',
    answer:
      'Вы можете отдельно включать или отключать три канала контроля: «Вход в аккаунт и снятие блокировки» (Google OAuth и разблокировка 2FA), «Смена настроек стратегий» (изменение статуса, риска, плеча или лимита) и «Достижение лимитов сигналов». Все изменения предпочтений синхронизируются с сервером немедленно.',
    meta: '3 независимых канала · Синхронизация с сервером',
  },
];

const CATEGORY_TABS: Array<{ id: FaqCategory; label: string }> = [
  { id: 'all', label: 'Все темы' },
  { id: '2fa', label: '2FA и защита' },
  { id: 'credits', label: 'Кредиты и PRO' },
  { id: 'pwa', label: 'PWA и Push' },
];

interface SecurityFaqSectionProps {
  onStartTour?: () => void;
}

export const SecurityFaqSection: React.FC<SecurityFaqSectionProps> = ({ onStartTour }) => {
  const [activeCategory, setActiveCategory] = useState<FaqCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>('2fa-how-it-works');

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return FAQ_ITEMS.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q)
      );
    });
  }, [activeCategory, searchQuery]);

  const handleToggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="security-faq-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-6 space-y-5"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400">
            Справочный центр · <span className="tabular-nums">{filteredItems.length}</span> из{' '}
            <span className="tabular-nums">{FAQ_ITEMS.length}</span> ответов
          </div>
          <h2
            id="security-faq-heading"
            className="mt-1 text-lg font-semibold text-white"
          >
            Часто задаваемые вопросы (FAQ)
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-2xl">
            Быстрые инструкции по настройке TOTP 2FA и резервных кодов, работе недельных кредитов, тарифа PRO и
            установке PWA с фоновыми push-уведомлениями на Android.
          </p>
          {onStartTour && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={onStartTour}
              className="mt-3 min-h-[38px] px-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15 text-xs font-medium text-emerald-300 inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span>Пройти тур по интерфейсу</span>
            </motion.button>
          )}
        </div>

        {/* Category Filter Segmented Bar */}
        <div
          role="tablist"
          aria-label="Категории вопросов FAQ"
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#0B0F17] border border-white/8 self-start lg:self-auto"
        >
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeCategory === tab.id;
            return (
              <motion.button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                whileTap={{ scale: 0.96 }}
                onClick={() => setActiveCategory(tab.id)}
                className={`relative min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="faq-category-tab"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-emerald-600"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск по вопросам: например, резервный код, 15 кредитов, Android, Push..."
          aria-label="Поиск по часто задаваемым вопросам"
          className="w-full min-h-[44px] rounded-xl border border-white/10 bg-[#0B0F17] pl-10 pr-10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Очистить поиск"
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Accordion List (hairline dividers, zero nested boxes) */}
      {filteredItems.length === 0 ? (
        <div className="py-8 text-center space-y-3 border-t border-white/8">
          <p className="text-sm text-slate-300">По запросу «{searchQuery}» ответы не найдены.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setActiveCategory('all');
            }}
            className="min-h-[40px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="divide-y divide-white/8 border-t border-white/8">
          {filteredItems.map((item, idx) => {
            const isOpen = openId === item.id;
            const panelId = `faq-panel-${item.id}`;
            return (
              <div key={item.id} className="py-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => handleToggle(item.id)}
                  className="w-full min-h-[48px] py-3 text-left flex items-start justify-between gap-4 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
                >
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      <span className="font-mono text-emerald-400">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>{' '}
                      <span>{item.categoryLabel}</span>
                      <span aria-hidden="true" className="mx-1.5 text-slate-600">
                        ·
                      </span>
                      <span className="text-slate-500">{item.meta}</span>
                    </div>
                    <div
                      className={`text-sm font-medium transition-colors ${
                        isOpen ? 'text-white' : 'text-slate-200 group-hover:text-white'
                      }`}
                    >
                      {item.question}
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-emerald-400' : 'group-hover:text-slate-200'
                    }`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={panelId}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="pb-4 pr-6 text-xs sm:text-sm text-slate-300 leading-relaxed"
                    >
                      {item.answer}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
};

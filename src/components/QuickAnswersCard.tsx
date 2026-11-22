import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  ChevronDown,
  Compass,
  HelpCircle,
  LifeBuoy,
  RotateCcw,
  Send,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { SupportTicketCategory, SupportTicketRecord } from '../types/domain';
import { PermanentFeaturesManual } from './FeatureGuide';
import { NATIVE_PILL_SPRING, NATIVE_SPRING, TERMINAL_EASE } from './MotionPrimitives';
import { SupportContactModal } from './SupportContactModal';
import { usePlan } from '../contexts/PlanContext';
import { buildLocalVernierChatReply } from '../lib/localAnalyticsEngine';
import { safeFetchJson } from '../utils/safeFetchJson';

interface QuickAnswerItem {
  id: string;
  topic: string;
  question: string;
  answer: string;
  actionId?: 'push' | 'ai' | 'pro' | 'faq' | 'tour';
  actionLabel?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

function formatMessageTime(date = new Date()): string {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const QUICK_ANSWERS: QuickAnswerItem[] = [
  {
    id: 'qa-search-columns',
    topic: 'Рынок и таблица',
    question: 'Как быстро найти монету и настроить колонки?',
    answer:
      'Введите тикер или название в строку поиска сверху (поддерживаются алиасы, например MATIC для POL), выберите фильтр по объёму, волатильности или новым листингам и отметьте нужные метрики через меню «Колонки».',
  },
  {
    id: 'qa-alerts-volatility',
    topic: 'Алерты и волатильность',
    question: 'Как поставить ценовой алерт и скачки >5%/ч?',
    answer:
      'Нажмите значок колокольчика рядом с активом, чтобы задать целевой уровень цены без открытия графика. Для фоновой доставки и оповещений о резких скачках волатильности активируйте Web Push в настройках уведомлений.',
    actionId: 'push',
    actionLabel: 'Настроить Push-уведомления',
  },
  {
    id: 'qa-credits-pro',
    topic: 'Кредиты и тариф PRO',
    question: 'Как работают 15 бесплатных кредитов и что закрыто в PRO?',
    answer:
      'На тарифе Free начисляется 15 кредитов каждые 7 дней (плюс лимит 1 сигнал/день на стратегию): Spot AI-анализ списывает 1 кредит, глубокий Futures-анализ — 2 кредита, ручной пересчёт PnL — 1 кредит. Подписка PRO даёт 100 кредитов в месяц, снимает ограничение на количество сигналов в день и открывает 5 PRO-стратегий, стакан ордеров TOP-10, конструктор периодов MA Ribbon, плечо >5x, 4H-бэктест и экспорт CSV.',
    actionId: 'pro',
    actionLabel: 'Перейти к стратегиям и PRO',
  },
  {
    id: 'qa-non-custodial',
    topic: 'Безопасность средств',
    question: 'Имеет ли терминал доступ к балансу на бирже?',
    answer:
      'Нет. Vernier работает по Non-Custodial модели на публичных рыночных данных Spot и Futures, без запроса API-ключей на торговлю или вывод. Доступ к настройкам можно защитить TOTP 2FA и автоблокировкой.',
    actionId: 'faq',
    actionLabel: 'Все вопросы по 2FA и защите',
  },
  {
    id: 'qa-pwa-mobile',
    topic: 'Android и PWA',
    question: 'Как установить терминал на телефон как приложение?',
    answer:
      'Откройте терминал в Chrome на Android и нажмите «Установить PWA» (или в меню браузера ⋮ выберите «Установить приложение»). Иконка появится на главном экране, а интерфейс будет открываться полноэкранно.',
  },
  {
    id: 'qa-timeframes',
    topic: 'График и индикаторы',
    question: 'Почему индикаторы меняются при смене 15M / 1H / 4H / 1D?',
    answer:
      'Каждый таймфрейм загружает собственный массив свечей и заново рассчитывает RSI (14), ATR%, уровни поддержки/сопротивления и ленту MA Ribbon, чтобы сигнал соответствовал выбранному горизонту торговли.',
    actionId: 'ai',
    actionLabel: 'Открыть AI-анализ пары',
  },
];

const STARTER_PROMPTS = [
  'Как включить алерты на скачки >5% за час?',
  'Как настроить колонки в таблице рынка?',
  'Чем тариф PRO отличается от Free?',
  'Как установить терминал на Android (PWA)?',
];

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'model',
  text: 'Здравствуйте! Я помощник терминала Vernier на базе Gemini. Спросите о поиске и фильтрах пар, настройке колонок, ценовых алертах, кредитах Free/PRO, 2FA или установке PWA.',
  timestamp: formatMessageTime(),
};

const TYPING_DOTS = [0, 1, 2] as const;

interface QuickAnswersCardProps {
  isSignedIn: boolean;
  userEmail?: string;
  supportTickets: SupportTicketRecord[];
  onRequireLogin: () => void;
  onCreateSupportTicket: (params: {
    contactEmail: string;
    category: SupportTicketCategory;
    subject: string;
    message: string;
  }) => Promise<string>;
  onOpenPushSettings: () => void;
  onOpenAiSection: () => void;
  onUpgradePro: () => void;
  onOpenFullFaq?: () => void;
  onStartTour?: () => void;
  inSheet?: boolean;
}

export const QuickAnswersCard: React.FC<QuickAnswersCardProps> = ({
  isSignedIn,
  userEmail,
  supportTickets,
  onRequireLogin,
  onCreateSupportTicket,
  onOpenPushSettings,
  onOpenAiSection,
  onUpgradePro,
  onOpenFullFaq,
  onStartTour,
  inSheet = false,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const planCtx = usePlan();
  const [mode, setMode] = useState<'chat' | 'manual' | 'faq'>('manual');
  const [openId, setOpenId] = useState<string | null>(null);
  const [supportModalOpen, setSupportModalOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode !== 'chat' || !threadRef.current) return;
    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [messages, sending, mode, prefersReducedMotion]);

  const handleToggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  const handleAction = (actionId: QuickAnswerItem['actionId']) => {
    if (actionId === 'push') onOpenPushSettings();
    else if (actionId === 'ai') onOpenAiSection();
    else if (actionId === 'pro') onUpgradePro();
    else if (actionId === 'faq') onOpenFullFaq?.();
    else if (actionId === 'tour') onStartTour?.();
  };

  const sendQuestion = async (rawText: string, options?: { isRetry?: boolean }) => {
    const clean = rawText.trim();
    if (clean.length < 2 || sending) return;

    const historyTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
    for (const m of messages) {
      if (m.id === 'welcome') continue;
      if (historyTurns.length === 0 && m.role !== 'user') continue;
      const prev = historyTurns[historyTurns.length - 1];
      if (prev && prev.role === m.role) continue;
      historyTurns.push({ role: m.role, text: m.text });
    }
    if (historyTurns.length > 0 && historyTurns[historyTurns.length - 1].role === 'user') {
      historyTurns.pop();
    }
    const historyPayload = historyTurns.slice(-8);

    const lastMsg = messages[messages.length - 1];
    const shouldAppendUserBubble = !(
      options?.isRetry &&
      lastMsg &&
      lastMsg.role === 'user' &&
      lastMsg.text === clean
    );

    if (shouldAppendUserBubble) {
      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        text: clean,
        timestamp: formatMessageTime(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputValue('');
    }

    setChatError(null);
    setLastFailedPrompt(null);
    setSending(true);

    try {
      const result = await safeFetchJson<{ reply?: string; error?: string }>('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean, history: historyPayload }),
        timeoutMs: 9000,
      });

      const replyText =
        result.ok && result.data?.reply
          ? result.data.reply
          : buildLocalVernierChatReply(clean, { plan: planCtx.plan });

      setMessages((prev) => [
        ...prev,
        {
          id: `model_${Date.now()}`,
          role: 'model',
          text: replyText,
          timestamp: formatMessageTime(),
        },
      ]);
    } catch {
      const fallbackReply = buildLocalVernierChatReply(clean, { plan: planCtx.plan });
      setMessages((prev) => [
        ...prev,
        {
          id: `model_${Date.now()}`,
          role: 'model',
          text: fallbackReply,
          timestamp: formatMessageTime(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(inputValue);
  };

  const handleResetChat = () => {
    setMessages([{ ...WELCOME_MESSAGE, timestamp: formatMessageTime() }]);
    setChatError(null);
    setLastFailedPrompt(null);
    setInputValue('');
  };

  return (
    <>
      <section
        aria-labelledby="quick-answers-heading"
        className={
          inSheet
            ? 'space-y-3.5'
            : 'mt-4 rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-3.5'
        }
      >
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/8">
          <div className="flex items-start gap-2.5 min-w-0">
            <Bot className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="quick-answers-heading"
                className="text-sm sm:text-base font-semibold text-white font-display"
              >
                Помощник и Справочник функций
              </h2>
              <p className="text-xs text-slate-400">
                Постоянная инструкция по всем модулям, AI-чат Gemini и быстрый FAQ
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto">
            {/* Compact Non-Clipping Grid on Mobile (360–430px): Гид | Чат | FAQ | Тур */}
            <div
              role="tablist"
              aria-label="Режим справки"
              className={`grid ${onStartTour ? 'grid-cols-4' : 'grid-cols-3'} sm:inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-[#0B0F17] w-full sm:w-auto`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'manual'}
                onClick={() => setMode('manual')}
                className={`relative min-h-[34px] px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                  mode === 'manual' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode === 'manual' && (
                  <motion.span
                    layoutId="quick-help-mode-pill"
                    transition={NATIVE_PILL_SPRING}
                    className="absolute inset-0 rounded-lg bg-emerald-600/90"
                  />
                )}
                <BookOpen className="w-3.5 h-3.5 relative z-10 shrink-0" />
                <span className="relative z-10">Гид</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'chat'}
                onClick={() => setMode('chat')}
                className={`relative min-h-[34px] px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                  mode === 'chat' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode === 'chat' && (
                  <motion.span
                    layoutId="quick-help-mode-pill"
                    transition={NATIVE_PILL_SPRING}
                    className="absolute inset-0 rounded-lg bg-emerald-600/90"
                  />
                )}
                <Bot className="w-3.5 h-3.5 relative z-10 shrink-0" />
                <span className="relative z-10">Чат</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'faq'}
                onClick={() => setMode('faq')}
                className={`relative min-h-[34px] px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                  mode === 'faq' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode === 'faq' && (
                  <motion.span
                    layoutId="quick-help-mode-pill"
                    transition={NATIVE_PILL_SPRING}
                    className="absolute inset-0 rounded-lg bg-emerald-600/90"
                  />
                )}
                <HelpCircle className="w-3.5 h-3.5 relative z-10 shrink-0" />
                <span className="relative z-10">FAQ</span>
              </button>
              {onStartTour && (
                <button
                  type="button"
                  onClick={onStartTour}
                  className="min-h-[34px] px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium text-emerald-300 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors"
                >
                  <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Тур</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onOpenFullFaq && (
                <button
                  type="button"
                  onClick={onOpenFullFaq}
                  className="min-h-[34px] px-3 rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-white/[0.04] text-xs font-medium text-slate-300 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <span>Все вопросы</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setSupportModalOpen(true)}
                className="min-h-[34px] px-3 rounded-lg border border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-xs font-medium text-emerald-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <LifeBuoy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Поддержка</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mode Content */}
        <AnimatePresence mode="wait" initial={false}>
        {mode === 'manual' ? (
          <motion.div
            key="quick-mode-manual"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: TERMINAL_EASE }}
          >
            <PermanentFeaturesManual />
          </motion.div>
        ) : mode === 'chat' ? (
          <motion.div
            key="quick-mode-chat"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: TERMINAL_EASE }}
            className="space-y-3"
          >
            {/* Quick Starter Questions */}
            <div className="flex flex-wrap items-center gap-1.5">
              {STARTER_PROMPTS.map((prompt) => (
                <motion.button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                  onClick={() => void sendQuestion(prompt)}
                  className="min-h-[32px] px-2.5 rounded-lg border border-white/10 bg-[#0B0F17] hover:border-emerald-500/35 hover:text-emerald-200 text-xs text-slate-300 transition-colors disabled:opacity-50 text-left"
                >
                  {prompt}
                </motion.button>
              ))}
              {messages.length > 1 && (
                <motion.button
                  type="button"
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                  onClick={handleResetChat}
                  aria-label="Очистить историю чата"
                  className="min-h-[32px] px-2.5 rounded-lg border border-white/10 bg-[#0B0F17] hover:text-white text-xs text-slate-400 inline-flex items-center gap-1 ml-auto transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Новый диалог</span>
                </motion.button>
              )}
            </div>

            {/* Compact Scrollable Conversation */}
            <div
              ref={threadRef}
              aria-live="polite"
              aria-busy={sending}
              className="max-h-[260px] overflow-y-auto space-y-2.5 pr-1 py-1"
            >
              <AnimatePresence initial={false}>
                {messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <motion.div
                      key={msg.id}
                      layout="position"
                      initial={
                        prefersReducedMotion
                          ? { opacity: 0 }
                          : {
                              opacity: 0,
                              x: isUser ? 14 : -12,
                              y: 8,
                              scale: 0.97,
                            }
                      }
                      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                      exit={
                        prefersReducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, y: -4, scale: 0.97 }
                      }
                      transition={
                        prefersReducedMotion
                          ? { duration: 0.12 }
                          : {
                              x: NATIVE_SPRING,
                              y: NATIVE_SPRING,
                              scale: NATIVE_SPRING,
                              opacity: { duration: 0.16, ease: TERMINAL_EASE },
                              layout: { duration: 0.16, ease: TERMINAL_EASE },
                            }
                      }
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[88%] sm:max-w-[78%] rounded-xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed whitespace-pre-line ${
                          isUser
                            ? 'bg-emerald-600/20 border border-emerald-500/35 text-emerald-50'
                            : 'bg-[#0B0F17] border border-white/8 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[11px] mb-1">
                          <span
                            className={
                              isUser ? 'font-medium text-emerald-300' : 'font-medium text-emerald-400'
                            }
                          >
                            {isUser ? 'Вы' : 'Ассистент Gemini'}
                          </span>
                          <span className="text-slate-500 font-mono tabular-nums">
                            {msg.timestamp}
                          </span>
                        </div>
                        {msg.text}
                      </div>
                    </motion.div>
                  );
                })}

                {sending && (
                  <motion.div
                    key="gemini-typing-indicator"
                    layout="position"
                    role="status"
                    aria-label="Ассистент Gemini печатает ответ"
                    initial={
                      prefersReducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, x: -10, y: 8, scale: 0.96 }
                    }
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    exit={
                      prefersReducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, y: -4, scale: 0.96 }
                    }
                    transition={
                      prefersReducedMotion
                        ? { duration: 0.12 }
                        : {
                            x: NATIVE_SPRING,
                            y: NATIVE_SPRING,
                            scale: NATIVE_SPRING,
                            opacity: { duration: 0.15, ease: TERMINAL_EASE },
                          }
                    }
                    className="flex justify-start"
                  >
                    <div className="rounded-xl bg-[#0B0F17] border border-white/8 px-3.5 py-2.5 space-y-1.5">
                      <div className="text-[11px] font-medium text-emerald-400">
                        Ассистент Gemini
                      </div>
                      <div className="flex items-center gap-2.5 text-xs text-slate-300">
                        <span className="inline-flex items-center gap-1" aria-hidden="true">
                          {TYPING_DOTS.map((dotIdx) => (
                            <motion.span
                              key={dotIdx}
                              className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                              animate={
                                prefersReducedMotion
                                  ? { opacity: 0.7 }
                                  : {
                                      y: [0, -4, 0],
                                      opacity: [0.35, 1, 0.35],
                                      scale: [0.9, 1.15, 0.9],
                                    }
                              }
                              transition={
                                prefersReducedMotion
                                  ? undefined
                                  : {
                                      duration: 0.85,
                                      repeat: Infinity,
                                      ease: 'easeInOut',
                                      delay: dotIdx * 0.15,
                                    }
                              }
                            />
                          ))}
                        </span>
                        <span className="text-slate-400">печатает…</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false}>
              {chatError && (
                <motion.div
                  key="chat-error-banner"
                  role="alert"
                  initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: TERMINAL_EASE }}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{chatError}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {lastFailedPrompt && (
                      <button
                        type="button"
                        onClick={() => void sendQuestion(lastFailedPrompt, { isRetry: true })}
                        className="font-semibold text-white hover:text-emerald-200 whitespace-nowrap"
                      >
                        Повторить
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode('faq')}
                      className="font-semibold text-emerald-300 hover:text-emerald-200 whitespace-nowrap"
                    >
                      Открыть FAQ →
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Message Input Form */}
            <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                maxLength={800}
                disabled={sending}
                aria-label="Задать вопрос помощнику терминала"
                placeholder="Задайте вопрос о работе терминала (например: как подключить 2FA или алерты?)..."
                className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-white/10 bg-[#0B0F17] px-3.5 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-60"
              />
              <motion.button
                type="submit"
                disabled={sending || inputValue.trim().length < 2}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                aria-label="Отправить вопрос"
                className="min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <Send className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">
                  {sending ? 'Печатает…' : 'Спросить'}
                </span>
              </motion.button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="quick-mode-faq"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: TERMINAL_EASE }}
            className="grid grid-cols-1 md:grid-cols-2 gap-x-6"
          >
            {QUICK_ANSWERS.map((item, index) => {
              const isOpen = openId === item.id;
              const panelId = `quick-answer-panel-${item.id}`;
              return (
                <div
                  key={item.id}
                  className="border-b border-white/6 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => handleToggle(item.id)}
                    className="w-full min-h-[46px] py-2.5 text-left flex items-start justify-between gap-3 group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        <span className="font-mono text-emerald-400">
                          {String(index + 1).padStart(2, '0')}.
                        </span>{' '}
                        <span>{item.topic}</span>
                      </div>
                      <div
                        className={`text-xs sm:text-[13px] font-medium leading-snug transition-colors ${
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
                        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                        transition={{ duration: 0.16, ease: TERMINAL_EASE }}
                        className="pb-3 pr-5 space-y-2"
                      >
                        <p className="text-xs text-slate-300 leading-relaxed">{item.answer}</p>
                        {item.actionId && item.actionLabel && (
                          <button
                            type="button"
                            onClick={() => handleAction(item.actionId)}
                            className="text-xs font-medium text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 transition-colors"
                          >
                            <span>{item.actionLabel}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        )}
        </AnimatePresence>

        {/* Footer Support CTA */}
        <div className="pt-3 border-t border-white/8 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            Нужна помощь по вашему аккаунту или нестандартный вопрос? Напишите команде терминала.
          </span>
          <button
            type="button"
            onClick={() => setSupportModalOpen(true)}
            className="font-medium text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <span>Связаться с поддержкой</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      <SupportContactModal
        open={supportModalOpen}
        isSignedIn={isSignedIn}
        defaultEmail={userEmail}
        tickets={supportTickets}
        onClose={() => setSupportModalOpen(false)}
        onRequireLogin={onRequireLogin}
        onSubmitTicket={onCreateSupportTicket}
      />
    </>
  );
};

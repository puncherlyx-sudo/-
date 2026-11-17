import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppTab } from '../types/domain';

export const TOUR_STORAGE_KEY = 'aegisquant_tour_completed_v1';

interface TourStep {
  id: string;
  tab: AppTab;
  tabLabel: string;
  targetId: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'market-toolbar',
    tab: 'market',
    tabLabel: 'Рынок',
    targetId: 'tour-market-toolbar',
    title: 'Спот, Фьючерсы и недельные кредиты',
    description:
      'Переключайтесь между Спотом и Фьючерсами, выбирайте любую из 44 ликвидных пар и таймфрейм. На бесплатном тарифе каждую неделю обновляются 15 кредитов анализа (Спот 1 кр., Фьючерсы 2 кр.).',
  },
  {
    id: 'market-ribbon',
    tab: 'market',
    tabLabel: 'Рынок',
    targetId: 'tour-ma-ribbon',
    title: 'Индикатор тренда MA Ribbon и настройка периодов',
    description:
      'Включайте ленту из 4 скользящих средних (EMA 8·13·21·55 доступна бесплатно), а в PRO открывайте переключение SMA, готовые пресеты и собственные периоды от 2 до 200.',
  },
  {
    id: 'market-ai',
    tab: 'market',
    tabLabel: 'Рынок',
    targetId: 'tour-market-ai',
    title: 'AI-анализ графика и риск-менеджмент',
    description:
      'Выберите стратегию (4 базовые на Free, все 9 в PRO), укажите депозит и риск. Терминал совмещает свечные индикаторы, новостной фон и рассчитывает зону входа, Stop-Loss и Take-Profit.',
  },
  {
    id: 'screener-overview',
    tab: 'screener',
    tabLabel: 'Скринер',
    targetId: 'tour-screener-overview',
    title: 'Скринер рынка, тепловая карта и портфель',
    description:
      'Фильтруйте 44 ликвидные пары по импульсу и объёму, добавляйте активы в избранное, ведите учебный спот-портфель с расчётом PnL и выгружайте отчёты в CSV в PRO.',
  },
  {
    id: 'strategies-pnl',
    tab: 'strategies',
    tabLabel: 'Стратегии',
    targetId: 'tour-strategies-pnl',
    title: 'Доходность стратегий (PnL) и лимиты PRO',
    description:
      'Сравнивайте кривую доходности стратегий на графике. На тарифе PRO открываются все 9 стратегий, до 20 сигналов в сутки, плечо до 20x и 4H-бэктесты.',
  },
  {
    id: 'news-calendar',
    tab: 'news',
    tabLabel: 'Новости',
    targetId: 'tour-news-calendar',
    title: 'Экономический календарь и новости',
    description:
      'Отслеживайте ключевые макро- и криптособытия уровня HIGH (CPI, ФРС, ETF, экспирации) и живую ленту новостей с оценкой бычьего или медвежьего сентимента.',
  },
  {
    id: 'security-center',
    tab: 'security',
    tabLabel: 'Безопасность',
    targetId: 'tour-security-meter',
    title: '2FA, Push-оповещения и контроль сессий',
    description:
      'Повышайте индекс защиты профиля: подключите TOTP 2FA и 8 резервных кодов, настройте критические Push-уведомления на Android и управляйте активными сессиями устройств.',
  },
];

interface InterfaceTourProps {
  open: boolean;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onClose: (completed: boolean) => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const InterfaceTour: React.FC<InterfaceTourProps> = ({
  open,
  activeTab,
  onSelectTab,
  onClose,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const currentStep = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];

  // Reset to first step whenever tour opens
  useEffect(() => {
    if (open) {
      setStepIndex(0);
    } else {
      setRect(null);
    }
  }, [open]);

  const measureTarget = useCallback(() => {
    if (!open || typeof document === 'undefined') return;
    const el = document.querySelector<HTMLElement>(`[data-tour-id="${currentStep.targetId}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  }, [open, currentStep.targetId]);

  // Switch tab if needed, notify sub-tabs to activate target section, scroll into view, and measure
  useEffect(() => {
    if (!open) return;
    if (activeTab !== currentStep.tab) {
      onSelectTab(currentStep.tab);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aegis:tour-focus', { detail: currentStep.targetId }));
    }

    const focusTimer = setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aegis:tour-focus', { detail: currentStep.targetId }));
      }
    }, 120);

    const scrollTimer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${currentStep.targetId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      measureTarget();
    }, 280);

    const settleTimer = setTimeout(() => {
      measureTarget();
    }, 580);

    return () => {
      clearTimeout(focusTimer);
      clearTimeout(scrollTimer);
      clearTimeout(settleTimer);
    };
  }, [open, stepIndex, activeTab, currentStep.tab, currentStep.targetId, onSelectTab, measureTarget]);

  // Sync spotlight rect on scroll/resize
  useEffect(() => {
    if (!open) return;
    const handleSync = () => measureTarget();
    window.addEventListener('resize', handleSync);
    window.addEventListener('scroll', handleSync, true);
    return () => {
      window.removeEventListener('resize', handleSync);
      window.removeEventListener('scroll', handleSync, true);
    };
  }, [open, measureTarget]);

  // Keyboard Escape support
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleFinish = () => {
    onSelectTab('market');
    onClose(true);
  };

  // Compute safe tooltip coordinates clamped inside viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const tooltipW = Math.min(370, vw - 24);
  const tooltipH = tooltipRef.current?.offsetHeight || 230;
  const topReserve = vw < 768 ? 62 : 76;
  const bottomReserve = vw < 768 ? 80 : 16;

  let tooltipTop = Math.max(topReserve, Math.round((vh - tooltipH) / 2));
  let tooltipLeft = Math.round((vw - tooltipW) / 2);

  if (rect) {
    const spaceBelow = vh - bottomReserve - (rect.top + rect.height);
    const spaceAbove = rect.top - topReserve;

    if (spaceBelow >= tooltipH + 14) {
      tooltipTop = rect.top + rect.height + 14;
    } else if (spaceAbove >= tooltipH + 14) {
      tooltipTop = rect.top - tooltipH - 14;
    } else {
      tooltipTop = Math.min(
        vh - bottomReserve - tooltipH,
        Math.max(topReserve, rect.top + 16)
      );
    }

    const centeredLeft = rect.left + rect.width / 2 - tooltipW / 2;
    tooltipLeft = Math.min(vw - tooltipW - 12, Math.max(12, Math.round(centeredLeft)));
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="interface-tour-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose(false);
            }
          }}
        >
          {/* Backdrop when target is missing, or Spotlight cutout overlay */}
          {rect ? (
            <motion.div
              aria-hidden="true"
              animate={{
                top: Math.max(4, rect.top - 6),
                left: Math.max(4, rect.left - 6),
                width: Math.min(vw - 8, rect.width + 12),
                height: rect.height + 12,
              }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              className="fixed rounded-2xl border-2 border-emerald-400/85 pointer-events-none"
              style={{
                boxShadow: '0 0 0 9999px rgba(6, 9, 15, 0.76)',
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              className="fixed inset-0 bg-[#06090F]/75 pointer-events-none"
            />
          )}

          {/* Floating Tooltip Card */}
          <motion.div
            ref={tooltipRef}
            key={currentStep.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{
              top: tooltipTop,
              left: tooltipLeft,
              width: tooltipW,
            }}
            className="fixed z-[51] rounded-2xl border border-emerald-500/35 bg-[#111827] shadow-2xl p-5 space-y-4"
          >
            {/* Header & Close */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] text-emerald-400 font-mono tabular-nums">
                  Шаг {stepIndex + 1} из {TOUR_STEPS.length}
                  <span aria-hidden="true" className="mx-1.5 text-slate-600">
                    ·
                  </span>
                  <span className="font-sans text-slate-400">Раздел «{currentStep.tabLabel}»</span>
                </div>
                <h3 id="interface-tour-title" className="mt-1 text-base font-semibold text-white">
                  {currentStep.title}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => onClose(false)}
                aria-label="Закрыть тур по интерфейсу"
                className="min-h-[34px] min-w-[34px] rounded-lg text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {currentStep.description}
            </p>

            {/* Step Progress Segments */}
            <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
              {TOUR_STEPS.map((st, idx) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStepIndex(idx)}
                  aria-label={`Перейти к шагу ${idx + 1}`}
                  className={`h-1.5 rounded-full transition-colors ${
                    idx <= stepIndex
                      ? idx === stepIndex
                        ? 'bg-emerald-400'
                        : 'bg-emerald-600/70'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                />
              ))}
            </div>

            {/* Footer Controls */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/8">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="min-h-[40px] px-2.5 text-xs font-medium text-slate-400 hover:text-white transition-colors whitespace-nowrap"
              >
                Пропустить
              </button>

              <div className="flex items-center gap-2">
                {stepIndex > 0 && (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                    className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Назад</span>
                  </motion.button>
                )}

                {stepIndex < TOUR_STEPS.length - 1 ? (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setStepIndex((prev) => Math.min(TOUR_STEPS.length - 1, prev + 1))}
                    className="min-h-[40px] px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-all"
                  >
                    <span>Далее</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={handleFinish}
                    className="min-h-[40px] px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-amber-500 hover:from-emerald-500 hover:to-amber-400 text-xs font-semibold text-white whitespace-nowrap transition-all"
                  >
                    Начать работу
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

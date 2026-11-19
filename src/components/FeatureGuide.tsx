import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { triggerHaptic } from '../lib/securityDlp';

interface FeatureGuideProps {
  title: string;
  summary: string;
  steps?: string[];
  className?: string;
  defaultOpen?: boolean;
  compact?: boolean;
}

/**
 * Compact, permanently available inline "Как это работает?" guide banner.
 * Keeps the terminal clean by default while letting any client tap to understand
 * exactly how each feature works and how to apply it.
 */
export const FeatureGuide: React.FC<FeatureGuideProps> = ({
  title,
  summary,
  steps = [],
  className = '',
  defaultOpen = false,
  compact = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const headingText = /^как\s/i.test(title.trim()) ? title : `Как работает: ${title}`;

  return (
    <div className={`rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] ${className}`}>
      <button
        type="button"
        onClick={() => {
          triggerHaptic(6);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className={`w-full ${compact ? 'min-h-[32px] px-2.5 py-1' : 'min-h-[34px] px-3 py-1.5'} flex items-center justify-between gap-2 text-left text-[11px] font-medium text-emerald-200 hover:text-white transition-colors`}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <HelpCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{headingText}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/80 shrink-0">
          <span>{open ? 'Скрыть' : 'Инструкция'}</span>
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-emerald-500/15 space-y-2 text-[11px] text-slate-300 leading-relaxed">
              <p>{summary}</p>
              {steps.length > 0 && (
                <ol className="space-y-1 list-decimal list-inside text-slate-200/95">
                  {steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export interface VernierManualSection {
  id: string;
  tabLabel: string;
  title: string;
  tier: 'FREE' | 'PRO' | 'MAX';
  summary: string;
  howToUse: string[];
}

export const VERNIER_MANUAL_SECTIONS: VernierManualSection[] = [
  {
    id: 'market-chart',
    tabLabel: 'Рынок',
    title: 'Терминал, График и PRO-слои (SMC / VPVR)',
    tier: 'FREE',
    summary:
      'Живой свечной график 44+ пар (Спот и Фьючерсы) с переключением между встроенным графиком и TradingView, индикаторами EMA/Bollinger/MA Ribbon, зонами Smart Money (S/R, Order Blocks, FVG, BOS/CHoCH) и профилем объёма VPVR (POC/VAH/VAL).',
    howToUse: [
      'Выберите пару, тип рынка (Спот/Фьючерсы) и таймфрейм (15M–1D) в верхней панели терминала.',
      'Включите нужные PRO-слои над графиком, чтобы увидеть ликвидность, дисбалансы FVG и уровни поддержки/сопротивления.',
      'Нажмите на колокольчик рядом с тикером, чтобы создать ценовой или индикаторный Smart Alert (RSI, EMA50/200, объём).',
    ],
  },
  {
    id: 'market-derivatives',
    tabLabel: 'Рынок',
    title: 'Сессии, Fear & Greed, Радар 44 пар и Ликвидации',
    tier: 'MAX',
    summary:
      'Показывает активную торговую сессию (Азия / Лондон / Нью-Йорк), таймер открытия NY, живой индекс страха и жадности, перегрев Funding Rate, аномалии Open Interest/CVD и карту кластеров ликвидаций.',
    howToUse: [
      'Отслеживайте перекрытие Лондон + Нью-Йорк — это окно максимальной ликвидности.',
      'В «Радаре 44» нажмите на любую пару с аномалией Funding/OI/CVD, чтобы сразу открыть её на графике.',
      'В «Ликвидациях» смотрите ближайшие магнитные кластеры 10x–100x — туда цена часто делает «вынос стопов».',
    ],
  },
  {
    id: 'market-ai-paper',
    tabLabel: 'Рынок',
    title: 'AI-анализ, Консилиум, Монте-Карло и Paper Trading',
    tier: 'PRO',
    summary:
      'AI-модуль рассчитывает точки входа, Stop-Loss и каскадные Take-Profit (TP1/TP2/TP3) на базе живых свечей и новостей. В MAX доступны 3-агентный AI-Консилиум, симуляция Монте-Карло (1 000 прогонов) и демо-торговля Paper Trading ($10,000).',
    howToUse: [
      'Перейдите в раздел «AI-анализ и риск», выберите стратегию и нажмите «Запустить AI-анализ».',
      'Отрабатывайте идеи без риска в Paper Trading: закрытые демо-сделки автоматически сохраняются в Дневник.',
      'При отправке реального ордера через ваш API-ключ терминал каждый раз запрашивает двойное подтверждение ответственности.',
    ],
  },
  {
    id: 'screener-all',
    tabLabel: 'Скринер',
    title: 'Таблица 44 пар, Паттерны, Сектора, Арбитраж и Портфель',
    tier: 'PRO',
    summary:
      'Полноэкранный отбор монет по 24ч импульсу, объёму, волатильности и Funding. Включает Live-сканер паттернов (RSI-дивергенции, Bollinger Squeeze), тепловую карту секторов (L1/L2/DeFi/AI/Meme), матрицу корреляций к BTC и сканер дельта-нейтрального Funding-арбитража.',
    howToUse: [
      'Используйте фильтры «Топ роста», «Высокий объём» или кастомные вотчлисты в «Таблице».',
      'В «Секторах» проверяйте, какие категории лидируют сегодня, и тапайте по плитке для перехода к лидеру.',
      'В «Портфеле» добавьте свои монеты (или подключите Read-Only API биржи), чтобы отслеживать общий PnL и цели доходности.',
    ],
  },
  {
    id: 'strategies-catalog',
    tabLabel: 'Стратегии',
    title: 'Каталог 27 стратегий, AI-сканер сетапов и Sentiment PRO',
    tier: 'FREE',
    summary:
      '27 готовых алгоритмов для Спота (18) и Фьючерсов (9), включая 9 эксклюзивных MAX-стратегий с историческим Win Rate 55%+. AI-сканер автоматически проверяет 44 пары, а Sentiment PRO объединяет Fear & Greed, ширину рынка, Funding и новости.',
    howToUse: [
      'Отфильтруйте каталог по рынку (Спот / Фьючерсы) или тарифу и включите нужные стратегии кнопкой «Вкл / Выкл».',
      'Нажмите «Настроить» на карточке, чтобы задать риск на сделку (%), минимальную уверенность и торговые пары.',
      'В «Sentiment PRO» сравнивайте реальный исторический Win Rate стратегии против базовых Free-алгоритмов.',
    ],
  },
  {
    id: 'strategies-risk-journal',
    tabLabel: 'Стратегии',
    title: 'Калькулятор риска, Дневник сделок и AI-коуч',
    tier: 'PRO',
    summary:
      'Калькулятор автоматически вычисляет объём позиции в USDT и монетах, ориентировочную цену ликвидации и 3 цели TP. Дневник строит Equity Curve, тепловой PnL-календарь и включает AI-коуча по дисциплине.',
    howToUse: [
      'В «Калькуляторе» нажмите «Из портфеля», выберите риск (0.5%–2%), введите вход и Stop-Loss — объём рассчитается сам.',
      'Сохраняйте сделки в «Дневник» одной кнопкой и закрывайте их по факту, чтобы видеть реальный Profit Factor и Win Rate.',
      'Открывайте подвкладку «AI-коуч» для аудита лучших торговых сессий, риска плеча и защиты Анти-FOMO.',
    ],
  },
  {
    id: 'news-calendar',
    tabLabel: 'Новости',
    title: 'Лента криптоновостей (RU/EN), AI-дайджест и Эконом. календарь',
    tier: 'FREE',
    summary:
      'Агрегация свежих новостей (CoinDesk, Cointelegraph, Decrypt) с автоматическим переводом на русский, тегами активов (#BTC, #ETH, #MACRO), прогнозом влияния, 24ч AI-дайджестом и макроэкономическим календарём в вашем локальном часовом поясе.',
    howToUse: [
      'Переключайте язык RU / EN в верхней панели раздела и фильтруйте ленту по тегам активов.',
      'Нажимайте «AI-влияние на рынок» под любой новостью, чтобы оценить ожидаемую волатильность и затронутые монеты.',
      'В «Эконом. календаре» включайте фильтр «Только High» перед заседаниями ФРС, публикацией CPI и экспирацией опционов.',
    ],
  },
  {
    id: 'security-hub',
    tabLabel: 'Защита',
    title: 'Центр защиты, Non-Custodial API, 2FA, PIN и Демо-режим тарифа',
    tier: 'FREE',
    summary:
      'VERNIER работает по Non-Custodial архитектуре: мы не принимаем и не храним деньги клиентов. В «Защите» настраиваются Read-Only / Trade API-ключи (AES-GCM), 2FA (TOTP), PIN-код, Privacy Mode, OLED-тема, Анти-FOMO Tilt-Guard и Демо-переключатель тарифов.',
    howToUse: [
      'Для безопасного тестирования всех PRO и MAX модулей используйте «Тест-режим тарифа (FREE / PRO / MAX)» в секции «Интерфейс и демо-режим».',
      'Подключайте биржевые ключи в «Интеграции бирж» — рекомендуем начинать с прав только на чтение (Read-Only) и отключённого вывода средств.',
      'Включите 2FA или 4-значный PIN-код для защиты ваших настроек, ключей и журнала сделок.',
    ],
  },
];

export const PermanentFeaturesManual: React.FC = () => {
  const [expandedId, setExpandedId] = useState<string | null>(VERNIER_MANUAL_SECTIONS[0].id);

  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-slate-200">
        <BookOpen className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <div className="font-semibold text-white">Полный справочник функций VERNIER</div>
          <p className="mt-0.5 text-[11px] text-slate-300">
            Нажмите на любой раздел ниже, чтобы узнать, как работает инструмент и как применять его в торговле. Также в каждом модуле терминала есть кнопка «Как работает».
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {VERNIER_MANUAL_SECTIONS.map((sec) => {
          const isOpen = expandedId === sec.id;
          return (
            <div
              key={sec.id}
              className="rounded-xl border border-white/10 bg-[var(--surface-0)] overflow-hidden"
            >
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(6);
                  setExpandedId((prev) => (prev === sec.id ? null : sec.id));
                }}
                aria-expanded={isOpen}
                className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-white/8 text-slate-300">
                      {sec.tabLabel}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        sec.tier === 'MAX'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : sec.tier === 'PRO'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {sec.tier}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-white leading-snug">
                    {sec.title}
                  </div>
                </div>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3.5 pb-3.5 pt-2 border-t border-white/8 space-y-2 text-[11px] text-slate-300 leading-relaxed">
                      <p>{sec.summary}</p>
                      <div className="pt-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400 mb-1">
                          Как пользоваться:
                        </div>
                        <ol className="space-y-1 list-decimal list-inside text-slate-200">
                          {sec.howToUse.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};

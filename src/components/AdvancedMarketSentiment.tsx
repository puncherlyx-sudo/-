import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Crown,
  Gauge,
  Lock,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { CREDIT_COSTS, MAX_X10_MONTHLY_QUOTA, MAX_X20_MONTHLY_QUOTA } from '../data/strategies';
import { useFearGreed } from '../contexts/FearGreedContext';
import { usePlan } from '../contexts/PlanContext';
import { authFetch } from '../lib/authFetch';
import { decodeHtmlEntities } from '../utils/htmlEntities';
import { FeatureGuide } from './FeatureGuide';
import type { AdvancedSentimentReport, MarketType, SentimentComparisonRow } from '../types/domain';

interface AdvancedMarketSentimentProps {
  isPro: boolean;
  isMax?: boolean;
  isSignedIn: boolean;
  creditsRemaining?: number;
  onUpgradePro: () => void;
  onUpgradeMax: (multiplier?: 10 | 20) => void;
  onConsumeCredits?: (amount: number, auditReason?: string) => Promise<boolean>;
  onOpenPairOnMarket?: (symbol: string, marketType: MarketType) => void;
}

const ASSET_OPTIONS = ['ALL', 'BTC', 'ETH', 'SOL', 'TON', 'XRP'] as const;

const BIAS_META: Record<
  AdvancedSentimentReport['forecastBias'],
  { label: string; accentClass: string; badgeClass: string; barColor: string }
> = {
  BULLISH_EXPANSION: {
    label: 'Бычий импульс',
    accentClass: 'text-emerald-400',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300',
    barColor: 'bg-emerald-400',
  },
  ACCUMULATION_BIAS: {
    label: 'Зона накопления',
    accentClass: 'text-cyan-300',
    badgeClass: 'border-cyan-500/35 bg-cyan-500/12 text-cyan-200',
    barColor: 'bg-cyan-400',
  },
  NEUTRAL_ROTATION: {
    label: 'Баланс / Ротация',
    accentClass: 'text-amber-300',
    badgeClass: 'border-amber-500/35 bg-amber-500/12 text-amber-200',
    barColor: 'bg-amber-400',
  },
  RISK_OFF_HEDGING: {
    label: 'Защитный режим',
    accentClass: 'text-rose-400',
    badgeClass: 'border-rose-500/35 bg-rose-500/12 text-rose-300',
    barColor: 'bg-rose-400',
  },
};

function formatSigned(val: number, suffix = ''): string {
  return `${val >= 0 ? '+' : ''}${val}${suffix}`;
}

export const AdvancedMarketSentiment: React.FC<AdvancedMarketSentimentProps> = ({
  isPro: isProProp,
  isMax: isMaxProp = false,
  isSignedIn,
  creditsRemaining,
  onUpgradePro,
  onUpgradeMax,
  onConsumeCredits,
  onOpenPairOnMarket,
}) => {
  const planCtx = usePlan();
  const { syncFromExternal } = useFearGreed();
  const isMax = isMaxProp || planCtx.isMax;
  const isPro = isProProp || planCtx.isPro || isMax;

  const [asset, setAsset] = useState<(typeof ASSET_OPTIONS)[number]>('ALL');
  const [interval, setInterval] = useState<'1h' | '4h' | '1d'>('4h');
  const [report, setReport] = useState<AdvancedSentimentReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPro && interval !== '1h') {
      setInterval('1h');
    } else if (isPro && !isMax && interval === '1d') {
      setInterval('4h');
    }
  }, [isPro, isMax, interval]);

  const effectiveInterval: '1h' | '4h' | '1d' = isMax
    ? interval
    : isPro
      ? interval === '1d'
        ? '4h'
        : interval
      : '1h';

  const effectiveTierForApi: 'free' | 'pro' | 'max' = isMax ? 'max' : isPro ? 'pro' : 'free';

  const fetchSentiment = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/strategies/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset,
          interval: effectiveInterval,
          ...(effectiveTierForApi !== 'free' ? { demoTier: effectiveTierForApi } : {}),
        }),
      });
      const json = (await res.json()) as AdvancedSentimentReport & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Не удалось загрузить данные сентимента.');
      }
      setReport(json);
      if (json.fearGreed && typeof json.fearGreed.value === 'number') {
        syncFromExternal(json.fearGreed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки модуля Advanced Market Sentiment.');
    } finally {
      setLoading(false);
    }
  }, [asset, effectiveInterval, effectiveTierForApi, syncFromExternal]);

  useEffect(() => {
    void fetchSentiment();
  }, [fetchSentiment]);

  const needsProCredit = Boolean(isPro && !isMax && isSignedIn && !planCtx.isDemoOverride);
  const isOutOfProCredits = Boolean(
    needsProCredit &&
      typeof creditsRemaining === 'number' &&
      creditsRemaining < CREDIT_COSTS.sentimentForecast
  );

  const handleManualRefresh = async () => {
    setError(null);
    if (!isPro) {
      onUpgradePro();
      return;
    }
    if (isOutOfProCredits) {
      onUpgradeMax(10);
      return;
    }
    if (needsProCredit && onConsumeCredits) {
      try {
        await onConsumeCredits(
          CREDIT_COSTS.sentimentForecast,
          `Обновление прогноза Advanced Market Sentiment (${asset}, ${effectiveInterval.toUpperCase()})`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Недостаточно кредитов для обновления прогноза.');
        return;
      }
    }
    await fetchSentiment();
  };

  const biasMeta = report ? BIAS_META[report.forecastBias] : BIAS_META.NEUTRAL_ROTATION;
  const sentimentRow = report?.comparison.sentimentStrategy ?? null;
  const comparisonRows: SentimentComparisonRow[] = report
    ? [
        ...(sentimentRow ? [sentimentRow] : []),
        ...report.comparison.freeStrategies,
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Header + Controls */}
      <section className="rounded-2xl border border-white/8 bg-[#111827] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className={isMax ? 'text-cyan-300 font-semibold' : 'text-amber-300 font-semibold'}>
                {isMax ? 'MAX Институциональный модуль' : 'PRO Эксклюзив'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Синхронизация Fear & Greed + Funding + Новости + OHLCV</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-300">
                {isMax ? '0 кр. · безлимит в MAX' : `${CREDIT_COSTS.sentimentForecast} кр. за ручное обновление`}
              </span>
            </div>
            <h2 className="mt-1.5 text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <Gauge className="w-5 h-5 text-cyan-400 shrink-0" />
              <span>Advanced Market Sentiment</span>
            </h2>
            <p className="mt-1 text-xs text-slate-400 max-w-3xl leading-relaxed">
              Комплексный прогноз рыночных настроений и фактическое сравнение исторического Win Rate стратегии
              «Advanced Market Sentiment» против базовых бесплатных алгоритмов на реальных свечах биржи.
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleManualRefresh()}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              !isPro
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                : isMax
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                  : 'border border-white/12 bg-white/5 hover:bg-white/10 text-white'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>
              {!isPro
                ? 'Открыть в PRO / MAX'
                : isMax
                  ? 'Обновить (0 кр. · MAX)'
                  : isOutOfProCredits
                    ? 'Безлимит в MAX (×10 / ×20)'
                    : `Обновить прогноз (${CREDIT_COSTS.sentimentForecast} кр.)`}
            </span>
          </button>
        </div>

        {/* Asset & Timeframe Filter Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/8">
          <div className="inline-flex flex-wrap items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            {ASSET_OPTIONS.map((item) => {
              const active = asset === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setAsset(item)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-mono font-medium transition-colors ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item === 'ALL' ? 'Весь рынок' : item}
                </button>
              );
            })}
          </div>

          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            <button
              type="button"
              onClick={() => setInterval('1h')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-mono font-medium transition-colors ${
                effectiveInterval === '1h' ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              1H · ~4д
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isPro) {
                  onUpgradePro();
                  return;
                }
                setInterval('4h');
              }}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-mono font-medium inline-flex items-center gap-1 transition-colors ${
                effectiveInterval === '4h' ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {!isPro && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
              <span>4H · ~15д</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isMax) {
                  onUpgradeMax(10);
                  return;
                }
                setInterval('1d');
              }}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-mono font-medium inline-flex items-center gap-1 transition-colors ${
                effectiveInterval === '1d'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35'
                  : 'text-slate-400 hover:text-cyan-200'
              }`}
              title="Глубокий горизонт 1D (~90д) доступен на тарифе MAX"
            >
              {!isMax ? (
                <Lock className="w-3 h-3 text-cyan-400 shrink-0" />
              ) : (
                <Sparkles className="w-3 h-3 text-cyan-300 shrink-0" />
              )}
              <span>1D · MAX</span>
            </button>
          </div>
        </div>

        <FeatureGuide
          title="Advanced Market Sentiment (PRO / MAX)"
          summary="Модуль рассчитывает сводный индекс настроений рынка (0–100) из 4 независимых источников: Fear & Greed, ширины спота (доля растущих пар из 44), средней ставки Funding фьючерсов и новостных катализаторов."
          steps={[
            'Выберите актив («Весь рынок» или конкретную монету) и горизонт (1H, 4H в PRO, 1D в MAX).',
            'Смотрите таблицу «Исторический Win Rate» — она показывает фактическую точность сентимент-стратегии против базовых Free-алгоритмов на свечах.',
            'Нажмите на кнопку пары рядом с любым новостным катализатором, чтобы сразу открыть её на графике.',
          ]}
        />
      </section>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !report && (
        <div className="h-[260px] rounded-2xl border border-white/8 bg-[#111827] animate-pulse flex items-center justify-center text-xs text-slate-400">
          Рассчитываем композитный индекс сентимента и реальный Win Rate по свечам…
        </div>
      )}

      {/* Locked Free Preview (only when effective plan is FREE) */}
      {report && !isPro && (
        <section className="rounded-2xl border border-amber-500/30 bg-[#111827] p-5 sm:p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <Lock className="w-3.5 h-3.5" />
                <span>Модуль доступен только на PRO и MAX</span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                {report.forecastHeadline}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {report.forecastSummary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onUpgradePro}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <Crown className="w-4 h-4" />
                <span>Открыть в PRO</span>
              </button>
              <button
                type="button"
                onClick={() => onUpgradeMax(10)}
                className="min-h-[42px] px-4 rounded-xl border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-cyan-300" />
                <span>MAX · ×10 / ×20 ({MAX_X10_MONTHLY_QUOTA}–{MAX_X20_MONTHLY_QUOTA} кр.)</span>
              </button>
            </div>
          </div>

          {/* Live Public Market Pulse Preview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-white/8 text-xs font-mono tabular-nums">
            <div>
              <div className="font-sans text-slate-400">Публичный индекс (превью)</div>
              <div className="mt-1 text-xl font-bold text-white">{report.compositeScore} / 100</div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-500">Полный прогноз в PRO</div>
            </div>
            <div>
              <div className="font-sans text-slate-400">Fear & Greed сейчас</div>
              <div className="mt-1 text-xl font-bold text-amber-300">{report.fearGreed.value}</div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-400">
                {report.fearGreed.classificationRu}
              </div>
            </div>
            <div>
              <div className="font-sans text-slate-400">Ширина спота</div>
              <div className="mt-1 text-xl font-bold text-emerald-400">
                {report.marketBreadth.advancingPct}%
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-400">
                {report.marketBreadth.advancingCount} из {report.marketBreadth.totalPairs} пар в плюсе
              </div>
            </div>
            <div>
              <div className="font-sans text-slate-400">Средний Funding Futures</div>
              <div className="mt-1 text-xl font-bold text-cyan-300">
                {formatSigned(report.marketBreadth.avgFundingRatePct, '%')}
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-500">
                Сравнение Win Rate скрыто на Free
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Full PRO / MAX Dashboard */}
      {report && isPro && (
        <>
          {/* 1. Integrated Sentiment Forecast */}
          <section className="rounded-2xl border border-white/8 bg-[#111827] p-5 sm:p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-semibold ${biasMeta.accentClass}`}>{biasMeta.label}</span>
                  <span className="text-slate-500" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-400">
                    Актив: {report.asset === 'ALL' ? 'Весь рынок (44 пары)' : `${report.asset}/USDT`}
                  </span>
                  <span className="text-slate-500" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-400">ТФ {report.interval.toUpperCase()}</span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white">{report.forecastHeadline}</h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
                  {report.forecastSummary}
                </p>
              </div>

              {/* Composite Score Gauge */}
              <div className="shrink-0 rounded-xl border border-white/10 bg-[#0B0F17] px-4 py-3 min-w-[190px]">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Индекс сентимента</span>
                  <span className={`font-semibold ${biasMeta.accentClass}`}>{biasMeta.label}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="text-2xl font-bold text-white">{report.compositeScore}</span>
                  <span className="text-xs text-slate-500">/ 100</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${biasMeta.barColor}`}
                    style={{ width: `${Math.min(100, Math.max(4, report.compositeScore))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 4-column Telemetry Strip (Hairline Dividers) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-white/8 text-xs font-mono tabular-nums">
              <div>
                <div className="font-sans text-slate-400">Fear & Greed (Сейчас / 7д / 30д)</div>
                <div className="mt-1 text-lg font-bold text-white">
                  {report.fearGreed.value}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({report.fearGreed.classificationRu})
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Вчера {report.fearGreed.yesterdayValue} · 7д {report.fearGreed.weekAgoValue} (
                  <span className={report.fearGreed.delta7d >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {formatSigned(report.fearGreed.delta7d)}
                  </span>
                  ) · 30д {report.fearGreed.monthAgoValue}
                </div>
              </div>

              <div>
                <div className="font-sans text-slate-400">Ширина спотового рынка</div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    report.marketBreadth.advancingPct >= 50 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {report.marketBreadth.advancingPct}% в росте
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {report.marketBreadth.advancingCount}/{report.marketBreadth.totalPairs} пар · ср. 24ч{' '}
                  {formatSigned(report.marketBreadth.avgChange24hPct, '%')}
                </div>
              </div>

              <div>
                <div className="font-sans text-slate-400">Ставка Funding Futures</div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    report.marketBreadth.avgFundingRatePct > 0.04
                      ? 'text-amber-300'
                      : 'text-cyan-300'
                  }`}
                >
                  {formatSigned(report.marketBreadth.avgFundingRatePct, '%')}
                </div>
                <div className="mt-0.5 font-sans text-[11px] text-slate-400">
                  {report.marketBreadth.avgFundingRatePct > 0.04
                    ? 'Повышенный перегрев лонгов'
                    : report.marketBreadth.avgFundingRatePct < 0
                      ? 'Преобладают шорт-позиции'
                      : 'Нейтральный баланс фьючерсов'}
                </div>
              </div>

              <div>
                <div className="font-sans text-slate-400">Баланс новостного фона</div>
                <div className="mt-1 text-lg font-bold text-white">
                  <span className="text-emerald-400">{report.newsBreakdown.bullishCount}</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-slate-300">{report.newsBreakdown.neutralCount}</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">{report.newsBreakdown.bearishCount}</span>
                </div>
                <div className="mt-0.5 font-sans text-[11px] text-slate-400">
                  Позитив / Нейтрал / Негатив
                </div>
              </div>
            </div>
          </section>

          {/* 2. Real Historical Win Rate Comparison vs Free Strategies */}
          <section className="rounded-2xl border border-white/8 bg-[#111827] p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Исторический Win Rate: Advanced Market Sentiment vs Free</span>
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Фактический расчёт по историческим свечам OHLCV ({report.interval.toUpperCase()}) с учётом
                  комиссии 0.08% на сделку. Показатели рассчитываются динамически и не подменяются.
                </p>
              </div>

              {sentimentRow && (
                <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums text-xs">
                  <div>
                    <div className="font-sans text-[11px] text-slate-400">Sentiment Win Rate</div>
                    <div className="text-lg font-bold text-emerald-400">{sentimentRow.winRatePct}%</div>
                  </div>
                  <div className="h-8 w-px bg-white/10" aria-hidden="true" />
                  <div>
                    <div className="font-sans text-[11px] text-slate-400">Разница vs ср. Free</div>
                    <div
                      className={`text-lg font-bold ${
                        report.comparison.winRateDeltaPp >= 0 ? 'text-cyan-300' : 'text-amber-300'
                      }`}
                    >
                      {formatSigned(report.comparison.winRateDeltaPp, ' п.п.')}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {comparisonRows.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-6 text-center text-xs text-slate-400">
                Недостаточно завершённых сделок на выбранном интервале для сравнения Win Rate.
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-white/8 pt-2">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-slate-400">
                      <th className="py-2.5 pr-4 font-medium">Стратегия</th>
                      <th className="py-2.5 px-3 font-medium">Тариф</th>
                      <th className="py-2.5 px-3 font-medium">Винрейт (Win Rate)</th>
                      <th className="py-2.5 px-3 font-medium text-right">Profit Factor</th>
                      <th className="py-2.5 px-3 font-medium text-right">Сделки</th>
                      <th className="py-2.5 pl-3 font-medium text-right">PnL (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                    {comparisonRows.map((row) => {
                      const isSentiment = row.strategyKey === 'spot_advanced_market_sentiment';
                      const barWidth = Math.min(100, Math.max(4, row.winRatePct));
                      return (
                        <tr
                          key={row.strategyKey}
                          className={
                            isSentiment
                              ? 'bg-cyan-500/[0.06]'
                              : 'hover:bg-white/[0.02] transition-colors'
                          }
                        >
                          <td className="py-3 pr-4 font-sans font-medium text-white whitespace-nowrap">
                            {row.name}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`font-mono text-[11px] font-semibold ${
                                isSentiment ? 'text-cyan-300' : 'text-slate-400'
                              }`}
                            >
                              {isSentiment ? 'PRO / MAX' : 'Free'}
                            </span>
                          </td>
                          <td className="py-3 px-3 min-w-[180px]">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`w-12 font-semibold ${
                                  isSentiment ? 'text-emerald-300' : 'text-slate-200'
                                }`}
                              >
                                {row.winRatePct}%
                              </span>
                              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isSentiment ? 'bg-cyan-400' : 'bg-slate-400'
                                  }`}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right text-slate-200">
                            {row.profitFactor.toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-right text-slate-300">{row.tradesCount}</td>
                          <td
                            className={`py-3 pl-3 text-right font-semibold whitespace-nowrap ${
                              row.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatSigned(row.totalPnlPct, '%')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8 text-xs text-slate-400">
              <span>
                Средний Win Rate базовых Free-стратегий:{' '}
                <strong className="font-mono text-white">
                  {report.comparison.freeAverageWinRatePct}%
                </strong>{' '}
                (ср. PnL{' '}
                <strong className="font-mono text-slate-200">
                  {formatSigned(report.comparison.freeAveragePnlPct, '%')}
                </strong>
                )
              </span>
              {!isMax && (
                <button
                  type="button"
                  onClick={() => onUpgradeMax(10)}
                  className="font-semibold text-cyan-300 hover:text-cyan-200 transition-colors"
                >
                  Открыть 1D (~90д) и 0 кр. обновлений в MAX →
                </button>
              )}
            </div>
          </section>

          {/* 3. Grounded News Catalysts */}
          <section className="rounded-2xl border border-white/8 bg-[#111827] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Ключевые новостные катализаторы ({report.newsBreakdown.catalysts.length})</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {isMax ? 'MAX глубина: до 6 катализаторов' : 'PRO глубина: до 3 катализаторов · 6 в MAX'}
              </span>
            </div>

            {report.newsBreakdown.catalysts.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-5 text-xs text-slate-400">
                Свежие новостные драйверы по выбранному фильтру сейчас загружаются. Попробуйте обновить позже.
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {report.newsBreakdown.catalysts.map((item) => {
                  const targetSymbol =
                    item.asset && item.asset !== 'ALL' && !item.asset.endsWith('USDT')
                      ? `${item.asset}USDT`
                      : 'BTCUSDT';
                  const sentimentLabel =
                    item.sentiment === 'BULLISH'
                      ? 'Позитив'
                      : item.sentiment === 'BEARISH'
                        ? 'Негатив'
                        : 'Нейтрально';
                  const sentimentColor =
                    item.sentiment === 'BULLISH'
                      ? 'text-emerald-400'
                      : item.sentiment === 'BEARISH'
                        ? 'text-rose-400'
                        : 'text-slate-400';

                  return (
                    <div key={item.id} className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                          <span className={`font-semibold ${sentimentColor}`}>{sentimentLabel}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-cyan-300">{item.asset}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="font-sans text-slate-400">{item.sourceTitle}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="font-sans text-slate-500">{item.publishedLabel}</span>
                        </div>
                        <div className="text-sm font-medium text-white">{decodeHtmlEntities(item.title)}</div>
                        <p className="text-xs text-slate-400 leading-relaxed">{decodeHtmlEntities(item.summary)}</p>
                      </div>

                      {onOpenPairOnMarket && (
                        <button
                          type="button"
                          onClick={() => onOpenPairOnMarket(targetSymbol, 'spot')}
                          className="min-h-[34px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{targetSymbol.replace('USDT', '')}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Languages,
  Lock,
  Newspaper,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { GroundedNewsItem } from '../types/domain';
import { usePlan } from '../contexts/PlanContext';
import { EconomicCalendarWidget } from './EconomicCalendarWidget';
import { AiComplianceFooter } from './LegalConsentModal';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { PaywallGate } from './PaywallGate';
import { FeatureGuide } from './FeatureGuide';
import { fetchJsonWithBackoff, getCachedValue, setCachedValue } from '../lib/marketCache';
import { triggerHaptic } from '../lib/securityDlp';
import { decodeHtmlEntities } from '../utils/htmlEntities';

type NewsSection = 'feed' | 'calendar';
type NewsLang = 'ru' | 'en';

interface NewsFeedViewProps {
  isPro?: boolean;
  onUpgradePro?: () => void;
}

const ASSET_FILTERS = ['ALL', 'BTC', 'ETH', 'SOL', 'TON', 'MACRO', 'DEFI'] as const;
type AssetTag = (typeof ASSET_FILTERS)[number];

const BULLISH_WORDS = [
  'rally', 'surge', 'soar', 'jump', 'gain', 'bull', 'etf inflow', 'record high', 'ath',
  'approve', 'approval', 'launch', 'partnership', 'adoption', 'upgrade', 'breakout', 'buy',
  'accumulate', 'рост', 'ралли', 'приток', 'одобрен', 'обновил максимум', 'быч', 'вырос',
];

const BEARISH_WORDS = [
  'crash', 'drop', 'fall', 'plunge', 'hack', 'exploit', 'lawsuit', 'sec sues', 'ban',
  'liquidation', 'outflow', 'selloff', 'dump', 'bear', 'decline', 'fraud', 'bankruptcy',
  'падение', 'обвал', 'взлом', 'иск', 'отток', 'ликвидац', 'медвеж', 'снижен',
];

const NEWS_RU_CACHE_KEY = 'vernier_news_ru_translations_v1';

interface CachedRuNewsEntry {
  title: string;
  summary: string;
}

function readRuNewsCache(): Record<string, CachedRuNewsEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NEWS_RU_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedRuNewsEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRuNewsCache(cache: Record<string, CachedRuNewsEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    // Ограничиваем размер кэша последними 120 новостями
    const entries = Object.entries(cache).slice(-120);
    window.localStorage.setItem(NEWS_RU_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore storage errors
  }
}

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

function detectDynamicSentiment(item: GroundedNewsItem): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  let bull = 0;
  let bear = 0;
  for (const w of BULLISH_WORDS) {
    if (hay.includes(w)) bull += 1;
  }
  for (const w of BEARISH_WORDS) {
    if (hay.includes(w)) bear += 1;
  }
  if (bull > bear) return 'BULLISH';
  if (bear > bull) return 'BEARISH';
  if (item.sentiment === 'BULLISH' || item.sentiment === 'BEARISH') return item.sentiment;
  return 'NEUTRAL';
}

function extractTags(item: GroundedNewsItem): AssetTag[] {
  const hay = `${item.asset} ${item.title} ${item.summary}`.toUpperCase();
  const tags: AssetTag[] = [];
  if (hay.includes('BTC') || hay.includes('BITCOIN') || hay.includes('БИТКОИН')) tags.push('BTC');
  if (hay.includes('ETH') || hay.includes('ETHEREUM') || hay.includes('ЭФИР')) tags.push('ETH');
  if (hay.includes('SOL') || hay.includes('SOLANA')) tags.push('SOL');
  if (hay.includes('TON') || hay.includes('TELEGRAM')) tags.push('TON');
  if (
    hay.includes('FED') ||
    hay.includes('CPI') ||
    hay.includes('SEC') ||
    hay.includes('ETF') ||
    hay.includes('ФРС') ||
    hay.includes('ИНФЛЯЦ') ||
    hay.includes('RATE')
  ) {
    tags.push('MACRO');
  }
  if (
    hay.includes('DEFI') ||
    hay.includes('DEX') ||
    hay.includes('SWAP') ||
    hay.includes('STAKING') ||
    hay.includes('L2') ||
    hay.includes('AERO') ||
    hay.includes('UNI')
  ) {
    tags.push('DEFI');
  }
  if (tags.length === 0) tags.push('BTC');
  return tags;
}

function buildAiImpactForecast(
  item: GroundedNewsItem,
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  tags: AssetTag[]
): { line1: string; line2: string } {
  const assetsStr = tags.filter((t) => t !== 'ALL').slice(0, 3).join(', ');
  const isMacro = tags.includes('MACRO');
  if (sentiment === 'BULLISH') {
    return {
      line1: `Ожидается умеренно-повышенная волатильность (${isMacro ? '±2.5–4.5%' : '±1.5–3.0%'}) с приоритетом покупателей на ближайшие 4–12ч.`,
      line2: `Затронутые активы: ${assetsStr}. Вероятно усиление притока ликвидности при подтверждении объёмом на 1H.`,
    };
  }
  if (sentiment === 'BEARISH') {
    return {
      line1: `Повышенный риск резкого импульса вниз (${isMacro ? '±3.0–5.0%' : '±2.0–4.0%'}) и срабатывания близких стоп-лоссов.`,
      line2: `Затронутые активы: ${assetsStr}. Рекомендуется снизить плечо и дождаться стабилизации свечи 1H.`,
    };
  }
  return {
    line1: `Ожидается нейтральная реакция рынка (волатильность в пределах ±0.8–1.5%) без слома старшего тренда.`,
    line2: `Затронутые активы: ${assetsStr}. Новость выступает фоновым драйвером — ориентируйтесь на технические уровни.`,
  };
}

export const NewsFeedView: React.FC<NewsFeedViewProps> = ({ isPro = false, onUpgradePro }) => {
  const planCtx = usePlan();
  const effIsPro = isPro || planCtx.isPro;

  const [section, setSection] = useState<NewsSection>('feed');
  const [selectedTag, setSelectedTag] = useState<AssetTag>('ALL');
  const [lang, setLang] = useState<NewsLang>('ru');
  const [visibleCount, setVisibleCount] = useState<number>(8);
  const [expandedImpactIds, setExpandedImpactIds] = useState<Record<string, boolean>>({});
  const [digestOpen, setDigestOpen] = useState<boolean>(false);

  const cacheKey = `news_feed_${selectedTag}`;
  const cachedInit = getCachedValue<{ items: GroundedNewsItem[]; grounded: boolean; updatedAt: string }>(cacheKey);

  const [items, setItems] = useState<GroundedNewsItem[]>(() => cachedInit?.data.items ?? []);
  const [grounded, setGrounded] = useState<boolean>(() => cachedInit?.data.grounded ?? false);
  const [loading, setLoading] = useState<boolean>(() => !cachedInit);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(() => cachedInit?.data.updatedAt ?? null);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-news-calendar') {
        setSection('calendar');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  const loadNews = useCallback(
    async (forceRefresh = false) => {
      const apiSymbol =
        selectedTag === 'BTC' || selectedTag === 'ETH' || selectedTag === 'SOL' || selectedTag === 'TON'
          ? `${selectedTag}USDT`
          : 'ALL';
      const key = `news_feed_${apiSymbol}`;
      const cached = getCachedValue<{ items: GroundedNewsItem[]; grounded: boolean; updatedAt: string }>(key);
      if (!forceRefresh && cached?.isFresh) {
        setItems(cached.data.items);
        setGrounded(cached.data.grounded);
        setLastUpdatedAt(cached.data.updatedAt);
        setLoading(false);
        return;
      }
      if (!cached) setLoading(true);
      setErrorMsg(null);

      const refreshParam = forceRefresh ? '&refresh=1' : '';
      const res = await fetchJsonWithBackoff<{
        items?: GroundedNewsItem[];
        grounded?: boolean;
        updatedAt?: string;
        error?: string;
      }>(`/api/news?symbol=${apiSymbol}${refreshParam}`, { retries: 2, timeoutMs: 14000 });

      if (!res.ok || !res.data) {
        setErrorMsg(res.errorMessage || 'Не удалось обновить новостную ленту.');
        setLoading(false);
        return;
      }

      const nextItems = res.data.items || [];
      const nextUpdated = res.data.updatedAt || new Date().toISOString();
      setCachedValue(key, { items: nextItems, grounded: Boolean(res.data.grounded), updatedAt: nextUpdated }, 120_000);
      setItems(nextItems);
      setGrounded(Boolean(res.data.grounded));
      setLastUpdatedAt(nextUpdated);
      setLoading(false);
    },
    [selectedTag]
  );

  useEffect(() => {
    void loadNews(false);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadNews(false);
      }
    }, 3 * 60_000);
    return () => window.clearInterval(intervalId);
  }, [loadNews]);

  const [ruTranslations, setRuTranslations] = useState<Record<string, CachedRuNewsEntry>>(() =>
    readRuNewsCache()
  );
  const [translatingRu, setTranslatingRu] = useState(false);

  // Полный перевод англоязычных новостей на русский язык (кэшируется по ID, без частичной подмены слов)
  useEffect(() => {
    if (lang !== 'ru' || items.length === 0) return;
    const untranslated = items
      .filter((item) => {
        const cached = ruTranslations[item.id];
        if (cached && hasCyrillic(cached.title)) return false;
        const cleanTitle = decodeHtmlEntities(item.title);
        const cleanSummary = decodeHtmlEntities(item.summary);
        return !hasCyrillic(cleanTitle) || (Boolean(cleanSummary) && !hasCyrillic(cleanSummary));
      })
      .slice(0, 20);

    if (untranslated.length === 0) return;
    let cancelled = false;
    setTranslatingRu(true);

    fetch('/api/news/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: untranslated.map((it) => ({
          id: it.id,
          title: decodeHtmlEntities(it.title),
          summary: decodeHtmlEntities(it.summary),
        })),
      }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ translations?: Record<string, CachedRuNewsEntry> }>) : null))
      .then((data) => {
        if (cancelled || !data?.translations || Object.keys(data.translations).length === 0) return;
        setRuTranslations((prev) => {
          const next = { ...prev, ...data.translations };
          writeRuNewsCache(next);
          return next;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setTranslatingRu(false);
      });

    return () => {
      cancelled = true;
    };
  }, [items, lang, ruTranslations]);

  const enrichedItems = useMemo(() => {
    return items
      .map((item) => {
        const sentiment = detectDynamicSentiment(item);
        const tags = extractTags(item);
        const cachedRu = ruTranslations[item.id];
        const translatedTitle = decodeHtmlEntities(
          lang === 'ru' && cachedRu?.title ? cachedRu.title : item.title
        );
        const translatedSummary = decodeHtmlEntities(
          lang === 'ru' && cachedRu?.summary ? cachedRu.summary : item.summary
        );
        const impact = buildAiImpactForecast(item, sentiment, tags);
        return { item, sentiment, tags, translatedTitle, translatedSummary, impact };
      })
      .filter(({ tags }) => selectedTag === 'ALL' || tags.includes(selectedTag));
  }, [items, lang, ruTranslations, selectedTag]);

  const displayedItems = useMemo(
    () => enrichedItems.slice(0, visibleCount),
    [enrichedItems, visibleCount]
  );

  // PRO #10: AI-дайджест за 24ч (5 ключевых драйверов, ETF-потоки, общий сентимент)
  const dailyDigest = useMemo(() => {
    const sourcePool = items.map((item) => {
      const sentiment = detectDynamicSentiment(item);
      const tags = extractTags(item);
      const cachedRu = ruTranslations[item.id];
      const title = decodeHtmlEntities(
        lang === 'ru' && cachedRu?.title ? cachedRu.title : item.title
      );
      return { item, sentiment, tags, title };
    });
    const bull = sourcePool.filter((x) => x.sentiment === 'BULLISH').length;
    const bear = sourcePool.filter((x) => x.sentiment === 'BEARISH').length;
    const total = Math.max(1, sourcePool.length);
    const bullPct = Math.round((bull / total) * 100);
    const bearPct = Math.round((bear / total) * 100);

    const overallSentiment =
      bull > bear + 1 ? 'Умеренно-бычий' : bear > bull + 1 ? 'Осторожно-медвежий' : 'Сбалансированный / Боковик';

    const etfMentions = sourcePool.filter((x) => /etf/i.test(`${x.item.title} ${x.item.summary}`));
    const etfBull = etfMentions.filter((x) => x.sentiment === 'BULLISH').length;
    const etfBear = etfMentions.filter((x) => x.sentiment === 'BEARISH').length;
    const etfFlowLabel =
      etfBull > etfBear
        ? 'Чистый приток в спотовые BTC/ETH ETF (+)'
        : etfBear > etfBull
          ? 'Локальный отток из спотовых ETF (-)'
          : 'Нейтральный баланс потоков спотовых ETF';

    const drivers =
      sourcePool.length > 0
        ? sourcePool.slice(0, 5).map((x) => ({
            id: x.item.id,
            title: x.title,
            tag: x.tags[0] ?? 'BTC',
            sentiment: x.sentiment,
          }))
        : [
            { id: 'd1', title: 'Динамика ликвидности BTC и притоков в спотовые ETF США', tag: 'BTC' as AssetTag, sentiment: 'BULLISH' as const },
            { id: 'd2', title: 'Макроожидания по ставке ФРС и индексу инфляции CPI', tag: 'MACRO' as AssetTag, sentiment: 'NEUTRAL' as const },
            { id: 'd3', title: 'Активность сетей L1/L2 и рост объёмов в DeFi-протоколах', tag: 'ETH' as AssetTag, sentiment: 'BULLISH' as const },
            { id: 'd4', title: 'Баланс ставок финансирования (Funding Rate) на бессрочных фьючерсах', tag: 'SOL' as AssetTag, sentiment: 'NEUTRAL' as const },
            { id: 'd5', title: 'Ротация капитала между крупной капитализацией и альткоинами', tag: 'DEFI' as AssetTag, sentiment: 'NEUTRAL' as const },
          ];

    return { overallSentiment, bullPct, bearPct, etfFlowLabel, drivers };
  }, [items, lang, ruTranslations]);

  const sectionTabs = useMemo(
    () => [
      {
        id: 'feed' as const,
        label: 'Лента новостей',
        icon: <Newspaper className="w-3.5 h-3.5 text-emerald-400" />,
        meta: enrichedItems.length > 0 ? enrichedItems.length : undefined,
      },
      {
        id: 'calendar' as const,
        label: 'Эконом. календарь',
        icon: <CalendarDays className="w-3.5 h-3.5 text-cyan-400" />,
      },
    ],
    [enrichedItems.length]
  );

  const sidebarControls = (
    <div className="space-y-2.5">
      {/* Переключатель языка перевода RU / EN */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[var(--surface-0)] p-1">
        <span className="pl-2 text-[11px] text-slate-400 inline-flex items-center gap-1.5">
          <Languages className="w-3.5 h-3.5 text-emerald-400" />
          <span>Перевод</span>
        </span>
        <div className="inline-flex items-center gap-1">
          {(['ru', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setLang(code);
              }}
              className={`min-h-[28px] px-2.5 rounded-lg text-[11px] font-mono font-semibold uppercase transition-colors ${
                lang === code
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      {/* Кликабельные теги монет и тем */}
      <div className="flex flex-wrap gap-1">
        {ASSET_FILTERS.map((tag) => {
          const active = selectedTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setSelectedTag(tag);
                setVisibleCount(8);
                setSection('feed');
              }}
              className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-mono font-medium transition-colors ${
                active
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[var(--surface-0)] text-slate-400 hover:text-slate-200 border border-white/8'
              }`}
            >
              {tag === 'ALL' ? 'Все' : tag}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          triggerHaptic(10);
          setSection('feed');
          setDigestOpen((v) => !v);
        }}
        className={`w-full min-h-[36px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
          digestOpen
            ? 'border-amber-400/55 bg-amber-500/20 text-amber-200'
            : 'border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/18 text-amber-200'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        <span>AI-дайджест за 24ч</span>
        {!effIsPro && <Lock className="w-3 h-3 text-amber-300 shrink-0" />}
      </button>

      <button
        type="button"
        onClick={() => void loadNews(true)}
        disabled={loading}
        className="w-full min-h-[36px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-1.5"
      >
        <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading || translatingRu ? 'animate-spin' : ''}`} />
        <span>{translatingRu ? 'Переводим ленту…' : 'Обновить ленту'}</span>
      </button>

      {lastUpdatedAt && (
        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums px-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="live-dot" aria-hidden="true" />
            <span className="font-sans">Онлайн-лента</span>
          </span>
          <span>
            {new Date(lastUpdatedAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Новости и события"
        subtitle={grounded ? 'Живой AI-разбор и RU/EN перевод' : 'CoinDesk · Cointelegraph · Decrypt · RU/EN'}
        icon={<Newspaper className="w-5 h-5 text-emerald-400" />}
        items={sectionTabs}
        activeId={section}
        onChange={setSection}
        layoutId="news-workspace-nav"
        accent="emerald"
        sidebarTopSlot={sidebarControls}
      >
        {section === 'feed' && (
          loading && items.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-44 rounded-2xl border border-white/8 bg-[var(--surface-1)] shimmer-skeleton p-5" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <FeatureGuide
                title="Лента новостей, AI-дайджест и Эконом. календарь"
                summary="Новости автоматически переводятся на русский язык, очищаются от спецсимволов и размечаются по активам и сентименту (Бычий / Медвежий / Нейтральный)."
                steps={[
                  'Используйте переключатель RU / EN и теги (#BTC, #ETH, #MACRO, #DEFI) для быстрого отбора новостей.',
                  'Нажмите «AI-дайджест за 24ч» (PRO), чтобы увидеть 5 главных драйверов дня и баланс потоков в ETF.',
                  'Перейдите в «Эконом. календарь», чтобы видеть время выхода CPI, FOMC и экспирации опционов в вашем локальном часовом поясе.',
                ]}
              />

              {/* PRO #10: AI-дайджест за 24ч (5 драйверов, ETF-потоки, общий сентимент) */}
              {digestOpen && (
                <PaywallGate
                  requiredPlan="PRO"
                  unlocked={effIsPro}
                  title="AI-дайджест рынка за 24ч"
                  description="5 главных драйверов дня из живой ленты новостей, оценка потоков в спотовые ETF и итоговый индекс настроений рынка."
                >
                  <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/[0.08] to-[var(--surface-1)] p-4 space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-white flex items-center gap-1.5 text-sm">
                        <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>AI-дайджест за 24ч · 5 главных драйверов</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDigestOpen(false)}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Свернуть
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
                        <div className="text-[10px] text-slate-400">Общий сентимент 24ч</div>
                        <div className="mt-0.5 text-sm font-bold text-emerald-300">
                          {dailyDigest.overallSentiment}
                        </div>
                        <div className="mt-1 text-[11px] font-mono text-slate-400">
                          Бычьих: {dailyDigest.bullPct}% · Медвежьих: {dailyDigest.bearPct}%
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
                        <div className="text-[10px] text-slate-400">Институциональные ETF-потоки</div>
                        <div className="mt-0.5 text-xs font-semibold text-cyan-200 leading-snug">
                          {dailyDigest.etfFlowLabel}
                        </div>
                      </div>
                    </div>

                    <ol className="space-y-1.5 list-decimal list-inside text-slate-200">
                      {dailyDigest.drivers.map((d) => (
                        <li key={d.id} className="leading-snug">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-emerald-300 mr-1.5">
                            #{d.tag}
                          </span>
                          <span>{d.title}</span>
                        </li>
                      ))}
                    </ol>

                    <AiComplianceFooter
                      sourceLabel="Новости · AI-дайджест за 24ч (PRO)"
                      snippet={`${dailyDigest.overallSentiment}, ${dailyDigest.etfFlowLabel}`}
                    />
                  </div>
                </PaywallGate>
              )}

              {errorMsg && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-center justify-between gap-2">
                  <span>{errorMsg}</span>
                  <button
                    type="button"
                    onClick={() => void loadNews(true)}
                    className="font-semibold text-amber-300 hover:underline shrink-0"
                  >
                    Повторить
                  </button>
                </div>
              )}

              {displayedItems.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-[var(--surface-1)] p-6 text-center space-y-3">
                  <p className="text-xs text-slate-300">
                    По тегу «{selectedTag}» пока нет свежих публикаций.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedTag('ALL')}
                    className="min-h-[38px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white"
                  >
                    Показать все новости
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {displayedItems.map(({ item, sentiment, tags, translatedTitle, translatedSummary, impact }, idx) => {
                      const impactOpen = Boolean(expandedImpactIds[item.id]);
                      const sentimentStyle =
                        sentiment === 'BULLISH'
                          ? {
                              badge: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300',
                              label: 'Бычий',
                              icon: <TrendingUp className="w-3 h-3 shrink-0" />,
                            }
                          : sentiment === 'BEARISH'
                            ? {
                                badge: 'border-rose-500/35 bg-rose-500/15 text-rose-300',
                                label: 'Медвежий',
                                icon: <TrendingDown className="w-3 h-3 shrink-0" />,
                              }
                            : {
                                badge: 'border-white/15 bg-white/5 text-slate-300',
                                label: 'Нейтральный',
                                icon: null,
                              };

                      return (
                        <motion.article
                          key={item.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(idx * 0.025, 0.14) }}
                          className="rounded-2xl border border-white/8 hover:border-emerald-500/30 bg-[var(--surface-1)] card-surface-glow p-4 flex flex-col justify-between gap-3 transition-colors"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {tags.map((tag) => (
                                  <button
                                    key={`${item.id}-${tag}`}
                                    type="button"
                                    onClick={() => setSelectedTag(tag)}
                                    className="px-2 py-0.5 rounded-md border border-white/10 bg-[var(--surface-0)] hover:border-emerald-500/40 text-[10px] font-mono font-semibold text-emerald-300 transition-colors"
                                  >
                                    #{tag}
                                  </button>
                                ))}
                                <span className="text-[11px] font-mono text-slate-400">{item.publishedLabel}</span>
                              </div>

                              <span
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold shrink-0 ${sentimentStyle.badge}`}
                              >
                                {sentimentStyle.icon}
                                <span>{sentimentStyle.label}</span>
                              </span>
                            </div>

                            <h3 className="mt-2.5 text-sm sm:text-base font-semibold text-white leading-snug">
                              {translatedTitle}
                            </h3>
                            <p className="mt-1.5 text-xs text-slate-300 leading-relaxed line-clamp-3">
                              {translatedSummary}
                            </p>

                            {/* Кнопка «AI-влияние на рынок» */}
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  triggerHaptic(8);
                                  if (!effIsPro && Object.keys(expandedImpactIds).length >= 3 && !impactOpen) {
                                    onUpgradePro?.();
                                    return;
                                  }
                                  setExpandedImpactIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                                }}
                                className="min-h-[34px] px-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/18 text-[11px] font-semibold text-cyan-200 inline-flex items-center gap-1.5 transition-colors"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                                <span>AI-влияние на рынок</span>
                                {!effIsPro && Object.keys(expandedImpactIds).length >= 3 && !impactOpen && (
                                  <Lock className="w-3 h-3 text-amber-300" />
                                )}
                                {impactOpen ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>

                              {impactOpen && (
                                <div className="mt-2 rounded-xl border border-cyan-500/25 bg-[var(--surface-0)] p-3 text-xs space-y-1.5">
                                  <div className="flex items-center gap-1.5 text-cyan-300 font-semibold text-[11px]">
                                    <Bot className="w-3.5 h-3.5 shrink-0" />
                                    <span>Краткий AI-прогноз влияния</span>
                                  </div>
                                  <p className="text-slate-200 leading-relaxed">{impact.line1}</p>
                                  <p className="text-slate-400 leading-relaxed">{impact.line2}</p>
                                  <AiComplianceFooter
                                    sourceLabel={`Новости · AI-влияние (${item.asset})`}
                                    snippet={translatedTitle}
                                  />
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-white/8 flex items-center justify-between text-xs gap-2">
                            <span className="text-slate-400 truncate">{item.sourceTitle}</span>
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap shrink-0"
                            >
                              <span>Источник</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </motion.article>
                      );
                    })}
                  </div>

                  {enrichedItems.length > visibleCount && (
                    <div className="flex justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => setVisibleCount((c) => c + 8)}
                        className="min-h-[40px] px-5 rounded-xl border border-white/12 bg-[var(--surface-1)] hover:bg-white/10 text-xs font-semibold text-white transition-colors"
                      >
                        Показать ещё ({enrichedItems.length - visibleCount})
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        )}

        {section === 'calendar' && (
          <div data-tour-id="tour-news-calendar">
            <EconomicCalendarWidget lang={lang} />
          </div>
        )}
      </WorkspaceShell>
    </StaggerDeck>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  Flame,
  Info,
  RefreshCw,
} from 'lucide-react';
import type { EconomicCalendarEvent } from '../types/domain';
import { CACHE_TTL, fetchWithSWR, isPageVisible, subscribePageVisibility } from '../utils/cache';
import { decodeHtmlEntities, formatEventTimeToLocal } from '../utils/htmlEntities';
import { parseJsonResponse, safeFetchJson } from '../utils/safeFetchJson';

type CategoryFilter = 'all' | 'macro' | 'crypto' | 'derivatives';

interface EconomicCalendarWidgetProps {
  lang?: 'ru' | 'en';
}

const CAL_RU_CACHE_KEY = 'vernier_calendar_ru_cache_v2';

function readCalRuCache(): Record<string, { title: string; summary: string }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CAL_RU_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { title: string; summary: string }>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCalRuCache(cache: Record<string, { title: string; summary: string }>): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(cache).slice(-80);
    window.localStorage.setItem(CAL_RU_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore storage limits
  }
}

function hasCyrillic(str: string): boolean {
  return /[А-Яа-яЁё]/.test(str);
}

export const EconomicCalendarWidget: React.FC<EconomicCalendarWidgetProps> = ({ lang = 'ru' }) => {
  const isEn = lang === 'en';
  const [events, setEvents] = useState<EconomicCalendarEvent[]>([]);
  const [ruMap, setRuMap] = useState<Record<string, { title: string; summary: string }>>(() => readCalRuCache());
  const [grounded, setGrounded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [highImpactOnly, setHighImpactOnly] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const attemptedTranslateIdsRef = useRef<Set<string>>(new Set());

  const loadCalendar = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const url = forceRefresh ? '/api/economic-calendar?refresh=1' : '/api/economic-calendar';
      const data = await fetchWithSWR<{
        events?: EconomicCalendarEvent[];
        grounded?: boolean;
        notice?: string;
        updatedAt?: string;
        error?: string;
      }>(
        'api:economic-calendar',
        async (signal) => {
          const res = await fetch(url, { cache: 'no-store', signal });
          const parsed = await parseJsonResponse<{
            events?: EconomicCalendarEvent[];
            grounded?: boolean;
            notice?: string;
            updatedAt?: string;
            error?: string;
          }>(res);
          if (!parsed.ok || !parsed.data) {
            throw new Error(parsed.errorMessage || 'Не удалось загрузить экономический календарь.');
          }
          return parsed.data;
        },
        {
          ttlMs: CACHE_TTL.NEWS_AND_CALENDAR_MS,
          forceRefresh,
          signal: controller.signal,
          onBackgroundUpdate: (fresh) => {
            setEvents(fresh.events || []);
            setGrounded(Boolean(fresh.grounded));
            setNotice(fresh.notice ?? null);
            setLastUpdatedAt(fresh.updatedAt || new Date().toISOString());
          },
        }
      );
      if (!controller.signal.aborted) {
        setEvents(data.events || []);
        setGrounded(Boolean(data.grounded));
        setNotice(data.notice ?? null);
        setLastUpdatedAt(data.updatedAt || new Date().toISOString());
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки календаря');
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCalendar(false);
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) {
        void loadCalendar(false);
      }
    }, 10 * 60_000);
    const unsubVis = subscribePageVisibility((visible) => {
      if (visible) {
        void loadCalendar(false);
      }
    });
    return () => {
      window.clearInterval(intervalId);
      unsubVis();
      abortRef.current?.abort();
    };
  }, [loadCalendar]);

  useEffect(() => {
    if (isEn || events.length === 0) return;
    const untranslated = events
      .filter((ev) => {
        if (attemptedTranslateIdsRef.current.has(ev.id)) return false;
        const cached = ruMap[ev.id];
        if (cached && hasCyrillic(cached.title)) return false;
        const cleanTitle = decodeHtmlEntities(ev.title);
        const cleanDesc = decodeHtmlEntities(ev.description || '');
        return !hasCyrillic(cleanTitle) || (Boolean(cleanDesc) && !hasCyrillic(cleanDesc));
      })
      .slice(0, 10);
    if (untranslated.length === 0) return;
    untranslated.forEach((ev) => attemptedTranslateIdsRef.current.add(ev.id));

    let cancelled = false;
    safeFetchJson<{ translations?: Record<string, { title: string; summary: string }> }>(
      '/api/news/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: untranslated.map((ev) => ({
            id: ev.id,
            title: decodeHtmlEntities(ev.title),
            summary: decodeHtmlEntities(ev.description || ''),
          })),
        }),
        timeoutMs: 12000,
      }
    )
      .then((res) => {
        if (cancelled) return;
        const translations = res.ok ? res.data?.translations : undefined;
        if (translations && Object.keys(translations).length > 0) {
          const valid: Record<string, { title: string; summary: string }> = {};
          for (const [id, entry] of Object.entries(translations)) {
            if (entry?.title && hasCyrillic(entry.title)) {
              valid[id] = {
                title: entry.title.trim(),
                summary: (entry.summary || '').trim(),
              };
            }
          }
          if (Object.keys(valid).length > 0) {
            setRuMap((prev) => {
              const next = { ...prev, ...valid };
              writeCalRuCache(next);
              return next;
            });
          }
        }
      })
      .catch(() => {
        // Keep clean original English text with EN badge when translation API is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, [events, isEn, ruMap]);

  const highCount = useMemo(
    () =>
      events.filter(
        (e) => (categoryFilter === 'all' || e.category === categoryFilter) && e.impact === 'HIGH'
      ).length,
    [events, categoryFilter]
  );

  useEffect(() => {
    if (highImpactOnly && highCount === 0) {
      setHighImpactOnly(false);
    }
  }, [highImpactOnly, highCount]);

  const filteredEvents = useMemo(() => {
    return events
      .filter((ev) => {
        if (categoryFilter !== 'all' && ev.category !== categoryFilter) return false;
        if (highImpactOnly && ev.impact !== 'HIGH') return false;
        return true;
      })
      .map((ev) => {
        const cached = !isEn ? ruMap[ev.id] : undefined;
        const rawTitle = decodeHtmlEntities(ev.title);
        const rawDesc = decodeHtmlEntities(ev.description || '');
        const hasValidRu = Boolean(cached?.title && hasCyrillic(cached.title));
        const title = !isEn && hasValidRu ? cached!.title : rawTitle;
        const description = !isEn && hasValidRu ? cached!.summary || rawDesc : rawDesc;
        const isUntranslatedEn = !isEn && !hasCyrillic(title);
        const { localTimeLabel } = formatEventTimeToLocal(ev.dateLabel, ev.timeUtcLabel, lang);
        return { ...ev, title, description, isUntranslatedEn, localTimeLabel };
      });
  }, [events, categoryFilter, highImpactOnly, isEn, ruMap, lang]);

  const renderImpactLabel = (impact: EconomicCalendarEvent['impact']) => {
    if (impact === 'HIGH') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 whitespace-nowrap">
          <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{isEn ? 'High' : 'Высокая'}</span>
        </span>
      );
    }
    if (impact === 'MEDIUM') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{isEn ? 'Medium' : 'Средняя'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
        <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span>{isEn ? 'Low' : 'Умеренная'}</span>
      </span>
    );
  };

  const renderBiasText = (bias: EconomicCalendarEvent['marketBias']) => {
    switch (bias) {
      case 'BULLISH':
        return <span className="text-emerald-400">{isEn ? 'Bullish catalyst' : 'Бычий драйвер'}</span>;
      case 'BEARISH':
        return <span className="text-rose-400">{isEn ? 'Downside risk' : 'Риск давления'}</span>;
      case 'VOLATILITY':
        return <span className="text-amber-300">{isEn ? 'Volatility spike' : 'Всплеск волатильности'}</span>;
      default:
        return <span className="text-slate-400">{isEn ? 'Neutral' : 'Нейтрально'}</span>;
    }
  };

  return (
    <section className="rounded-2xl border border-white/8 bg-[#111827] p-5 sm:p-6 space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Макроданные США и ФРС</span>
            <span aria-hidden="true">·</span>
            <span>ETF, опционы и разлоки</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="live-dot" aria-hidden="true" />
              <span>{grounded ? 'Живой поиск расписания' : 'Deribit · OKX · ФРС'}</span>
              {lastUpdatedAt && (
                <span className="font-mono text-[11px] text-slate-500">
                  {new Date(lastUpdatedAt).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </span>
          </div>
          <h2 className="mt-1 text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-amber-400 shrink-0" />
            <span>{isEn ? 'Crypto Economic Calendar' : 'Экономический календарь крипто-рынка'}</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Category Segmented Filter */}
          <div className="grid grid-cols-2 sm:inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8 w-full sm:w-auto gap-1 sm:gap-0">
            {(
              [
                { id: 'all', label: isEn ? 'All' : 'Все' },
                { id: 'macro', label: isEn ? 'Macro' : 'Макро' },
                { id: 'crypto', label: isEn ? 'Crypto' : 'Крипто' },
                { id: 'derivatives', label: isEn ? 'Derivatives' : 'Деривативы' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setCategoryFilter(tab.id);
                  setHighImpactOnly(false);
                }}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  categoryFilter === tab.id
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* High Impact Filter Toggle */}
          <button
            type="button"
            disabled={highCount === 0}
            onClick={() => {
              if (highCount === 0) return;
              setHighImpactOnly((v) => !v);
            }}
            aria-pressed={highImpactOnly}
            className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
              highImpactOnly && highCount > 0
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{isEn ? `High only (${highCount})` : `Только High (${highCount})`}</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadCalendar(true)}
            aria-label="Обновить календарь событий"
            className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>
      </div>

      {notice && events.length > 0 && (
        <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2.5 text-xs text-cyan-200 flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Loading State */}
      {loading && events.length === 0 ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="h-14 rounded-xl bg-[#0B0F17] border border-white/8 animate-pulse" />
          ))}
        </div>
      ) : error && events.length === 0 ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-center space-y-3">
          <p className="text-xs text-rose-300">{error}</p>
          <button
            type="button"
            onClick={() => void loadCalendar(true)}
            className="min-h-[40px] px-4 rounded-xl bg-rose-500/20 text-rose-200 text-xs font-medium"
          >
            Повторить загрузку
          </button>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-6 text-center space-y-3">
          <p className="text-xs text-slate-300">По выбранным фильтрам событий в календаре не найдено.</p>
          <button
            type="button"
            onClick={() => {
              setCategoryFilter('all');
              setHighImpactOnly(false);
            }}
            className="min-h-[40px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
          >
            Сбросить фильтры календаря
          </button>
        </div>
      ) : (
        <>
          {/* Desktop High-Density Institutional Table */}
          <div className="hidden md:block overflow-x-auto border-t border-white/8">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/8 text-slate-400">
                  <th className="py-3 pr-4 font-medium whitespace-nowrap">
                    {isEn ? 'Date · Local time' : 'Дата · Лок. время'}
                  </th>
                  <th className="py-3 px-3 font-medium whitespace-nowrap">Актив / Сектор</th>
                  <th className="py-3 px-3 font-medium">Ключевое событие и влияние</th>
                  <th className="py-3 px-3 font-medium whitespace-nowrap">Важность</th>
                  <th className="py-3 px-3 font-medium text-right whitespace-nowrap">Пред.</th>
                  <th className="py-3 px-3 font-medium text-right whitespace-nowrap">Прогноз</th>
                  <th className="py-3 pl-3 font-medium text-right whitespace-nowrap">Факт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {filteredEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-white/[0.02] transition-colors align-top">
                    <td className="py-3.5 pr-4 font-mono tabular-nums whitespace-nowrap">
                      <div className="text-white font-semibold">{ev.dateLabel}</div>
                      <div className="mt-0.5 text-[11px] text-cyan-300/90" title={ev.timeUtcLabel}>
                        {ev.localTimeLabel}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 font-mono whitespace-nowrap">
                      <div className="text-slate-200 font-semibold">{ev.regionOrAsset}</div>
                      <div className="mt-0.5 font-sans text-[11px]">{renderBiasText(ev.marketBias)}</div>
                    </td>
                    <td className="py-3.5 px-3 max-w-md">
                      <div className="font-semibold text-white leading-snug flex items-start gap-2">
                        <span>
                          {ev.isUntranslatedEn && (
                            <span className="inline-block align-middle mr-1.5 px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono font-semibold text-slate-300">
                              EN
                            </span>
                          )}
                          {ev.title}
                        </span>
                        {ev.sourceUrl && (
                          <a
                            href={ev.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Открыть источник события"
                            className="text-emerald-400 hover:text-emerald-300 shrink-0 mt-0.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      {ev.description && (
                        <p className="mt-1 text-slate-400 leading-relaxed">{ev.description}</p>
                      )}
                    </td>
                    <td className="py-3.5 px-3">{renderImpactLabel(ev.impact)}</td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {ev.previous}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-200 font-medium whitespace-nowrap">
                      {ev.forecast}
                    </td>
                    <td className="py-3.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <span
                        className={
                          ev.actual === 'Ожидается'
                            ? 'text-slate-400'
                            : 'text-emerald-400 font-semibold'
                        }
                      >
                        {ev.actual}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Responsive List (Android PWA) */}
          <div className="md:hidden divide-y divide-white/8 border-t border-white/8">
            {filteredEvents.map((ev) => (
              <div key={ev.id} className="cv-list-item py-4 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono tabular-nums text-slate-300">
                    <span className="text-white font-semibold">{ev.dateLabel}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="text-cyan-300">{ev.localTimeLabel}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="text-slate-400">{ev.regionOrAsset}</span>
                  </div>
                  {renderImpactLabel(ev.impact)}
                </div>

                <div className="font-semibold text-sm text-white leading-snug">
                  {ev.isUntranslatedEn && (
                    <span className="inline-block align-middle mr-1.5 px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono font-semibold text-slate-300">
                      EN
                    </span>
                  )}
                  <span>{ev.title}</span>
                </div>
                {ev.description && (
                  <p className="text-slate-400 leading-relaxed">{ev.description}</p>
                )}

                <div className="pt-1 flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums text-[11px]">
                  <div className="text-slate-400">
                    Пред: <span className="text-slate-200">{ev.previous}</span>
                    <span aria-hidden="true"> · </span>
                    Прогноз: <span className="text-white font-medium">{ev.forecast}</span>
                    <span aria-hidden="true"> · </span>
                    Факт: <span className={ev.actual === 'Ожидается' ? 'text-slate-400' : 'text-emerald-400 font-semibold'}>{ev.actual}</span>
                  </div>
                  <div className="font-sans">{renderBiasText(ev.marketBias)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

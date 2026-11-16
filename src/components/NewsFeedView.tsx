import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, Newspaper, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import type { GroundedNewsItem } from '../types/domain';
import { EconomicCalendarWidget } from './EconomicCalendarWidget';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';

type NewsSection = 'feed' | 'calendar';

const ASSET_FILTERS = ['ALL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TONUSDT'] as const;

export const NewsFeedView: React.FC = () => {
  const [section, setSection] = useState<NewsSection>('feed');
  const [selectedAsset, setSelectedAsset] = useState<string>('ALL');
  const [items, setItems] = useState<GroundedNewsItem[]>([]);
  const [grounded, setGrounded] = useState(false);
  const [loading, setLoading] = useState(true);

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

  const loadNews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/news?symbol=${selectedAsset}`);
      if (res.ok) {
        const data = (await res.json()) as { items: GroundedNewsItem[]; grounded: boolean };
        setItems(data.items || []);
        setGrounded(Boolean(data.grounded));
      }
    } catch {
      // Keep previous list if offline
    } finally {
      setLoading(false);
    }
  }, [selectedAsset]);

  useEffect(() => {
    void loadNews();
  }, [loadNews]);

  const sectionTabs = useMemo(
    () => [
      {
        id: 'feed' as const,
        label: 'Лента новостей',
        icon: <Newspaper className="w-3.5 h-3.5 text-emerald-400" />,
        meta: items.length > 0 ? items.length : undefined,
      },
      {
        id: 'calendar' as const,
        label: 'Эконом. календарь',
        icon: <CalendarDays className="w-3.5 h-3.5 text-cyan-400" />,
      },
    ],
    [items.length]
  );

  const sidebarControls = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {ASSET_FILTERS.map((asset) => {
          const active = selectedAsset === asset;
          return (
            <button
              key={asset}
              type="button"
              onClick={() => {
                setSelectedAsset(asset);
                setSection('feed');
              }}
              className={`min-h-[32px] px-2.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                active ? 'bg-emerald-600 text-white' : 'bg-[#0B0F17] text-slate-400 hover:text-slate-200 border border-white/8'
              }`}
            >
              {asset === 'ALL' ? 'Все' : asset.replace('USDT', '')}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void loadNews()}
        disabled={loading}
        className="w-full min-h-[34px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-1.5"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>Обновить ленту</span>
      </button>
    </div>
  );

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Новости и события"
        subtitle={grounded ? 'Живой поиск источников' : 'Рыночные катализаторы'}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-44 rounded-2xl border border-white/8 bg-[#111827] animate-pulse p-5" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {items.map((item, idx) => (
                <motion.article
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.15) }}
                  className="rounded-2xl border border-white/8 hover:border-white/15 bg-[#111827] card-surface-glow p-4 sm:p-5 flex flex-col justify-between gap-3.5 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-slate-400 font-mono">
                        <span className="text-white font-semibold">{item.asset}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.publishedLabel}</span>
                      </div>
                      <span
                        className={`font-semibold ${
                          item.sentiment === 'BULLISH'
                            ? 'text-emerald-400'
                            : item.sentiment === 'BEARISH'
                              ? 'text-rose-400'
                              : 'text-slate-300'
                        }`}
                      >
                        {item.sentiment === 'BULLISH'
                          ? 'Бычий фон'
                          : item.sentiment === 'BEARISH'
                            ? 'Медвежий фон'
                            : 'Нейтрально'}
                      </span>
                    </div>

                    <h3 className="mt-2 text-sm sm:text-base font-semibold text-white leading-snug">{item.title}</h3>
                    <p className="mt-1.5 text-xs sm:text-sm text-slate-300 leading-relaxed">{item.summary}</p>
                  </div>

                  <div className="pt-2.5 border-t border-white/8 flex items-center justify-between text-xs">
                    <span className="text-slate-400 truncate max-w-[200px]">{item.sourceTitle}</span>
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
              ))}
            </div>
          )
        )}

        {section === 'calendar' && (
          <div data-tour-id="tour-news-calendar">
            <EconomicCalendarWidget />
          </div>
        )}
      </WorkspaceShell>
    </StaggerDeck>
  );
};

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from 'lucide-react';
import { useLiveMarketSnapshot } from '../stores/liveMarketStore';

const TICKER_COLLAPSED_KEY = 'vernier_ticker_collapsed_v1';

function formatPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

interface TickerTapeProps {
  embedded?: boolean;
}

export const TickerTape: React.FC<TickerTapeProps> = React.memo(({ embedded = false }) => {
  // Подписка на изолированный троттлированный стор живых котировок (не вызывает ререндер App.tsx)
  const { tickers, isOnline: isOnlineStream } = useLiveMarketSnapshot('spot');

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(TICKER_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TICKER_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const { leader, laggard } = useMemo(() => {
    if (tickers.length === 0) return { leader: null, laggard: null };
    let best = tickers[0];
    let worst = tickers[0];
    for (let i = 1; i < tickers.length; i += 1) {
      if (tickers[i].change24hPct > best.change24hPct) best = tickers[i];
      if (tickers[i].change24hPct < worst.change24hPct) worst = tickers[i];
    }
    return { leader: best, laggard: worst };
  }, [tickers]);

  if (tickers.length === 0) return null;

  const stripItems = tickers.slice(0, 12);

  return (
    <div
      className={
        embedded
          ? 'w-full border-t border-white/6 bg-[var(--surface-0)]/60'
          : 'w-full border-b border-emerald-500/15 bg-[var(--surface-0)]'
      }
      aria-label="Лента котировок и пульс рынка"
    >
      <div
        className={`${
          embedded ? 'px-2.5 sm:px-3.5 h-7' : 'max-w-7xl mx-auto px-3 sm:px-6 h-7'
        } flex items-center gap-2 overflow-hidden text-[11px] font-mono tabular-nums`}
      >
        {/* Live Stream Indicator + Compact Leader/Laggard */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-sans font-medium">
            <span className="live-dot" aria-hidden="true" />
            <span className="hidden sm:inline">{isOnlineStream ? 'Онлайн' : 'Кэш'}</span>
          </span>

          {leader && (
            <span className="inline-flex items-center gap-1 text-emerald-400 whitespace-nowrap">
              <TrendingUp className="w-3 h-3 shrink-0" />
              <span className="text-slate-200 font-semibold">{leader.baseAsset}</span>
              <span>+{leader.change24hPct}%</span>
            </span>
          )}
          {laggard && (
            <span className="hidden sm:inline-flex items-center gap-1 text-rose-400 whitespace-nowrap">
              <TrendingDown className="w-3 h-3 shrink-0" />
              <span className="text-slate-300">{laggard.baseAsset}</span>
              <span>{laggard.change24hPct}%</span>
            </span>
          )}
        </div>

        {/* GPU-accelerated Marquee via translate3d + will-change: transform */}
        {!collapsed ? (
          <div className="flex-1 overflow-hidden relative min-w-0">
            <div className="ticker-tape items-center gap-5">
              {[...stripItems, ...stripItems].map((t, idx) => (
                <div key={`${t.symbol}-${idx}`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-slate-300 font-semibold">{t.baseAsset}</span>
                  <span className="text-white">{formatPrice(t.price)}</span>
                  <span className={t.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {t.change24hPct >= 0 ? '+' : ''}
                    {t.change24hPct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 text-[10px] font-sans text-slate-500 truncate">
            Бегущая строка свёрнута · {tickers.length} пар онлайн
          </div>
        )}

        {/* Collapse / Expand toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Развернуть ленту котировок' : 'Свернуть ленту котировок'}
          title={collapsed ? 'Развернуть тикер' : 'Свернуть тикер'}
          className="h-6 w-6 rounded-md text-slate-400 hover:text-white hover:bg-white/10 inline-flex items-center justify-center shrink-0 transition-colors"
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
});
TickerTape.displayName = 'TickerTape';

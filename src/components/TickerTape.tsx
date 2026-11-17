import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { TickerOverview } from '../types/domain';
import { FlashValue } from './MotionPrimitives';

const REFRESH_MS = 20_000;

function formatPrice(val: number): string {
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 1) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(5)}`;
}

/**
 * Бегущая лента котировок в стиле биржевого терминала.
 * Обновляется раз в 20 секунд (пока вкладка видна), на паузе при касании.
 */
export const TickerTape: React.FC = () => {
  const [tickers, setTickers] = useState<TickerOverview[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/market/overview?marketType=spot');
        if (!res.ok) return;
        const data = (await res.json()) as { tickers?: TickerOverview[] };
        if (!cancelled && Array.isArray(data.tickers)) setTickers(data.tickers.slice(0, 12));
      } catch {
        // оставляем прошлые данные при сетевом сбое
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (tickers.length === 0) {
    return <div className="h-9 border-b border-white/8 bg-[#0B0F17]/70" aria-hidden="true" />;
  }

  const items = tickers.map((t) => {
    const up = t.change24hPct >= 0;
    return (
      <li key={t.symbol} className="flex items-center gap-2 px-4 whitespace-nowrap">
        <span className="text-[11px] font-semibold text-slate-200">{t.baseAsset}</span>
        <FlashValue value={t.price} className="text-[11px] font-mono tabular-nums text-slate-300">
          {formatPrice(t.price)}
        </FlashValue>
        <span
          className={`inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold tabular-nums ${
            up ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {up ? '+' : ''}
          {t.change24hPct}%
        </span>
      </li>
    );
  });

  return (
    <div
      className="ticker-tape h-9 border-b border-white/8 bg-[#0B0F17]/70 backdrop-blur-md overflow-hidden flex items-center"
      role="marquee"
      aria-label="Лента котировок"
    >
      <ul className="ticker-track flex items-center w-max">{items}</ul>
      <ul className="ticker-track flex items-center w-max" aria-hidden="true">
        {items}
      </ul>
    </div>
  );
};

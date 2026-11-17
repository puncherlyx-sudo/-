import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import type { TickerOverview } from '../types/domain';
import { FlashValue } from './MotionPrimitives';

const REFRESH_MS = 20_000;

function formatPrice(val: number): string {
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 1) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(5)}`;
}

function signed(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** Сколько секунд назад обновились данные. Свой таймер, чтобы не перерисовывать ленту каждую секунду. */
const DataAge: React.FC<{ updatedAt: number }> = ({ updatedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const sec = Math.max(0, Math.round((now - updatedAt) / 1000));
  const stale = sec > 60;
  return (
    <span className={`font-mono tabular-nums ${stale ? 'text-amber-400' : 'text-slate-500'}`}>
      {stale ? 'данные устарели · ' : ''}
      {sec < 60 ? `${sec}с` : `${Math.floor(sec / 60)}м`} назад
    </span>
  );
};

/**
 * Бегущая лента котировок + «пульс рынка» (сколько растёт/падает, лидер, аутсайдер, свежесть данных).
 * Обновляется раз в 20 секунд, пока вкладка видна; лента на паузе при касании.
 */
export const TickerTape: React.FC = () => {
  const [tickers, setTickers] = useState<TickerOverview[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/market/overview?marketType=spot');
        if (!res.ok) return;
        const data = (await res.json()) as { tickers?: TickerOverview[] };
        if (!cancelled && Array.isArray(data.tickers) && data.tickers.length > 0) {
          setTickers(data.tickers);
          setUpdatedAt(Date.now());
        }
      } catch {
        // оставляем прошлые данные при сетевом сбое — возраст данных покажет, что они устарели
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const pulse = useMemo(() => {
    if (tickers.length === 0) return null;
    const up = tickers.filter((t) => t.change24hPct >= 0).length;
    const sorted = [...tickers].sort((a, b) => b.change24hPct - a.change24hPct);
    return {
      up,
      down: tickers.length - up,
      upShare: Math.round((up / tickers.length) * 100),
      leader: sorted[0],
      laggard: sorted[sorted.length - 1],
    };
  }, [tickers]);

  if (tickers.length === 0 || !pulse) {
    return <div className="h-9 border-b border-white/8 bg-[#0B0F17]/70" aria-hidden="true" />;
  }

  const items = tickers.slice(0, 12).map((t) => {
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
          {signed(t.change24hPct)}
        </span>
      </li>
    );
  });

  return (
    <div className="border-b border-white/8 bg-[#0B0F17]/70 backdrop-blur-md">
      <div
        className="ticker-tape h-9 overflow-hidden flex items-center"
        role="marquee"
        aria-label="Лента котировок"
      >
        <ul className="ticker-track flex items-center w-max">{items}</ul>
        <ul className="ticker-track flex items-center w-max" aria-hidden="true">
          {items}
        </ul>
      </div>

      {/* Пульс рынка: полоса «растут / падают» и ключевые цифры */}
      <div className="px-3 sm:px-6 pb-1.5 max-w-7xl mx-auto">
        <div
          className="h-1 rounded-full bg-rose-500/45 overflow-hidden"
          role="img"
          aria-label={`Растут ${pulse.up} из ${tickers.length} монет`}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pulse.upShare}%` }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
          />
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-[10px] leading-4 whitespace-nowrap overflow-hidden">
          <span className="font-mono tabular-nums text-slate-400">
            <span className="text-emerald-400">▲{pulse.up}</span> <span className="text-rose-400">▼{pulse.down}</span>
          </span>
          <span className="truncate text-slate-500">
            Лидер <span className="text-emerald-400">{pulse.leader.baseAsset} {signed(pulse.leader.change24hPct)}</span>
            {' · '}
            Аутсайдер <span className="text-rose-400">{pulse.laggard.baseAsset} {signed(pulse.laggard.change24hPct)}</span>
          </span>
          {updatedAt !== null && <DataAge updatedAt={updatedAt} />}
        </div>
      </div>
    </div>
  );
};

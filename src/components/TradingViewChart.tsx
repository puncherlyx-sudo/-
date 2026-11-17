import React, { useEffect, useState } from 'react';
import { ExternalLink, Maximize2, X } from 'lucide-react';
import type { MarketType, Timeframe } from '../types/domain';

export type ChartEngine = 'native' | 'tradingview';

const ENGINE_STORAGE_KEY = 'aegisquant_chart_engine';

/** Запоминаем выбор графика на устройстве (если хранилище недоступно — просто работаем без запоминания). */
export function readChartEngine(): ChartEngine {
  try {
    return window.localStorage.getItem(ENGINE_STORAGE_KEY) === 'tradingview' ? 'tradingview' : 'native';
  } catch {
    return 'native';
  }
}

export function saveChartEngine(engine: ChartEngine): void {
  try {
    window.localStorage.setItem(ENGINE_STORAGE_KEY, engine);
  } catch {
    // не критично
  }
}

const INTERVAL_MAP: Record<Timeframe, string> = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };

interface ChartEngineSwitchProps {
  engine: ChartEngine;
  onChange: (engine: ChartEngine) => void;
}

/** Переключатель «Наш график / TradingView». */
export const ChartEngineSwitch: React.FC<ChartEngineSwitchProps> = ({ engine, onChange }) => (
  <div
    role="radiogroup"
    aria-label="Источник графика"
    className="inline-flex rounded-xl border border-white/10 bg-[#0B0F17] p-1 text-xs font-semibold"
  >
    {(
      [
        { id: 'native', label: 'Наш график' },
        { id: 'tradingview', label: 'TradingView' },
      ] as Array<{ id: ChartEngine; label: string }>
    ).map((opt) => (
      <button
        key={opt.id}
        type="button"
        role="radio"
        aria-checked={engine === opt.id}
        onClick={() => onChange(opt.id)}
        className={`min-h-[34px] px-3 rounded-lg transition-colors ${
          engine === opt.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

interface TradingViewChartProps {
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
}

/**
 * Официальный виджет TradingView Advanced Real-Time Chart.
 * Загружается в изолированном iframe (sandbox без allow-same-origin): скрипт TradingView
 * не видит ни аккаунт, ни данные приложения.
 */
export const TradingViewChart: React.FC<TradingViewChartProps> = ({ symbol, marketType, timeframe }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const src = `/embed/tradingview?symbol=${encodeURIComponent(symbol)}&marketType=${marketType}&interval=${INTERVAL_MAP[timeframe]}`;
  const externalUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    `BINANCE:${symbol}${marketType === 'futures' ? '.P' : ''}`
  )}`;

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  const frame = (
    <iframe
      key={src}
      title={`График TradingView ${symbol}`}
      src={src}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      allow="fullscreen"
      referrerPolicy="no-referrer"
      loading="lazy"
      onLoad={() => setLoaded(true)}
      className="w-full h-full border-0 bg-[#0B0F17]"
    />
  );

  return (
    <div className="space-y-2">
      <div
        className={
          fullscreen
            ? 'fixed inset-0 z-[90] bg-[#0B0F17] flex flex-col pt-[env(safe-area-inset-top)]'
            : 'relative h-[460px] sm:h-[560px] rounded-xl overflow-hidden border border-white/8'
        }
      >
        {fullscreen && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 text-xs text-slate-300">
            <span className="font-semibold">
              {symbol.replace('USDT', '')} / USDT · TradingView
            </span>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Закрыть полноэкранный режим"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className={fullscreen ? 'flex-1 min-h-0' : 'absolute inset-0'}>{frame}</div>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 bg-[#0B0F17] pointer-events-none">
            Загрузка графика TradingView…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>Данные и инструменты предоставляет TradingView (Binance). Они могут отличаться от котировок приложения.</span>
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 inline-flex items-center gap-1.5"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            На весь экран
          </button>
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 inline-flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Открыть в TradingView
          </a>
        </span>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Check, Columns3, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export interface MarketVisibleColumns {
  sparkline: boolean;
  price: boolean;
  change24h: boolean;
  volume: boolean;
  marketCap: boolean;
}

export type MarketColumnKey = keyof MarketVisibleColumns;

export const DEFAULT_MARKET_COLUMNS: MarketVisibleColumns = {
  sparkline: true,
  price: true,
  change24h: true,
  volume: true,
  marketCap: true,
};

const COLUMN_OPTIONS: Array<{ key: MarketColumnKey; label: string; hint: string }> = [
  { key: 'price', label: 'Цена', hint: 'Текущая котировка USDT' },
  { key: 'change24h', label: '24ч %', hint: 'Изменение цены за сутки' },
  { key: 'volume', label: 'Объём 24ч', hint: 'Суточный оборот торгов' },
  { key: 'marketCap', label: 'Капитализация', hint: 'Рыночная оценка актива' },
  { key: 'sparkline', label: 'График 24ч', hint: 'Мини-кривая динамики' },
];

interface ColumnSelectorMenuProps {
  columns: MarketVisibleColumns;
  onChange: (next: MarketVisibleColumns) => void;
  align?: 'left' | 'right';
}

export const ColumnSelectorMenu: React.FC<ColumnSelectorMenuProps> = ({
  columns,
  onChange,
  align = 'right',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const enabledCount = Object.values(columns).filter(Boolean).length;
  const totalCount = COLUMN_OPTIONS.length;
  const isCustomized = enabledCount !== totalCount;

  useEffect(() => {
    if (!open) return;
    const handleOutside = (evt: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(evt.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggleColumn = (key: MarketColumnKey) => {
    onChange({
      ...columns,
      [key]: !columns[key],
    });
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Выбор отображаемых колонок таблицы активов"
        className={`min-h-[34px] px-2.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
          open || isCustomized
            ? 'border-cyan-500/45 bg-cyan-500/12 text-cyan-200 hover:bg-cyan-500/18'
            : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-white/20'
        }`}
      >
        <Columns3 className="w-3.5 h-3.5 shrink-0" />
        <span>Колонки</span>
        <span className="font-mono tabular-nums text-[11px] text-slate-400">
          {enabledCount}/{totalCount}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Настройка колонок списка активов"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-full mt-1.5 z-40 w-64 rounded-2xl border border-white/12 bg-[#0B0F17] shadow-2xl shadow-black/60 p-2 space-y-1 ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            <div className="px-2 py-1 flex items-center justify-between border-b border-white/8 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Колонки списка
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {enabledCount} из {totalCount}
              </span>
            </div>

            {COLUMN_OPTIONS.map((opt) => {
              const checked = columns[opt.key];
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => toggleColumn(opt.key)}
                  className={`w-full min-h-[38px] px-2.5 py-1.5 rounded-xl text-left flex items-center justify-between gap-2.5 transition-colors ${
                    checked
                      ? 'bg-emerald-500/10 text-white hover:bg-emerald-500/15'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-tight">{opt.label}</div>
                    <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{opt.hint}</div>
                  </div>
                  <span
                    className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                        : 'border-white/20 bg-white/5 text-transparent'
                    }`}
                  >
                    <Check className="w-3 h-3 stroke-[2.75]" />
                  </span>
                </button>
              );
            })}

            <div className="pt-1 mt-1 border-t border-white/8">
              <button
                type="button"
                onClick={() => onChange(DEFAULT_MARKET_COLUMNS)}
                disabled={!isCustomized}
                className="w-full min-h-[32px] px-2.5 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] disabled:opacity-40 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Показать все колонки</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

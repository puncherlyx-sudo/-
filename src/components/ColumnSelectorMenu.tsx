import React, { useState } from 'react';
import { Check, Columns3, RotateCcw } from 'lucide-react';
import { BottomSheet, BottomSheetItem, BottomSheetList } from './BottomSheet';
import { triggerHaptic } from '../lib/securityDlp';

export interface MarketVisibleColumns {
  price: boolean;
  change24h: boolean;
  volume: boolean;
  marketCap: boolean;
  sparkline: boolean;
}

export type VisibleAssetColumns = MarketVisibleColumns;

export const DEFAULT_MARKET_COLUMNS: MarketVisibleColumns = {
  price: true,
  change24h: true,
  volume: true,
  marketCap: true,
  sparkline: true,
};

export const DEFAULT_VISIBLE_COLUMNS = DEFAULT_MARKET_COLUMNS;

interface ColumnOption {
  key: keyof MarketVisibleColumns;
  label: string;
  hint: string;
}

const COLUMN_OPTIONS: ColumnOption[] = [
  { key: 'price', label: 'Цена (USDT)', hint: 'Текущая рыночная котировка пары' },
  { key: 'change24h', label: 'Изменение 24ч (%)', hint: 'Дневной импульс роста или падения' },
  { key: 'volume', label: 'Объём 24ч', hint: 'Суточный оборот торгов в долларах' },
  { key: 'marketCap', label: 'Капитализация', hint: 'Оценка рыночной капитализации монеты' },
  { key: 'sparkline', label: 'Спарклайн 24ч', hint: 'Мини-график тренда за 24 часа' },
];

interface ColumnSelectorMenuProps {
  columns: VisibleAssetColumns;
  onChange: (next: VisibleAssetColumns) => void;
}

export const ColumnSelectorMenu: React.FC<ColumnSelectorMenuProps> = ({ columns, onChange }) => {
  const [open, setOpen] = useState(false);

  const activeCount = Object.values(columns).filter(Boolean).length;
  const isDefault =
    columns.price &&
    columns.change24h &&
    columns.volume &&
    columns.marketCap &&
    columns.sparkline;

  const toggleColumn = (key: keyof VisibleAssetColumns) => {
    triggerHaptic(8);
    const next = { ...columns, [key]: !columns[key] };
    // Не позволяем скрыть абсолютно все колонки — оставляем хотя бы одну
    if (!Object.values(next).some(Boolean)) return;
    onChange(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          triggerHaptic(8);
          setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Настроить отображаемые колонки активов"
        className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
          open || !isDefault
            ? 'border-emerald-500/45 bg-emerald-500/12 text-emerald-200'
            : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:border-white/20 hover:text-white'
        }`}
      >
        <Columns3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>Колонки</span>
        <span className="font-mono tabular-nums text-[11px] text-slate-400">
          {activeCount}/{COLUMN_OPTIONS.length}
        </span>
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Настройка колонок"
        subtitle={`Показано ${activeCount} из ${COLUMN_OPTIONS.length} метрик в обзоре пар`}
        headerRight={
          !isDefault ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onChange(DEFAULT_VISIBLE_COLUMNS);
              }}
              className="min-h-[34px] px-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-medium inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Сброс</span>
            </button>
          ) : null
        }
      >
        <BottomSheetList className="space-y-2">
          {COLUMN_OPTIONS.map((opt, idx) => {
            const checked = columns[opt.key];
            const isLastActive = checked && activeCount === 1;
            return (
              <BottomSheetItem key={opt.key} index={idx}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  disabled={isLastActive}
                  onClick={() => toggleColumn(opt.key)}
                  className={`w-full min-h-[54px] px-3.5 py-2.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors ${
                    checked
                      ? 'border-emerald-500/35 bg-emerald-500/[0.09] text-white'
                      : 'border-white/8 bg-[var(--surface-0)] text-slate-300 hover:border-white/15'
                  } ${isLastActive ? 'opacity-65 cursor-not-allowed' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-slate-400 leading-snug">{opt.hint}</div>
                  </div>
                  <span
                    className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                        : 'border-white/20 bg-white/5 text-transparent'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  </span>
                </button>
              </BottomSheetItem>
            );
          })}

          <BottomSheetItem key="done-cta" index={COLUMN_OPTIONS.length} className="pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
            >
              Готово
            </button>
          </BottomSheetItem>
        </BottomSheetList>
      </BottomSheet>
    </>
  );
};

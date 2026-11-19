import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  ClipboardCheck,
  Copy,
  ShieldAlert,
  Square,
} from 'lucide-react';
import { triggerHaptic } from '../lib/securityDlp';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

interface OrderTransferCardProps {
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  entryText: string;
  stopLossText: string;
  tp1Text: string;
  volumeUsdtText: string;
  leverage?: number;
  compact?: boolean;
}

export const OrderTransferCard: React.FC<OrderTransferCardProps> = ({
  symbol,
  direction,
  entryText,
  stopLossText,
  tp1Text,
  volumeUsdtText,
  leverage,
  compact = false,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      triggerHaptic(10);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
    } catch {
      // Игнорируем ошибку доступа к буферу обмена
    }
  };

  const cleanNumeric = (raw: string) => {
    const match = raw.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return match ? match[0] : raw;
  };

  const fullSetupText = [
    `VERNIER Сетап · ${symbol} · ${direction}${leverage && leverage > 1 ? ` (${leverage}x)` : ''}`,
    `Вход: ${entryText}`,
    `Stop-Loss: ${stopLossText}`,
    `TP1: ${tp1Text}`,
    `Объем: ${volumeUsdtText} USDT`,
  ].join('\n');

  const buttons = [
    { id: 'entry', label: 'Вход', value: cleanNumeric(entryText), preview: entryText, tone: 'text-white' },
    { id: 'sl', label: 'Stop-Loss', value: cleanNumeric(stopLossText), preview: stopLossText, tone: 'text-rose-300' },
    { id: 'tp1', label: 'Take-Profit 1', value: cleanNumeric(tp1Text), preview: tp1Text, tone: 'text-emerald-300' },
    {
      id: 'vol',
      label: 'Объём USDT',
      value: cleanNumeric(volumeUsdtText),
      preview: `${volumeUsdtText} USDT`,
      tone: 'text-cyan-300',
    },
  ];

  return (
    <div
      className={`rounded-xl border border-emerald-500/20 bg-[var(--surface-2)] ${
        compact ? 'p-3 space-y-2.5' : 'p-3.5 space-y-3'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
          <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Перенос ордера на биржу</span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">Нажмите для копирования</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {buttons.map((btn) => {
          const isCopied = copiedKey === btn.id;
          return (
            <button
              key={btn.id}
              type="button"
              onClick={() => void copyValue(btn.id, btn.value)}
              aria-label={`Копировать ${btn.label}: ${btn.preview}`}
              className={`min-h-[48px] rounded-lg border px-2.5 py-2 text-left transition-all active:scale-[0.98] ${
                isCopied
                  ? 'border-emerald-400/60 bg-emerald-500/18 text-emerald-200'
                  : 'border-white/10 bg-[var(--surface-0)] hover:border-emerald-500/35'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
                <span className="font-medium leading-tight">
                  {isCopied ? 'Скопировано' : btn.label}
                </span>
                {isCopied ? (
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-500 shrink-0" />
                )}
              </div>
              <div className={`mt-0.5 text-xs font-mono font-semibold tabular-nums leading-tight break-all ${btn.tone}`}>
                {btn.preview}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void copyValue('all', fullSetupText)}
        className="w-full min-h-[38px] rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors active:scale-[0.99]"
      >
        {copiedKey === 'all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copiedKey === 'all' ? 'Весь сетап скопирован в буфер' : 'Скопировать весь сетап'}</span>
      </button>

      <NonCustodialRiskNotice
        text="VERNIER не оперирует вашими деньгами. Перенос параметров и открытие сделок на бирже выполняются вами самостоятельно под вашу личную финансовую ответственность."
      />
    </div>
  );
};

export const PRE_TRADE_CHECKLIST_ITEMS = [
  { id: 'htf', label: 'Тренд старшего ТФ подтвержден' },
  { id: 'risk', label: 'Риск на сделку ≤ 2%' },
  { id: 'macro', label: 'Нет выхода важных макроновостей' },
  { id: 'calm', label: 'Без эмоций / не отыгрываюсь' },
] as const;

interface PreTradeChecklistProps {
  checkedIds: string[];
  onToggle: (id: string) => void;
  antiFomoTriggered?: boolean;
  isMax?: boolean;
}

export const PreTradeChecklist: React.FC<PreTradeChecklistProps> = ({
  checkedIds,
  onToggle,
  antiFomoTriggered = false,
  isMax = false,
}) => {
  const doneCount = checkedIds.length;
  const allDone = doneCount === PRE_TRADE_CHECKLIST_ITEMS.length;

  return (
    <div className="rounded-xl border border-white/10 bg-[var(--surface-0)] p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Pre-Trade Чек-лист и Анти-FOMO</span>
        </div>
        <span
          className={`text-[11px] font-mono tabular-nums font-semibold ${
            allDone ? 'text-emerald-400' : 'text-slate-400'
          }`}
        >
          {doneCount}/{PRE_TRADE_CHECKLIST_ITEMS.length}
        </span>
      </div>

      {antiFomoTriggered && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/12 px-3 py-2.5 text-xs text-amber-100 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong className="text-amber-200">
              Анти-FOMO защита{isMax ? ' MAX' : ''} (3 убытка подряд за 24ч):
            </strong>{' '}
            Режим защиты: сделайте паузу 30 мин или снизьте риск вдвое.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {PRE_TRADE_CHECKLIST_ITEMS.map((item) => {
          const checked = checkedIds.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onToggle(item.id);
              }}
              aria-pressed={checked}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border text-left text-xs flex items-center gap-2 transition-colors ${
                checked
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
                  : 'border-white/8 bg-[var(--surface-1)] text-slate-300 hover:border-white/15'
              }`}
            >
              {checked ? (
                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-slate-500 shrink-0" />
              )}
              <span className="leading-tight">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

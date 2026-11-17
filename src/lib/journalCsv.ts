import { tradePnlPct, tradeRMultiple, type TradeLike, type TradeSide } from './journalStats.ts';

export interface CsvTrade extends TradeLike {
  id: string;
  symbol: string;
  marketType: 'spot' | 'futures';
  note: string;
  createdAtSec?: number;
  closedAt?: string;
}

/**
 * Ячейка CSV. Ячейки, начинающиеся с = + - @ (и управляющих символов), Excel/Google Таблицы выполняют как формулу —
 * такие значения (например, из заметки) экранируются апострофом. Затем применяются обычные правила кавычек.
 */
export function csvCell(value: string | number): string {
  let text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const sideLabel = (s: TradeSide) => (s === 'LONG' ? 'LONG' : 'SHORT');

const HEADER = ['id', 'date_opened', 'date_closed', 'symbol', 'market', 'side', 'entry', 'stop', 'exit', 'status', 'pnl_pct', 'r_multiple', 'note'];

export function tradesToCsv(trades: CsvTrade[]): string {
  const rows = trades.map((t) => {
    const closed = t.status === 'closed' && t.exitPrice > 0;
    const pnl = closed ? tradePnlPct(t, t.exitPrice) : null;
    const r = closed ? tradeRMultiple(t, t.exitPrice) : null;
    return [
      t.id,
      t.createdAtSec ? new Date(t.createdAtSec * 1000).toISOString() : '',
      t.closedAt ?? '',
      t.symbol,
      t.marketType,
      sideLabel(t.side),
      t.entryPrice,
      t.stopPrice > 0 ? t.stopPrice : '',
      closed ? t.exitPrice : '',
      t.status,
      pnl === null ? '' : Math.round(pnl * 100) / 100,
      r === null ? '' : Math.round(r * 100) / 100,
      t.note,
    ].map(csvCell);
  });
  // BOM, чтобы Excel правильно открыл русский текст в UTF-8
  return '﻿' + [HEADER.join(','), ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n';
}

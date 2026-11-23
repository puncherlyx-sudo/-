export type PnlIntensityLevel = 0 | 1 | 2 | 3 | 4;
export type PnlDirection = 'positive' | 'negative' | 'neutral';

export interface PnlIntensityStyles {
  level: PnlIntensityLevel;
  direction: PnlDirection;
  textClass: string;
  subtleTextClass: string;
  badgeClass: string;
  cardTintClass: string;
  widgetBorderClass: string;
  chartStrokeHex: string;
}

export interface PnlIntensityOptions {
  /** Принудительно нейтральный вид (например, при скрытых балансах или отсутствии данных). */
  isNeutral?: boolean;
}

const NEUTRAL_STYLES: PnlIntensityStyles = {
  level: 0,
  direction: 'neutral',
  textClass: 'text-slate-300',
  subtleTextClass: 'text-slate-400',
  badgeClass: 'border-white/10 bg-white/[0.04] text-slate-300',
  cardTintClass: 'bg-transparent',
  widgetBorderClass: 'border-emerald-500/18',
  chartStrokeHex: '#94a3b8',
};

const POSITIVE_TIERS: Record<Exclude<PnlIntensityLevel, 0>, PnlIntensityStyles> = {
  1: {
    level: 1,
    direction: 'positive',
    textClass: 'text-emerald-400/85',
    subtleTextClass: 'text-emerald-400/70',
    badgeClass: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300/90',
    cardTintClass: 'bg-emerald-500/[0.03]',
    widgetBorderClass: 'border-emerald-500/22',
    chartStrokeHex: '#34d399',
  },
  2: {
    level: 2,
    direction: 'positive',
    textClass: 'text-emerald-400',
    subtleTextClass: 'text-emerald-300/85',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/[0.13] text-emerald-300',
    cardTintClass: 'bg-emerald-500/[0.07]',
    widgetBorderClass: 'border-emerald-500/32',
    chartStrokeHex: '#10b981',
  },
  3: {
    level: 3,
    direction: 'positive',
    textClass: 'text-emerald-300',
    subtleTextClass: 'text-emerald-200/90',
    badgeClass:
      'border-emerald-400/50 bg-emerald-500/[0.21] text-emerald-200 shadow-[0_0_12px_-4px_rgba(16,185,129,0.5)]',
    cardTintClass:
      'bg-emerald-500/[0.12] shadow-[inset_0_0_24px_-12px_rgba(16,185,129,0.45)]',
    widgetBorderClass:
      'border-emerald-400/45 shadow-[0_0_18px_-10px_rgba(16,185,129,0.45)]',
    chartStrokeHex: '#10b981',
  },
  4: {
    level: 4,
    direction: 'positive',
    textClass: 'text-emerald-200 drop-shadow-[0_0_8px_rgba(16,185,129,0.45)]',
    subtleTextClass: 'text-emerald-200',
    badgeClass:
      'border-emerald-400/70 bg-emerald-500/[0.30] text-emerald-100 shadow-[0_0_16px_-3px_rgba(16,185,129,0.68)]',
    cardTintClass:
      'bg-emerald-500/[0.18] shadow-[inset_0_0_28px_-10px_rgba(16,185,129,0.62)]',
    widgetBorderClass:
      'border-emerald-400/60 shadow-[0_0_22px_-8px_rgba(16,185,129,0.58)]',
    chartStrokeHex: '#34d399',
  },
};

const NEGATIVE_TIERS: Record<Exclude<PnlIntensityLevel, 0>, PnlIntensityStyles> = {
  1: {
    level: 1,
    direction: 'negative',
    textClass: 'text-rose-400/85',
    subtleTextClass: 'text-rose-400/70',
    badgeClass: 'border-rose-500/20 bg-rose-500/[0.07] text-rose-300/90',
    cardTintClass: 'bg-rose-500/[0.03]',
    widgetBorderClass: 'border-rose-500/22',
    chartStrokeHex: '#fda4af',
  },
  2: {
    level: 2,
    direction: 'negative',
    textClass: 'text-rose-400',
    subtleTextClass: 'text-rose-300/85',
    badgeClass: 'border-rose-500/35 bg-rose-500/[0.13] text-rose-300',
    cardTintClass: 'bg-rose-500/[0.07]',
    widgetBorderClass: 'border-rose-500/32',
    chartStrokeHex: '#fb7185',
  },
  3: {
    level: 3,
    direction: 'negative',
    textClass: 'text-rose-300',
    subtleTextClass: 'text-rose-200/90',
    badgeClass:
      'border-rose-400/50 bg-rose-500/[0.21] text-rose-200 shadow-[0_0_12px_-4px_rgba(244,63,94,0.5)]',
    cardTintClass:
      'bg-rose-500/[0.12] shadow-[inset_0_0_24px_-12px_rgba(244,63,94,0.45)]',
    widgetBorderClass:
      'border-rose-400/45 shadow-[0_0_18px_-10px_rgba(244,63,94,0.45)]',
    chartStrokeHex: '#f43f5e',
  },
  4: {
    level: 4,
    direction: 'negative',
    textClass: 'text-rose-200 drop-shadow-[0_0_8px_rgba(244,63,94,0.48)]',
    subtleTextClass: 'text-rose-200',
    badgeClass:
      'border-rose-400/70 bg-rose-500/[0.30] text-rose-100 shadow-[0_0_16px_-3px_rgba(244,63,94,0.68)]',
    cardTintClass:
      'bg-rose-500/[0.18] shadow-[inset_0_0_28px_-10px_rgba(244,63,94,0.62)]',
    widgetBorderClass:
      'border-rose-400/60 shadow-[0_0_22px_-8px_rgba(244,63,94,0.58)]',
    chartStrokeHex: '#f43f5e',
  },
};

/**
 * Вычисляет уровень интенсивности подсветки PnL (0..4) по модулю доходности в процентах.
 * - 0: около нуля (|pct| < 0.05%)
 * - 1: слабая (0.05% .. <2%)
 * - 2: умеренная (2% .. <7%)
 * - 3: выраженная (7% .. <15%)
 * - 4: экстремальная (>=15%)
 */
export function resolvePnlIntensityLevel(pnlPct: number): PnlIntensityLevel {
  if (!Number.isFinite(pnlPct)) return 0;
  const abs = Math.abs(pnlPct);
  if (abs < 0.05) return 0;
  if (abs < 2) return 1;
  if (abs < 7) return 2;
  if (abs < 15) return 3;
  return 4;
}

/**
 * Возвращает набор Tailwind-классов с динамической интенсивностью зелёного/красного оттенка
 * в зависимости от знака и величины доходности (pnlPct).
 */
export function getPnlIntensityStyles(
  pnlPct: number,
  options?: PnlIntensityOptions
): PnlIntensityStyles {
  if (options?.isNeutral || !Number.isFinite(pnlPct)) {
    return NEUTRAL_STYLES;
  }
  const level = resolvePnlIntensityLevel(pnlPct);
  if (level === 0) {
    return NEUTRAL_STYLES;
  }
  return pnlPct > 0 ? POSITIVE_TIERS[level] : NEGATIVE_TIERS[level];
}

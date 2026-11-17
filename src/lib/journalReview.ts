import { tradePnlPct, tradeRMultiple, type TradeLike, type TradeSide } from './journalStats.ts';

/**
 * Глубокий разбор дневника сделок: правила и расчёты, без ИИ.
 * Отвечает на вопрос «где я теряю деньги»: направления, пары, дисциплина стопов, серии убытков.
 */

export interface ReviewTrade extends TradeLike {
  symbol: string;
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface ReviewInsight {
  tone: InsightTone;
  title: string;
  text: string;
}

export interface JournalReview {
  sample: { closed: number; open: number; enough: boolean };
  headline: { tone: InsightTone; text: string };
  metrics: {
    winRatePct: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
    payoffRatio: number | null;
    profitFactor: number | null;
    expectancyPct: number | null;
    expectancyR: number | null;
    maxLossStreak: number;
  };
  bySide: Array<{ side: TradeSide; count: number; winRatePct: number; avgPnlPct: number }>;
  bySymbol: Array<{ symbol: string; count: number; winRatePct: number; totalPnlPct: number }>;
  stops: {
    withStop: number;
    withoutStop: number;
    withoutStopPct: number;
    avgLossWithStopPct: number | null;
    avgLossWithoutStopPct: number | null;
  };
  insights: ReviewInsight[];
}

export const MIN_TRADES_FOR_REVIEW = 8;

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const r1 = (n: number): string => (Math.round(n * 10) / 10).toString().replace('.', ',');
const pct = (n: number): string => `${n >= 0 ? '+' : ''}${r1(n)}%`;

export function reviewJournal(trades: ReviewTrade[]): JournalReview {
  const closed = trades.filter((t) => t.status === 'closed' && t.exitPrice > 0);
  const open = trades.filter((t) => t.status === 'open').length;
  // порядок: по порядку записи (для серий убытков), входной массив уже упорядочен от старых к новым
  const rows = closed.map((t) => ({ t, pnl: tradePnlPct(t, t.exitPrice), r: tradeRMultiple(t, t.exitPrice) }));

  const wins = rows.filter((x) => x.pnl > 0);
  const losses = rows.filter((x) => x.pnl < 0);
  const rs = rows.map((x) => x.r).filter((r): r is number => r !== null);

  const grossWin = sum(wins.map((x) => x.pnl));
  const grossLoss = Math.abs(sum(losses.map((x) => x.pnl)));
  const avgWin = avg(wins.map((x) => x.pnl));
  const avgLoss = avg(losses.map((x) => x.pnl));

  let streak = 0;
  let maxLossStreak = 0;
  for (const x of rows) {
    if (x.pnl < 0) {
      streak += 1;
      maxLossStreak = Math.max(maxLossStreak, streak);
    } else {
      streak = 0;
    }
  }

  const metrics: JournalReview['metrics'] = {
    winRatePct: rows.length ? (wins.length / rows.length) * 100 : null,
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    payoffRatio: avgWin !== null && avgLoss !== null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    expectancyPct: avg(rows.map((x) => x.pnl)),
    expectancyR: avg(rs),
    maxLossStreak,
  };

  const bySide = (['LONG', 'SHORT'] as TradeSide[])
    .map((side) => {
      const part = rows.filter((x) => x.t.side === side);
      return {
        side,
        count: part.length,
        winRatePct: part.length ? (part.filter((x) => x.pnl > 0).length / part.length) * 100 : 0,
        avgPnlPct: avg(part.map((x) => x.pnl)) ?? 0,
      };
    })
    .filter((s) => s.count > 0);

  const symbols = Array.from(new Set(rows.map((x) => x.t.symbol)));
  const bySymbol = symbols
    .map((symbol) => {
      const part = rows.filter((x) => x.t.symbol === symbol);
      return {
        symbol,
        count: part.length,
        winRatePct: (part.filter((x) => x.pnl > 0).length / part.length) * 100,
        totalPnlPct: sum(part.map((x) => x.pnl)),
      };
    })
    .sort((a, b) => b.totalPnlPct - a.totalPnlPct);

  const noStop = rows.filter((x) => !(x.t.stopPrice > 0));
  const withStop = rows.filter((x) => x.t.stopPrice > 0);
  const stops: JournalReview['stops'] = {
    withStop: withStop.length,
    withoutStop: noStop.length,
    withoutStopPct: rows.length ? (noStop.length / rows.length) * 100 : 0,
    avgLossWithStopPct: avg(withStop.filter((x) => x.pnl < 0).map((x) => x.pnl)),
    avgLossWithoutStopPct: avg(noStop.filter((x) => x.pnl < 0).map((x) => x.pnl)),
  };

  const enough = rows.length >= MIN_TRADES_FOR_REVIEW;
  const insights: ReviewInsight[] = [];

  if (!enough) {
    insights.push({
      tone: 'neutral',
      title: 'Мало данных',
      text: `Закрыто ${rows.length} из ${MIN_TRADES_FOR_REVIEW} сделок, нужных для надёжных выводов. Продолжайте вести дневник: выводы на малой выборке часто случайны.`,
    });
  } else {
    const exp = metrics.expectancyPct ?? 0;
    if (exp <= 0) {
      insights.push({
        tone: 'bad',
        title: 'Система пока в минусе',
        text: `В среднем сделка приносит ${pct(exp)}. Пока не найдёте и не исправите причину (см. ниже), увеличивать размер позиции рано.`,
      });
    }
    // Безубыточный винрейт = 1 / (1 + payoff). Если фактический ниже — асимметрия «прибыль меньше убытка» съедает результат.
    if (
      metrics.payoffRatio !== null &&
      metrics.payoffRatio < 1 &&
      (metrics.winRatePct ?? 0) < 100 / (1 + metrics.payoffRatio)
    ) {
      insights.push({
        tone: 'bad',
        title: 'Убытки больше прибылей',
        text: `Средний убыток (${pct(avgLoss ?? 0)}) в ${r1(1 / metrics.payoffRatio)} раза больше средней прибыли (${pct(avgWin ?? 0)}). Чтобы это работало, нужен винрейт выше ${Math.round(100 / (1 + metrics.payoffRatio))}%, а у вас ${Math.round(metrics.winRatePct ?? 0)}%. Ставьте стопы ближе или не закрывайте прибыль слишком рано.`,
      });
    }
    if (stops.withoutStopPct >= 30) {
      const detail =
        stops.avgLossWithoutStopPct !== null && stops.avgLossWithStopPct !== null
          ? ` Убыток без стопа в среднем ${pct(stops.avgLossWithoutStopPct)}, со стопом ${pct(stops.avgLossWithStopPct)}.`
          : '';
      insights.push({
        tone: stops.withoutStopPct >= 50 ? 'bad' : 'warn',
        title: 'Сделки без стопа',
        text: `У ${Math.round(stops.withoutStopPct)}% сделок не записан стоп.${detail} Без стопа нельзя посчитать R и контролировать риск.`,
      });
    }
    if (maxLossStreak >= 4) {
      insights.push({
        tone: 'warn',
        title: 'Серия убытков',
        text: `Самая длинная серия: ${maxLossStreak} убыточных сделок подряд. После 3 убытков подряд разумно сделать паузу и снизить размер позиции.`,
      });
    }
    if (bySide.length === 2) {
      const [a, b] = bySide;
      if (a.count >= 3 && b.count >= 3 && Math.abs(a.winRatePct - b.winRatePct) >= 20) {
        const better = a.winRatePct > b.winRatePct ? a : b;
        const worse = better === a ? b : a;
        insights.push({
          tone: 'warn',
          title: better.side === 'LONG' ? 'Лонги получаются лучше шортов' : 'Шорты получаются лучше лонгов',
          text: `${better.side === 'LONG' ? 'Лонги' : 'Шорты'}: винрейт ${Math.round(better.winRatePct)}% (${better.count} сделок), ${worse.side === 'LONG' ? 'лонги' : 'шорты'}: ${Math.round(worse.winRatePct)}% (${worse.count}). Возможно, стоит торговать только сильную сторону.`,
        });
      }
    }
    const worstSymbol = [...bySymbol].reverse().find((s) => s.count >= 3 && s.totalPnlPct < 0);
    if (worstSymbol) {
      insights.push({
        tone: 'warn',
        title: `Пара ${worstSymbol.symbol.replace('USDT', '')} съедает результат`,
        text: `${worstSymbol.count} сделок, суммарно ${pct(worstSymbol.totalPnlPct)}, винрейт ${Math.round(worstSymbol.winRatePct)}%. Подумайте, нужна ли она в вашем списке.`,
      });
    }
    if (exp > 0 && (metrics.winRatePct ?? 0) >= 45 && stops.withoutStopPct < 20) {
      insights.push({
        tone: 'good',
        title: 'Система в плюсе',
        text: `Среднее на сделку ${pct(exp)}, стопы стоят почти везде. Это хорошая основа: следите, чтобы размер позиции не рос быстрее, чем подтверждается статистика.`,
      });
    }
    if (insights.length === 0) {
      insights.push({ tone: 'neutral', title: 'Явных проблем не найдено', text: 'Продолжайте вести дневник: с ростом числа сделок выводы станут точнее.' });
    }
  }

  const headline: JournalReview['headline'] = !enough
    ? { tone: 'neutral', text: `Выборка мала: ${rows.length} закрытых сделок` }
    : (metrics.expectancyPct ?? 0) > 0
      ? { tone: 'good', text: `Ожидание ${pct(metrics.expectancyPct ?? 0)} на сделку, винрейт ${Math.round(metrics.winRatePct ?? 0)}%` }
      : { tone: 'bad', text: `Ожидание ${pct(metrics.expectancyPct ?? 0)} на сделку: система в минусе` };

  return { sample: { closed: rows.length, open, enough }, headline, metrics, bySide, bySymbol, stops, insights };
}

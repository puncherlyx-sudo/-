import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, CircleCheck, Download, Lock, Plus, Sparkles, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { CREDIT_COSTS, TRADING_PAIRS } from '../data/strategies';
import { authFetch } from '../lib/authFetch';
import { db } from '../lib/firebase';
import type { JournalReview } from '../lib/journalReview';
import { tradesToCsv } from '../lib/journalCsv';
import {
  computeJournalStats,
  tradePnlPct,
  tradeRMultiple,
  type TradeSide,
} from '../lib/journalStats';
import type { MarketType, TickerOverview } from '../types/domain';
import { JournalReviewPanel } from './JournalReviewPanel';
import { AnimatedNumber } from './MotionExtras';
import { UpgradeNudge } from './UpgradeNudge';

interface TradeRecord {
  id: string;
  userId: string;
  symbol: string;
  marketType: MarketType;
  side: TradeSide;
  entryPrice: number;
  stopPrice: number;
  exitPrice: number;
  status: 'open' | 'closed';
  note: string;
  closedAt: string;
  createdAt?: { seconds?: number };
}

interface TradeJournalProps {
  uid: string | null;
  onRequireLogin: () => void;
  isPro?: boolean;
  creditsRemaining?: number;
  onUpgradePro?: () => void;
}

const inputCls =
  'w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0B0F17] px-3.5 text-sm font-mono tabular-nums text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none';

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(5);
}

function signedPct(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function newTradeId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function describeError(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'permission-denied') {
    return 'Нет доступа к дневнику. Владельцу приложения нужно опубликовать обновлённые правила Firestore (файл firestore.rules).';
  }
  return 'Не удалось выполнить действие. Проверьте соединение и повторите.';
}

export const TradeJournal: React.FC<TradeJournalProps> = ({
  uid,
  onRequireLogin,
  isPro = false,
  creditsRemaining,
  onUpgradePro,
}) => {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [side, setSide] = useState<TradeSide>('LONG');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitInput, setExitInput] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Подписка на дневник пользователя
  useEffect(() => {
    if (!uid) {
      setTrades([]);
      return;
    }
    setLoadError(null);
    const q = query(collection(db, 'users', uid, 'trades'), where('userId', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as TradeRecord);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setTrades(rows);
      },
      (err) => setLoadError(describeError(err))
    );
    return unsub;
  }, [uid]);

  // Текущие цены: для подстановки цены входа и для результата открытых сделок
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const next: Record<string, number> = {};
        for (const mt of ['spot', 'futures'] as MarketType[]) {
          const res = await fetch(`/api/market/overview?marketType=${mt}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { tickers?: TickerOverview[] };
          for (const t of data.tickers ?? []) next[`${mt}:${t.symbol}`] = t.price;
        }
        if (!cancelled) setPrices(next);
      } catch {
        // оставляем прошлые цены
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const stats = useMemo(() => computeJournalStats(trades), [trades]);

  // Платные функции дневника: разбор (кредиты, считает сервер) и экспорт (PRO)
  const [review, setReview] = useState<JournalReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<{ message: string; upgrade: boolean } | null>(null);

  const handleReview = async () => {
    setReviewError(null);
    setReviewNote(null);
    setReviewing(true);
    try {
      const res = await authFetch('/api/journal/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // от старых сделок к новым: так считаются серии убытков
        body: JSON.stringify({
          trades: [...trades]
            .reverse()
            .map((t) => ({
              symbol: t.symbol,
              side: t.side,
              entryPrice: t.entryPrice,
              stopPrice: t.stopPrice,
              exitPrice: t.exitPrice,
              status: t.status,
            })),
        }),
      });
      const data = (await res.json()) as {
        report?: JournalReview;
        charged?: number;
        credits?: { remaining: number } | null;
        error?: string;
        upgrade?: boolean;
      };
      if (!res.ok || !data.report) {
        setReviewError({ message: data.error || 'Не удалось сделать разбор.', upgrade: Boolean(data.upgrade) });
        return;
      }
      setReview(data.report);
      setReviewNote(
        data.charged
          ? `Списано ${data.charged} кр.${data.credits ? `, осталось ${data.credits.remaining}` : ''}.`
          : 'Кредиты не списаны: закрытых сделок пока мало для надёжных выводов.'
      );
    } catch {
      setReviewError({ message: 'Нет соединения с сервером. Кредиты не списаны.', upgrade: false });
    } finally {
      setReviewing(false);
    }
  };

  const handleExport = () => {
    if (!isPro) {
      onUpgradePro?.();
      return;
    }
    const csv = tradesToCsv(
      [...trades].reverse().map((t) => ({
        id: t.id,
        symbol: t.symbol,
        marketType: t.marketType,
        side: t.side,
        entryPrice: t.entryPrice,
        stopPrice: t.stopPrice,
        exitPrice: t.exitPrice,
        status: t.status,
        note: t.note,
        createdAtSec: t.createdAt?.seconds,
        closedAt: t.closedAt,
      }))
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegisquant-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const livePrice = prices[`${marketType}:${symbol}`];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!uid) {
      onRequireLogin();
      return;
    }
    const entryPrice = Number(entry.replace(',', '.'));
    const stopPrice = stop.trim() ? Number(stop.replace(',', '.')) : 0;
    if (!Number.isFinite(entryPrice) || !(entryPrice > 0) || entryPrice > 100_000_000) {
      setFormError('Введите корректную цену входа (до 100 000 000).');
      return;
    }
    if (stop.trim() && (!Number.isFinite(stopPrice) || !(stopPrice > 0) || stopPrice > 100_000_000)) {
      setFormError('Стоп должен быть числом больше нуля (до 100 000 000), либо оставьте поле пустым.');
      return;
    }
    if (stopPrice > 0 && (side === 'LONG' ? stopPrice >= entryPrice : stopPrice <= entryPrice)) {
      setFormError(
        side === 'LONG' ? 'Для лонга стоп должен быть НИЖЕ цены входа.' : 'Для шорта стоп должен быть ВЫШЕ цены входа.'
      );
      return;
    }
    setSubmitting(true);
    try {
      const id = newTradeId();
      await setDoc(doc(db, 'users', uid, 'trades', id), {
        id,
        userId: uid,
        symbol,
        marketType,
        side,
        entryPrice,
        stopPrice,
        exitPrice: 0,
        status: 'open',
        note: note.trim().slice(0, 280),
        closedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setEntry('');
      setStop('');
      setNote('');
    } catch (err) {
      setFormError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (t: TradeRecord) => {
    if (!uid) return;
    const exitPrice = Number(exitInput.replace(',', '.'));
    if (!Number.isFinite(exitPrice) || !(exitPrice > 0) || exitPrice > 100_000_000) {
      setActionError('Введите корректную цену выхода (до 100 000 000).');
      return;
    }
    setBusyId(t.id);
    setActionError(null);
    try {
      await updateDoc(doc(db, 'users', uid, 'trades', t.id), {
        exitPrice,
        status: 'closed',
        closedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      setClosingId(null);
      setExitInput('');
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (t: TradeRecord) => {
    if (!uid) return;
    setBusyId(t.id);
    setActionError(null);
    try {
      await deleteDoc(doc(db, 'users', uid, 'trades', t.id));
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusyId(null);
    }
  };

  const statCards: Array<{ label: string; node: React.ReactNode; tone: string }> = [
    {
      label: 'Винрейт',
      tone: 'text-white',
      node:
        stats.winRatePct === null ? (
          '—'
        ) : (
          <AnimatedNumber value={stats.winRatePct} format={(n) => `${Math.round(n)}%`} fromZero />
        ),
    },
    {
      label: 'Итог, %',
      tone: stats.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400',
      node: stats.closedCount ? (
        <AnimatedNumber value={stats.totalPnlPct} format={(n) => signedPct(n, 1)} fromZero />
      ) : (
        '—'
      ),
    },
    {
      label: 'Средний R',
      tone: (stats.avgR ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
      node:
        stats.avgR === null ? (
          '—'
        ) : (
          <AnimatedNumber value={stats.avgR} format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`} fromZero />
        ),
    },
    {
      label: 'Закрыто / открыто',
      tone: 'text-white',
      node: `${stats.closedCount} / ${stats.openCount}`,
    },
  ];

  if (!uid) {
    return (
      <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-6 text-center space-y-3">
        <div className="mx-auto w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
          <Lock className="w-5 h-5" />
        </div>
        <h3 className="text-base font-semibold text-white">Дневник сделок</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
          Записывайте входы и выходы, считайте винрейт и средний R. Дневник хранится в вашем аккаунте и виден только вам.
        </p>
        <button
          type="button"
          onClick={onRequireLogin}
          className="cta-shimmer min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-sm font-semibold text-white"
        >
          Войти, чтобы вести дневник
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Статистика */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Статистика дневника">
        {statCards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4">
            <div className="text-[11px] text-slate-400">{c.label}</div>
            <div className={`mt-1 text-xl font-bold font-mono tabular-nums ${c.tone}`}>{c.node}</div>
          </div>
        ))}
      </section>

      {/* Платные функции дневника */}
      <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 space-y-3" aria-label="Разбор и экспорт">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleReview()}
            disabled={reviewing || stats.closedCount === 0}
            className="cta-shimmer min-h-[46px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {reviewing ? 'Считаю…' : `Глубокий разбор (${CREDIT_COSTS.journalReview} кр.)`}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={trades.length === 0}
            className="min-h-[46px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-sm font-semibold text-slate-200 inline-flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Экспорт в CSV
            {!isPro && <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold">PRO</span>}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Разбор показывает, где вы теряете деньги: направления, пары, дисциплина стопов, серии убытков.
          {typeof creditsRemaining === 'number' && (
            <> Кредитов: <span className="font-mono text-slate-300">{creditsRemaining}</span>.</>
          )}
        </p>
        {reviewError && (
          reviewError.upgrade && !isPro ? (
            <UpgradeNudge
              title="Кредитов не хватает"
              text={`${reviewError.message} PRO даёт 100 кредитов в месяц и экспорт дневника.`}
              onUpgrade={() => onUpgradePro?.()}
            />
          ) : (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">{reviewError.message}</div>
          )
        )}
        {reviewNote && <p className="text-[11px] text-slate-400">{reviewNote}</p>}
      </section>

      {review && <JournalReviewPanel review={review} />}

      {/* Новая сделка */}
      <form
        onSubmit={(e) => void handleAdd(e)}
        className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-3"
      >
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-400" />
          Новая сделка
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] text-slate-400 mb-1">Пара</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputCls}>
              {TRADING_PAIRS.map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] text-slate-400 mb-1">Рынок</span>
            <select value={marketType} onChange={(e) => setMarketType(e.target.value as MarketType)} className={inputCls}>
              <option value="spot">Спот</option>
              <option value="futures">Фьючерсы</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Направление сделки">
          {(['LONG', 'SHORT'] as TradeSide[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => setSide(s)}
              className={`min-h-[44px] rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                side === s
                  ? s === 'LONG'
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {s === 'LONG' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {s === 'LONG' ? 'Лонг' : 'Шорт'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              Цена входа
              {livePrice !== undefined && (
                <button
                  type="button"
                  onClick={() => setEntry(String(livePrice))}
                  className="text-cyan-300 hover:text-cyan-200 font-medium"
                >
                  по рынку {fmt(livePrice)}
                </button>
              )}
            </span>
            <input
              inputMode="decimal"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-slate-400 mb-1">Стоп (по желанию)</span>
            <input
              inputMode="decimal"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-[11px] text-slate-400 mb-1">Заметка: почему вошли</span>
          <input
            value={note}
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: пробой уровня на объёме"
            className={`${inputCls} font-sans`}
          />
        </label>

        {formError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
            {formError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {submitting ? 'Сохранение…' : 'Записать сделку'}
        </button>
      </form>

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">{loadError}</div>
      )}
      {actionError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{actionError}</div>
      )}

      {/* Список сделок */}
      <section className="space-y-3" aria-label="Сделки">
        {trades.length === 0 && !loadError && (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
            Пока нет записей. Записывайте каждую сделку: через несколько недель статистика покажет, что у вас реально
            работает.
          </div>
        )}

        <AnimatePresence initial={false}>
          {trades.map((t) => {
            const isOpen = t.status === 'open';
            const price = isOpen ? prices[`${t.marketType}:${t.symbol}`] : t.exitPrice;
            const pnl = price ? tradePnlPct(t, price) : null;
            const r = price ? tradeRMultiple(t, price) : null;
            const win = (pnl ?? 0) >= 0;
            return (
              <motion.article
                key={t.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      {t.symbol.replace('USDT', '')}
                      <span className="text-slate-500 font-normal">/ USDT</span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          t.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {t.side === 'LONG' ? 'ЛОНГ' : 'ШОРТ'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-normal">
                        {t.marketType === 'futures' ? 'фьючерсы' : 'спот'}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-400">
                      вход {fmt(t.entryPrice)}
                      {t.stopPrice > 0 && <> · стоп {fmt(t.stopPrice)}</>}
                      {!isOpen && <> · выход {fmt(t.exitPrice)}</>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {pnl !== null ? (
                      <>
                        <div className={`text-lg font-bold font-mono tabular-nums ${win ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {signedPct(pnl)}
                        </div>
                        {r !== null && (
                          <div className={`text-[11px] font-mono tabular-nums ${r >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {r >= 0 ? '+' : ''}
                            {r.toFixed(2)}R
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-slate-500">нет цены</div>
                    )}
                    <div className="text-[10px] text-slate-500">{isOpen ? 'открыта (сейчас)' : 'закрыта'}</div>
                  </div>
                </div>

                {t.note && <p className="mt-2 text-xs text-slate-300 leading-relaxed">{t.note}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {isOpen && closingId !== t.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setClosingId(t.id);
                        setExitInput(prices[`${t.marketType}:${t.symbol}`] ? String(prices[`${t.marketType}:${t.symbol}`]) : '');
                        setActionError(null);
                      }}
                      className="min-h-[38px] px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5"
                    >
                      <CircleCheck className="w-3.5 h-3.5" />
                      Закрыть сделку
                    </button>
                  )}

                  {isOpen && closingId === t.id && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <input
                        inputMode="decimal"
                        value={exitInput}
                        onChange={(e) => setExitInput(e.target.value)}
                        placeholder="Цена выхода"
                        aria-label="Цена выхода"
                        className={`${inputCls} min-h-[38px] sm:w-40`}
                      />
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => void handleClose(t)}
                        className="min-h-[38px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white"
                      >
                        Готово
                      </button>
                      <button
                        type="button"
                        onClick={() => setClosingId(null)}
                        className="min-h-[38px] px-3 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300"
                      >
                        Отмена
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => (confirmDeleteId === t.id ? void handleDelete(t) : setConfirmDeleteId(t.id))}
                    onBlur={() => setConfirmDeleteId((cur) => (cur === t.id ? null : cur))}
                    className={`min-h-[38px] px-3 rounded-lg border text-xs inline-flex items-center gap-1.5 ml-auto transition-colors ${
                      confirmDeleteId === t.id
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                    }`}
                    aria-label="Удалить запись"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {confirmDeleteId === t.id ? 'Точно удалить?' : 'Удалить'}
                  </button>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </section>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Результат считается в % от цены входа без плеча и комиссий. «R» — результат в долях риска (расстояние до стопа):
        +2R значит, что прибыль вдвое больше риска. Это учёт ваших записей, а не инвестиционная рекомендация.
      </p>
    </div>
  );
};

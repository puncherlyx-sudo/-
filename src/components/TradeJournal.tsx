import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CalendarDays,
  CheckCircle2,
  Download,
  Lock,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { TRADING_PAIRS } from '../data/strategies';
import { downloadCsvWithBom } from '../lib/csvExport';
import { FeatureGuide } from './FeatureGuide';
import {
  addLocalTrade,
  deleteLocalTrade,
  hasThreeConsecutiveLosses24h,
  readLocalTrades,
  updateLocalTrade,
  VERNIER_TRADES_EVENT,
} from '../lib/localDemoStore';
import {
  detectSensitiveWalletInput,
  parseLocalePositiveNumber,
  sanitizePlainText,
  triggerHaptic,
} from '../lib/securityDlp';
import { usePlan } from '../contexts/PlanContext';
import {
  computeDisciplineIndex,
  readTiltGuardConfig,
  VERNIER_PRO_MAX_EVENT,
  type TiltGuardConfig,
} from '../lib/proMaxStore';
import type { MarketType, TradeJournalEntry } from '../types/domain';
import { AiComplianceFooter } from './LegalConsentModal';
import { PreTradeChecklist } from './OrderTransferCard';
import { PaywallGate } from './PaywallGate';

interface TradeJournalProps {
  uid: string | null;
  isPro: boolean;
  isMax?: boolean;
  privacyMode?: boolean;
  onUpgradePro?: () => void;
  onRequireLogin: () => void;
}

export const TradeJournal: React.FC<TradeJournalProps> = ({
  uid,
  isPro,
  isMax = false,
  privacyMode = false,
  onUpgradePro,
  onRequireLogin,
}) => {
  const planCtx = usePlan();
  const effIsPro = isPro || planCtx.isPro;
  const effIsMax = isMax || planCtx.isMax;
  const effPrivacy = privacyMode || planCtx.privacyMode;

  const [journalTab, setJournalTab] = useState<'analytics' | 'coach'>('analytics');
  const [showErrorAudit, setShowErrorAudit] = useState<boolean>(false);
  const [tiltCfg, setTiltCfg] = useState<TiltGuardConfig>(() => readTiltGuardConfig());

  const [cloudTrades, setCloudTrades] = useState<TradeJournalEntry[]>([]);
  const [localTrades, setLocalTrades] = useState<TradeJournalEntry[]>(() => readLocalTrades());
  const [showForm, setShowForm] = useState(false);

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entryStr, setEntryStr] = useState('64000');
  const [stopStr, setStopStr] = useState('62800');
  const [tpStr, setTpStr] = useState('66800');
  const [sizeStr, setSizeStr] = useState('500');
  const [leverage, setLeverage] = useState(1);
  const [strategyName, setStrategyName] = useState('Пробой тренда + EMA');
  const [note, setNote] = useState('');
  const [dlpWarning, setDlpWarning] = useState<string | null>(null);
  const [checkedChecklist, setCheckedChecklist] = useState<string[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePriceStr, setClosePriceStr] = useState('');

  // Синхронизация локальных сделок и Tilt-Guard
  useEffect(() => {
    const syncLocal = () => setLocalTrades(readLocalTrades());
    const syncProMax = () => setTiltCfg(readTiltGuardConfig());
    window.addEventListener(VERNIER_TRADES_EVENT, syncLocal);
    window.addEventListener(VERNIER_PRO_MAX_EVENT, syncProMax);
    return () => {
      window.removeEventListener(VERNIER_TRADES_EVENT, syncLocal);
      window.removeEventListener(VERNIER_PRO_MAX_EVENT, syncProMax);
    };
  }, []);

  // Подписка на Firestore при входе
  useEffect(() => {
    if (!uid) {
      setCloudTrades([]);
      return;
    }
    const q = query(collection(db, 'users', uid, 'trades'), orderBy('openedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TradeJournalEntry[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TradeJournalEntry, 'id'>),
        }));
        setCloudTrades(list);
      },
      () => {
        // Если нет доступа или офлайн — работаем с локальными сделками
      }
    );
    return () => unsub();
  }, [uid]);

  const trades = uid && cloudTrades.length > 0 ? cloudTrades : localTrades;
  const isLocalMode = !uid;

  const antiFomoActive = useMemo(() => hasThreeConsecutiveLosses24h(trades), [trades]);

  const stats = useMemo(() => {
    const closed = trades
      .filter((t) => t.status === 'CLOSED' && typeof t.pnlUsdt === 'number')
      .sort((a, b) => Date.parse(a.closedAt || a.openedAt) - Date.parse(b.closedAt || b.openedAt));

    const wins = closed.filter((t) => (t.pnlUsdt ?? 0) > 0);
    const losses = closed.filter((t) => (t.pnlUsdt ?? 0) < 0);
    const totalPnl = closed.reduce((acc, t) => acc + (t.pnlUsdt ?? 0), 0);
    const grossWin = wins.reduce((acc, t) => acc + (t.pnlUsdt ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + (t.pnlUsdt ?? 0), 0));
    const winRatePct = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;
    const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const avgRr = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 2.0 : 0;

    let cumulative = 0;
    const equityCurve = [
      { idx: 0, label: 'Старт', equity: 0 },
      ...closed.map((t, i) => {
        cumulative += t.pnlUsdt ?? 0;
        return {
          idx: i + 1,
          label: `${t.symbol.replace('USDT', '')} #${i + 1}`,
          equity: Number(cumulative.toFixed(2)),
        };
      }),
    ];

    // Разбивка Win Rate по парам
    const byPairMap = new Map<string, { wins: number; total: number; pnl: number }>();
    // Разбивка по торговым сессиям (Азия 00-08 UTC, Лондон 08-14 UTC, Нью-Йорк 14-24 UTC)
    const sessionBuckets: Record<'Азия' | 'Лондон' | 'Нью-Йорк', { wins: number; total: number; pnl: number }> = {
      Азия: { wins: 0, total: 0, pnl: 0 },
      Лондон: { wins: 0, total: 0, pnl: 0 },
      'Нью-Йорк': { wins: 0, total: 0, pnl: 0 },
    };

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
    const dailyMap = new Map<number, { pnl: number; count: number }>();

    let highLevLosses = 0;
    let noSlLosses = 0;
    let revengeTrades = 0;

    closed.forEach((t, idx) => {
      const pnl = t.pnlUsdt ?? 0;
      const isWin = pnl > 0;

      const pairCur = byPairMap.get(t.symbol) ?? { wins: 0, total: 0, pnl: 0 };
      pairCur.total += 1;
      pairCur.pnl += pnl;
      if (isWin) pairCur.wins += 1;
      byPairMap.set(t.symbol, pairCur);

      const dt = new Date(t.closedAt || t.openedAt);
      const hr = Number.isFinite(dt.getTime()) ? dt.getUTCHours() : 12;
      const sessKey: 'Азия' | 'Лондон' | 'Нью-Йорк' =
        hr < 8 ? 'Азия' : hr < 14 ? 'Лондон' : 'Нью-Йорк';
      sessionBuckets[sessKey].total += 1;
      sessionBuckets[sessKey].pnl += pnl;
      if (isWin) sessionBuckets[sessKey].wins += 1;

      if (dt.getFullYear() === curYear && dt.getMonth() === curMonth) {
        const day = dt.getDate();
        const curDay = dailyMap.get(day) ?? { pnl: 0, count: 0 };
        curDay.pnl += pnl;
        curDay.count += 1;
        dailyMap.set(day, curDay);
      }

      if (pnl < 0 && (t.leverage ?? 1) >= 10) highLevLosses += 1;
      if (pnl < 0 && !t.stopLoss) noSlLosses += 1;
      if (idx > 0 && (closed[idx - 1].pnlUsdt ?? 0) < 0 && t.positionSizeUsdt > closed[idx - 1].positionSizeUsdt * 1.25) {
        revengeTrades += 1;
      }
    });

    const pairStats = Array.from(byPairMap.entries())
      .map(([sym, d]) => ({
        symbol: sym,
        total: d.total,
        winRate: d.total > 0 ? Math.round((d.wins / d.total) * 100) : 0,
        pnl: Number(d.pnl.toFixed(2)),
      }))
      .sort((a, b) => b.pnl - a.pnl);

    const sessionStats = (['Азия', 'Лондон', 'Нью-Йорк'] as const).map((name) => {
      const b = sessionBuckets[name];
      return {
        name,
        total: b.total,
        winRate: b.total > 0 ? Math.round((b.wins / b.total) * 100) : 0,
        pnl: Number(b.pnl.toFixed(2)),
      };
    });

    const calendarDays = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const entry = dailyMap.get(day);
      return {
        day,
        pnl: entry ? Number(entry.pnl.toFixed(1)) : null,
        count: entry?.count ?? 0,
      };
    });

    const worstPair = [...pairStats].sort((a, b) => a.pnl - b.pnl)[0] ?? null;
    const activeSessions = [...sessionStats].filter((s) => s.total > 0);
    const bestSession = [...activeSessions].sort((a, b) => b.pnl - a.pnl)[0] ?? null;
    const losingSession =
      [...activeSessions]
        .filter((s) => s.pnl < 0 || s.winRate < 50)
        .sort((a, b) => a.pnl - b.pnl)[0] ?? null;

    return {
      totalCount: trades.length,
      closedCount: closed.length,
      openCount: trades.filter((t) => t.status === 'OPEN').length,
      totalPnl,
      winRatePct,
      profitFactor,
      avgRr,
      equityCurve,
      pairStats,
      sessionStats,
      calendarDays,
      monthLabel: now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
      highLevLosses,
      noSlLosses,
      revengeTrades,
      worstPair,
      worstSession: losingSession,
      bestSession,
    };
  }, [trades]);

  const disciplineIndex = useMemo(
    () => computeDisciplineIndex(tiltCfg, stats.closedCount, antiFomoActive ? 1 : 0),
    [tiltCfg, stats.closedCount, antiFomoActive]
  );

  const handleNoteChange = (val: string) => {
    const dlp = detectSensitiveWalletInput(val);
    if (dlp.blocked) {
      setNote('');
      setDlpWarning(dlp.warning);
      triggerHaptic(30);
      return;
    }
    setDlpWarning(null);
    setNote(val);
  };

  const handleCreateTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    const entryPrice = parseLocalePositiveNumber(entryStr, 0);
    const stopLoss = parseLocalePositiveNumber(stopStr, 0);
    const takeProfit = parseLocalePositiveNumber(tpStr, 0);
    const positionSizeUsdt = parseLocalePositiveNumber(sizeStr, 0);
    if (entryPrice <= 0 || positionSizeUsdt <= 0) return;

    const cleanNote = sanitizePlainText(note, 260);
    const payload: Omit<TradeJournalEntry, 'id'> = {
      uid: uid ?? 'local-demo',
      symbol,
      marketType,
      direction,
      status: 'OPEN',
      entryPrice,
      stopLoss: stopLoss > 0 ? stopLoss : undefined,
      takeProfit: takeProfit > 0 ? takeProfit : undefined,
      positionSizeUsdt,
      leverage: marketType === 'spot' ? 1 : leverage,
      strategyName: sanitizePlainText(strategyName, 80) || 'Ручная сделка',
      note: cleanNote || `Чек-лист: ${checkedChecklist.length}/4`,
      openedAt: new Date().toISOString(),
    };

    triggerHaptic(12);
    if (uid) {
      try {
        await addDoc(collection(db, 'users', uid, 'trades'), payload);
      } catch {
        addLocalTrade(payload);
      }
    } else {
      addLocalTrade(payload);
    }
    setShowForm(false);
    setNote('');
    setCheckedChecklist([]);
  };

  const handleCloseTrade = async (trade: TradeJournalEntry) => {
    const exitPrice = parseLocalePositiveNumber(closePriceStr, 0);
    if (exitPrice <= 0) return;

    const priceDeltaPct =
      trade.direction === 'LONG'
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
    const pnlPct = Number((priceDeltaPct * (trade.leverage || 1)).toFixed(2));
    const pnlUsdt = Number(((trade.positionSizeUsdt * priceDeltaPct) / 100).toFixed(2));
    const patch: Partial<TradeJournalEntry> = {
      status: 'CLOSED',
      exitPrice,
      pnlPct,
      pnlUsdt,
      closedAt: new Date().toISOString(),
    };

    triggerHaptic(12);
    if (uid && !trade.id.startsWith('loc-') && !trade.id.startsWith('demo-')) {
      await updateDoc(doc(db, 'users', uid, 'trades', trade.id), patch);
    } else {
      updateLocalTrade(trade.id, patch);
    }
    setClosingId(null);
    setClosePriceStr('');
  };

  const handleDeleteTrade = async (trade: TradeJournalEntry) => {
    triggerHaptic(10);
    if (uid && !trade.id.startsWith('loc-') && !trade.id.startsWith('demo-')) {
      await deleteDoc(doc(db, 'users', uid, 'trades', trade.id));
    } else {
      deleteLocalTrade(trade.id);
    }
  };

  const handleExportCsv = () => {
    if (!effIsPro) {
      onUpgradePro?.();
      return;
    }
    const headers = [
      'Дата',
      'Пара',
      'Рынок',
      'Направление',
      'Статус',
      'Вход $',
      'Выход $',
      'Объём USDT',
      'Плечо',
      'PnL USDT',
      'PnL %',
      'Стратегия',
      'Заметка',
    ];
    const rows = trades.map((t) => [
      t.openedAt,
      t.symbol,
      t.marketType,
      t.direction,
      t.status,
      t.entryPrice,
      t.exitPrice ?? '',
      t.positionSizeUsdt,
      t.leverage,
      t.pnlUsdt ?? '',
      t.pnlPct ?? '',
      t.strategyName ?? '',
      t.note ?? '',
    ]);
    downloadCsvWithBom(`vernier-journal-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const mask = (v: string) => (effPrivacy ? '•••••' : v);

  return (
    <section className="rounded-2xl border border-white/8 bg-[var(--surface-1)] card-surface-glow p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white flex flex-wrap items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Дневник сделок и аналитика</span>
            {/* MAX #6: Индикатор Индекса дисциплины в шапке дневника */}
            <span
              title="Индекс дисциплины Tilt-Guard (0–100%)"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold ${
                disciplineIndex >= 80
                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                  : disciplineIndex >= 55
                    ? 'border-amber-500/35 bg-amber-500/12 text-amber-200'
                    : 'border-rose-500/35 bg-rose-500/12 text-rose-300'
              }`}
            >
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span>Дисциплина {disciplineIndex}%</span>
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Авторасчёт Winrate, PnL-календарь, разбивка по сессиям, защита Tilt-Guard и персональный AI-коуч.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className={`min-h-[36px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
              effIsPro
                ? 'border-cyan-500/35 bg-cyan-500/12 text-cyan-200 hover:bg-cyan-500/20'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
            }`}
          >
            {effIsPro ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{effIsPro ? 'Экспорт CSV' : 'CSV (PRO)'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="min-h-[36px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showForm ? 'Скрыть форму' : 'Новая сделка'}</span>
          </button>
        </div>
      </div>

      {/* Подвкладки: Сделки и аналитика | Персональный AI-коуч (MAX #11) */}
      <div className="inline-flex items-center p-1 rounded-xl bg-[var(--surface-0)] border border-white/8">
        <button
          type="button"
          onClick={() => {
            triggerHaptic(8);
            setJournalTab('analytics');
          }}
          className={`min-h-[32px] px-3 rounded-lg text-xs font-semibold transition-colors ${
            journalTab === 'analytics' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Сделки и аналитика
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic(8);
            setJournalTab('coach');
          }}
          className={`min-h-[32px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
            journalTab === 'coach' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span>AI-коуч</span>
          <span className="text-[9px] font-mono px-1 rounded bg-black/20">MAX</span>
        </button>
      </div>

      <FeatureGuide
        title="Дневник сделок и AI-коуч"
        summary="Фиксируйте реальные и демо-сделки, отслеживайте кривую капитала (Equity Curve), месячный PnL-календарь и выявляйте ошибки дисциплины через AI-коуча."
        steps={[
          'Нажмите «+ Сделка» сверху, чтобы записать вход, Stop-Loss и Take-Profit, или закрывайте позиции прямо из Paper Trading.',
          'Когда сделка завершена, нажмите «Закрыть» и укажите цену выхода — PnL, Win Rate и Profit Factor обновятся автоматически.',
          'Во вкладке «AI-коуч» проверяйте лучшие торговые сессии и получайте 3-шаговый план улучшения дисциплины.',
        ]}
      />

      {/* Статус локального демо-режима */}
      {isLocalMode && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-emerald-200">
            Локальное хранение (демо-режим без регистрации) · Войдите для облачной синхронизации
          </span>
          <button
            type="button"
            onClick={onRequireLogin}
            className="text-emerald-300 hover:text-emerald-200 font-semibold whitespace-nowrap"
          >
            Войти через Google →
          </button>
        </div>
      )}

      {/* Анти-FOMO предупреждение при 3 убытках подряд за 24ч */}
      {antiFomoActive && (
        <div className="rounded-xl border border-amber-500/45 bg-amber-500/12 px-3.5 py-3 text-xs text-amber-100 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong className="text-amber-200">
              Анти-FOMO защита{effIsMax ? ' MAX' : ''} активирована:
            </strong>{' '}
            Зафиксировано 3 убыточные сделки подряд за последние 24 часа. Режим защиты: сделайте паузу 30 мин или снизьте риск вдвое.
          </div>
        </div>
      )}

      {/* Метрики эффективности */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
          <div className="font-sans text-[11px] text-slate-400">Чистый PnL</div>
          <div className={`mt-1 text-base font-bold ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {mask(`${stats.totalPnl >= 0 ? '+' : '-'}$${Math.abs(stats.totalPnl).toFixed(2)}`)}
          </div>
        </div>
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
          <div className="font-sans text-[11px] text-slate-400">Win Rate</div>
          <div className="mt-1 text-base font-bold text-white">{stats.winRatePct.toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
          <div className="font-sans text-[11px] text-slate-400">Profit Factor</div>
          <div className="mt-1 text-base font-bold text-cyan-300">{stats.profitFactor.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
          <div className="font-sans text-[11px] text-slate-400">Средний R:R</div>
          <div className="mt-1 text-base font-bold text-amber-300">1 : {stats.avgRr.toFixed(2)}</div>
        </div>
      </div>

      {/* MAX #11: Персональный AI-коуч по трейдингу */}
      {journalTab === 'coach' && (
        <PaywallGate
          requiredPlan="MAX"
          unlocked={effIsMax}
          title="Персональный AI-коуч по трейдингу"
          description="Глубокий аудит дневника сделок и срабатываний Tilt-Guard: выявление паттернов убытков (сессия, завышенное плечо, тильт после лосса) и пошаговый план коррекции."
        >
          <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-cyan-500/[0.08] to-[var(--surface-0)] p-4 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-white text-sm">
                <Bot className="w-4 h-4 text-cyan-300 shrink-0" />
                <span>Аудит торговой дисциплины · AI-коуч</span>
              </div>
              <span className="px-2 py-0.5 rounded-md border border-cyan-400/35 bg-cyan-500/15 font-mono text-[10px] font-bold text-cyan-200">
                Сделок проанализировано: {stats.closedCount} · Tilt-срабатываний: {tiltCfg.totalTriggers}
              </span>
            </div>

            {/* Выявленные паттерны и сильные/слабые сессии */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {stats.worstSession ? (
                <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 space-y-1">
                  <div className="text-[11px] text-rose-300/90">Слабая торговая сессия</div>
                  <div className="text-sm font-bold text-white">{stats.worstSession.name}</div>
                  <div className="text-[11px] font-mono text-rose-300">
                    WR {stats.worstSession.winRate}% ·{' '}
                    {mask(`${stats.worstSession.pnl >= 0 ? '+' : '-'}$${Math.abs(stats.worstSession.pnl).toFixed(1)}`)}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] p-3 space-y-1">
                  <div className="text-[11px] text-emerald-300 font-medium">Сильная торговая сессия</div>
                  <div className="text-sm font-bold text-white">
                    {stats.bestSession ? stats.bestSession.name : 'Статистика собирается'}
                  </div>
                  {stats.bestSession && (
                    <div className="text-[11px] font-mono text-emerald-300">
                      WR {stats.bestSession.winRate}% ·{' '}
                      {mask(`${stats.bestSession.pnl >= 0 ? '+' : '-'}$${Math.abs(stats.bestSession.pnl).toFixed(1)}`)}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-300 leading-snug">
                    Убыточных сессий пока не выявлено — продолжайте собирать статистику.
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-white/8 bg-[var(--surface-1)] p-3 space-y-1">
                <div className="text-[11px] text-slate-400">Риск плеча и реванш-входов</div>
                <div className="text-sm font-bold text-amber-300 font-mono">
                  {stats.highLevLosses} уб. ≥10x · {stats.revengeTrades} реванш
                </div>
                <div className="text-[11px] text-slate-400">
                  {stats.revengeTrades > 0
                    ? 'Замечено увеличение объёма сразу после убытка.'
                    : 'Увеличения лота после убытка не зафиксировано.'}
                </div>
              </div>

              <div className="rounded-xl border border-white/8 bg-[var(--surface-1)] p-3 space-y-1">
                <div className="text-[11px] text-slate-400">Индекс дисциплины</div>
                <div className="text-sm font-bold text-emerald-300 font-mono">{disciplineIndex} / 100%</div>
                <div className="text-[11px] text-slate-400">
                  {stats.noSlLosses > 0
                    ? `${stats.noSlLosses} убыточных сделок без Stop-Loss.`
                    : 'Все закрытые сделки контролировались стопом.'}
                </div>
              </div>
            </div>

            {/* 3-шаговый план коррекции */}
            <div className="rounded-xl border border-white/10 bg-[var(--surface-1)] p-3.5 space-y-2">
              <div className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>Персональный план коррекции на 7 дней (3 шага)</span>
              </div>
              <ol className="space-y-2 text-slate-200 leading-relaxed list-decimal list-inside">
                <li>
                  <strong className="text-white">Фокус на сильном окне:</strong>{' '}
                  {stats.bestSession && stats.worstSession && stats.worstSession.name !== stats.bestSession.name
                    ? `Сместите 70% объёма в сессию «${stats.bestSession.name}» (WR ${stats.bestSession.winRate}%), ограничьте входы в «${stats.worstSession.name}» (WR ${stats.worstSession.winRate}%).`
                    : stats.bestSession
                      ? `Сессия «${stats.bestSession.name}» показывает лучший результат (WR ${stats.bestSession.winRate}%). Убыточных сессий пока нет — сохраняйте текущий отбор сетапов и накопите минимум 10–15 закрытых сделок для полного сравнения.`
                      : 'Торгуйте преимущественно перекрытие Лондон/Нью-Йорк (13:30–17:00 UTC) для лучшей ликвидности.'}
                </li>
                <li>
                  <strong className="text-white">Потолок плеча и стоп-дисциплина:</strong>{' '}
                  {stats.highLevLosses > 0
                    ? 'Ограничьте плечо до 5x до выхода Win Rate выше 55% и фиксируйте Stop-Loss до нажатия «Открыть».'
                    : 'Сохраняйте фиксированный риск 1–1.5% на сделку и переводите стоп в безубыток после TP1.'}
                </li>
                <li>
                  <strong className="text-white">Анти-тильт правило:</strong>{' '}
                  {tiltCfg.totalTriggers > 0 || stats.revengeTrades > 0
                    ? 'Активируйте авто-паузу Tilt-Guard на 30 мин после 2 убытков подряд — запрет на удвоение позиции.'
                    : 'При серии из 2 убытков снижайте рабочий объём следующей сделки вдвое (0.5R).'}
                </li>
              </ol>
            </div>

            <AiComplianceFooter
              sourceLabel="Дневник сделок · Персональный AI-коуч MAX"
              snippet={`Дисциплина ${disciplineIndex}%, WR ${stats.winRatePct.toFixed(1)}%, PF ${stats.profitFactor.toFixed(2)}`}
            />
          </div>
        </PaywallGate>
      )}

      {/* PRO #6: Продвинутая аналитика (Equity Curve, PnL-календарь, Win Rate по парам/сессиям, AI-разбор ошибок) */}
      {journalTab === 'analytics' && (
        <PaywallGate
          requiredPlan="PRO"
          unlocked={effIsPro}
          title="Продвинутый дневник PRO: Equity Curve, PnL-календарь и AI-разбор"
          description="График кривой капитала, тепловой PnL-календарь месяца, статистика Win Rate по монетам и торговым сессиям (Азия / Лондон / NY) + AI-разбор ошибок."
        >
          <div className="space-y-3.5">
            {/* Кривая капитала (Equity Curve) */}
            {stats.equityCurve.length > 1 && (
              <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3.5 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                  <span className="font-medium text-slate-200 leading-snug">Кривая капитала (Equity Curve, USDT)</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                    Закрыто: {stats.closedCount} · Открыто: {stats.openCount}
                  </span>
                </div>
                <div className="h-[165px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.equityCurve} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fill: '#64748B', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (effPrivacy ? '••' : `$${v}`)}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0E1C1C',
                          borderColor: 'rgba(16,185,129,0.25)',
                          borderRadius: '10px',
                          fontSize: '12px',
                          color: '#F1F5F9',
                        }}
                        formatter={(v) => [effPrivacy ? '•••••' : `$${Number(v ?? 0).toFixed(2)}`, 'Накопл. PnL']}
                      />
                      <Area
                        type="monotone"
                        dataKey="equity"
                        stroke={stats.totalPnl >= 0 ? '#10B981' : '#F43F5E'}
                        fill={stats.totalPnl >= 0 ? '#10B981' : '#F43F5E'}
                        fillOpacity={0.18}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Месячный PnL-календарь (Heatmap) */}
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-200 inline-flex items-center gap-1.5 capitalize">
                  <CalendarDays className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>PnL-календарь · {stats.monthLabel}</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">Зелёный = +PnL · Красный = -PnL</span>
              </div>
              <div className="grid grid-cols-7 gap-1 font-mono tabular-nums">
                {stats.calendarDays.map((cell) => {
                  const hasTrades = cell.pnl !== null;
                  const isPos = (cell.pnl ?? 0) >= 0;
                  return (
                    <div
                      key={cell.day}
                      title={
                        hasTrades
                          ? `${cell.day} число: ${mask(`${isPos ? '+' : '-'}$${Math.abs(cell.pnl ?? 0).toFixed(1)}`)} (${cell.count} сд.)`
                          : `${cell.day} число: нет сделок`
                      }
                      className={`rounded-lg border p-1 text-center min-h-[38px] flex flex-col items-center justify-center transition-colors ${
                        !hasTrades
                          ? 'border-white/6 bg-[var(--surface-1)]/60 text-slate-500'
                          : isPos
                            ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
                            : 'border-rose-500/40 bg-rose-500/20 text-rose-200'
                      }`}
                    >
                      <span className="text-[10px] leading-none">{cell.day}</span>
                      {hasTrades && (
                        <span className="mt-0.5 text-[9px] font-bold leading-none truncate max-w-full">
                          {effPrivacy ? '••' : `${isPos ? '+' : ''}${Math.round(cell.pnl ?? 0)}`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Win Rate по парам и торговым сессиям */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
                <div className="font-medium text-slate-200">Win Rate по торговым сессиям</div>
                <div className="space-y-1.5">
                  {stats.sessionStats.map((s) => (
                    <div key={s.name} className="space-y-1 font-mono tabular-nums">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-sans text-slate-300">
                          {s.name} <span className="text-slate-500">({s.total})</span>
                        </span>
                        <span>
                          <strong className="text-white">{s.winRate}%</strong>{' '}
                          <span className={s.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            ({mask(`${s.pnl >= 0 ? '+' : '-'}$${Math.abs(s.pnl).toFixed(0)}`)})
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                        <div
                          style={{ width: `${Math.max(4, s.winRate)}%` }}
                          className={s.pnl >= 0 ? 'h-full bg-emerald-400' : 'h-full bg-rose-400'}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
                <div className="font-medium text-slate-200">Топ пары по результату</div>
                {stats.pairStats.length === 0 ? (
                  <div className="text-[11px] text-slate-500 py-3">Закройте сделки для расчёта статистики по парам.</div>
                ) : (
                  <div className="space-y-1.5 font-mono tabular-nums">
                    {stats.pairStats.slice(0, 4).map((p) => (
                      <div
                        key={p.symbol}
                        className="flex items-center justify-between rounded-lg border border-white/6 bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px]"
                      >
                        <span className="font-semibold text-white">
                          {p.symbol.replace('USDT', '')}{' '}
                          <span className="text-slate-500 font-normal">({p.total})</span>
                        </span>
                        <span className="text-slate-300">WR {p.winRate}%</span>
                        <span className={p.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {mask(`${p.pnl >= 0 ? '+' : '-'}$${Math.abs(p.pnl).toFixed(1)}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Кнопка «AI-разбор ошибок» */}
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-amber-200 inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>AI-разбор ошибок по журналу</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setShowErrorAudit((v) => !v);
                  }}
                  className="min-h-[30px] px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/35 text-amber-200 font-semibold transition-colors"
                >
                  {showErrorAudit ? 'Скрыть разбор' : 'Запустить AI-разбор'}
                </button>
              </div>
              {showErrorAudit && (
                <ul className="space-y-1 text-[11px] text-slate-200 pt-1 border-t border-white/10">
                  <li>
                    • <strong className="text-white">Проблемная пара:</strong>{' '}
                    {stats.worstPair && stats.worstPair.pnl < 0
                      ? `${stats.worstPair.symbol} (${mask(`-$${Math.abs(stats.worstPair.pnl).toFixed(1)}`)}, WR ${stats.worstPair.winRate}%) — проверьте входы против старшего тренда.`
                      : 'Убыточных пар-аутсайдеров пока не выявлено.'}
                  </li>
                  <li>
                    • <strong className="text-white">Контроль стопов и плеча:</strong>{' '}
                    {stats.noSlLosses > 0
                      ? `Обнаружено ${stats.noSlLosses} убытков без Stop-Loss — задавайте стоп до открытия ордера.`
                      : stats.highLevLosses > 0
                        ? `Повышенное плечо (≥10x) дало ${stats.highLevLosses} стопов — оптимально 3x–5x.`
                        : 'Риск-менеджмент стабилен, критических нарушений не найдено.'}
                  </li>
                </ul>
              )}
            </div>
          </div>
        </PaywallGate>
      )}

      {/* Форма создания сделки */}
      {showForm && (
        <form
          onSubmit={(e) => void handleCreateTrade(e)}
          className="rounded-xl border border-emerald-500/25 bg-[var(--surface-0)] p-4 space-y-3 text-xs"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-slate-400 mb-1">Пара</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
              >
                {TRADING_PAIRS.map((p) => (
                  <option key={p.symbol} value={p.symbol}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Рынок</label>
              <select
                value={marketType}
                onChange={(e) => setMarketType(e.target.value as MarketType)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 text-white"
              >
                <option value="spot">Спот</option>
                <option value="futures">Фьючерсы</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Направление</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'LONG' | 'SHORT')}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
              >
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Объём (USDT)</label>
              <input
                type="text"
                inputMode="decimal"
                value={sizeStr}
                onChange={(e) => setSizeStr(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-slate-400 mb-1">Цена входа ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={entryStr}
                onChange={(e) => setEntryStr(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Stop-Loss ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={stopStr}
                onChange={(e) => setStopStr(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Take-Profit ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={tpStr}
                onChange={(e) => setTpStr(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-slate-400 mb-1">Стратегия</label>
              <input
                type="text"
                value={strategyName}
                onChange={(e) => setStrategyName(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-3 text-white"
              />
            </div>
            {marketType === 'futures' && (
              <div>
                <label className="block text-slate-400 mb-1">Плечо (x)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={leverage}
                  onChange={(e) => setLeverage(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-3 font-mono text-white"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Заметка / сетап (DLP-защита активна)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Причина входа, уровень, эмоции..."
              className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-1)] px-3 text-white placeholder:text-slate-500"
            />
            {dlpWarning && (
              <div className="mt-1.5 rounded-lg border border-rose-500/40 bg-rose-500/12 px-2.5 py-1.5 text-[11px] text-rose-200">
                {dlpWarning}
              </div>
            )}
          </div>

          <PreTradeChecklist
            checkedIds={checkedChecklist}
            onToggle={(id) =>
              setCheckedChecklist((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
            antiFomoTriggered={antiFomoActive}
            isMax={isMax}
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-[38px] px-4 rounded-xl border border-white/10 bg-white/5 text-slate-300"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="min-h-[38px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              Сохранить сделку
            </button>
          </div>
        </form>
      )}

      {/* Список сделок */}
      {trades.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-6 text-center text-xs text-slate-400">
          Дневник пока пуст. Запишите первую сделку выше или отправьте расчёт из «Калькулятора риска».
        </div>
      ) : (
        <div className="divide-y divide-white/8 border-t border-white/8">
          {trades.map((t) => {
            const isClosed = t.status === 'CLOSED';
            const isWin = (t.pnlUsdt ?? 0) >= 0;
            return (
              <div key={t.id} className="cv-list-item py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-white">{t.symbol}</span>
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                        t.direction === 'LONG'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {t.direction === 'LONG' ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {t.direction}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {t.marketType === 'futures' ? `Futures ${t.leverage}x` : 'Spot'} · {mask(`$${t.positionSizeUsdt}`)}
                    </span>
                    <span className="text-[11px] text-slate-500">{t.strategyName}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                    <span>Вход: ${t.entryPrice}</span>
                    {t.stopLoss && <span className="text-rose-300/80">SL: ${t.stopLoss}</span>}
                    {t.takeProfit && <span className="text-emerald-300/80">TP: ${t.takeProfit}</span>}
                    {t.exitPrice && <span className="text-white">Выход: ${t.exitPrice}</span>}
                  </div>
                  {t.note && <div className="text-[11px] text-slate-400">{t.note}</div>}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isClosed ? (
                    <div className="text-right font-mono tabular-nums">
                      <div className={`font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {mask(`${isWin ? '+' : '-'}$${Math.abs(t.pnlUsdt ?? 0).toFixed(2)}`)}
                      </div>
                      <div className={`text-[11px] ${isWin ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {isWin ? '+' : ''}
                        {(t.pnlPct ?? 0).toFixed(2)}%
                      </div>
                    </div>
                  ) : closingId === t.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={closePriceStr}
                        onChange={(e) => setClosePriceStr(e.target.value)}
                        placeholder="Цена выхода"
                        className="w-24 min-h-[32px] rounded-lg border border-white/15 bg-[var(--surface-0)] px-2 font-mono text-white text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCloseTrade(t)}
                        className="min-h-[32px] px-2.5 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>OK</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setClosingId(t.id);
                        setClosePriceStr(String(t.takeProfit ?? t.entryPrice));
                      }}
                      className="min-h-[34px] px-2.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-semibold whitespace-nowrap"
                    >
                      Закрыть
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleDeleteTrade(t)}
                    aria-label={`Удалить сделку ${t.symbol}`}
                    className="min-h-[34px] min-w-[34px] rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

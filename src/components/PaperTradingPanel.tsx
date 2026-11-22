import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  RotateCcw,
  ShieldAlert,
  Square,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
} from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import {
  clearCooldownWithChecklist,
  closePaperPositionToJournal,
  readPaperAccount,
  readTiltGuardConfig,
  resetPaperAccount,
  VERNIER_PRO_MAX_EVENT,
  writePaperAccount,
  type PaperAccountState,
  type PaperPosition,
  type TiltGuardConfig,
} from '../lib/proMaxStore';
import { parseLocalePositiveNumber, triggerHaptic } from '../lib/securityDlp';
import { FeatureGuide } from './FeatureGuide';
import { PaywallGate } from './PaywallGate';
import {
  NonCustodialRiskNotice,
  PaperFundsConfirmModal,
  type PendingPaperFundsConfirm,
} from './TradeRiskConfirmModal';

interface PaperTradingPanelProps {
  symbol: string;
  currentPrice: number;
  allPrices?: Record<string, number>;
}

const DISCIPLINE_QUESTIONS = [
  'Я признаю прошлый убыток и не пытаюсь «отыграться» увеличенным плечом.',
  'У этой сделки есть чёткий Stop-Loss и подтверждение по тренду.',
  'Мой эмоциональный фон спокоен, я действую строго по торговой системе.',
];

function fmtUsd(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs >= 1) return `$${val.toFixed(2)}`;
  return `$${val.toFixed(4)}`;
}

export const PaperTradingPanel: React.FC<PaperTradingPanelProps> = ({
  symbol,
  currentPrice,
  allPrices = {},
}) => {
  const { isMax, maskValue } = usePlan();
  const [account, setAccount] = useState<PaperAccountState>(() => readPaperAccount());
  const [tilt, setTilt] = useState<TiltGuardConfig>(() => readTiltGuardConfig());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [limitPriceStr, setLimitPriceStr] = useState('');
  const [marginStr, setMarginStr] = useState('500');
  const [leverage, setLeverage] = useState(10);
  const [slStr, setSlStr] = useState('');
  const [tpStr, setTpStr] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedUnlock, setCheckedUnlock] = useState<number[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{
    meta: PendingPaperFundsConfirm;
    execute: () => void;
  } | null>(null);

  useEffect(() => {
    const sync = () => {
      setAccount(readPaperAccount());
      setTilt(readTiltGuardConfig());
    };
    window.addEventListener(VERNIER_PRO_MAX_EVENT, sync);
    return () => {
      window.removeEventListener(VERNIER_PRO_MAX_EVENT, sync);
    };
  }, []);

  const hasActiveCooldown = Boolean(tilt.cooldownUntilMs && tilt.cooldownUntilMs > nowMs);
  useEffect(() => {
    if (!tilt.cooldownUntilMs || tilt.cooldownUntilMs <= Date.now()) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (tilt.cooldownUntilMs && now >= tilt.cooldownUntilMs) {
        window.clearInterval(timer);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tilt.cooldownUntilMs, hasActiveCooldown]);

  const markPriceFor = (sym: string, fallback: number) => {
    if (sym === symbol && currentPrice > 0) return currentPrice;
    return allPrices[sym] ?? fallback;
  };

  const unrealizedSummary = useMemo(() => {
    let totalUnrealized = 0;
    let totalMargin = 0;
    for (const pos of account.positions) {
      const mp = markPriceFor(pos.symbol, pos.entryPrice);
      const delta =
        pos.side === 'LONG'
          ? (mp - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - mp) / pos.entryPrice;
      totalUnrealized += pos.notionalUsdt * delta;
      totalMargin += pos.marginUsdt;
    }
    const equity = account.balanceUsdt + totalMargin + totalUnrealized;
    return {
      totalUnrealized: Number(totalUnrealized.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      totalRoePct:
        account.initialBalanceUsdt > 0
          ? Number((((equity - account.initialBalanceUsdt) / account.initialBalanceUsdt) * 100).toFixed(2))
          : 0,
    };
  }, [account, currentPrice, symbol, allPrices]);

  const cooldownRemainingSec =
    tilt.enabled && tilt.cooldownUntilMs && tilt.cooldownUntilMs > nowMs
      ? Math.ceil((tilt.cooldownUntilMs - nowMs) / 1000)
      : 0;
  const isCooldownActive = cooldownRemainingSec > 0;

  const formatTimer = (sec: number) => {
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const handleOpenPosition = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (isCooldownActive) {
      setError('Активен режим Tilt-Guard «Остыть». Пройдите чек-лист дисциплины или дождитесь окончания таймера.');
      return;
    }

    const margin = parseLocalePositiveNumber(marginStr, 0);
    const entry =
      orderType === 'LIMIT'
        ? parseLocalePositiveNumber(limitPriceStr, currentPrice)
        : currentPrice;

    if (entry <= 0) {
      setError('Дождитесь загрузки живой цены или введите цену Limit.');
      return;
    }
    if (margin < 10 || margin > account.balanceUsdt) {
      setError(`Укажите маржу от $10 до доступного баланса (${fmtUsd(account.balanceUsdt)}).`);
      return;
    }

    const sl = parseLocalePositiveNumber(slStr, 0);
    const tp = parseLocalePositiveNumber(tpStr, 0);
    const newPos: PaperPosition = {
      id: `paper-${Date.now()}`,
      symbol,
      side,
      orderType,
      entryPrice: entry,
      marginUsdt: margin,
      notionalUsdt: Number((margin * leverage).toFixed(2)),
      leverage,
      stopLoss: sl > 0 ? sl : undefined,
      takeProfit: tp > 0 ? tp : undefined,
      openedAt: new Date().toISOString(),
    };

    setPendingConfirm({
      meta: {
        title: `Открыть Paper ${side} · ${symbol} (${leverage}x)`,
        actionLabel: `Подтвердить и открыть ${side}`,
        summary: `Маржа: ${fmtUsd(margin)} · Объём: ${fmtUsd(newPos.notionalUsdt)} · Цена входа: ${fmtUsd(entry)} (${orderType}). Операция выполняется на виртуальном счёте Paper Trading.`,
        tone: side === 'LONG' ? 'emerald' : 'rose',
      },
      execute: () => {
        const next: PaperAccountState = {
          ...account,
          balanceUsdt: Number((account.balanceUsdt - margin).toFixed(2)),
          positions: [newPos, ...account.positions],
        };
        triggerHaptic(12);
        writePaperAccount(next);
        setAccount(next);
        setNotice(`Открыта Paper-позиция ${side} ${symbol} (${leverage}x) по ${fmtUsd(entry)}.`);
        setSlStr('');
        setTpStr('');
      },
    });
  };

  const handleClosePosition = (pos: PaperPosition) => {
    const mp = markPriceFor(pos.symbol, pos.entryPrice);
    setPendingConfirm({
      meta: {
        title: `Закрыть Paper-позицию ${pos.symbol}`,
        actionLabel: 'Подтвердить и закрыть',
        summary: `Позиция ${pos.side} ${pos.symbol} (${pos.leverage}x) будет закрыта по цене ${fmtUsd(mp)} и автоматически записана в Дневник сделок.`,
        tone: 'rose',
      },
      execute: () => {
        triggerHaptic(12);
        const { nextState, pnlUsdt, roePct } = closePaperPositionToJournal(pos, mp);
        setAccount(nextState);
        setTilt(readTiltGuardConfig());
        setNotice(
          `Позиция ${pos.symbol} закрыта (${pnlUsdt >= 0 ? '+' : ''}${fmtUsd(pnlUsdt)} · ${roePct >= 0 ? '+' : ''}${roePct}%) и записана в Дневник сделок.`
        );
      },
    });
  };

  const handleReset = () => {
    setPendingConfirm({
      meta: {
        title: 'Сбросить Paper-счёт до $10,000',
        actionLabel: 'Подтвердить сброс $10k',
        summary: 'Текущий виртуальный баланс и открытые Paper-позиции будут сброшены до стартовых $10,000.00.',
        tone: 'amber',
      },
      execute: () => {
        triggerHaptic(10);
        const fresh = resetPaperAccount();
        setAccount(fresh);
        setNotice('Демо-счёт сброшен до $10,000.00.');
      },
    });
  };

  const handleCompleteDisciplineChecklist = () => {
    if (checkedUnlock.length < DISCIPLINE_QUESTIONS.length) return;
    triggerHaptic(12);
    const updated = clearCooldownWithChecklist();
    setTilt(updated);
    setCheckedUnlock([]);
    setNotice('Чек-лист дисциплины пройден. Торговля в Paper-терминале разблокирована.');
  };

  return (
    <PaywallGate
      requiredPlan="MAX"
      unlocked={isMax}
      title="Paper Trading — встроенный демо-терминал"
      description="Виртуальный баланс $10,000, ордера Long/Short до 50x, живой PnL и ROE %, а также автоматическое сохранение закрытых сделок в Дневник."
    >
      <div className="space-y-3.5">
        {/* Баланс и KPI */}
        <div className="rounded-xl border border-cyan-500/25 bg-[var(--surface-0)] p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Wallet className="w-3.5 h-3.5 text-cyan-400" />
              <span>Paper-счёт VERNIER</span>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[30px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-slate-300 inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Сброс $10k</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-xs">
            <div className="rounded-lg bg-[var(--surface-1)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">Эквити</div>
              <div className="text-white font-bold mt-0.5 truncate">
                {maskValue(fmtUsd(unrealizedSummary.equity))}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--surface-1)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">Свободно</div>
              <div className="text-cyan-300 font-bold mt-0.5 truncate">
                {maskValue(fmtUsd(account.balanceUsdt))}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--surface-1)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">Общий ROE</div>
              <div
                className={`font-bold mt-0.5 truncate ${
                  unrealizedSummary.totalRoePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {unrealizedSummary.totalRoePct >= 0 ? '+' : ''}
                {unrealizedSummary.totalRoePct}%
              </div>
            </div>
          </div>
        </div>

        {/* Блокировка Tilt-Guard «Остыть» */}
        {isCooldownActive && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/12 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Tilt-Guard: режим «Остыть»</span>
              </div>
              <span className="font-mono tabular-nums text-xs font-bold text-amber-300">
                {formatTimer(cooldownRemainingSec)}
              </span>
            </div>
            <p className="text-[11px] text-amber-100/90 leading-relaxed">
              Сработал дневной лимит убытка или серия стопов. Новые Paper-сделки заблокированы до окончания таймера или прохождения чек-листа дисциплины:
            </p>
            <div className="space-y-1.5">
              {DISCIPLINE_QUESTIONS.map((q, idx) => {
                const isChecked = checkedUnlock.includes(idx);
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() =>
                      setCheckedUnlock((prev) =>
                        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                      )
                    }
                    className="w-full text-left rounded-lg border border-amber-400/25 bg-[var(--surface-0)]/80 px-2.5 py-2 text-[11px] text-slate-200 flex items-start gap-2"
                  >
                    {isChecked ? (
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                    )}
                    <span>{q}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={checkedUnlock.length < DISCIPLINE_QUESTIONS.length}
              onClick={handleCompleteDisciplineChecklist}
              className="w-full min-h-[38px] rounded-xl bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold"
            >
              Подтвердить дисциплину и снять паузу ({checkedUnlock.length}/3)
            </button>
          </div>
        )}

        {/* Форма ордера */}
        <form onSubmit={handleOpenPosition} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setSide('LONG')}
              className={`min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                side === 'LONG'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'border border-white/10 bg-[var(--surface-0)] text-slate-300'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>LONG</span>
            </button>
            <button
              type="button"
              onClick={() => setSide('SHORT')}
              className={`min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                side === 'SHORT'
                  ? 'bg-rose-500 text-white'
                  : 'border border-white/10 bg-[var(--surface-0)] text-slate-300'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              <span>SHORT</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="inline-flex p-0.5 rounded-xl bg-[var(--surface-0)] border border-white/10">
              {(['MARKET', 'LIMIT'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setOrderType(t);
                    if (t === 'LIMIT' && !limitPriceStr && currentPrice > 0) {
                      setLimitPriceStr(String(currentPrice));
                    }
                  }}
                  className={`flex-1 min-h-[34px] rounded-lg text-[11px] font-semibold ${
                    orderType === t ? 'bg-white/12 text-white' : 'text-slate-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Плечо</span>
              <span className="font-mono font-bold text-cyan-300">{leverage}x</span>
            </div>
          </div>

          <input
            type="range"
            min={1}
            max={50}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            aria-label="Плечо Paper-сделки"
            className="w-full accent-cyan-400"
          />

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">Маржа (USDT)</span>
              <input
                type="text"
                inputMode="decimal"
                value={marginStr}
                onChange={(e) => setMarginStr(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 font-mono text-white"
              />
            </label>
            {orderType === 'LIMIT' ? (
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Цена Limit ($)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={limitPriceStr}
                  onChange={(e) => setLimitPriceStr(e.target.value)}
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 font-mono text-white"
                />
              </label>
            ) : (
              <div className="space-y-1">
                <span className="text-[11px] text-slate-400">Объём позиции</span>
                <div className="min-h-[38px] rounded-xl border border-white/8 bg-[var(--surface-0)] px-2.5 flex items-center font-mono text-cyan-200">
                  {maskValue(fmtUsd(parseLocalePositiveNumber(marginStr, 0) * leverage))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-rose-300">Stop-Loss ($)</span>
              <input
                type="text"
                inputMode="decimal"
                value={slStr}
                onChange={(e) => setSlStr(e.target.value)}
                placeholder="Необязательно"
                className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 font-mono text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-emerald-300">Take-Profit ($)</span>
              <input
                type="text"
                inputMode="decimal"
                value={tpStr}
                onChange={(e) => setTpStr(e.target.value)}
                placeholder="Необязательно"
                className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 font-mono text-white"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/12 px-3 py-2 text-xs text-rose-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={isCooldownActive}
            className={`w-full min-h-[42px] rounded-xl text-xs font-bold disabled:opacity-45 transition-all ${
              side === 'LONG'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950'
                : 'bg-gradient-to-r from-rose-500 to-amber-500 text-white'
            }`}
          >
            Открыть Paper {side} · {symbol} ({leverage}x)
          </button>
        </form>

        {/* Открытые Paper-позиции */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Открытые позиции ({account.positions.length})</span>
            <span className="font-mono tabular-nums">
              Нереал. PnL:{' '}
              <strong className={unrealizedSummary.totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {maskValue(
                  `${unrealizedSummary.totalUnrealized >= 0 ? '+' : ''}${fmtUsd(unrealizedSummary.totalUnrealized)}`
                )}
              </strong>
            </span>
          </div>

          {account.positions.length === 0 ? (
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 text-center text-xs text-slate-500">
              Нет открытых позиций. Закрытые сделки автоматически попадают в Дневник.
            </div>
          ) : (
            <div className="space-y-2">
              {account.positions.map((pos) => {
                const mp = markPriceFor(pos.symbol, pos.entryPrice);
                const movePct =
                  pos.side === 'LONG'
                    ? (mp - pos.entryPrice) / pos.entryPrice
                    : (pos.entryPrice - mp) / pos.entryPrice;
                const pnlUsd = pos.notionalUsdt * movePct;
                const roePct = movePct * pos.leverage * 100;
                return (
                  <div
                    key={pos.id}
                    className="rounded-xl border border-white/10 bg-[var(--surface-0)] p-3 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-mono font-bold text-white">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {pos.side} {pos.leverage}x
                        </span>
                        <span>{pos.symbol}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleClosePosition(pos)}
                        className="min-h-[30px] px-2.5 rounded-lg border border-rose-500/35 bg-rose-500/12 hover:bg-rose-500/22 text-[11px] font-semibold text-rose-200 inline-flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Закрыть в дневник</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
                      <div>
                        <span className="font-sans text-slate-500 block text-[10px]">Вход / Марк</span>
                        <span className="text-slate-200">
                          {fmtUsd(pos.entryPrice)} / {fmtUsd(mp)}
                        </span>
                      </div>
                      <div>
                        <span className="font-sans text-slate-500 block text-[10px]">Объём</span>
                        <span className="text-slate-200">{maskValue(fmtUsd(pos.notionalUsdt))}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-sans text-slate-500 block text-[10px]">PnL / ROE</span>
                        <span className={pnlUsd >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {maskValue(`${pnlUsd >= 0 ? '+' : ''}${fmtUsd(pnlUsd)}`)} ({roePct >= 0 ? '+' : ''}
                          {roePct.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <NonCustodialRiskNotice
          text="Paper Trading использует исключительно виртуальный баланс ($10,000). VERNIER не принимает и не хранит реальные деньги клиентов; результаты симуляции не гарантируют прибыль на реальной бирже."
        />

        <FeatureGuide
          title="Как работает Paper Trading"
          summary="Тренируйтесь на виртуальных $10,000 с живыми котировками без риска реальных средств. Закрытые сделки автоматически попадают в Дневник для разбора AI-коучем."
          steps={[
            'Выберите LONG или SHORT, тип ордера (MARKET/LIMIT), маржу и плечо.',
            'Каждое действие с виртуальными средствами требует подтверждения ответственности.',
            'При серии стопов сработает защита Tilt-Guard «Остыть» для профилактики эмоциональной торговли.',
          ]}
          compact
        />
      </div>

      <PaperFundsConfirmModal
        pending={pendingConfirm?.meta ?? null}
        onConfirm={() => {
          const action = pendingConfirm;
          setPendingConfirm(null);
          action?.execute();
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </PaywallGate>
  );
};

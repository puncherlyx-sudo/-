import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Flame,
  ShieldAlert,
  ShieldCheck,
  Square,
  Timer,
} from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { hasThreeConsecutiveLosses24h, readLocalTrades } from '../lib/localDemoStore';
import {
  clearCooldownWithChecklist,
  computeDisciplineIndex,
  readTiltGuardConfig,
  triggerManualCooldown,
  VERNIER_PRO_MAX_EVENT,
  writeTiltGuardConfig,
  type TiltGuardConfig,
} from '../lib/proMaxStore';
import { triggerHaptic } from '../lib/securityDlp';
import { PaywallGate } from './PaywallGate';

const CHECKLIST_ITEMS = [
  'Я закрыл график минимум на 5 минут и восстановил фокус.',
  'Следующая сделка будет открыта со стандартным риском (без удвоения лота).',
  'Я проверил старший таймфрейм и дневной лимит потерь.',
];

export const TiltGuardPanel: React.FC = () => {
  const { isMax, maskValue } = usePlan();
  const [cfg, setCfg] = useState<TiltGuardConfig>(() => readTiltGuardConfig());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [checked, setChecked] = useState<number[]>([]);

  useEffect(() => {
    const sync = () => setCfg(readTiltGuardConfig());
    window.addEventListener(VERNIER_PRO_MAX_EVENT, sync);
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.removeEventListener(VERNIER_PRO_MAX_EVENT, sync);
      window.clearInterval(id);
    };
  }, []);

  const trades = readLocalTrades();
  const closedCount = trades.filter((t) => t.status === 'CLOSED').length;
  const hasBadStreak = hasThreeConsecutiveLosses24h(trades);
  const disciplineIndex = computeDisciplineIndex(cfg, closedCount, hasBadStreak ? 1 : 0);

  const remainingSec =
    cfg.cooldownUntilMs && cfg.cooldownUntilMs > nowMs
      ? Math.ceil((cfg.cooldownUntilMs - nowMs) / 1000)
      : 0;

  const updateCfg = (patch: Partial<TiltGuardConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    writeTiltGuardConfig(next);
  };

  return (
    <PaywallGate
      requiredPlan="MAX"
      unlocked={isMax}
      title="Анти-FOMO / Tilt-Guard"
      description="Дневной лимит убытка, контроль серии стопов, режим «Остыть» с таймером блокировки и расчёт Индекса дисциплины (0–100%)."
    >
      <div className="rounded-2xl border border-cyan-500/25 bg-[var(--surface-1)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Анти-FOMO / Tilt-Guard</span>
              <span className="text-[10px] font-mono font-bold text-cyan-200 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35">
                MAX
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Защита от тильта и переторговки: автоблокировка Paper-сделок при превышении лимита.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-right font-mono tabular-nums">
            <div className="font-sans text-[10px] text-emerald-300">Индекс дисциплины</div>
            <div className="text-sm font-bold text-white">{disciplineIndex}%</div>
          </div>
        </div>

        {/* Статус и переключатель активности */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              updateCfg({ enabled: !cfg.enabled });
            }}
            className={`min-h-[42px] rounded-xl border px-3 flex items-center justify-between font-semibold transition-colors ${
              cfg.enabled
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'border-white/10 bg-[var(--surface-0)] text-slate-400'
            }`}
          >
            <span>Защита активна</span>
            <ShieldCheck className="w-4 h-4" />
          </button>

          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] px-3 py-2 flex items-center justify-between font-mono tabular-nums">
            <span className="font-sans text-slate-400">Убыток сегодня</span>
            <span className={cfg.todayLossUsdt > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
              {maskValue(`-$${cfg.todayLossUsdt.toFixed(0)}`)}
            </span>
          </div>

          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] px-3 py-2 flex items-center justify-between font-mono tabular-nums">
            <span className="font-sans text-slate-400">Серия стопов</span>
            <span className="text-amber-300 font-bold">
              {cfg.currentLossStreak} / {cfg.maxLossStreak}
            </span>
          </div>
        </div>

        {/* Настройки лимитов */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Daily Loss Limit</span>
              <div className="inline-flex rounded-md border border-white/10 overflow-hidden text-[10px]">
                <button
                  type="button"
                  onClick={() => updateCfg({ dailyLossMode: 'pct', dailyLossLimit: 3 })}
                  className={`px-2 py-0.5 ${cfg.dailyLossMode === 'pct' ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400'}`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => updateCfg({ dailyLossMode: 'usdt', dailyLossLimit: 300 })}
                  className={`px-2 py-0.5 ${cfg.dailyLossMode === 'usdt' ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400'}`}
                >
                  USDT
                </button>
              </div>
            </div>
            <input
              type="number"
              min={1}
              max={cfg.dailyLossMode === 'pct' ? 25 : 5000}
              value={cfg.dailyLossLimit}
              onChange={(e) => updateCfg({ dailyLossLimit: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full min-h-[36px] rounded-lg border border-white/10 bg-[var(--surface-1)] px-2.5 font-mono text-white"
            />
          </div>

          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
            <span className="text-slate-400 block">Лимит серии убытков</span>
            <div className="grid grid-cols-4 gap-1">
              {([2, 3, 4, 5] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => updateCfg({ maxLossStreak: n })}
                  className={`min-h-[36px] rounded-lg font-mono font-bold transition-colors ${
                    cfg.maxLossStreak === n
                      ? 'bg-cyan-400 text-slate-950'
                      : 'border border-white/10 bg-[var(--surface-1)] text-slate-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
            <span className="text-slate-400 block">Таймер «Остыть»</span>
            <div className="grid grid-cols-3 gap-1">
              {([15, 30, 60] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateCfg({ cooldownMinutes: m })}
                  className={`min-h-[36px] rounded-lg font-mono font-bold transition-colors ${
                    cfg.cooldownMinutes === m
                      ? 'bg-amber-400 text-slate-950'
                      : 'border border-white/10 bg-[var(--surface-1)] text-slate-300'
                  }`}
                >
                  {m}м
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Активный режим «Остыть» или кнопка ручного запуска */}
        {remainingSec > 0 ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/12 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold text-amber-200">
              <span className="inline-flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-amber-400" />
                Режим «Остыть» активен
              </span>
              <span className="font-mono tabular-nums text-amber-300">
                {String(Math.floor(remainingSec / 60)).padStart(2, '0')}:
                {String(remainingSec % 60).padStart(2, '0')}
              </span>
            </div>
            <div className="space-y-1.5">
              {CHECKLIST_ITEMS.map((item, idx) => {
                const isDone = checked.includes(idx);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() =>
                      setChecked((prev) =>
                        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                      )
                    }
                    className="w-full text-left rounded-lg border border-amber-400/25 bg-[var(--surface-0)] px-2.5 py-2 text-[11px] text-slate-200 flex items-start gap-2"
                  >
                    {isDone ? (
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                    )}
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={checked.length < CHECKLIST_ITEMS.length}
              onClick={() => {
                triggerHaptic(12);
                setCfg(clearCooldownWithChecklist());
                setChecked([]);
              }}
              className="w-full min-h-[38px] rounded-xl bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold"
            >
              Завершить чек-лист дисциплины ({checked.length}/3)
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(12);
              setCfg(triggerManualCooldown());
            }}
            className="w-full min-h-[40px] rounded-xl border border-amber-400/35 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-semibold text-amber-200 inline-flex items-center justify-center gap-1.5"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Включить паузу «Остыть» на {cfg.cooldownMinutes} мин вручную</span>
          </button>
        )}
      </div>
    </PaywallGate>
  );
};

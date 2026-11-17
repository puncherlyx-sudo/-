import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Crosshair, Loader2, Lock, TrendingDown, TrendingUp } from 'lucide-react';
import type { ScanReport, SetupCandidate, SetupGrade } from '../../server/setupScanner.ts';
import { CREDIT_COSTS } from '../data/strategies';
import { authFetch } from '../lib/authFetch';
import type { MarketType } from '../types/domain';
import { UpgradeNudge } from './UpgradeNudge';

interface SetupScannerProps {
  isSignedIn: boolean;
  isPro: boolean;
  creditsRemaining?: number;
  creditQuota?: number;
  onRequireLogin: () => void;
  onUpgradePro: () => void;
  onOpenPair: (symbol: string, marketType: MarketType) => void;
}

interface ScanResponse extends ScanReport {
  degraded?: boolean;
  charged?: number;
  credits?: { remaining: number; quota: number; isPro: boolean } | null;
  error?: string;
  code?: string;
  upgrade?: boolean;
}

const GRADE_STYLE: Record<SetupGrade, string> = {
  A: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300',
  B: 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300',
  C: 'border-amber-400/60 bg-amber-500/15 text-amber-300',
  D: 'border-slate-500/60 bg-slate-500/15 text-slate-300',
};

const TF_LABEL: Record<string, string> = { '15m': '15м', '1h': '1ч', '4h': '4ч', '1d': '1д' };
const BIAS_ARROW: Record<string, { text: string; cls: string }> = {
  BULLISH: { text: '▲', cls: 'text-emerald-400' },
  BEARISH: { text: '▼', cls: 'text-rose-400' },
  RANGE: { text: '■', cls: 'text-slate-500' },
};

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(5);
}

export const SetupScanner: React.FC<SetupScannerProps> = ({
  isSignedIn,
  isPro,
  creditsRemaining,
  creditQuota,
  onRequireLogin,
  onUpgradePro,
  onOpenPair,
}) => {
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<{ message: string; upgrade: boolean } | null>(null);
  const [showRules, setShowRules] = useState(false);

  const cost = CREDIT_COSTS.setupScanner;
  const lowCredits = isSignedIn && typeof creditsRemaining === 'number' && creditsRemaining < cost;

  const run = async () => {
    setError(null);
    if (!isSignedIn) {
      onRequireLogin();
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch('/api/scanner/setups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketType }),
      });
      const data = (await res.json()) as ScanResponse;
      if (!res.ok) {
        setError({ message: data.error || 'Не удалось выполнить сканирование.', upgrade: Boolean(data.upgrade) });
        return;
      }
      setResult(data);
    } catch {
      setError({ message: 'Нет соединения с сервером. Кредиты не списаны.', upgrade: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="Сканер сетапов">
      <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Crosshair className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">Сканер сетапов</h3>
            <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">
              Проверяет все пары на четырёх таймфреймах (15м, 1ч, 4ч, 1д) и показывает самые согласованные входы:
              где тренд совпадает, RSI не перегрет и цена рядом с уровнем.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Рынок">
          {(['spot', 'futures'] as MarketType[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={marketType === m}
              onClick={() => setMarketType(m)}
              className={`min-h-[42px] rounded-xl border text-sm font-semibold transition-colors ${
                marketType === m
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {m === 'spot' ? 'Спот' : 'Фьючерсы'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="cta-shimmer w-full min-h-[48px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : !isSignedIn ? <Lock className="w-4 h-4" /> : <Crosshair className="w-4 h-4" />}
          {loading ? 'Сканирую рынок…' : !isSignedIn ? 'Войти и запустить сканер' : `Запустить сканер (${cost} кр.)`}
        </button>

        {isSignedIn && typeof creditsRemaining === 'number' && (
          <p className="text-[11px] text-slate-500 text-center">
            Кредитов: <span className="font-mono text-slate-300">{creditsRemaining}</span>
            {typeof creditQuota === 'number' ? ` из ${creditQuota}` : ''}
            {isPro ? ' (PRO, обновляются раз в месяц)' : ' (обновляются раз в неделю)'}
          </p>
        )}
      </div>

      {(lowCredits || error?.upgrade) && !isPro && (
        <UpgradeNudge
          title="Кредиты на исходе"
          text="PRO даёт 100 кредитов в месяц, все стратегии и до 50 ценовых алертов. Сканер, анализ и разбор дневника считаются из одного баланса."
          onUpgrade={onUpgradePro}
        />
      )}
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error.message}</div>
      )}

      {result?.degraded && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Биржевые данные сейчас недоступны, поэтому сравнение таймфреймов было бы недостоверным. Результат не показан,
          <b> кредиты не списаны</b>. Повторите позже.
        </div>
      )}

      {result && !result.degraded && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              Проверено пар: {result.scannedPairs}
              {result.skippedNoDirection > 0 && ` · без явного направления: ${result.skippedNoDirection}`}
            </span>
            {result.credits && (
              <span>
                Списано {result.charged} кр., осталось{' '}
                <span className="font-mono text-slate-300">{result.credits.remaining}</span>
              </span>
            )}
          </div>

          {result.setups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
              Сейчас нет пар с согласованным трендом. Это нормально: чаще всего лучший вход — подождать.
            </div>
          ) : (
            <AnimatePresence initial>
              {result.setups.map((s, i) => (
                <SetupCard
                  key={`${s.symbol}-${s.direction}`}
                  setup={s}
                  rank={i + 1}
                  marketType={result.marketType}
                  onOpen={onOpenPair}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      <div className="text-[11px] leading-relaxed text-slate-500 space-y-2">
        <button type="button" onClick={() => setShowRules((v) => !v)} className="text-cyan-300 hover:text-cyan-200 font-medium">
          {showRules ? 'Скрыть, как считается оценка' : 'Как считается оценка'}
        </button>
        {showRules && (
          <ul className="list-disc pl-4 space-y-1">
            <li>До 60 баллов за согласие трендов: вес 15м=1, 1ч=1,5, 4ч=2, 1д=2. Без перевеса одной стороны сетап не показывается.</li>
            <li>+10, если совпадают старшие таймфреймы (4ч и 1д); −15, если дневной тренд против.</li>
            <li>До +15 за «рабочий» RSI на 1ч; штраф −10 при перегреве (RSI выше 75 для лонга, ниже 25 для шорта).</li>
            <li>+15, если цена у поддержки (для лонга) или сопротивления (для шорта); −15, если вплотную к противоположному уровню.</li>
            <li>+5 за потенциал не менее 1,5 к риску и +5 за умеренную волатильность.</li>
            <li>Оценки A ≥ 75, B ≥ 60, C ≥ 45, остальное D.</li>
          </ul>
        )}
        <p>Сканер находит идеи для проверки по явным правилам. Это не инвестиционная рекомендация и не гарантия результата.</p>
      </div>
    </section>
  );
};

const SetupCard: React.FC<{
  setup: SetupCandidate;
  rank: number;
  marketType: MarketType;
  onOpen: (symbol: string, marketType: MarketType) => void;
}> = ({ setup, rank, marketType, onOpen }) => {
  const long = setup.direction === 'LONG';
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: rank * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="text-slate-500 font-mono text-xs">#{rank}</span>
            {setup.symbol.replace('USDT', '')}
            <span className="text-slate-500 font-normal">/ USDT</span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ${
                long ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {long ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {long ? 'ЛОНГ' : 'ШОРТ'}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-400">
            цена {fmt(setup.price)} · поддержка {fmt(setup.support)} · сопротивление {fmt(setup.resistance)}
          </div>
        </div>
        <div className="shrink-0 text-center">
          <div className={`w-11 h-11 rounded-xl border-2 flex items-center justify-center text-lg font-bold ${GRADE_STYLE[setup.grade]}`}>
            {setup.grade}
          </div>
          <div className="mt-0.5 text-[10px] font-mono tabular-nums text-slate-400">{setup.score}/100</div>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${setup.score}%` }}
          transition={{ duration: 0.8, delay: 0.1 + rank * 0.06, ease: [0.16, 1, 0.3, 1] }}
          className={`h-full rounded-full ${long ? 'bg-gradient-to-r from-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-rose-500 to-rose-300'}`}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {setup.frames.map((f) => {
          const b = BIAS_ARROW[f.bias];
          return (
            <span key={f.tf} className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] font-mono tabular-nums text-slate-300">
              {TF_LABEL[f.tf]} <span className={b.cls}>{b.text}</span>
            </span>
          );
        })}
        {setup.riskReward !== null && (
          <span className="px-2 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-[11px] font-mono tabular-nums text-cyan-200">
            потенциал : риск = {setup.riskReward} : 1
          </span>
        )}
      </div>

      <ul className="space-y-1">
        {setup.reasons.map((r) => (
          <li key={r} className="flex items-start gap-2 text-xs text-slate-300">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            {r}
          </li>
        ))}
        {setup.warnings.map((w) => (
          <li key={w} className="flex items-start gap-2 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {w}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onOpen(setup.symbol, marketType)}
        className="w-full min-h-[40px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition-colors"
      >
        Открыть на графике
      </button>
    </motion.article>
  );
};

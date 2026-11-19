import React, { useState } from 'react';
import { Delete, Lock, ShieldCheck } from 'lucide-react';
import { hashPinSha256, triggerHaptic } from '../lib/securityDlp';

interface PinLockOverlayProps {
  expectedPinHash: string;
  antiPhishingCode?: string;
  onUnlocked: () => void;
}

export const PinLockOverlay: React.FC<PinLockOverlayProps> = ({
  expectedPinHash,
  antiPhishingCode,
  onUnlocked,
}) => {
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleDigit = async (d: string) => {
    if (checking || digits.length >= 4) return;
    triggerHaptic(8);
    setError(null);
    const next = `${digits}${d}`;
    setDigits(next);

    if (next.length === 4) {
      setChecking(true);
      try {
        const hashed = await hashPinSha256(next);
        if (hashed === expectedPinHash) {
          triggerHaptic(15);
          onUnlocked();
        } else {
          triggerHaptic(30);
          setError('Неверный PIN-код. Попробуйте ещё раз.');
          setTimeout(() => setDigits(''), 350);
        }
      } finally {
        setChecking(false);
      }
    }
  };

  const handleBackspace = () => {
    if (checking || digits.length === 0) return;
    triggerHaptic(6);
    setDigits((prev) => prev.slice(0, -1));
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--surface-0)]/96 backdrop-blur-xl p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Разблокировка VERNIER по PIN-коду"
    >
      <div className="w-full max-w-xs rounded-3xl border border-emerald-500/25 bg-[var(--surface-1)] p-6 shadow-2xl space-y-6 text-center">
        <div className="space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-base font-semibold text-white">Терминал заблокирован</h2>
          <p className="text-xs text-slate-400">Введите 4-значный PIN-код для доступа</p>
          {antiPhishingCode && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Анти-фишинг: {antiPhishingCode}</span>
            </div>
          )}
        </div>

        {/* 4 PIN dots */}
        <div className="flex items-center justify-center gap-4" aria-label={`Введено ${digits.length} из 4 цифр`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`w-3.5 h-3.5 rounded-full border transition-all ${
                i < digits.length
                  ? 'bg-emerald-400 border-emerald-300 scale-110 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                  : 'bg-transparent border-white/25'
              }`}
            />
          ))}
        </div>

        {error && <div className="text-xs text-rose-400 font-medium">{error}</div>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <button
              key={n}
              type="button"
              disabled={checking}
              onClick={() => void handleDigit(n)}
              className="min-h-[52px] rounded-2xl border border-white/10 bg-[var(--surface-2)] hover:bg-emerald-500/15 hover:border-emerald-500/35 active:scale-95 text-lg font-mono font-semibold text-white transition-all"
            >
              {n}
            </button>
          ))}
          <div />
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleDigit('0')}
            className="min-h-[52px] rounded-2xl border border-white/10 bg-[var(--surface-2)] hover:bg-emerald-500/15 hover:border-emerald-500/35 active:scale-95 text-lg font-mono font-semibold text-white transition-all"
          >
            0
          </button>
          <button
            type="button"
            disabled={checking || digits.length === 0}
            onClick={handleBackspace}
            aria-label="Удалить последнюю цифру"
            className="min-h-[52px] rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 active:scale-95 text-slate-300 flex items-center justify-center transition-all disabled:opacity-40"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

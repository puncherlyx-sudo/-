import React, { useState } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';

interface TwoFactorModalProps {
  open: boolean;
  title: string;
  description: string;
  uid: string;
  encryptedSecret: string;
  backupCodeHashes: string[];
  onVerified: (consumedBackupHash: string | null) => Promise<void>;
  onClose: () => void;
}

export const TwoFactorModal: React.FC<TwoFactorModalProps> = ({
  open,
  title,
  description,
  uid,
  encryptedSecret,
  backupCodeHashes,
  onVerified,
  onClose,
}) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/security/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          encryptedSecret,
          code: code.trim(),
          backupCodeHashes,
        }),
      });
      const data = (await res.json()) as {
        verified?: boolean;
        consumedBackupHash?: string | null;
        error?: string;
      };
      if (!res.ok || !data.verified) {
        setError(data.error || 'Неверный код подтверждения.');
        return;
      }
      await onVerified(data.consumedBackupHash ?? null);
      setCode('');
    } catch {
      setError('Ошибка соединения с сервером проверки 2FA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">Двухфакторная защита (TOTP / резервный код)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-300 leading-relaxed">{description}</p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="totp-stepup-input" className="block text-xs font-medium text-slate-400 mb-1.5">
              6-значный код Google Authenticator или 8-значный резервный код
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="totp-stepup-input"
                type="text"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456 или ABCD-EFGH"
                className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0B0F17] pl-10 pr-4 text-sm font-mono tracking-wider text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading || code.trim().length < 6}
              className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
            >
              {loading ? 'Проверка...' : 'Подтвердить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { authFetch } from '../lib/authFetch';

interface LockScreenOverlayProps {
  uid: string;
  email: string;
  encryptedSecret: string;
  backupCodeHashes: string[];
  onUnlocked: (consumedBackupHash: string | null) => Promise<void>;
  onLogout: () => Promise<void>;
}

export const LockScreenOverlay: React.FC<LockScreenOverlayProps> = ({
  uid,
  email,
  encryptedSecret,
  backupCodeHashes,
  onUnlocked,
  onLogout,
}) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/security/totp/verify', {
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
        setError(data.error || 'Неверный код 2FA.');
        return;
      }
      await onUnlocked(data.consumedBackupHash ?? null);
      setCode('');
    } catch {
      setError('Ошибка сети при проверке 2FA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B0F17]/95 backdrop-blur-xl p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl border border-emerald-500/30 bg-[#0B0F17] overflow-hidden mx-auto shadow-lg">
          <img
            src="/src/assets/images/terminal_icon_vault_1794855844198.jpg"
            alt="2FA Защита Vernier"
            width={64}
            height={64}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>
        <h2 className="mt-4 text-center text-xl font-semibold text-white">Терминал заблокирован</h2>
        <p className="mt-1.5 text-center text-sm text-slate-400">
          Сессия {email} защищена двухфакторной аутентификацией. Введите код из аутентификатора для доступа.
        </p>

        <form onSubmit={handleUnlock} className="mt-6 space-y-4">
          <input
            type="text"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            className="w-full min-h-[48px] rounded-xl border border-white/10 bg-[#0B0F17] px-4 text-center text-lg font-mono tracking-[0.25em] text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || code.trim().length < 6}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {loading ? 'Проверка...' : 'Разблокировать терминал'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void onLogout()}
          className="mt-4 w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Выйти из аккаунта</span>
        </button>
      </div>
    </div>
  );
};

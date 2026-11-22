import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, ShieldCheck, X } from 'lucide-react';
import type {
  ExchangeKeyPermissions,
  ExchangeKeyRecord,
  ExchangeSyncResult,
} from '../types/domain';

interface EditExchangeKeyModalProps {
  keyRecord: ExchangeKeyRecord | null;
  onClose: () => void;
  onSave: (
    existingKey: ExchangeKeyRecord,
    params: {
      label: string;
      apiKey: string;
      apiSecret: string;
      passphrase?: string;
      permissions: ExchangeKeyPermissions;
      testnet: boolean;
    }
  ) => Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }>;
}

export const EditExchangeKeyModal: React.FC<EditExchangeKeyModalProps> = ({
  keyRecord,
  onClose,
  onSave,
}) => {
  const [label, setLabel] = useState('');
  const [permissions, setPermissions] = useState<ExchangeKeyPermissions>('read_only');
  const [testnet, setTestnet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!keyRecord) return;
    setLabel(keyRecord.label);
    setPermissions(keyRecord.permissions);
    setTestnet(keyRecord.testnet);
    setApiKey('');
    setApiSecret('');
    setPassphrase('');
    setShowSecret(false);
    setError(null);
  }, [keyRecord]);

  useEffect(() => {
    if (!keyRecord) return;
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyRecord, submitting, onClose]);

  if (!keyRecord) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (label.trim().length < 2) {
      setError('Укажите название профиля (минимум 2 символа).');
      return;
    }
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError('Введите актуальные API Key и API Secret с вашей биржи.');
      return;
    }
    if (keyRecord.exchange === 'okx' && !passphrase.trim()) {
      setError('Для OKX необходимо указать Passphrase.');
      return;
    }

    setSubmitting(true);
    try {
      await onSave(keyRecord, {
        label: label.trim(),
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        passphrase: passphrase.trim(),
        permissions,
        testnet,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить API-ключ.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-exchange-key-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/12 bg-[#111827] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <KeyRound className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 id="edit-exchange-key-title" className="text-sm font-semibold text-white truncate">
                Обновить API-ключ · {keyRecord.exchange.toUpperCase()}
              </h3>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                Текущий ключ: {keyRecord.apiKeyPreview}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно редактирования ключа"
            className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          {keyRecord.lastSyncError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold text-rose-300">Последний сбой синхронизации</div>
                <div className="mt-0.5 text-[11px] break-words">{keyRecord.lastSyncError}</div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-3.5 py-2.5 text-[11px] text-slate-400 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              В модели Non-Custodial старые секреты не расшифровываются в браузер. Введите новый или перевыпущенный API Key и API Secret — они будут проверены на бирже и зашифрованы через AES-256-GCM.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Название профиля</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300 block">Права ключа</span>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0F17] border border-white/10">
                <button
                  type="button"
                  onClick={() => setPermissions('read_only')}
                  className={`min-h-[32px] rounded-lg text-xs font-medium transition-colors ${
                    permissions === 'read_only'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Чтение
                </button>
                <button
                  type="button"
                  onClick={() => setPermissions('trade')}
                  className={`min-h-[32px] rounded-lg text-xs font-medium transition-colors ${
                    permissions === 'trade'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Торговля
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Новый API Key</span>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Вставьте актуальный API Key"
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Новый API Secret</span>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="Вставьте Secret Key"
                  className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] pl-3 pr-9 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? 'Скрыть секрет' : 'Показать секрет'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>
          </div>

          {keyRecord.exchange === 'okx' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Passphrase (обязательно для OKX)</span>
              <input
                type={showSecret ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                placeholder="Кодовая фраза API OKX"
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </label>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => setTestnet((v) => !v)}
              aria-pressed={testnet}
              className={`min-h-[36px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-2 transition-colors ${
                testnet
                  ? 'border-cyan-500/40 bg-cyan-500/12 text-cyan-200'
                  : 'border-white/10 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${testnet ? 'bg-cyan-400' : 'bg-slate-600'}`}
              />
              <span>{testnet ? 'Testnet / Demo' : 'Mainnet'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{submitting ? 'Проверка...' : 'Проверить и сохранить'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Check, Crown, Loader2, ShieldCheck, X } from 'lucide-react';
import { authFetch } from '../lib/authFetch';

type Period = 'month' | 'year';

interface PlansResponse {
  enabled: boolean;
  plans: Record<Period, { priceUsd: number; days: number }>;
}

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  /** Конец оплаченного периода PRO (мс), если подписка уже активна. */
  proUntil?: number;
}

const FEATURES = [
  'Безлимитный AI-анализ рынка',
  'До 20 сигналов в день на стратегию',
  'Push-уведомления о сигналах',
  'Все стратегии и таймфреймы',
];

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const PricingModal: React.FC<PricingModalProps> = ({ open, onClose, proUntil }) => {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [period, setPeriod] = useState<Period>('year');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    let cancelled = false;
    fetch('/api/billing/plans')
      .then((r) => r.json() as Promise<PlansResponse>)
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить тарифы. Проверьте соединение.');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const month = data?.plans.month;
  const year = data?.plans.year;
  const yearSavingPct =
    month && year ? Math.max(0, Math.round((1 - year.priceUsd / (month.priceUsd * 12)) * 100)) : 0;

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      });
      const json = (await res.json()) as { invoiceUrl?: string; error?: string };
      if (!res.ok || !json.invoiceUrl) {
        throw new Error(json.error || 'Не удалось создать счёт.');
      }
      const url = new URL(json.invoiceUrl);
      if (url.protocol !== 'https:' || !/(^|\.)nowpayments\.io$/i.test(url.hostname)) {
        throw new Error('Получен недопустимый адрес оплаты.');
      }
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка оплаты.');
      setLoading(false);
    }
  };

  const cards: Array<{ key: Period; title: string; price?: number; note: string }> = [
    { key: 'month', title: '1 месяц', price: month?.priceUsd, note: '30 дней доступа' },
    {
      key: 'year',
      title: '1 год',
      price: year?.priceUsd,
      note: yearSavingPct > 0 ? `Выгода ${yearSavingPct}% · 365 дней` : '365 дней доступа',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Оформление подписки PRO"
    >
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">AegisQuant PRO</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {proUntil && proUntil > Date.now()
                  ? `Активен до ${formatDate(proUntil)}. Оплата продлит срок.`
                  : 'Полный доступ к терминалу'}
              </p>
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

        <ul className="mt-5 space-y-2">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>

        <div className="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Период подписки">
          {cards.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={period === c.key}
              onClick={() => setPeriod(c.key)}
              className={`min-h-[96px] rounded-xl border p-3.5 text-left transition-colors ${
                period === c.key
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="text-xs font-medium text-slate-400">{c.title}</div>
              <div className="mt-1 text-2xl font-bold text-white font-mono">
                {c.price !== undefined ? `$${c.price}` : '—'}
              </div>
              <div className="mt-1 text-[11px] text-emerald-400">{c.note}</div>
            </button>
          ))}
        </div>

        {data && !data.enabled && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
            Приём оплаты ещё не подключён. Попробуйте позже.
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handlePay()}
          disabled={loading || !data?.enabled}
          className="mt-5 min-h-[48px] w-full rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? 'Создаём счёт…' : 'Оплатить криптовалютой'}
        </button>

        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Оплата проходит на защищённой странице платёжного сервиса NOWPayments (USDT, BTC, ETH и др.). PRO включается
          автоматически после подтверждения платежа в сети — обычно в течение нескольких минут.
        </p>
      </div>
    </div>
  );
};

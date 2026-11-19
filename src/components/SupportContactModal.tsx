import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  LifeBuoy,
  Send,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { SupportTicketCategory, SupportTicketRecord } from '../types/domain';
import { NATIVE_SPRING } from './MotionPrimitives';

interface SupportContactModalProps {
  open: boolean;
  isSignedIn: boolean;
  defaultEmail?: string;
  tickets: SupportTicketRecord[];
  onClose: () => void;
  onRequireLogin: () => void;
  onSubmitTicket: (params: {
    contactEmail: string;
    category: SupportTicketCategory;
    subject: string;
    message: string;
  }) => Promise<string>;
}

const SUPPORT_CATEGORIES: Array<{ id: SupportTicketCategory; label: string }> = [
  { id: 'alerts', label: 'Алерты и Push' },
  { id: 'chart', label: 'Графики и пары' },
  { id: 'billing', label: 'PRO и кредиты' },
  { id: 'security', label: '2FA и безопасность' },
  { id: 'other', label: 'Другой вопрос' },
];

const CATEGORY_LABEL_MAP: Record<SupportTicketCategory, string> = {
  alerts: 'Алерты и Push',
  chart: 'Графики и пары',
  billing: 'PRO и кредиты',
  security: '2FA и безопасность',
  other: 'Другой вопрос',
};

function formatTicketTime(tsRaw: unknown): string {
  const sec = (tsRaw as { seconds?: number } | undefined)?.seconds;
  if (!sec) return 'Только что';
  return new Date(sec * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SupportContactModal: React.FC<SupportContactModalProps> = ({
  open,
  isSignedIn,
  defaultEmail = '',
  tickets,
  onClose,
  onRequireLogin,
  onSubmitTicket,
}) => {
  const [category, setCategory] = useState<SupportTicketCategory>('alerts');
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedTicketId, setSubmittedTicketId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmittedTicketId(null);
    if (defaultEmail && !contactEmail) {
      setContactEmail(defaultEmail);
    }
  }, [open, defaultEmail, contactEmail]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmittedTicketId(null);

    const cleanEmail = contactEmail.trim();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();

    if (cleanEmail.length < 3 || !cleanEmail.includes('@')) {
      setError('Введите корректный email для ответа поддержки.');
      return;
    }
    if (cleanSubject.length < 3) {
      setError('Укажите тему обращения (от 3 символов).');
      return;
    }
    if (cleanMessage.length < 10) {
      setError('Опишите проблему подробнее (минимум 10 символов).');
      return;
    }

    setSubmitting(true);
    try {
      const ticketId = await onSubmitTicket({
        contactEmail: cleanEmail,
        category,
        subject: cleanSubject,
        message: cleanMessage,
      });
      setSubmittedTicketId(ticketId);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить обращение.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-modal-title"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />

          {/* Mobile Bottom Sheet / Desktop Center Card */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={NATIVE_SPRING}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-white/12 bg-[#111827] shadow-2xl p-5 pb-6 space-y-4 max-h-[90dvh] overflow-y-auto"
          >
            <div className="sm:hidden w-10 h-1 rounded-full bg-slate-700 mx-auto -mt-1 mb-2" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/8">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
                  <LifeBuoy className="w-4 h-4 text-emerald-300" />
                </div>
                <div className="min-w-0">
                  <h3 id="support-modal-title" className="text-sm sm:text-base font-bold text-white font-display">
                    Связаться с поддержкой
                  </h3>
                  <p className="text-xs text-slate-400">
                    Если в «Быстрых ответах» нет решения — опишите задачу команде Vernier
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть окно поддержки"
                className="min-h-[36px] min-w-[36px] rounded-xl border border-white/10 bg-[#0B0F17] text-slate-400 hover:text-white flex items-center justify-center shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!isSignedIn && (
              <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-cyan-200">
                <span>Войдите через Google, чтобы обращения сохранялись в истории аккаунта.</span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequireLogin();
                  }}
                  className="font-semibold text-white underline underline-offset-2 whitespace-nowrap"
                >
                  Войти →
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Topic Category Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Категория вопроса</label>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Категория обращения">
                  {SUPPORT_CATEGORIES.map((item) => {
                    const active = category === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setCategory(item.id)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                          active
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                            : 'border-white/10 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Contact Email */}
              <div className="space-y-1">
                <label htmlFor="support-email" className="block text-xs font-medium text-slate-300">
                  Email для ответа
                </label>
                <input
                  id="support-email"
                  type="email"
                  required
                  maxLength={200}
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="trader@example.com"
                  className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Subject */}
              <div className="space-y-1">
                <label htmlFor="support-subject" className="block text-xs font-medium text-slate-300">
                  Тема обращения
                </label>
                <input
                  id="support-subject"
                  type="text"
                  required
                  minLength={3}
                  maxLength={140}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Например: Не приходят Push-уведомления на Android"
                  className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Message */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="support-message" className="font-medium text-slate-300">
                    Описание ситуации
                  </label>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500">
                    {message.length}/2000
                  </span>
                </div>
                <textarea
                  id="support-message"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Укажите пару, таймфрейм, устройство и шаги, после которых возник вопрос..."
                  className="w-full rounded-xl border border-white/10 bg-[#0B0F17] p-3 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none resize-y"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </div>
              )}

              {submittedTicketId && (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-white">Обращение зарегистрировано</div>
                    <div className="mt-0.5 text-slate-300">
                      Номер заявки: <span className="font-mono text-emerald-300">{submittedTicketId}</span>. Ответ придёт на{' '}
                      <span className="font-mono">{contactEmail.trim()}</span>.
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[40px] px-4 rounded-xl border border-white/10 bg-[#0B0F17] hover:bg-white/[0.04] text-xs font-medium text-slate-300 transition-colors"
                >
                  Закрыть
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Отправка...' : 'Отправить обращение'}</span>
                </button>
              </div>
            </form>

            {/* Recent Tickets History (when signed in and tickets exist) */}
            {isSignedIn && tickets.length > 0 && (
              <div className="pt-3 border-t border-white/8 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Ваши последние обращения</span>
                  <span className="font-mono tabular-nums text-slate-500">{tickets.length}</span>
                </div>
                <div className="divide-y divide-white/8 max-h-40 overflow-y-auto">
                  {tickets.slice(0, 5).map((ticket) => (
                    <div key={ticket.id} className="py-2 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{ticket.subject}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          <span className="font-mono text-slate-500">{ticket.id}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{CATEGORY_LABEL_MAP[ticket.category] ?? ticket.category}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-emerald-400 font-medium">
                          {ticket.status === 'resolved' ? 'Решено' : 'Принято'}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatTicketTime(ticket.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

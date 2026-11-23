import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ExchangeId, SupportTicketCategory } from '../types/domain';
import type { ExchangeSyncErrorLogEntry } from '../lib/exchangeSyncErrorLog';
import {
  buildSyncErrorSupportReport,
  MAX_SUPPORT_MESSAGE_LEN,
  MAX_SUPPORT_SUBJECT_LEN,
} from '../lib/exchangeSyncSupportReport';
import { triggerHaptic } from '../lib/securityDlp';
import { LegalDocumentModal, type LegalDocKind } from './LegalConsentModal';
import { TERMINAL_EASE } from './MotionPrimitives';

interface SyncErrorSupportModalProps {
  open: boolean;
  onClose: () => void;
  logs: ExchangeSyncErrorLogEntry[];
  exchangeFilter?: 'all' | ExchangeId;
  defaultEmail?: string;
  onCreateSupportTicket: (params: {
    contactEmail: string;
    category: SupportTicketCategory;
    subject: string;
    message: string;
  }) => Promise<string>;
}

export const SyncErrorSupportModal: React.FC<SyncErrorSupportModalProps> = ({
  open,
  onClose,
  logs,
  exchangeFilter = 'all',
  defaultEmail = '',
  onCreateSupportTicket,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [userComment, setUserComment] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [logLimit, setLogLimit] = useState<number>(5);
  const [previewExpanded, setPreviewExpanded] = useState<boolean>(true);
  const [acceptedDataConsent, setAcceptedDataConsent] = useState(false);
  const [openLegalDoc, setOpenLegalDoc] = useState<LegalDocKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const report = useMemo(
    () =>
      buildSyncErrorSupportReport({
        logs,
        exchangeFilter,
        userComment,
        maxLogs: logLimit,
        appVersion: typeof navigator !== 'undefined' ? `VERNIER Web (${navigator.platform || 'browser'})` : 'VERNIER Web',
      }),
    [logs, exchangeFilter, userComment, logLimit]
  );

  useEffect(() => {
    if (open) {
      setContactEmail((prev) => (prev.trim() ? prev : defaultEmail));
      setCustomSubject(report.subject);
      setAcceptedDataConsent(false);
      setErrorText(null);
      setCreatedTicketId(null);
      setCopiedPayload(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultEmail]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  const effectiveSubject = (customSubject.trim() || report.subject).slice(0, MAX_SUPPORT_SUBJECT_LEN);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    const trimmedEmail = contactEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorText('Укажите корректный email для получения ответа от инженеров поддержки.');
      return;
    }
    if (!acceptedDataConsent) {
      setErrorText(
        'Подтвердите добровольную передачу email и обезличенных технических логов, а также согласие с Политикой конфиденциальности.'
      );
      return;
    }

    setSubmitting(true);
    triggerHaptic(10);
    try {
      const ticketId = await onCreateSupportTicket({
        contactEmail: trimmedEmail,
        category: 'security',
        subject: effectiveSubject,
        message: report.message,
      });
      setCreatedTicketId(ticketId);
      triggerHaptic(15);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Не удалось отправить отчёт в службу поддержки.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(`${effectiveSubject}\n\n${report.message}`);
      setCopiedPayload(true);
      triggerHaptic(8);
      window.setTimeout(() => setCopiedPayload(false), 1800);
    } catch {
      setErrorText('Не удалось скопировать текст отчёта в буфер обмена.');
    }
  };

  return (
    <>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: TERMINAL_EASE }}
          onClick={() => {
            if (!submitting) onClose();
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Отправка отчёта об ошибках синхронизации в поддержку"
        >
          <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.2, ease: TERMINAL_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#0E1522] shadow-2xl"
          >
            {/* Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-white/8 bg-[#0B0F17] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Send className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Отчёт об ошибках синхронизации в поддержку</span>
                  </h3>
                  <span className="px-2 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/12 font-mono text-[10px] text-emerald-300 tabular-nums">
                    Логов: {report.attachedLogs.length}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Последние технические логи (HTTP-статус, endpoint, код ошибки, stack trace) прикрепляются автоматически с маскировкой секретов.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                aria-label="Закрыть окно отправки отчёта"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {createdTicketId ? (
                <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-5 text-center space-y-3">
                  <div className="mx-auto w-11 h-11 rounded-2xl border border-emerald-400/40 bg-emerald-500/15 flex items-center justify-center text-emerald-300">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white">Детальный отчёт отправлен в поддержку</h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Прикреплено технических записей:{' '}
                      <strong className="font-mono text-emerald-300">{report.attachedLogs.length}</strong>. Ответ поступит на{' '}
                      <strong className="text-white">{contactEmail}</strong>.
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs font-mono text-cyan-300">
                    <span>ID тикета: {createdTicketId}</span>
                  </div>
                  <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(createdTicketId).catch(() => undefined);
                        setCopiedPayload(true);
                        window.setTimeout(() => setCopiedPayload(false), 1600);
                      }}
                      className="min-h-[36px] px-3 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5"
                    >
                      {copiedPayload ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedPayload ? 'ID скопирован' : 'Копировать ID'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="min-h-[36px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                    >
                      Готово
                    </button>
                  </div>
                </div>
              ) : (
                <form id="sync-error-support-form" onSubmit={handleSubmit} className="space-y-4">
                  {/* Краткая сводка по прикрепляемым ошибкам */}
                  <div className="grid grid-cols-3 gap-2.5 text-xs">
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-3 py-2">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">Ошибок в журнале</div>
                      <div className="mt-0.5 text-sm font-bold font-mono tabular-nums text-white">
                        {report.totalErrorCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2">
                      <div className="text-[10px] text-rose-300/80 uppercase tracking-wider">Критических</div>
                      <div className="mt-0.5 text-sm font-bold font-mono tabular-nums text-rose-300">
                        {report.criticalCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
                      <div className="text-[10px] text-amber-300/80 uppercase tracking-wider">Предупреждений</div>
                      <div className="mt-0.5 text-sm font-bold font-mono tabular-nums text-amber-300">
                        {report.warningCount}
                      </div>
                    </div>
                  </div>

                  {/* Email и глубина прикрепляемых логов */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="sm:col-span-2 block space-y-1">
                      <span className="text-[11px] font-medium text-slate-300">Email для ответа поддержки</span>
                      <input
                        type="email"
                        required
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full min-h-[38px] rounded-xl border border-white/12 bg-[#0B0F17] px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] font-medium text-slate-300">Прикрепить логов</span>
                      <select
                        value={logLimit}
                        onChange={(e) => setLogLimit(Number(e.target.value))}
                        className="w-full min-h-[38px] rounded-xl border border-white/12 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:outline-none focus:border-cyan-400/60"
                      >
                        <option value={3}>Последние 3</option>
                        <option value={5}>Последние 5</option>
                        <option value={8}>Последние 8</option>
                      </select>
                    </label>
                  </div>

                  {/* Тема обращения */}
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-slate-300">Тема отчёта</span>
                    <input
                      type="text"
                      maxLength={MAX_SUPPORT_SUBJECT_LEN}
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      placeholder={report.subject}
                      className="w-full min-h-[38px] rounded-xl border border-white/12 bg-[#0B0F17] px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
                    />
                  </label>

                  {/* Комментарий пользователя */}
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-slate-300">
                      Дополнительный комментарий (необязательно)
                    </span>
                    <textarea
                      rows={2}
                      maxLength={400}
                      value={userComment}
                      onChange={(e) => setUserComment(e.target.value)}
                      placeholder="Например: ошибка появилась после перевыпуска ключа на Bybit или смены IP..."
                      className="w-full rounded-xl border border-white/12 bg-[#0B0F17] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 resize-none"
                    />
                  </label>

                  {/* Автоматически прикрепляемый технический пакет */}
                  <div className="rounded-xl border border-white/10 bg-[#080C14] overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/8 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewExpanded((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200 hover:text-cyan-100"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>Прикрепляемые технические логи ({report.attachedLogs.length})</span>
                        {previewExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>

                      <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums text-slate-400">
                        <span>
                          {report.message.length} / {MAX_SUPPORT_MESSAGE_LEN} симв.
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyReport()}
                          className="px-2 py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 inline-flex items-center gap-1"
                        >
                          {copiedPayload ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedPayload ? 'Скопировано' : 'Копировать'}</span>
                        </button>
                      </div>
                    </div>

                    {previewExpanded && (
                      <pre className="p-3 text-[11px] font-mono leading-relaxed text-slate-300 whitespace-pre-wrap break-words max-h-52 overflow-y-auto">
                        {report.message}
                      </pre>
                    )}
                  </div>

                  {/* Гарантия безопасности */}
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 flex items-start gap-2 text-[11px] text-emerald-200/90 leading-relaxed">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      Все API-ключи, секреты, passphrase, подписи и длинные токены автоматически удалены и заменены на{' '}
                      <code className="font-mono text-emerald-300">[скрыто]</code> перед отправкой.
                    </span>
                  </div>

                  {/* Обязательное подтверждение добровольной передачи email и технических логов */}
                  <label className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 cursor-pointer text-[11px] text-slate-200 leading-relaxed">
                    <input
                      type="checkbox"
                      checked={acceptedDataConsent}
                      onChange={(e) => setAcceptedDataConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
                    />
                    <span>
                      Я подтверждаю, что самостоятельно и добровольно передаю указанный email и прикреплённые технические логи в службу поддержки, принимаю{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenLegalDoc('privacy');
                        }}
                        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-medium"
                      >
                        Политику конфиденциальности
                      </button>{' '}
                      и{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenLegalDoc('terms');
                        }}
                        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-medium"
                      >
                        Условия использования
                      </button>
                      , и осознаю ответственность за передаваемые данные.
                    </span>
                  </label>

                  {errorText && (
                    <div className="rounded-xl border border-rose-500/35 bg-rose-500/12 px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{errorText}</span>
                    </div>
                  )}
                </form>
              )}
            </div>

            {/* Footer */}
            {!createdTicketId && (
              <div className="px-4 sm:px-5 py-3 border-t border-white/8 bg-[#0B0F17] flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onClose}
                  className="min-h-[38px] px-3.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  form="sync-error-support-form"
                  disabled={submitting || !acceptedDataConsent}
                  className="min-h-[38px] px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 transition-all"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Отправка отчёта…</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Отправить отчёт в поддержку</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      <LegalDocumentModal doc={openLegalDoc} onClose={() => setOpenLegalDoc(null)} />
    </>
  );
};

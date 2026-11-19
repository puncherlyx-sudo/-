import React, { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  FileText,
  Flag,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  LEGAL_CONSENT_VERSION,
  saveAiReportTicket,
  saveLegalConsent,
  type LegalConsentRecord,
} from '../lib/localDemoStore';
import { sanitizePlainText, triggerHaptic } from '../lib/securityDlp';

export type LegalDocKind = 'privacy' | 'terms' | 'disclaimer';

interface LegalDocumentModalProps {
  doc: LegalDocKind | null;
  onClose: () => void;
}

export const LegalDocumentModal: React.FC<LegalDocumentModalProps> = ({ doc, onClose }) => {
  if (!doc) return null;

  const titles: Record<LegalDocKind, string> = {
    privacy: 'Политика конфиденциальности (Закон Украины и GDPR)',
    terms: 'Условия использования VERNIER Terminal',
    disclaimer: 'Правовое уведомление и отказ от ответственности',
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titles[doc]}
    >
      <div className="w-full max-w-2xl max-h-[88dvh] flex flex-col rounded-2xl border border-emerald-500/25 bg-[var(--surface-1)] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-semibold text-white truncate">{titles[doc]}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть документ"
            className="min-h-[38px] min-w-[38px] rounded-lg text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
          {doc === 'privacy' && (
            <>
              <p className="text-[11px] font-mono text-emerald-300">
                Редакция {LEGAL_CONSENT_VERSION} · Соответствует Закону Украины «Про захист персональних даних» № 2297-VI, Регламенту ЕС (GDPR) и Google Play Data Safety Policy.
              </p>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">1. Категории обрабатываемых данных</h4>
                <p>
                  VERNIER обрабатывает минимальный объём данных, необходимый для работы аналитического терминала: email и идентификатор профиля при входе через Google OAuth, локальные настройки терминала, пользовательский дневник сделок, ценовые алерты и журналы безопасности (2FA/сессии).
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">2. Некастодиальная модель и защита секретов</h4>
                <p>
                  VERNIER НЕ принимает, НЕ хранит и НЕ оперирует деньгами клиентов напрямую. Приложение никогда не запрашивает Seed-фразы, приватные ключи криптокошельков или пароли от бирж. API-ключи бирж (при их добровольном подключении с отключённым правом вывода средств) шифруются алгоритмом AES-256-GCM; отправка команды входа в позицию на биржу клиента выполняется исключительно при явном ручном подтверждении пользователя на каждый запуск.
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">3. Передача обезличенных данных в AI-модуль</h4>
                <p>
                  При запуске AI-анализа или AI-оценки новостей передаются исключительно рыночные котировки, значения технических индикаторов и параметры выбранной стратегии без привязки к персональным данным (ФИО, документам, платёжным реквизитам).
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">4. Права субъекта данных (Закон Украины № 2297-VI и GDPR)</h4>
                <p>
                  Вы имеете право в любой момент в разделе «Безопасность → Управление данными» просмотреть и отозвать согласия, экспортировать все свои данные в формате JSON или выполнить полное безвозвратное удаление аккаунта и локального хранилища. Контакт для запросов на удаление данных: <span className="font-mono text-emerald-300">privacy@vernier-terminal.app</span>.
                </p>
              </section>
            </>
          )}

          {doc === 'terms' && (
            <>
              <p className="text-[11px] font-mono text-emerald-300">
                Редакция {LEGAL_CONSENT_VERSION} · Пользовательское соглашение и правила подписок Google Play Billing.
              </p>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">1. Возрастное ограничение (18+)</h4>
                <p>
                  Использование VERNIER разрешено исключительно дееспособным лицам, достигшим 18-летнего возраста.
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">2. Характер программного обеспечения</h4>
                <p>
                  VERNIER является исключительно информационно-аналитическим ПО. Сервис не является криптовалютной биржей, брокером, платёжной системой, кастодиальным кошельком или финансовым советником в понимании законодательства Украины о финансовых услугах и виртуальных активах.
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">3. Подписки PRO / MAX и оплата через Google Play Billing</h4>
                <p>
                  Платные тарифы PRO и MAX (включая пакеты квот X10 и X20) оплачиваются исключительно в фиатной валюте (банковская карта / Google Pay) через биллинг Google Play. Подписка продлевается автоматически, если автопродление не отключено минимум за 24 часа до окончания оплаченного периода в настройках Google Play. Доступна кнопка «Восстановить покупки».
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">4. Ограничения в отношении AI-генерации (Google Play GenAI Policy)</h4>
                <p>
                  Все AI-сценарии, прогнозы сентимента и разборы новостей носят вероятностный справочный характер, могут содержать неточности и сопровождаются маркировкой «Сгенерировано AI • Возможны неточности» и инструментом обратной связи / жалобы.
                </p>
              </section>
            </>
          )}

          {doc === 'disclaimer' && (
            <>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">Отказ от инвестиционных рекомендаций и личная ответственность</h4>
                <p>
                  VERNIER не принимает, не хранит и не управляет средствами клиентов. Единственная торговая функция — техническая отправка команды входа в позицию на личный биржевой аккаунт клиента через его API-ключ исключительно с его явного подтверждения при каждом запуске. Торговля цифровыми активами и деривативами связана с высоким риском полной или частичной потери капитала. Все решения пользователь принимает самостоятельно под свою полную финансовую ответственность.
                </p>
              </section>
              <section className="space-y-1.5">
                <h4 className="font-semibold text-white">Источники котировок и товарные знаки бирж</h4>
                <p>
                  Рыночные данные предоставлены публичными API бирж и агрегаторов. Упоминания Binance, Bybit, OKX и других платформ носят исключительно информационный характер. VERNIER не является партнером, представителем или аффилированным сервисом указанных компаний.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};

interface LegalConsentModalProps {
  open: boolean;
  mode?: 'onboarding' | 'auth';
  onAccepted: (record: LegalConsentRecord) => void;
  onCancel?: () => void;
}

export const LegalConsentModal: React.FC<LegalConsentModalProps> = ({
  open,
  mode = 'onboarding',
  onAccepted,
  onCancel,
}) => {
  const [isAdult, setIsAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedAiProcessing, setAcceptedAiProcessing] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDocKind | null>(null);

  if (!open) return null;

  const allChecked = isAdult && acceptedTerms && acceptedAiProcessing && acceptedDisclaimer;

  const handleConfirm = () => {
    if (!allChecked) return;
    triggerHaptic(12);
    const record: LegalConsentRecord = {
      acceptedAt: new Date().toISOString(),
      version: LEGAL_CONSENT_VERSION,
      isAdult,
      acceptedTerms,
      acceptedAiProcessing,
      acceptedDisclaimer,
    };
    saveLegalConsent(record);
    onAccepted(record);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/82 backdrop-blur-md p-3 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Юридическое согласие и подтверждение 18+"
      >
        <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl border border-emerald-500/30 bg-[var(--surface-1)] p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">
                  {mode === 'auth' ? 'Подтверждение перед входом' : 'Добро пожаловать в VERNIER'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Подтвердите возраст 18+ и правовые условия (Закон Украины / GDPR / Google Play)
                </p>
              </div>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Закрыть"
                className="min-h-[38px] min-w-[38px] rounded-lg text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="space-y-2.5 text-xs text-slate-200">
            <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-[var(--surface-0)] cursor-pointer hover:border-emerald-500/35 transition-colors">
              <input
                type="checkbox"
                checked={isAdult}
                onChange={(e) => setIsAdult(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
              />
              <span className="leading-relaxed font-medium text-white">Мне исполнилось 18 лет</span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-[var(--surface-0)] cursor-pointer hover:border-emerald-500/35 transition-colors">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
              />
              <span className="leading-relaxed">
                Я прочитал(а) и принимаю{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenDoc('privacy');
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
                    setOpenDoc('terms');
                  }}
                  className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-medium"
                >
                  Условия использования
                </button>
                .
              </span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-[var(--surface-0)] cursor-pointer hover:border-emerald-500/35 transition-colors">
              <input
                type="checkbox"
                checked={acceptedAiProcessing}
                onChange={(e) => setAcceptedAiProcessing(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
              />
              <span className="leading-relaxed">
                Я даю явное согласие на обработку моих персональных данных и передачу обезличенных запросов аналитическому модулю AI.
              </span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-[var(--surface-0)] cursor-pointer hover:border-emerald-500/35 transition-colors">
              <input
                type="checkbox"
                checked={acceptedDisclaimer}
                onChange={(e) => setAcceptedDisclaimer(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
              />
              <span className="leading-relaxed">
                Я понимаю, что VERNIER не принимает и не оперирует моими деньгами напрямую (вход в позицию возможен только на моей бирже через API по моему подтверждению при каждом запуске), а за любые финансовые решения и возможную утрату средств я несу полную личную ответственность.{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenDoc('disclaimer');
                  }}
                  className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  Подробнее
                </button>
              </span>
            </label>
          </div>

          <div className="pt-1 flex flex-col sm:flex-row gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[44px] sm:w-32 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 transition-colors"
              >
                Отмена
              </button>
            )}
            <button
              type="button"
              disabled={!allChecked}
              onClick={handleConfirm}
              className="flex-1 min-h-[46px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all"
            >
              <Check className="w-4 h-4" />
              <span>{mode === 'auth' ? 'Принять и продолжить вход' : 'Подтвердить и войти в терминал'}</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
            <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              Дата и версия согласия ({LEGAL_CONSENT_VERSION}) сохраняются в вашем профиле. Вы можете отозвать согласие или удалить все данные в разделе «Безопасность».
            </span>
          </p>
        </div>
      </div>

      <LegalDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} />
    </>
  );
};

interface AiComplianceFooterProps {
  sourceLabel: string;
  snippet?: string;
}

export const AiComplianceFooter: React.FC<AiComplianceFooterProps> = ({ sourceLabel, snippet }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState('Неточные цифры или уровни');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveAiReportTicket({
      source: sourceLabel,
      reason,
      comment: sanitizePlainText(comment, 300),
      snippet: snippet ? sanitizePlainText(snippet, 160) : undefined,
    });
    triggerHaptic(10);
    setSubmitted(true);
    setTimeout(() => {
      setModalOpen(false);
      setSubmitted(false);
      setComment('');
    }, 1200);
  };

  return (
    <>
      <div className="mt-2.5 pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Сгенерировано AI · Возможны неточности · Не инвестрекомендация</span>
        </span>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1 text-slate-400 hover:text-amber-300 transition-colors font-medium whitespace-nowrap"
        >
          <Flag className="w-3 h-3 shrink-0" />
          <span>Пожаловаться на ответ AI</span>
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Жалоба на сгенерированный AI-ответ"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[var(--surface-1)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Пожаловаться на ответ AI</span>
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Закрыть"
                className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {submitted ? (
              <div className="py-5 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <div className="text-sm font-semibold text-white">Жалоба зарегистрирована</div>
                <p className="text-xs text-slate-400">
                  Спасибо! Отчёт сохранён для модерации качества AI (Google Play GenAI Policy).
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3 text-xs">
                <div className="text-slate-400">
                  Модуль: <span className="text-slate-200 font-medium">{sourceLabel}</span>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-slate-400">Причина жалобы</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="Неточные цифры или уровни">Неточные цифры или уровни</option>
                    <option value="Галлюцинация / вымышленный факт">Галлюцинация / вымышленный факт</option>
                    <option value="Ошибочный перевод или тональность">Ошибочный перевод или тональность</option>
                    <option value="Вводящий в заблуждение прогноз">Вводящий в заблуждение прогноз</option>
                    <option value="Неприемлемый контент">Неприемлемый контент</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-slate-400">Комментарий (опционально)</label>
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Опишите, что именно показалось некорректным..."
                    className="w-full rounded-xl border border-white/10 bg-[var(--surface-0)] p-3 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="min-h-[38px] px-4 rounded-xl border border-white/10 bg-white/5 text-slate-300"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="min-h-[38px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold"
                  >
                    Отправить отчёт
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};

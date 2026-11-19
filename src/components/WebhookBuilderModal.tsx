import React, { useMemo, useState } from 'react';
import { Check, Copy, Send, Sparkles, Webhook, X } from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import {
  DEFAULT_WEBHOOK_PAYLOAD,
  readWebhookConfig,
  writeWebhookConfig,
  type WebhookTemplateConfig,
} from '../lib/proMaxStore';
import { detectSensitiveWalletInput, DLP_WARNING_MESSAGE, triggerHaptic } from '../lib/securityDlp';
import { PaywallGate } from './PaywallGate';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

interface WebhookBuilderModalProps {
  open: boolean;
  onClose: () => void;
  sampleSymbol?: string;
  samplePrice?: number;
}

const VARIABLES = ['{{ticker}}', '{{price}}', '{{side}}', '{{sl}}', '{{tp}}'] as const;

export const WebhookBuilderModal: React.FC<WebhookBuilderModalProps> = ({
  open,
  onClose,
  sampleSymbol = 'BTCUSDT',
  samplePrice = 94250,
}) => {
  const { isMax } = usePlan();
  const [config, setConfig] = useState<WebhookTemplateConfig>(() => readWebhookConfig());
  const [copied, setCopied] = useState(false);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [dlpErr, setDlpErr] = useState<string | null>(null);
  const [confirmedBotRisk, setConfirmedBotRisk] = useState(false);

  const renderedPreview = useMemo(() => {
    const sl = Number((samplePrice * 0.982).toFixed(2));
    const tp = Number((samplePrice * 1.036).toFixed(2));
    return config.payloadTemplate
      .replace(/\{\{ticker\}\}/g, sampleSymbol)
      .replace(/\{\{price\}\}/g, String(samplePrice))
      .replace(/\{\{side\}\}/g, 'LONG')
      .replace(/\{\{sl\}\}/g, String(sl))
      .replace(/\{\{tp\}\}/g, String(tp));
  }, [config.payloadTemplate, sampleSymbol, samplePrice]);

  if (!open) return null;

  const insertVariable = (v: string) => {
    triggerHaptic(8);
    const next = {
      ...config,
      payloadTemplate: `${config.payloadTemplate}${config.payloadTemplate.endsWith('\n') ? '' : ' '}${v}`,
    };
    setConfig(next);
    writeWebhookConfig(next);
  };

  const handleSaveField = (patch: Partial<WebhookTemplateConfig>) => {
    const combined = `${patch.endpointUrl ?? config.endpointUrl} ${patch.telegramChatId ?? config.telegramChatId} ${patch.payloadTemplate ?? config.payloadTemplate}`;
    if (detectSensitiveWalletInput(combined).blocked) {
      setDlpErr(DLP_WARNING_MESSAGE);
      return;
    }
    setDlpErr(null);
    const next = { ...config, ...patch };
    setConfig(next);
    writeWebhookConfig(next);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config.payloadTemplate);
      triggerHaptic(10);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard denial
    }
  };

  const handleTest = () => {
    triggerHaptic(12);
    const target =
      config.channel === 'telegram'
        ? `Telegram (${config.telegramChatId || 'канал не задан'})`
        : `Webhook (${config.endpointUrl || 'URL не задан'})`;
    setTestNotice(`Тестовый сигнал ${sampleSymbol} LONG сформирован для ${target}. JSON валиден и готов к отправке.`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Конструктор Webhook и Telegram-сигналов"
    >
      <div className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-2xl border border-cyan-500/30 bg-[var(--surface-1)] p-4 sm:p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Webhook className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Webhook / Telegram-сигналы</span>
              <span className="text-[10px] font-mono font-bold text-cyan-200 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35">
                MAX
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Шаблон JSON-payload для внешних торговых ботов и Telegram-каналов.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть конструктор Webhook"
            className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <PaywallGate
          requiredPlan="MAX"
          unlocked={isMax}
          title="Конструктор Webhook и Telegram-сигналов"
          description="Генерируйте JSON-payload с динамическими переменными {{ticker}}, {{price}}, {{side}}, {{sl}}, {{tp}} и отправляйте сигналы во внешние боты."
        >
          <div className="space-y-3.5">
            {/* Канал доставки */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface-0)] border border-white/10">
              <button
                type="button"
                onClick={() => handleSaveField({ channel: 'telegram' })}
                className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                  config.channel === 'telegram'
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/35'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Telegram Bot
              </button>
              <button
                type="button"
                onClick={() => handleSaveField({ channel: 'webhook' })}
                className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                  config.channel === 'webhook'
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/35'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Custom Webhook (JSON)
              </button>
            </div>

            {config.channel === 'telegram' ? (
              <label className="block space-y-1 text-xs">
                <span className="text-slate-400">Chat ID или @канал Telegram</span>
                <input
                  type="text"
                  value={config.telegramChatId}
                  onChange={(e) => handleSaveField({ telegramChatId: e.target.value })}
                  placeholder="@vernier_signals или -1001234567890"
                  className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 font-mono text-white focus:border-cyan-400 focus:outline-none"
                />
              </label>
            ) : (
              <label className="block space-y-1 text-xs">
                <span className="text-slate-400">Webhook HTTPS Endpoint</span>
                <input
                  type="url"
                  value={config.endpointUrl}
                  onChange={(e) => handleSaveField({ endpointUrl: e.target.value })}
                  placeholder="https://your-bot.domain/webhook"
                  className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 font-mono text-white focus:border-cyan-400 focus:outline-none"
                />
              </label>
            )}

            {/* Кнопки вставки переменных */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Вставить переменную в шаблон:</span>
                <button
                  type="button"
                  onClick={() => handleSaveField({ payloadTemplate: DEFAULT_WEBHOOK_PAYLOAD })}
                  className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                >
                  Сбросить шаблон
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="min-h-[32px] px-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-mono text-cyan-200 transition-colors"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Редактор JSON-payload */}
            <label className="block space-y-1 text-xs">
              <span className="text-slate-400">JSON-шаблон сигнала</span>
              <textarea
                rows={6}
                value={config.payloadTemplate}
                onChange={(e) => handleSaveField({ payloadTemplate: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-[var(--surface-0)] p-3 font-mono text-xs text-emerald-200 focus:border-cyan-400 focus:outline-none"
              />
            </label>

            {/* Предпросмотр подстановки */}
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-1.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                <span>Предпросмотр с текущим тикером ({sampleSymbol})</span>
              </div>
              <pre className="text-[11px] font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap break-all">
                {renderedPreview}
              </pre>
            </div>

            {dlpErr && (
              <div className="rounded-xl border border-rose-500/35 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {dlpErr}
              </div>
            )}
            {testNotice && (
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-xs text-emerald-200">
                {testNotice}
              </div>
            )}

            <NonCustodialRiskNotice
              variant="card"
              text="VERNIER не принимает и не оперирует вашими деньгами. Вебхуки и Telegram-сигналы могут косвенно запускать сделки во внешних ботах на ваших счетах, что несёт риск потери средств. Вы используете автоматизацию исключительно под свою личную финансовую ответственность."
            />

            <label className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 cursor-pointer text-xs text-slate-200 leading-relaxed">
              <input
                type="checkbox"
                checked={confirmedBotRisk}
                onChange={(e) => setConfirmedBotRisk(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 shrink-0"
              />
              <span>
                Я подтверждаю, что сам(а) контролирую подключённых ботов/вебхуки и несу полную финансовую ответственность за любые сделки и возможные убытки.
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!confirmedBotRisk}
                onClick={handleTest}
                className="min-h-[42px] rounded-xl bg-gradient-to-r from-cyan-400 to-teal-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-opacity"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Тест уведомления</span>
              </button>
              <button
                type="button"
                disabled={!confirmedBotRisk}
                onClick={() => void handleCopy()}
                className="min-h-[42px] rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-opacity"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Шаблон скопирован' : 'Копировать шаблон'}</span>
              </button>
            </div>
          </div>
        </PaywallGate>
      </div>
    </div>
  );
};

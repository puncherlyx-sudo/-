import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  KeyRound,
  Link2,
  PauseCircle,
  RefreshCw,
  Repeat,
  Terminal,
  Wrench,
} from 'lucide-react';
import type {
  ExchangeKeyRecord,
  ExchangeSyncResult,
  SecurityAuditLog,
} from '../types/domain';
import {
  detectKnownExchangeSyncError,
  getExchangeSyncQuickFix,
  type ExchangeSyncErrorCategory,
  type ExchangeSyncQuickFixActionType,
  type ExchangeSyncSeverity,
  type GroupedExchangeSyncLogEntry,
} from '../lib/exchangeSyncErrorLog';

const CATEGORY_META: Record<ExchangeSyncErrorCategory, { label: string }> = {
  success: { label: 'Успешно' },
  rate_limit: { label: 'Лимит API' },
  auth: { label: 'Ошибка ключа / прав' },
  network: { label: 'Сбой сети' },
  exchange_api: { label: 'Ошибка API биржи' },
  unknown: { label: 'Сбой синхронизации' },
};

const SEVERITY_STYLES: Record<
  ExchangeSyncSeverity,
  { rowClass: string; dotClass: string; badgeClass: string; badgeText?: string }
> = {
  success: {
    rowClass: 'border-emerald-500/30 border-l-4 border-l-emerald-400 bg-emerald-500/[0.10]',
    dotClass: 'bg-emerald-400',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/20 text-emerald-200',
    badgeText: 'Успешно',
  },
  warning: {
    rowClass: 'border-orange-500/35 border-l-4 border-l-orange-400 bg-orange-500/[0.13]',
    dotClass: 'bg-orange-400',
    badgeClass: 'border-orange-500/40 bg-orange-500/20 text-orange-200',
  },
  critical: {
    rowClass: 'border-rose-500/40 border-l-4 border-l-rose-500 bg-rose-500/[0.14]',
    dotClass: 'bg-rose-500',
    badgeClass: 'border-rose-500/45 bg-rose-500/22 text-rose-100',
  },
};

const AUDIT_STATUS_STYLES = {
  SUCCESS: {
    row: 'border-emerald-500/25 border-l-4 border-l-emerald-400 bg-emerald-500/[0.09]',
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/35 bg-emerald-500/18 text-emerald-200',
  },
  BLOCKED: {
    row: 'border-rose-500/35 border-l-4 border-l-rose-500 bg-rose-500/[0.13]',
    dot: 'bg-rose-500',
    badge: 'border-rose-500/45 bg-rose-500/22 text-rose-100',
  },
  WARNING: {
    row: 'border-orange-500/35 border-l-4 border-l-orange-400 bg-orange-500/[0.12]',
    dot: 'bg-orange-400',
    badge: 'border-orange-500/40 bg-orange-500/20 text-orange-200',
  },
} as const;

export interface VirtualizedExchangeSyncLogListProps {
  groups: GroupedExchangeSyncLogEntry[];
  exchangeKeys: ExchangeKeyRecord[];
  nowTickMs: number;
  quickFixBusyId: string | null;
  onSetQuickFixBusyId: (id: string | null) => void;
  onSetQuickFixNotice: (notice: { tone: 'ok' | 'err'; text: string } | null) => void;
  onToggleExchange: (keyId: string, enabled: boolean) => Promise<void>;
  onSyncExchange: (key: ExchangeKeyRecord, applyToPortfolio: boolean) => Promise<ExchangeSyncResult>;
  onEditExchangeKey: (key: ExchangeKeyRecord) => void;
  onOpenExchangesSection: () => void;
}

/**
 * Виртуализированный список логов синхронизации бирж (@tanstack/react-virtual).
 * В DOM монтируются только видимые строки (+ overscan) с динамическим измерением высоты.
 */
export const VirtualizedExchangeSyncLogList: React.FC<VirtualizedExchangeSyncLogListProps> = React.memo(
  ({
    groups,
    exchangeKeys,
    nowTickMs,
    quickFixBusyId,
    onSetQuickFixBusyId,
    onSetQuickFixNotice,
    onToggleExchange,
    onSyncExchange,
    onEditExchangeKey,
    onOpenExchangesSection,
  }) => {
    const scrollParentRef = useRef<HTMLDivElement | null>(null);
    const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
    const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);

    const toggleExpanded = useCallback((entryId: string) => {
      setExpandedIds((prev) => ({ ...prev, [entryId]: !prev[entryId] }));
    }, []);

    const formatPrettyPayload = useCallback((raw: string): string => {
      const trimmed = raw.trim();
      if (!trimmed) return '';
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
          return trimmed;
        }
      }
      return trimmed;
    }, []);

    const handleCopyDiagnostics = useCallback((entry: GroupedExchangeSyncLogEntry['entry']) => {
      const payload = JSON.stringify(
        {
          id: entry.id,
          occurredAt: entry.occurredAt,
          exchange: entry.exchange,
          label: entry.label,
          testnet: entry.testnet,
          severity: entry.severity,
          category: entry.category,
          source: entry.source,
          errorMessage: entry.errorMessage,
          httpStatus: entry.technicalDetails?.httpStatus ?? null,
          endpoint: entry.technicalDetails?.endpoint ?? null,
          rawApiResponse: entry.technicalDetails?.rawApiResponse ?? null,
          stackTrace: entry.technicalDetails?.stackTrace ?? null,
        },
        null,
        2
      );
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(payload).then(() => {
          setCopiedEntryId(entry.id);
          window.setTimeout(() => {
            setCopiedEntryId((curr) => (curr === entry.id ? null : curr));
          }, 1800);
        });
      }
    }, []);

    const exchangeKeyMap = useMemo(() => {
      const map = new Map<string, ExchangeKeyRecord>();
      for (const k of exchangeKeys) {
        map.set(k.id, k);
      }
      return map;
    }, [exchangeKeys]);

    const rowVirtualizer = useVirtualizer({
      count: groups.length,
      getScrollElement: () => scrollParentRef.current,
      getItemKey: (index) => groups[index]?.entry.id ?? index,
      estimateSize: (index) => {
        const item = groups[index];
        if (!item) return 80;
        const base = item.entry.severity === 'success' ? 92 : 162;
        return expandedIds[item.entry.id] ? base + 240 : base;
      },
      overscan: 6,
      gap: 8,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
      <div
        ref={scrollParentRef}
        className="max-h-[28rem] overflow-y-auto pr-1 overscroll-contain [scrollbar-gutter:stable]"
        role="list"
        aria-label="Список логов синхронизации бирж"
      >
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualRow) => {
            const group = groups[virtualRow.index];
            if (!group) return null;

            const { entry, repeatCount, firstOccurredAtMs, lastOccurredAtMs, entryIds } = group;
            const sevBase = SEVERITY_STYLES[entry.severity];
            const badgeText = sevBase.badgeText ?? CATEGORY_META[entry.category].label;
            const timeLabel = new Date(lastOccurredAtMs).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            const firstTimeLabel = new Date(firstOccurredAtMs).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            const linkedKey = exchangeKeyMap.get(entry.keyId) ?? null;
            const quickFix = getExchangeSyncQuickFix(entry, nowTickMs);
            const knownErrorMatch = detectKnownExchangeSyncError(entry);
            const isQuickFixBusy = quickFixBusyId !== null && entryIds.includes(quickFixBusyId);
            const isExpanded = Boolean(expandedIds[entry.id]);
            const tech = entry.technicalDetails;
            const isCopied = copiedEntryId === entry.id;

            const handleQuickRetry = async () => {
              if (!linkedKey) return;
              onSetQuickFixBusyId(entry.id);
              onSetQuickFixNotice(null);
              try {
                if (!linkedKey.enabled) {
                  await onToggleExchange(linkedKey.id, true);
                }
                const res = await onSyncExchange(linkedKey, true);
                onSetQuickFixNotice({
                  tone: 'ok',
                  text: `Синхронизация ${linkedKey.exchange.toUpperCase()} (${linkedKey.label}) выполнена: $${res.totalBalanceUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
                });
              } catch (err) {
                onSetQuickFixNotice({
                  tone: 'err',
                  text: err instanceof Error ? err.message : 'Повторная синхронизация завершилась ошибкой.',
                });
              } finally {
                onSetQuickFixBusyId(null);
              }
            };

            const handleQuickPause = async () => {
              if (!linkedKey || !linkedKey.enabled) return;
              onSetQuickFixBusyId(entry.id);
              onSetQuickFixNotice(null);
              try {
                await onToggleExchange(linkedKey.id, false);
                onSetQuickFixNotice({
                  tone: 'ok',
                  text: `Ключ «${linkedKey.label}» поставлен на паузу на время охлаждения лимитов API.`,
                });
              } catch (err) {
                onSetQuickFixNotice({
                  tone: 'err',
                  text: err instanceof Error ? err.message : 'Не удалось поставить ключ на паузу.',
                });
              } finally {
                onSetQuickFixBusyId(null);
              }
            };

            const renderQuickFixActionButton = (
              actionType: ExchangeSyncQuickFixActionType,
              label: string,
              isSecondary = false
            ) => {
              if (!linkedKey) return null;
              if (actionType === 'pause_key') {
                if (!linkedKey.enabled) return null;
                return (
                  <button
                    key={`${entry.id}-pause`}
                    type="button"
                    disabled={isQuickFixBusy}
                    onClick={() => void handleQuickPause()}
                    className="min-h-[30px] px-2.5 rounded-md border border-amber-500/35 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-[11px] font-semibold text-amber-200 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <PauseCircle className="w-3 h-3" />
                    <span>{label}</span>
                  </button>
                );
              }
              if (actionType === 'edit_key') {
                return (
                  <button
                    key={`${entry.id}-edit`}
                    type="button"
                    disabled={isQuickFixBusy}
                    onClick={() => onEditExchangeKey(linkedKey)}
                    className="min-h-[30px] px-2.5 rounded-md border border-emerald-400/45 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-[11px] font-semibold text-emerald-100 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <KeyRound className="w-3 h-3" />
                    <span>{knownErrorMatch ? 'Устранить' : label}</span>
                  </button>
                );
              }
              return (
                <button
                  key={`${entry.id}-retry`}
                  type="button"
                  disabled={isQuickFixBusy}
                  onClick={() => void handleQuickRetry()}
                  className={`min-h-[30px] px-2.5 rounded-md border disabled:opacity-50 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    isSecondary
                      ? 'border-white/15 bg-white/5 hover:bg-white/10 text-slate-200'
                      : 'border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${isQuickFixBusy ? 'animate-spin' : ''}`} />
                  <span>
                    {isQuickFixBusy
                      ? 'Синхр...'
                      : !linkedKey.enabled
                        ? 'Включить и повторить'
                        : label}
                  </span>
                </button>
              );
            };

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                role="listitem"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className={`rounded-lg border px-3 py-2.5 space-y-2 text-xs ${sevBase.rowClass}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sevBase.dotClass}`} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white break-words">
                            {entry.errorMessage}
                          </span>
                          {knownErrorMatch && (
                            <span
                              title={knownErrorMatch.reason}
                              className="inline-flex items-center rounded-md border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200 shrink-0"
                            >
                              Код {knownErrorMatch.code}
                            </span>
                          )}
                          {repeatCount > 1 && (
                            <span
                              title={`Повторялось подряд в фоновом режиме: ${repeatCount}`}
                              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums shrink-0 ${
                                entry.severity === 'critical'
                                  ? 'border-rose-500/45 bg-rose-500/25 text-rose-100'
                                  : 'border-orange-500/45 bg-orange-500/25 text-orange-100'
                              }`}
                            >
                              <Repeat className="w-3 h-3" />
                              <span>×{repeatCount}</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-slate-300/80 font-mono text-[11px] flex flex-wrap items-center gap-2">
                          <span>
                            {entry.exchange.toUpperCase()} · {entry.label}
                            {entry.testnet ? ' (Testnet)' : ''}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {entry.source === 'manual' ? 'Ручная проверка' : 'Фоновое обновление'}
                          </span>
                          {repeatCount > 1 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-200">
                                Повторов подряд: {repeatCount}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono tabular-nums">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${sevBase.badgeClass}`}>
                        {badgeText}
                      </span>
                      <div className="mt-1 text-slate-400 text-[11px]">{timeLabel}</div>
                      {repeatCount > 1 && firstOccurredAtMs < lastOccurredAtMs && (
                        <div className="text-[10px] text-slate-400/80">
                          с {firstTimeLabel}
                        </div>
                      )}
                    </div>
                  </div>

                  {quickFix && (
                    <div className="ml-4.5 rounded-lg border border-white/10 bg-[#0B0F17]/75 px-3 py-2 flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                        <div className="text-[11px] text-slate-300 leading-relaxed">
                          <span className="font-semibold text-cyan-300">
                            Быстрое решение · {quickFix.title}:{' '}
                          </span>
                          <span>{quickFix.suggestion}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {quickFix.cooldownLabel && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-200 tabular-nums">
                            <Clock className="w-3 h-3" />
                            <span>{quickFix.cooldownLabel}</span>
                          </span>
                        )}

                        {linkedKey ? (
                          <>
                            {renderQuickFixActionButton(
                              quickFix.recommendedAction,
                              quickFix.actionLabel
                            )}
                            {quickFix.secondaryAction &&
                              quickFix.secondaryActionLabel &&
                              renderQuickFixActionButton(
                                quickFix.secondaryAction,
                                quickFix.secondaryActionLabel,
                                true
                              )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={onOpenExchangesSection}
                            className="min-h-[30px] px-2.5 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-[11px] font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Link2 className="w-3 h-3 text-emerald-400" />
                            <span>Ключ удалён — добавить новый</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Кнопка раскрытия расширенной технической информации и быстрое устранение по известному коду */}
                  <div className="ml-4.5 flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(entry.id)}
                        aria-expanded={isExpanded}
                        className="min-h-[26px] px-2 rounded-md border border-white/10 bg-black/30 hover:bg-black/50 text-[11px] font-mono text-slate-300 hover:text-white inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Terminal className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{isExpanded ? 'Скрыть тех. детали' : 'Тех. детали'}</span>
                        {tech?.httpStatus && (
                          <span className="rounded bg-white/10 px-1 py-0.2 text-[10px] text-amber-200">
                            HTTP {tech.httpStatus}
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        )}
                      </button>

                      {knownErrorMatch?.canResolveByEditingKey &&
                        (!quickFix || quickFix.recommendedAction !== 'edit_key') && (
                          <button
                            type="button"
                            onClick={() =>
                              linkedKey ? onEditExchangeKey(linkedKey) : onOpenExchangesSection()
                            }
                            title={knownErrorMatch.reason}
                            className="min-h-[26px] px-2.5 rounded-md border border-emerald-400/45 bg-emerald-500/20 hover:bg-emerald-500/30 text-[11px] font-semibold text-emerald-100 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>Устранить</span>
                          </button>
                        )}
                    </div>

                    {isExpanded && (
                      <button
                        type="button"
                        onClick={() => handleCopyDiagnostics(entry)}
                        className="min-h-[26px] px-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-mono text-emerald-200 inline-flex items-center gap-1.5 transition-colors"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Скопировано</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Копировать JSON</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="ml-4.5 rounded-lg border border-white/10 bg-[#05080E] p-3 space-y-2.5 font-mono text-[11px]">
                      {/* Метаданные события */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10.5px] text-slate-400 pb-2 border-b border-white/8">
                        <div className="truncate">
                          <span className="text-slate-500">ID: </span>
                          <span className="text-slate-200">{entry.id}</span>
                        </div>
                        <div className="truncate">
                          <span className="text-slate-500">ISO: </span>
                          <span className="text-slate-200">{entry.occurredAt}</span>
                        </div>
                        <div className="truncate">
                          <span className="text-slate-500">Категория: </span>
                          <span className="text-slate-200">{entry.category}</span>
                          {tech?.httpStatus ? (
                            <span className="ml-1.5 text-amber-300">· HTTP {tech.httpStatus}</span>
                          ) : null}
                        </div>
                        <div className="truncate">
                          <span className="text-slate-500">Эндпоинт: </span>
                          <span className="text-cyan-300">
                            {tech?.endpoint ?? (entry.severity === 'success' ? 'POST /api/exchanges/sync' : '—')}
                          </span>
                        </div>
                      </div>

                      {/* Raw API Response */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                          <span>Raw API Response</span>
                          <span className="text-slate-500 normal-case">секреты скрыты</span>
                        </div>
                        {tech?.rawApiResponse ? (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/8 bg-black/60 p-2 text-[10.5px] leading-relaxed text-emerald-200/90">
                            {formatPrettyPayload(tech.rawApiResponse)}
                          </pre>
                        ) : (
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/8 bg-black/50 p-2 text-[10.5px] leading-relaxed text-slate-400">
                            {JSON.stringify(
                              {
                                exchange: entry.exchange,
                                testnet: entry.testnet,
                                severity: entry.severity,
                                category: entry.category,
                                message: entry.errorMessage,
                                ...(entry.balanceUsdt !== undefined ? { balanceUsdt: entry.balanceUsdt } : {}),
                                ...(entry.assetsCount !== undefined ? { assetsCount: entry.assetsCount } : {}),
                                note: 'Сырой ответ API биржи не был передан для этой записи.',
                              },
                              null,
                              2
                            )}
                          </pre>
                        )}
                      </div>

                      {/* Stack Trace */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Stack Trace
                        </div>
                        {tech?.stackTrace ? (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/8 bg-black/60 p-2 text-[10.5px] leading-relaxed text-rose-200/85">
                            {tech.stackTrace}
                          </pre>
                        ) : (
                          <div className="rounded-md border border-white/6 bg-black/40 px-2.5 py-2 text-[10.5px] text-slate-500">
                            {entry.severity === 'success'
                              ? 'Синхронизация завершилась успешно — stack trace не формируется.'
                              : 'Stack trace недоступен для этой записи (запись создана ранее или без трассировки стека).'}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

VirtualizedExchangeSyncLogList.displayName = 'VirtualizedExchangeSyncLogList';

export interface VirtualizedAuditLogListProps {
  auditLogs: SecurityAuditLog[];
}

/**
 * Виртуализированный журнал аудита безопасности (@tanstack/react-virtual).
 * Поддерживает плавную прокрутку полного журнала без ограничения в 20 записей и без перегрузки DOM.
 */
export const VirtualizedAuditLogList: React.FC<VirtualizedAuditLogListProps> = React.memo(
  ({ auditLogs }) => {
    const scrollParentRef = useRef<HTMLDivElement | null>(null);

    const rowVirtualizer = useVirtualizer({
      count: auditLogs.length,
      getScrollElement: () => scrollParentRef.current,
      getItemKey: (index) => auditLogs[index]?.id ?? index,
      estimateSize: () => 68,
      overscan: 8,
      gap: 6,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
      <div
        ref={scrollParentRef}
        className="max-h-[28rem] overflow-y-auto pr-1 overscroll-contain [scrollbar-gutter:stable]"
        role="list"
        aria-label="Журнал аудита безопасности"
      >
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualRow) => {
            const log = auditLogs[virtualRow.index];
            if (!log) return null;

            const ts = (log.createdAt as { seconds?: number } | undefined)?.seconds;
            const dateLabel = ts
              ? new Date(ts * 1000).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Сейчас';
            const statusStyle =
              log.status === 'SUCCESS'
                ? AUDIT_STATUS_STYLES.SUCCESS
                : log.status === 'BLOCKED'
                  ? AUDIT_STATUS_STYLES.BLOCKED
                  : AUDIT_STATUS_STYLES.WARNING;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                role="listitem"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={`rounded-lg border px-3 py-2.5 flex items-start justify-between gap-4 text-xs ${statusStyle.row}`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${statusStyle.dot}`} />
                    <div className="min-w-0">
                      <div className="font-medium text-white break-words">{log.description}</div>
                      <div className="mt-0.5 text-slate-300/80 font-mono break-all sm:break-normal">
                        {log.eventType} · {log.deviceLabel}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono tabular-nums">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusStyle.badge}`}>
                      {log.status}
                    </span>
                    <div className="mt-1 text-slate-400">{dateLabel}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

VirtualizedAuditLogList.displayName = 'VirtualizedAuditLogList';

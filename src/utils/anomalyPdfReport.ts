import {
  buildHourlyErrorIntensitySeries,
  detectKnownExchangeSyncError,
  sanitizeTechnicalString,
  type ExchangeSyncErrorLogEntry,
  type HourlyErrorIntensityPoint,
  type HourlyErrorIntensitySeries,
} from '../lib/exchangeSyncErrorLog';
import type { ExchangeId } from '../types/domain';

export interface AnomalyPeriodItem {
  hourStartMs: number;
  label: string;
  fullRangeLabel: string;
  errors: number;
  critical: number;
  warning: number;
  excessOverThreshold: number;
}

export interface ExchangeBreakdownItem {
  exchange: ExchangeId;
  errors: number;
  critical: number;
  warning: number;
  sharePct: number;
}

export interface IncidentSummaryItem {
  occurredAtLabel: string;
  exchange: string;
  label: string;
  severity: 'critical' | 'warning';
  knownCode: string | null;
  message: string;
}

export interface AnomalyPdfReportData {
  generatedAtIso: string;
  generatedAtLabel: string;
  periodLabel: string;
  windowHours: 24 | 72;
  exchangeScopeLabel: string;
  series: HourlyErrorIntensitySeries;
  anomalies: AnomalyPeriodItem[];
  exchangeBreakdown: ExchangeBreakdownItem[];
  recentIncidents: IncidentSummaryItem[];
}

export function buildAnomalyPdfReportData(
  logs: ExchangeSyncErrorLogEntry[],
  options?: {
    windowHours?: 24 | 72;
    exchangeFilter?: 'all' | ExchangeId;
    nowMs?: number;
  }
): AnomalyPdfReportData {
  const windowHours: 24 | 72 = options?.windowHours === 72 ? 72 : 24;
  const exchangeFilter = options?.exchangeFilter ?? 'all';
  const nowMs = options?.nowMs ?? Date.now();
  const HOUR_MS = 60 * 60 * 1000;

  const scopedLogs =
    exchangeFilter === 'all'
      ? logs
      : logs.filter((entry) => entry.exchange === exchangeFilter);

  const series = buildHourlyErrorIntensitySeries(scopedLogs, { windowHours, nowMs });

  const startMs = series.points[0]?.hourStartMs ?? nowMs - windowHours * HOUR_MS;
  const formatDateTime = (ms: number) =>
    new Date(ms).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const anomalies: AnomalyPeriodItem[] = series.points
    .filter((p) => p.isAnomaly)
    .sort((a, b) => b.errors - a.errors || b.hourStartMs - a.hourStartMs)
    .map((p) => ({
      hourStartMs: p.hourStartMs,
      label: p.label,
      fullRangeLabel: p.fullRangeLabel,
      errors: p.errors,
      critical: p.critical,
      warning: p.warning,
      excessOverThreshold: Math.max(0, p.errors - series.anomalyThreshold),
    }));

  const windowStartCutoff = startMs;
  const windowErrorLogs = scopedLogs.filter(
    (entry) =>
      entry.severity !== 'success' &&
      entry.occurredAtMs >= windowStartCutoff &&
      entry.occurredAtMs <= nowMs + HOUR_MS
  );

  const exMap = new Map<ExchangeId, { errors: number; critical: number; warning: number }>();
  for (const entry of windowErrorLogs) {
    const cur = exMap.get(entry.exchange) ?? { errors: 0, critical: 0, warning: 0 };
    cur.errors += 1;
    if (entry.severity === 'critical') cur.critical += 1;
    else cur.warning += 1;
    exMap.set(entry.exchange, cur);
  }

  const totalWindowErrors = windowErrorLogs.length;
  const exchangeBreakdown: ExchangeBreakdownItem[] = Array.from(exMap.entries())
    .map(([exchange, stats]) => ({
      exchange,
      errors: stats.errors,
      critical: stats.critical,
      warning: stats.warning,
      sharePct: totalWindowErrors > 0 ? Number(((stats.errors / totalWindowErrors) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.errors - a.errors || b.critical - a.critical);

  const recentIncidents: IncidentSummaryItem[] = windowErrorLogs
    .slice()
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
    .slice(0, 8)
    .map((entry) => {
      const known = detectKnownExchangeSyncError(entry);
      const safeMsg = sanitizeTechnicalString(entry.errorMessage, 140) ?? 'Ошибка синхронизации';
      return {
        occurredAtLabel: new Date(entry.occurredAtMs).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        exchange: entry.exchange.toUpperCase(),
        label: entry.label,
        severity: entry.severity === 'critical' ? 'critical' : 'warning',
        knownCode: known?.code ?? null,
        message: safeMsg,
      };
    });

  return {
    generatedAtIso: new Date(nowMs).toISOString(),
    generatedAtLabel: formatDateTime(nowMs),
    periodLabel: `${formatDateTime(startMs)} — ${formatDateTime(nowMs)}`,
    windowHours,
    exchangeScopeLabel: exchangeFilter === 'all' ? 'Все биржи' : exchangeFilter.toUpperCase(),
    series,
    anomalies,
    exchangeBreakdown,
    recentIncidents,
  };
}

export interface PdfJpegPageInput {
  jpegBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/**
 * Генерирует спецификационно-совместимый PDF 1.4 (A4 Portrait) из массива JPEG-страниц
 * без внешних зависимостей и без использования window.open / print.
 */
export function buildPdfFromJpegPages(pages: PdfJpegPageInput[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error('Cannot build PDF without pages');
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushStr = (str: string) => {
    pushBytes(encoder.encode(str));
  };

  // A4 in PDF points (72 DPI)
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;

  // Object numbering:
  // 1 = Catalog
  // 2 = Pages
  // For each page i (0..N-1):
  //   pageObjId    = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId   = 5 + i * 3
  const totalObjects = 2 + pages.length * 3;
  const offsets: number[] = new Array(totalObjects + 1).fill(0);

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1: Catalog
  offsets[1] = offset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  const kidsRefs = pages.map((_, idx) => `${3 + idx * 3} 0 R`).join(' ');
  offsets[2] = offset;
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, idx) => {
    const pageObjId = 3 + idx * 3;
    const contentObjId = 4 + idx * 3;
    const imageObjId = 5 + idx * 3;

    const contentStream = `q\n${PAGE_W.toFixed(2)} 0 0 ${PAGE_H.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);

    // Page object
    offsets[pageObjId] = offset;
    pushStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Content stream object
    offsets[contentObjId] = offset;
    pushStr(`${contentObjId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    pushStr('endstream\nendobj\n');

    // JPEG Image XObject
    offsets[imageObjId] = offset;
    pushStr(
      `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(page.widthPx))} ` +
        `/Height ${Math.max(1, Math.round(page.heightPx))} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`
    );
    pushBytes(page.jpegBytes);
    pushStr('\nendstream\nendobj\n');
  });

  // Cross-reference table
  const xrefOffset = offset;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= totalObjects; i += 1) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const result = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 3 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  points: HourlyErrorIntensityPoint[],
  anomalyThreshold: number,
  x: number,
  y: number,
  w: number,
  h: number
) {
  // Chart container
  drawRoundedRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#0B1220';
  ctx.fill();
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const padL = 56;
  const padR = 24;
  const padT = 32;
  const padB = 46;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const plotX = x + padL;
  const plotY = y + padT;

  const maxErr = Math.max(
    anomalyThreshold + 1,
    3,
    ...points.map((p) => p.errors)
  );

  // Horizontal grid + Y labels
  const ySteps = Math.min(5, maxErr);
  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= ySteps; i += 1) {
    const val = Math.round((maxErr * i) / ySteps);
    const py = plotY + plotH - (val / maxErr) * plotH;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, py);
    ctx.lineTo(plotX + plotW, py);
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.fillText(String(val), plotX - 10, py);
  }

  // Anomaly threshold line
  const threshY = plotY + plotH - (anomalyThreshold / maxErr) * plotH;
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(plotX, threshY);
  ctx.lineTo(plotX + plotW, threshY);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#FCD34D';
  ctx.textAlign = 'right';
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Порог аномалии: ≥${anomalyThreshold} ош./ч`, plotX + plotW - 4, threshY - 12);

  if (points.length === 0) return;

  const getX = (idx: number) =>
    points.length === 1 ? plotX + plotW / 2 : plotX + (idx / (points.length - 1)) * plotW;
  const getY = (val: number) => plotY + plotH - (val / maxErr) * plotH;

  // Critical errors dashed line
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#FB923C';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, idx) => {
    const px = getX(idx);
    const py = getY(p.critical);
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.restore();

  // Total errors primary line
  ctx.strokeStyle = '#F43F5E';
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((p, idx) => {
    const px = getX(idx);
    const py = getY(p.errors);
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Markers for non-zero and anomaly points
  points.forEach((p, idx) => {
    const px = getX(idx);
    const py = getY(p.errors);
    if (p.isAnomaly) {
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(244, 63, 94, 0.28)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#F43F5E';
      ctx.fill();
      ctx.strokeStyle = '#FFE4E6';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (p.errors > 0) {
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FB7185';
      ctx.fill();
    }
  });

  // X-axis tick labels
  const step = Math.max(1, Math.floor(points.length / 8));
  ctx.fillStyle = '#94A3B8';
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < points.length; i += step) {
    const px = getX(i);
    ctx.fillText(points[i].label, px, plotY + plotH + 12);
  }
  const lastIdx = points.length - 1;
  if (lastIdx % step !== 0) {
    ctx.textAlign = 'right';
    ctx.fillText(points[lastIdx].label, plotX + plotW, plotY + plotH + 12);
  }
}

function renderAnomalyReportCanvas(data: AnomalyPdfReportData): HTMLCanvasElement {
  const WIDTH = 1240;
  const HEIGHT = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable');
  }

  // Clean light background for crisp readability & printing
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const M = 56;
  const contentW = WIDTH - M * 2;

  // Top VERNIER Brand Header Banner
  const headerH = 168;
  const grad = ctx.createLinearGradient(0, 0, WIDTH, headerH);
  grad.addColorStop(0, '#070D16');
  grad.addColorStop(1, '#0F2922');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, headerH);

  // Emerald accent strip
  ctx.fillStyle = '#10B981';
  ctx.fillRect(0, headerH - 5, WIDTH, 5);

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#34D399';
  ctx.font = 'bold 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('VERNIER SECURITY CENTER · ОТЧЁТ ПО АНОМАЛИЯМ СИНХРОНИЗАЦИИ', M, 30);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 34px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('Сводка интенсивности ошибок API бирж', M, 60);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(
    `Период: ${data.periodLabel} (${data.windowHours}ч)  ·  Охват: ${data.exchangeScopeLabel}`,
    M,
    112
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#94A3B8';
  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`Сформировано: ${data.generatedAtLabel}`, WIDTH - M, 32);

  // Status badge in header
  const hasAnomalies = data.series.anomalyHoursCount > 0;
  const badgeText = hasAnomalies
    ? `АНОМАЛИЙ: ${data.series.anomalyHoursCount} Ч`
    : 'АКТИВНОСТЬ В НОРМЕ';
  const badgeW = 216;
  drawRoundedRect(ctx, WIDTH - M - badgeW, 74, badgeW, 38, 10);
  ctx.fillStyle = hasAnomalies ? 'rgba(244, 63, 94, 0.24)' : 'rgba(16, 185, 129, 0.24)';
  ctx.fill();
  ctx.strokeStyle = hasAnomalies ? '#FB7185' : '#34D399';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = hasAnomalies ? '#FFE4E6' : '#D1FAE5';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(badgeText, WIDTH - M - badgeW / 2, 93);

  let y = headerH + 34;

  // 4 KPI Cards
  const kpiGap = 18;
  const kpiW = (contentW - kpiGap * 3) / 4;
  const kpiH = 104;
  const kpis = [
    {
      label: `Ошибок за ${data.windowHours}ч`,
      value: String(data.series.totalErrors),
      sub: `Крит: ${data.series.criticalErrors} · Пред: ${data.series.warningErrors}`,
      accent: '#0F172A',
    },
    {
      label: 'Пик интенсивности',
      value: data.series.peakErrorsPerHour > 0 ? `${data.series.peakErrorsPerHour} ош./ч` : '0 ош./ч',
      sub: data.series.peakHourLabel !== '—' ? `Час: ${data.series.peakHourLabel}` : 'Всплесков нет',
      accent: data.series.peakErrorsPerHour >= data.series.anomalyThreshold ? '#E11D48' : '#0F172A',
    },
    {
      label: 'Средняя частота',
      value: `${data.series.avgErrorsPerHour.toFixed(2)} / ч`,
      sub: `Порог аномалии: ≥${data.series.anomalyThreshold} ош./ч`,
      accent: '#0F172A',
    },
    {
      label: 'Часов с аномалией',
      value: String(data.series.anomalyHoursCount),
      sub: hasAnomalies ? 'Требуется проверка ключей' : 'Отклонений не выявлено',
      accent: hasAnomalies ? '#E11D48' : '#059669',
    },
  ];

  kpis.forEach((kpi, idx) => {
    const kx = M + idx * (kpiW + kpiGap);
    drawRoundedRect(ctx, kx, y, kpiW, kpiH, 12);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#64748B';
    ctx.font = '600 14px system-ui, -apple-system, sans-serif';
    ctx.fillText(kpi.label, kx + 18, y + 16);

    ctx.fillStyle = kpi.accent;
    ctx.font = 'bold 28px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(kpi.value, kx + 18, y + 40);

    ctx.fillStyle = '#64748B';
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.fillText(truncateText(ctx, kpi.sub, kpiW - 36), kx + 18, y + 76);
  });

  y += kpiH + 30;

  // Line chart section
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
  ctx.fillText('1. Линейный график интенсивности ошибок (ошибки/час)', M, y);
  y += 32;

  drawLineChart(ctx, data.series.points, data.series.anomalyThreshold, M, y, contentW, 290);
  y += 308;

  // Two-column middle section: Anomalous periods (left) + Affected exchanges (right)
  const colGap = 24;
  const leftW = Math.round(contentW * 0.58);
  const rightW = contentW - leftW - colGap;
  const midH = 310;

  // Left box: Anomaly periods
  drawRoundedRect(ctx, M, y, leftW, midH, 12);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.fillText('2. Зафиксированные периоды аномалий', M + 20, y + 18);

  if (data.anomalies.length === 0) {
    ctx.fillStyle = '#059669';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Аномальных всплесков за выбранный период не обнаружено.',
      M + 20,
      y + 62
    );
    ctx.fillStyle = '#64748B';
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `Ни один часовой интервал не достиг порога ≥${data.series.anomalyThreshold} ош./ч.`,
      M + 20,
      y + 90
    );
  } else {
    // Table header
    const ty = y + 54;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(M + 16, ty, leftW - 32, 30);
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.fillText('Интервал', M + 26, ty + 8);
    ctx.fillText('Всего', M + 280, ty + 8);
    ctx.fillText('Крит.', M + 360, ty + 8);
    ctx.fillText('Пред.', M + 440, ty + 8);
    ctx.fillText('Превыш.', M + 520, ty + 8);

    data.anomalies.slice(0, 6).forEach((item, idx) => {
      const ry = ty + 38 + idx * 34;
      if (idx % 2 === 1) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(M + 16, ry - 4, leftW - 32, 30);
      }
      ctx.fillStyle = '#0F172A';
      ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(item.fullRangeLabel, M + 26, ry + 3);
      ctx.fillStyle = '#E11D48';
      ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`${item.errors}/ч`, M + 280, ry + 3);
      ctx.fillStyle = '#BE123C';
      ctx.fillText(String(item.critical), M + 360, ry + 3);
      ctx.fillStyle = '#D97706';
      ctx.fillText(String(item.warning), M + 440, ry + 3);
      ctx.fillStyle = '#475569';
      ctx.fillText(`+${item.excessOverThreshold}`, M + 520, ry + 3);
    });
  }

  // Right box: Exchange breakdown
  const rx = M + leftW + colGap;
  drawRoundedRect(ctx, rx, y, rightW, midH, 12);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.fillText('3. Распределение по биржам', rx + 20, y + 18);

  if (data.exchangeBreakdown.length === 0) {
    ctx.fillStyle = '#059669';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.fillText('Ошибок по биржам не зафиксировано.', rx + 20, y + 62);
  } else {
    data.exchangeBreakdown.slice(0, 4).forEach((ex, idx) => {
      const ey = y + 62 + idx * 58;
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`#${idx + 1} ${ex.exchange.toUpperCase()}`, rx + 20, ey);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#E11D48';
      ctx.fillText(`${ex.errors} (${ex.sharePct.toFixed(0)}%)`, rx + rightW - 20, ey);

      // Bar
      const barW = rightW - 40;
      drawRoundedRect(ctx, rx + 20, ey + 24, barW, 10, 5);
      ctx.fillStyle = '#E2E8F0';
      ctx.fill();

      drawRoundedRect(ctx, rx + 20, ey + 24, Math.max(12, (barW * ex.sharePct) / 100), 10, 5);
      ctx.fillStyle = ex.critical >= ex.warning ? '#F43F5E' : '#F59E0B';
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748B';
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.fillText(`Критических: ${ex.critical} · Предупреждений: ${ex.warning}`, rx + 20, ey + 38);
    });
  }

  y += midH + 28;

  // Bottom section: Recent critical/warning incidents
  const tableH = HEIGHT - y - 78;
  drawRoundedRect(ctx, M, y, contentW, tableH, 12);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.fillText('4. Последние инциденты синхронизации за период', M + 20, y + 18);

  if (data.recentIncidents.length === 0) {
    ctx.fillStyle = '#64748B';
    ctx.font = '15px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'За выбранный период критических ошибок и предупреждений синхронизации не зафиксировано.',
      M + 20,
      y + 62
    );
  } else {
    const hdrY = y + 54;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(M + 16, hdrY, contentW - 32, 32);
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.fillText('Время', M + 26, hdrY + 9);
    ctx.fillText('Биржа / Ключ', M + 150, hdrY + 9);
    ctx.fillText('Уровень / Код', M + 360, hdrY + 9);
    ctx.fillText('Описание (секреты скрыты)', M + 520, hdrY + 9);

    data.recentIncidents.slice(0, 8).forEach((inc, idx) => {
      const ry = hdrY + 42 + idx * 42;
      if (ry + 30 > y + tableH - 12) return;
      if (idx % 2 === 1) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(M + 16, ry - 6, contentW - 32, 36);
      }

      ctx.fillStyle = '#334155';
      ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(inc.occurredAtLabel, M + 26, ry + 4);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
      ctx.fillText(truncateText(ctx, `${inc.exchange} · ${inc.label}`, 195), M + 150, ry + 4);

      ctx.fillStyle = inc.severity === 'critical' ? '#E11D48' : '#D97706';
      ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      const sevText = inc.knownCode
        ? `${inc.severity === 'critical' ? 'КРИТ' : 'ПРЕД'} · ${inc.knownCode}`
        : inc.severity === 'critical'
          ? 'КРИТИЧ.'
          : 'ПРЕДУПР.';
      ctx.fillText(sevText, M + 360, ry + 4);

      ctx.fillStyle = '#334155';
      ctx.font = '13px system-ui, -apple-system, sans-serif';
      ctx.fillText(truncateText(ctx, inc.message, contentW - 548), M + 520, ry + 4);
    });
  }

  // Footer
  ctx.fillStyle = '#94A3B8';
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    'VERNIER Security Center · Локальный отчёт сформирован в браузере, API-секреты исключены.',
    M,
    HEIGHT - 42
  );
  ctx.textAlign = 'right';
  ctx.fillText('Стр. 1 / 1', WIDTH - M, HEIGHT - 42);

  return canvas;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function downloadAnomalyPdfReport(
  logs: ExchangeSyncErrorLogEntry[],
  options?: {
    windowHours?: 24 | 72;
    exchangeFilter?: 'all' | ExchangeId;
    nowMs?: number;
  }
): { filename: string; report: AnomalyPdfReportData } {
  const report = buildAnomalyPdfReportData(logs, options);
  const canvas = renderAnomalyReportCanvas(report);
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const jpegBytes = dataUrlToUint8Array(jpegDataUrl);

  const pdfBytes = buildPdfFromJpegPages([
    {
      jpegBytes,
      widthPx: canvas.width,
      heightPx: canvas.height,
    },
  ]);

  const dateStamp = new Date(options?.nowMs ?? Date.now())
    .toISOString()
    .slice(0, 10);
  const scopeSlug =
    options?.exchangeFilter && options.exchangeFilter !== 'all'
      ? `-${options.exchangeFilter}`
      : '';
  const filename = `vernier-anomalies-${report.windowHours}h${scopeSlug}-${dateStamp}.pdf`;

  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);

  return { filename, report };
}

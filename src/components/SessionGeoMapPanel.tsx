import React, { useMemo, useState } from 'react';
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldCountriesTopo from 'world-atlas/countries-110m.json';
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  LogOut,
  MapPin,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { UserSessionRecord } from '../types/domain';

interface SessionGeoMapPanelProps {
  sessions: UserSessionRecord[];
  currentSessionId: string;
  onRevokeSession: (sessionId: string) => Promise<void>;
  onToggleSuspicious: (sessionId: string, nextSuspicious: boolean) => Promise<void>;
}

type MapFilter = 'all' | 'active' | 'suspicious';
type SessionRiskTier = 'current' | 'suspicious' | 'trusted' | 'revoked';

interface ProjectedSessionPoint {
  session: UserSessionRecord;
  lon: number;
  lat: number;
  x: number;
  y: number;
  distanceKm: number | null;
  tier: SessionRiskTier;
  reasonLabel: string;
}

const SVG_WIDTH = 960;
const SVG_HEIGHT = 450;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatSessionDate(ts: unknown): string {
  const sec = (ts as { seconds?: number } | undefined)?.seconds;
  if (!sec) return 'Только что';
  return new Date(sec * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SessionGeoMapPanel: React.FC<SessionGeoMapPanelProps> = ({
  sessions,
  currentSessionId,
  onRevokeSession,
  onToggleSuspicious,
}) => {
  const [filter, setFilter] = useState<MapFilter>('all');
  const [zoom, setZoom] = useState<number>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Build Natural Earth SVG map paths once
  const { projection, spherePath, graticulePath, countryPaths } = useMemo(() => {
    const topo = worldCountriesTopo as unknown as Topology;
    const countriesGeo = feature(
      topo,
      (topo.objects as { countries: Parameters<typeof feature>[1] }).countries
    );
    const proj = geoNaturalEarth1().fitExtent(
      [
        [14, 14],
        [SVG_WIDTH - 14, SVG_HEIGHT - 14],
      ],
      { type: 'Sphere' }
    );
    const pathGen = geoPath(proj);
    const features =
      countriesGeo.type === 'FeatureCollection' ? countriesGeo.features : [countriesGeo];

    return {
      projection: proj,
      spherePath: pathGen({ type: 'Sphere' }) || '',
      graticulePath: pathGen(geoGraticule10()) || '',
      countryPaths: features.map((f, index) => ({
        id: String((f as { id?: string | number }).id ?? index),
        d: pathGen(f) || '',
      })),
    };
  }, []);

  // Evaluate geolocation & risk tier for every session
  const allPoints = useMemo<ProjectedSessionPoint[]>(() => {
    const current = sessions.find((s) => s.id === currentSessionId);
    const currentHasGeo =
      typeof current?.latitude === 'number' && typeof current?.longitude === 'number';

    const geoSessions = sessions.filter(
      (s) => typeof s.latitude === 'number' && typeof s.longitude === 'number'
    );

    // Track duplicate coordinates so overlapping pins fan out cleanly
    const coordCounts = new Map<string, number>();

    return geoSessions.map((session) => {
      const lat = Number(session.latitude);
      const lon = Number(session.longitude);
      const projected = projection([lon, lat]) || [SVG_WIDTH / 2, SVG_HEIGHT / 2];

      const coordKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      const dupIdx = coordCounts.get(coordKey) ?? 0;
      coordCounts.set(coordKey, dupIdx + 1);
      const angle = dupIdx * 2.1;
      const offsetRadius = dupIdx === 0 ? 0 : Math.min(14, 5 + dupIdx * 3);
      const x = projected[0] + Math.cos(angle) * offsetRadius;
      const y = projected[1] + Math.sin(angle) * offsetRadius;

      const distanceKm =
        currentHasGeo && current
          ? haversineKm(Number(current.latitude), Number(current.longitude), lat, lon)
          : null;

      const isCurrent = session.id === currentSessionId;
      const isRevoked = session.status === 'revoked';
      const isCountryMismatch =
        Boolean(current?.countryCode) &&
        Boolean(session.countryCode) &&
        current?.countryCode !== 'XX' &&
        session.countryCode !== 'XX' &&
        session.countryCode !== current?.countryCode;
      const isRemoteDistance = distanceKm !== null && distanceKm > 800;
      const flaggedOrAnomalous = Boolean(session.isSuspicious) || isCountryMismatch || isRemoteDistance;

      let tier: SessionRiskTier = 'trusted';
      let reasonLabel = 'Подтверждённый регион';

      if (isCurrent) {
        tier = 'current';
        reasonLabel = 'Текущая сессия';
      } else if (isRevoked) {
        tier = session.isSuspicious ? 'suspicious' : 'revoked';
        reasonLabel = session.isSuspicious ? 'Завершён как подозрительный' : 'Сессия завершена';
      } else if (flaggedOrAnomalous) {
        tier = 'suspicious';
        if (session.isSuspicious) {
          reasonLabel = 'Отмечен как подозрительный';
        } else if (isCountryMismatch) {
          reasonLabel = 'Вход из другой страны';
        } else {
          reasonLabel = `Удалённый вход (~${distanceKm?.toLocaleString('ru-RU')} км)`;
        }
      }

      return {
        session,
        lon,
        lat,
        x,
        y,
        distanceKm,
        tier,
        reasonLabel,
      };
    });
  }, [sessions, currentSessionId, projection]);

  const filteredPoints = useMemo(() => {
    if (filter === 'active') return allPoints.filter((p) => p.session.status === 'active');
    if (filter === 'suspicious') return allPoints.filter((p) => p.tier === 'suspicious');
    return allPoints;
  }, [allPoints, filter]);

  const suspiciousCount = useMemo(
    () => allPoints.filter((p) => p.tier === 'suspicious').length,
    [allPoints]
  );
  const uniqueRegionsCount = useMemo(() => {
    const set = new Set(
      allPoints.map((p) => `${p.session.city || ''}:${p.session.countryCode || ''}`)
    );
    return set.size;
  }, [allPoints]);

  const currentPoint = useMemo(
    () => allPoints.find((p) => p.tier === 'current') ?? null,
    [allPoints]
  );

  // Selected session defaults to first suspicious active session, or current session
  const selectedPoint = useMemo(() => {
    if (selectedId) {
      const found = allPoints.find((p) => p.session.id === selectedId);
      if (found) return found;
    }
    return (
      allPoints.find((p) => p.tier === 'suspicious' && p.session.status === 'active') ??
      currentPoint ??
      allPoints[0] ??
      null
    );
  }, [allPoints, selectedId, currentPoint]);

  // Great-circle connection arcs from current session to other distinct points
  const connectionArcs = useMemo(() => {
    if (!currentPoint) return [];
    const pathGen = geoPath(projection);
    return filteredPoints
      .filter((p) => p.session.id !== currentPoint.session.id && (p.distanceKm ?? 0) > 20)
      .map((p) => ({
        id: p.session.id,
        tier: p.tier,
        d:
          pathGen({
            type: 'LineString',
            coordinates: [
              [currentPoint.lon, currentPoint.lat],
              [p.lon, p.lat],
            ],
          }) || '',
      }));
  }, [currentPoint, filteredPoints, projection]);

  // Center zoom transform around selected point
  const mapTransformStyle = useMemo(() => {
    if (zoom <= 1 || !selectedPoint) {
      return { transform: 'scale(1)', transformOrigin: '50% 50%' };
    }
    const ox = Math.min(90, Math.max(10, (selectedPoint.x / SVG_WIDTH) * 100));
    const oy = Math.min(90, Math.max(10, (selectedPoint.y / SVG_HEIGHT) * 100));
    return {
      transform: `scale(${zoom})`,
      transformOrigin: `${ox.toFixed(1)}% ${oy.toFixed(1)}%`,
    };
  }, [zoom, selectedPoint]);

  const handleRevoke = async (sessionId: string) => {
    setBusyId(sessionId);
    setActionMessage(null);
    try {
      await onRevokeSession(sessionId);
      setActionMessage('Сессия завершена и помечена для контроля.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleSuspicious = async (session: UserSessionRecord) => {
    setBusyId(session.id);
    setActionMessage(null);
    const next = !session.isSuspicious;
    try {
      await onToggleSuspicious(session.id, next);
      setActionMessage(
        next ? 'Вход помечен как подозрительный.' : 'Вход подтверждён как доверенный.'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <motion.section
      id="sec-geo-map-panel"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="session-geo-map-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 sm:p-6 space-y-5"
    >
      {/* Header & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400 tabular-nums">
            Геолокация IP-адресов · Локаций: {uniqueRegionsCount}
            <span aria-hidden="true" className="mx-1.5 text-slate-600">
              ·
            </span>
            <span className={suspiciousCount > 0 ? 'text-rose-400 font-medium' : 'text-emerald-400'}>
              {suspiciousCount > 0
                ? `Аномалий или удалённых входов: ${suspiciousCount}`
                : 'Подозрительных входов не обнаружено'}
            </span>
          </div>
          <h2 id="session-geo-map-heading" className="mt-1 text-lg font-semibold text-white flex items-center gap-2">
            <Globe2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>Карта входов и IP-геолокация сессий</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-2xl">
            Визуальный контроль географии последних входов в терминал. Входы из других стран или на расстоянии свыше 800 км от текущей сессии выделяются красным маркером.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            {(
              [
                { id: 'all', label: 'Все входы' },
                { id: 'active', label: 'Активные' },
                { id: 'suspicious', label: `Подозрительные (${suspiciousCount})` },
              ] as const
            ).map((tab) => {
              const isActive = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`relative min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="geo-map-filter-tab"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className={`absolute inset-0 rounded-lg ${
                        tab.id === 'suspicious' && suspiciousCount > 0 ? 'bg-rose-600' : 'bg-emerald-600'
                      }`}
                    />
                  )}
                  <span className="relative z-10 tabular-nums">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Interactive World Map Canvas */}
      <div className="relative rounded-xl border border-white/8 bg-[#0B0F17] overflow-hidden">
        {/* Zoom Controls Overlay */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-xl border border-white/10 bg-[#111827]/90 backdrop-blur-sm p-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3.2, Number((z + 0.55).toFixed(2))))}
            aria-label="Приблизить карту"
            className="min-h-[32px] min-w-[32px] rounded-lg text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.55).toFixed(2))))}
            aria-label="Отдалить карту"
            className="min-h-[32px] min-w-[32px] rounded-lg text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          {zoom > 1 && (
            <button
              type="button"
              onClick={() => setZoom(1)}
              aria-label="Сбросить масштаб"
              className="min-h-[32px] min-w-[32px] rounded-lg text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Map Legend (clean unboxed text) */}
        <div className="absolute bottom-3 left-3 z-10 hidden sm:flex items-center gap-4 text-[11px] text-slate-300 bg-[#0B0F17]/85 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/8">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>Текущая</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>Другая в регионе</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>Подозрительная / Удалённая</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
            <span>Завершена</span>
          </span>
        </div>

        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label="Карта мира с геолокацией IP-адресов последних сессий"
          className="w-full h-auto block select-none transition-transform duration-300 ease-out"
          style={mapTransformStyle}
        >
          {/* Ocean Sphere */}
          <path d={spherePath} fill="#090D16" stroke="rgba(148,163,184,0.14)" strokeWidth={1} />

          {/* Latitude / Longitude Graticule */}
          <path d={graticulePath} fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth={0.6} />

          {/* Natural Earth Countries */}
          <g>
            {countryPaths.map((c) => (
              <path
                key={c.id}
                d={c.d}
                fill="#192336"
                stroke="rgba(148,163,184,0.22)"
                strokeWidth={0.55}
              />
            ))}
          </g>

          {/* Great-circle arcs from current session to other sessions */}
          <g>
            {connectionArcs.map((arc) => (
              <path
                key={arc.id}
                d={arc.d}
                fill="none"
                stroke={arc.tier === 'suspicious' ? 'rgba(244,63,94,0.65)' : 'rgba(245,158,11,0.4)'}
                strokeWidth={arc.tier === 'suspicious' ? 1.6 : 1.1}
                strokeDasharray="4 4"
              />
            ))}
          </g>

          {/* Session IP Markers */}
          <g>
            {filteredPoints.map((pt) => {
              const isSelected = selectedPoint?.session.id === pt.session.id;
              const fill =
                pt.tier === 'current'
                  ? '#10B981'
                  : pt.tier === 'suspicious'
                    ? '#F43F5E'
                    : pt.tier === 'trusted'
                      ? '#F59E0B'
                      : '#64748B';

              return (
                <g
                  key={pt.session.id}
                  transform={`translate(${pt.x}, ${pt.y})`}
                  onClick={() => setSelectedId(pt.session.id)}
                  className="cursor-pointer"
                >
                  {/* Telemetry halo for active current or suspicious session */}
                  {(pt.tier === 'current' || pt.tier === 'suspicious') && (
                    <circle
                      r={isSelected ? 14 : 11}
                      fill={fill}
                      fillOpacity={0.18}
                      stroke={fill}
                      strokeOpacity={0.55}
                      strokeWidth={1}
                    />
                  )}
                  {isSelected && (
                    <circle
                      r={9}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={1.6}
                    />
                  )}
                  <circle
                    r={isSelected ? 5.5 : 4.5}
                    fill={fill}
                    stroke="#0B0F17"
                    strokeWidth={1.5}
                  />
                  <title>
                    {`${pt.session.city || 'Неизвестно'}, ${pt.session.country || ''} (${pt.session.ipAddress || 'IP'}) — ${pt.reasonLabel}`}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Selected Pin Inspector */}
      {selectedPoint ? (
        <div className="pt-2 border-t border-white/8 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {selectedPoint.tier === 'suspicious' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : selectedPoint.tier === 'current' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span
                  className={`font-semibold ${
                    selectedPoint.tier === 'suspicious'
                      ? 'text-rose-300'
                      : selectedPoint.tier === 'current'
                        ? 'text-emerald-400'
                        : selectedPoint.tier === 'trusted'
                          ? 'text-amber-300'
                          : 'text-slate-400'
                  }`}
                >
                  {selectedPoint.reasonLabel}
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="font-mono tabular-nums text-white font-semibold">
                  IP: {selectedPoint.session.ipAddress || 'Не определён'}
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="text-slate-300">
                  {selectedPoint.session.city || 'Неизвестный город'}, {selectedPoint.session.country || '—'} ({selectedPoint.session.countryCode || 'XX'})
                </span>
              </div>

              <div className="text-xs text-slate-400 font-mono tabular-nums">
                {selectedPoint.session.deviceLabel} ({selectedPoint.session.browserLabel})
                <span aria-hidden="true" className="mx-1.5 text-slate-600">
                  ·
                </span>
                Координаты: {selectedPoint.lat.toFixed(2)}, {selectedPoint.lon.toFixed(2)}
                {selectedPoint.distanceKm !== null && (
                  <>
                    <span aria-hidden="true" className="mx-1.5 text-slate-600">
                      ·
                    </span>
                    Дистанция от вас: {selectedPoint.distanceKm.toLocaleString('ru-RU')} км
                  </>
                )}
              </div>
            </div>

            {selectedPoint.session.status === 'active' && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyId === selectedPoint.session.id}
                  onClick={() => void handleToggleSuspicious(selectedPoint.session)}
                  className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    selectedPoint.session.isSuspicious
                      ? 'border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-300'
                      : 'border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {selectedPoint.session.isSuspicious ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Подтвердить вход</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Отметить подозрительным</span>
                    </>
                  )}
                </button>

                {selectedPoint.session.id !== currentSessionId && (
                  <button
                    type="button"
                    disabled={busyId === selectedPoint.session.id}
                    onClick={() => void handleRevoke(selectedPoint.session.id)}
                    className="min-h-[38px] px-3 rounded-xl border border-rose-500/35 bg-rose-500/12 hover:bg-rose-500/20 text-xs font-semibold text-rose-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Завершить сессию</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {actionMessage && (
            <div className="text-xs text-emerald-300">{actionMessage}</div>
          )}
        </div>
      ) : (
        <div className="pt-2 border-t border-white/8 text-xs text-slate-400">
          По выбранному фильтру или текущим сессиям геолокация пока не зафиксирована.
        </div>
      )}

      {/* Chronological Geo-IP Session Table */}
      {filteredPoints.length > 0 && (
        <div className="pt-2 border-t border-white/8 divide-y divide-white/8">
          {filteredPoints.slice(0, 8).map((pt) => {
            const isSelected = selectedPoint?.session.id === pt.session.id;
            return (
              <button
                key={pt.session.id}
                type="button"
                onClick={() => {
                  setSelectedId(pt.session.id);
                  if (zoom === 1) setZoom(1.55);
                }}
                className={`w-full py-2.5 px-2 rounded-lg text-left flex flex-wrap items-center justify-between gap-3 text-xs transition-colors ${
                  isSelected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      pt.tier === 'current'
                        ? 'bg-emerald-400'
                        : pt.tier === 'suspicious'
                          ? 'bg-rose-500'
                          : pt.tier === 'trusted'
                            ? 'bg-amber-400'
                            : 'bg-slate-500'
                    }`}
                  />
                  <span className="font-mono tabular-nums text-white font-medium">
                    {pt.session.ipAddress || '—'}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <span className="text-slate-300 truncate">
                    {pt.session.city || 'Город не определён'}, {pt.session.country || '—'}
                  </span>
                </div>

                <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] shrink-0">
                  <span
                    className={
                      pt.tier === 'current'
                        ? 'text-emerald-400'
                        : pt.tier === 'suspicious'
                          ? 'text-rose-400'
                          : pt.tier === 'trusted'
                            ? 'text-amber-300'
                            : 'text-slate-500'
                    }
                  >
                    {pt.reasonLabel}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <span className="text-slate-400">{formatSessionDate(pt.session.lastLoginAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </motion.section>
  );
};

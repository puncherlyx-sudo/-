import React, { useId, useMemo } from 'react';

interface MiniSparklineProps {
  data?: number[];
  changePct?: number | null;
  width?: number;
  height?: number;
  showArea?: boolean;
  className?: string;
}

export const MiniSparkline: React.FC<MiniSparklineProps> = ({
  data,
  changePct = null,
  width = 68,
  height = 24,
  showArea = false,
  className = '',
}) => {
  const gradientId = useId().replace(/:/g, '');

  const geometry = useMemo(() => {
    if (!data || data.length < 2) return null;
    const valid = data.filter((v) => Number.isFinite(v));
    if (valid.length < 2) return null;

    let min = valid[0];
    let max = valid[0];
    for (let i = 1; i < valid.length; i++) {
      if (valid[i] < min) min = valid[i];
      if (valid[i] > max) max = valid[i];
    }

    const padX = 1.5;
    const padY = 2.5;
    const innerW = Math.max(4, width - padX * 2);
    const innerH = Math.max(4, height - padY * 2);
    const span = max - min;

    const coords = valid.map((val, idx) => {
      const x = padX + (idx / (valid.length - 1)) * innerW;
      const norm = span > 1e-12 ? (val - min) / span : 0.5;
      const y = padY + (1 - norm) * innerH;
      return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
    });

    const linePath = coords
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`)
      .join(' ');
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${linePath} L${last.x} ${height} L${first.x} ${height} Z`;

    const isPositive =
      changePct !== null && Number.isFinite(changePct)
        ? changePct >= 0
        : valid[valid.length - 1] >= valid[0];

    return {
      linePath,
      areaPath,
      lastX: last.x,
      lastY: last.y,
      isPositive,
    };
  }, [data, width, height, changePct]);

  if (!geometry) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={`shrink-0 ${className}`}
      >
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="rgba(148, 163, 184, 0.25)"
          strokeWidth={1.25}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const strokeColor = geometry.isPositive ? '#34D399' : '#FB7185';
  const fillStart = geometry.isPositive ? 'rgba(52, 211, 153, 0.26)' : 'rgba(251, 113, 133, 0.24)';
  const fillEnd = geometry.isPositive ? 'rgba(52, 211, 153, 0.0)' : 'rgba(251, 113, 133, 0.0)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={`shrink-0 overflow-visible ${className}`}
    >
      {showArea && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillStart} />
            <stop offset="100%" stopColor={fillEnd} />
          </linearGradient>
        </defs>
      )}
      {showArea && <path d={geometry.areaPath} fill={`url(#${gradientId})`} />}
      <path
        d={geometry.linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={geometry.lastX} cy={geometry.lastY} r={1.8} fill={strokeColor} />
    </svg>
  );
};

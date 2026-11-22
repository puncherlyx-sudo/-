import React from 'react';
import { motion } from 'motion/react';
import { NATIVE_SPRING, TERMINAL_EASE } from './MotionPrimitives';

const SKELETON_PULSE = {
  opacity: [0.4, 0.82, 0.4],
};

const SKELETON_TRANSITION = {
  duration: 1.4,
  repeat: Infinity,
  ease: 'easeInOut' as const,
};

interface SkeletonBlockProps {
  className?: string;
}

const SkeletonBlock: React.FC<SkeletonBlockProps> = ({ className = '' }) => (
  <motion.div
    aria-hidden="true"
    animate={SKELETON_PULSE}
    transition={SKELETON_TRANSITION}
    className={`rounded-md bg-white/[0.08] ${className}`}
  />
);

export const skeletonSwapVariants = {
  initial: { opacity: 0, y: 6, filter: 'blur(3px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      y: NATIVE_SPRING,
      opacity: { duration: 0.2, ease: TERMINAL_EASE },
      filter: { duration: 0.2, ease: TERMINAL_EASE },
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    filter: 'blur(2px)',
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] as const },
  },
};

export const AssetStripSkeleton: React.FC = () => (
  <div
    aria-busy="true"
    aria-label="Загрузка активов"
    className="w-full overflow-hidden pb-0.5"
  >
    <div className="flex items-center gap-2 h-[38px]">
      {Array.from({ length: 5 }).map((_, idx) => (
        <div
          key={idx}
          className="h-[38px] w-[286px] shrink-0 rounded-xl border border-white/8 bg-[#0B0F17] px-2.5 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-3.5 w-8" />
            <SkeletonBlock className="h-3.5 w-16" />
            <SkeletonBlock className="h-3 w-10" />
          </div>
          <div className="flex items-center gap-1.5">
            <SkeletonBlock className="h-5 w-5 rounded-lg" />
            <SkeletonBlock className="h-[28px] w-[78px] rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const PairsListSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <div
    aria-busy="true"
    aria-label="Загрузка списка пар"
    className="max-h-[360px] overflow-hidden"
  >
    {Array.from({ length: rows }).map((_, idx) => (
      <div
        key={idx}
        className="h-[60px] px-3 sm:px-4 border-b border-white/6 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <SkeletonBlock className="h-8 w-8 rounded-lg shrink-0" />
          <div className="space-y-1.5 flex-1 max-w-[140px]">
            <SkeletonBlock className="h-3.5 w-24" />
            <SkeletonBlock className="h-2.5 w-16" />
          </div>
          <div className="ml-auto space-y-1.5 flex flex-col items-end">
            <SkeletonBlock className="h-3.5 w-20" />
            <SkeletonBlock className="h-2.5 w-14" />
          </div>
        </div>
        <SkeletonBlock className="h-[36px] w-[96px] rounded-xl shrink-0" />
      </div>
    ))}
  </div>
);

export const OrderBookSkeleton: React.FC<{ viewMode: 'split' | 'bids' | 'asks' }> = ({
  viewMode,
}) => {
  const rowCount = viewMode === 'split' ? 8 : 10;
  return (
    <div aria-busy="true" aria-label="Загрузка стакана ордеров" className="space-y-4">
      {/* Imbalance Bar Skeleton */}
      <div className="space-y-2 rounded-xl bg-[#0B0F17] border border-white/8 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="h-3 w-28" />
          <SkeletonBlock className="h-3 w-24 hidden sm:block" />
          <SkeletonBlock className="h-3 w-28" />
        </div>
        <SkeletonBlock className="h-2 w-full rounded-full" />
      </div>

      {/* Depth Rows Skeleton */}
      <div
        className={`grid gap-4 ${viewMode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}
      >
        {viewMode !== 'asks' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 pb-1 border-b border-white/8">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
            {Array.from({ length: rowCount }).map((_, idx) => (
              <div
                key={`bid-sk-${idx}`}
                className="flex items-center justify-between px-2 py-1.5 h-[28px]"
              >
                <SkeletonBlock className="h-3.5 w-20" />
                <SkeletonBlock className="h-3.5 w-28" />
              </div>
            ))}
          </div>
        )}

        {viewMode !== 'bids' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 pb-1 border-b border-white/8">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
            {Array.from({ length: rowCount }).map((_, idx) => (
              <div
                key={`ask-sk-${idx}`}
                className="flex items-center justify-between px-2 py-1.5 h-[28px]"
              >
                <SkeletonBlock className="h-3.5 w-20" />
                <SkeletonBlock className="h-3.5 w-28" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const OscillatorsSkeleton: React.FC = () => (
  <div
    aria-busy="true"
    aria-label="Загрузка осцилляторов"
    className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4"
  >
    <div className="flex items-center justify-between">
      <SkeletonBlock className="h-4 w-56" />
      <SkeletonBlock className="h-3.5 w-10" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, idx) => (
        <div key={idx} className="rounded-xl bg-[#0B0F17] border border-white/8 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-4 w-10" />
          </div>
          <SkeletonBlock className="h-2 w-full rounded-full" />
          <SkeletonBlock className="h-3 w-40" />
        </div>
      ))}
    </div>
  </div>
);

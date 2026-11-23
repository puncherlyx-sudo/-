import React from 'react';
import { Loader2 } from 'lucide-react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { TERMINAL_EASE } from './MotionPrimitives';

interface ViewFallbackProps {
  /** Название загружаемой вкладки для контекстного индикатора. */
  tabLabel?: string;
}

const fallbackContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.16,
      ease: TERMINAL_EASE,
      staggerChildren: 0.055,
      delayChildren: 0.02,
    },
  },
};

const fallbackItemVariants: Variants = {
  hidden: { opacity: 0, y: 7 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: TERMINAL_EASE,
    },
  },
};

const fallbackTextVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      delay: 0.04,
      ease: TERMINAL_EASE,
    },
  },
};

const fallbackReducedVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.14, ease: TERMINAL_EASE },
  },
};

/** Индикатор загрузки и структурный скелетон с плавным каскадным появлением для Suspense. */
export const ViewFallback: React.FC<ViewFallbackProps> = ({ tabLabel }) => {
  const prefersReducedMotion = useReducedMotion();
  const statusText = tabLabel ? `Загрузка раздела «${tabLabel}»…` : 'Загрузка раздела…';
  const itemVariant = prefersReducedMotion ? fallbackReducedVariants : fallbackItemVariants;
  const textVariant = prefersReducedMotion ? fallbackReducedVariants : fallbackTextVariants;

  return (
    <motion.div
      variants={fallbackContainerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-3"
      role="status"
      aria-live="polite"
      aria-label={statusText}
    >
      {/* Контекстная панель прогресса переключения вкладки */}
      <motion.div
        variants={itemVariant}
        className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#111827]/95 px-4 py-3"
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-white/[0.04]"
        >
          {prefersReducedMotion ? (
            <div className="h-full w-1/2 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 opacity-75" />
          ) : (
            <motion.div
              className="h-full w-2/5 bg-gradient-to-r from-transparent via-emerald-400 to-cyan-300"
              initial={{ x: '-100%' }}
              animate={{ x: '260%' }}
              transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
            <motion.div variants={textVariant} className="min-w-0">
              <div className="text-xs font-semibold text-slate-100 truncate">{statusText}</div>
              <div className="text-[11px] text-slate-400 truncate">
                Подготовка графиков и модулей интерфейса
              </div>
            </motion.div>
          </div>
          <motion.span
            variants={textVariant}
            className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/80 shrink-0"
          >
            Загрузка
          </motion.span>
        </div>
      </motion.div>

      {/* Структурные скелетоны контента с плавным появлением и мягким переливом */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[0, 1, 2].map((idx) => (
          <motion.div
            key={idx}
            variants={itemVariant}
            className="relative h-24 overflow-hidden rounded-2xl border border-white/8 bg-[#111827]"
          >
            {!prefersReducedMotion && (
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: idx * 0.14,
                }}
              />
            )}
          </motion.div>
        ))}
      </div>

      <motion.div
        variants={itemVariant}
        className="relative h-52 overflow-hidden rounded-2xl border border-white/8 bg-[#111827]"
      >
        {!prefersReducedMotion && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
          />
        )}
      </motion.div>

      <motion.div
        variants={itemVariant}
        className="relative h-36 overflow-hidden rounded-2xl border border-white/8 bg-[#111827]"
      >
        {!prefersReducedMotion && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
          />
        )}
      </motion.div>
    </motion.div>
  );
};

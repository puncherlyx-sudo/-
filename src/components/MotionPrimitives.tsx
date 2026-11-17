import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';

export const TERMINAL_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Directional slide-in + subtle blur transition for top-level tab switching.
 * Animates only compositor-friendly transform, opacity, and filter properties.
 */
export const tabSlideBlurVariants: Variants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction * 28,
    y: 8,
    scale: 0.992,
    filter: 'blur(6px)',
  }),
  animate: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.28,
      ease: TERMINAL_EASE,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -20,
    y: -4,
    scale: 0.995,
    filter: 'blur(4px)',
    transition: {
      duration: 0.17,
      ease: [0.4, 0, 1, 1],
    },
  }),
};

const staggerDeckVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.02,
    },
  },
};

const revealBlockVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 12,
    filter: 'blur(4px)',
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.24,
      ease: TERMINAL_EASE,
    },
  },
};

interface MotionContainerProps {
  children: React.ReactNode;
  className?: string;
}

export const StaggerDeck: React.FC<MotionContainerProps> = ({ children, className = '' }) => (
  <motion.div
    variants={staggerDeckVariants}
    initial="hidden"
    animate="visible"
    className={className}
  >
    {children}
  </motion.div>
);

export const RevealBlock: React.FC<MotionContainerProps> = ({ children, className = '' }) => (
  <motion.div variants={revealBlockVariants} className={className}>
    {children}
  </motion.div>
);

export const InteractiveTile: React.FC<MotionContainerProps> = ({ children, className = '' }) => (
  <motion.div
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.985 }}
    transition={{ duration: 0.16, ease: TERMINAL_EASE }}
    className={className}
  >
    {children}
  </motion.div>
);

export interface SubSectionItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  meta?: string | number;
}

interface SubSectionTabsProps<T extends string> {
  items: ReadonlyArray<SubSectionItem<T>>;
  activeId: T;
  onChange: (id: T) => void;
  layoutId: string;
  ariaLabel?: string;
  accent?: 'emerald' | 'cyan' | 'amber';
}

export function SubSectionTabs<T extends string>({
  items,
  activeId,
  onChange,
  layoutId,
  ariaLabel = 'Разделы вкладки',
  accent = 'emerald',
}: SubSectionTabsProps<T>) {
  const activeBgClass =
    accent === 'cyan'
      ? 'bg-cyan-500/18 border border-cyan-400/40'
      : accent === 'amber'
        ? 'bg-amber-500/18 border border-amber-400/40'
        : 'bg-emerald-500/18 border border-emerald-400/40';

  const activeTextClass =
    accent === 'cyan'
      ? 'text-cyan-200'
      : accent === 'amber'
        ? 'text-amber-200'
        : 'text-emerald-200';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl border border-white/10 bg-[#0E1420]/95"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <motion.button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            whileTap={{ scale: 0.96 }}
            onClick={() => onChange(item.id)}
            className={`relative min-h-[38px] px-3 sm:px-3.5 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              isActive ? activeTextClass : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                className={`absolute inset-0 rounded-xl ${activeBgClass}`}
              />
            )}
            {item.icon && <span className="relative z-10 inline-flex shrink-0">{item.icon}</span>}
            <span className="relative z-10">{item.label}</span>
            {item.meta !== undefined && item.meta !== '' && (
              <span className="relative z-10 font-mono tabular-nums text-[11px] opacity-75">
                · {item.meta}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

interface SubSectionFrameProps {
  sectionKey: string;
  children: React.ReactNode;
  className?: string;
}

export const SubSectionFrame: React.FC<SubSectionFrameProps> = ({
  sectionKey,
  children,
  className = '',
}) => (
  <AnimatePresence mode="wait">
    <motion.div
      key={sectionKey}
      initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }}
      transition={{ duration: 0.18, ease: TERMINAL_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  </AnimatePresence>
);

interface WorkspaceShellProps<T extends string> {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  items: ReadonlyArray<SubSectionItem<T>>;
  activeId: T;
  onChange: (id: T) => void;
  layoutId: string;
  accent?: 'emerald' | 'cyan' | 'amber';
  sidebarTopSlot?: React.ReactNode;
  sidebarBottomSlot?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 2-column Desktop Sidebar + Mobile Visible 2-Column Button Grid.
 * Every feature inside a tab is immediately visible and 1-click reachable without scrolling down.
 */
export function WorkspaceShell<T extends string>({
  title,
  subtitle,
  icon,
  items,
  activeId,
  onChange,
  layoutId,
  accent = 'emerald',
  sidebarTopSlot,
  sidebarBottomSlot,
  children,
}: WorkspaceShellProps<T>) {
  const activeBorder =
    accent === 'cyan'
      ? 'border-cyan-400/40 bg-cyan-500/14 text-cyan-200'
      : accent === 'amber'
        ? 'border-amber-400/40 bg-amber-500/14 text-amber-200'
        : 'border-emerald-400/40 bg-emerald-500/14 text-emerald-200';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* Left Navigation Sidebar (Desktop) / Compact Quick Grid (Mobile) */}
      <aside className="lg:col-span-3 lg:sticky lg:top-20 rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/8">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">{title}</h2>
              {subtitle && <div className="text-[11px] text-slate-400 truncate">{subtitle}</div>}
            </div>
          </div>
        </div>

        {sidebarTopSlot && <div className="pb-2.5 border-b border-white/8">{sidebarTopSlot}</div>}

        {/* Mobile/Tablet: All buttons visible immediately in a compact 2-col grid */}
        <nav
          aria-label={`Разделы: ${title}`}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1.5"
        >
          {items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => onChange(item.id)}
                className={`relative min-h-[40px] px-2.5 sm:px-3 rounded-xl text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-white/5 lg:border-transparent'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId={layoutId}
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className={`absolute inset-0 rounded-xl border ${activeBorder}`}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2 min-w-0">
                  {item.icon && <span className="shrink-0 opacity-90">{item.icon}</span>}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.meta !== undefined && item.meta !== '' && (
                  <span className="relative z-10 font-mono tabular-nums text-[11px] opacity-75 shrink-0">
                    {item.meta}
                  </span>
                )}
              </motion.button>
            );
          })}
        </nav>

        {sidebarBottomSlot && (
          <div className="hidden lg:block pt-2.5 border-t border-white/8">{sidebarBottomSlot}</div>
        )}
      </aside>

      {/* Right Active Workspace Viewport */}
      <div className="lg:col-span-9 min-w-0">
        <SubSectionFrame sectionKey={activeId}>{children}</SubSectionFrame>
      </div>
    </div>
  );
}

/**
 * Подсвечивает значение зелёной/красной вспышкой, когда число растёт или падает.
 * Анимацию запускает смена key, поэтому повторные изменения подряд тоже заметны.
 */
export const FlashValue: React.FC<{
  value: number | null | undefined;
  className?: string;
  children: React.ReactNode;
}> = ({ value, className = '', children }) => {
  const previous = useRef(value);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (typeof value === 'number' && typeof before === 'number' && value !== before) {
      const dir = value > before ? 'up' : 'down';
      setFlash((prev) => ({ dir, n: (prev?.n ?? 0) + 1 }));
    }
  }, [value]);

  return (
    <span key={flash?.n ?? 0} className={`${className} ${flash ? `flash-${flash.dir}` : ''}`.trim()}>
      {children}
    </span>
  );
};

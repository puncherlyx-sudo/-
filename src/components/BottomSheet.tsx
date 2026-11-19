import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { triggerHaptic } from '../lib/securityDlp';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  /** Optional max-width class on desktop (default: sm:max-w-lg) */
  maxWidthClass?: string;
  /** Optional body padding override */
  bodyClassName?: string;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  subtitle,
  headerRight,
  children,
  maxWidthClass = 'sm:max-w-lg',
  bodyClassName = 'p-4',
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => {
              triggerHaptic(6);
              onClose();
            }}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Sheet Surface */}
          <motion.div
            initial={{ y: '100%', opacity: 0.8 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.85 }}
            className={`relative z-10 w-full ${maxWidthClass} max-h-[86dvh] flex flex-col rounded-t-3xl sm:rounded-2xl border-t sm:border border-emerald-500/25 bg-[var(--surface-1)] shadow-2xl shadow-black/75 overflow-hidden`}
          >
            {/* Mobile Drag Handle */}
            <div className="pt-2.5 pb-1 flex justify-center sm:hidden shrink-0">
              <span className="w-10 h-1 rounded-full bg-white/20" aria-hidden="true" />
            </div>

            {/* Sticky Sheet Header */}
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 bg-[var(--surface-1)]">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm sm:text-base font-bold text-white truncate">{title}</h3>
                {subtitle && (
                  <p className="mt-0.5 text-[11px] text-slate-400 truncate">{subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {headerRight}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(6);
                    onClose();
                  }}
                  aria-label="Закрыть панель"
                  className="min-h-[38px] min-w-[38px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white inline-flex items-center justify-center transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Body with gentle content entrance/exit */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`overflow-y-auto overscroll-contain flex-1 pb-safe ${bodyClassName}`}
            >
              {children}
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

interface BottomSheetListProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Animated list container for BottomSheet items using Framer Motion AnimatePresence.
 */
export const BottomSheetList: React.FC<BottomSheetListProps> = ({ children, className = '' }) => (
  <div className={className}>
    <AnimatePresence mode="popLayout" initial={false}>
      {children}
    </AnimatePresence>
  </div>
);

interface BottomSheetItemProps {
  children: React.ReactNode;
  index?: number;
  className?: string;
}

/**
 * Animated BottomSheet item with smooth Framer Motion entry, exit, and staggered fluidity.
 */
export const BottomSheetItem: React.FC<BottomSheetItemProps> = ({
  children,
  index = 0,
  className = '',
}) => (
  <motion.div
    layout="position"
    initial={{ opacity: 0, y: 8, scale: 0.985 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -6, scale: 0.975 }}
    transition={{
      duration: 0.2,
      delay: Math.min(index * 0.022, 0.16),
      ease: [0.22, 1, 0.36, 1],
    }}
    className={className}
  >
    {children}
  </motion.div>
);


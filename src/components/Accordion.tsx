import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { TERMINAL_EASE } from './MotionPrimitives';

export interface AccordionEntry {
  id: string;
  title: string;
  meta?: string;
  badge?: string;
  content: React.ReactNode;
}

interface AccordionProps {
  items: AccordionEntry[];
  /** Позволяет одновременно открывать несколько пунктов (по умолчанию false — открыт один). */
  allowMultiple?: boolean;
  /** Изначально открытый id (или массив id). */
  defaultOpenIds?: string[];
  /** Управляемый список открытых id (опционально). */
  openIds?: string[];
  onToggle?: (id: string, nextOpen: boolean) => void;
  /** Компактные отступы для виджетов. */
  compact?: boolean;
  className?: string;
}

/**
 * Доступный и плавный компонент Accordion с анимацией раскрытия и поддержкой prefers-reduced-motion.
 */
export const Accordion: React.FC<AccordionProps> = ({
  items,
  allowMultiple = false,
  defaultOpenIds = [],
  openIds: controlledOpenIds,
  onToggle,
  compact = false,
  className = '',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [internalOpenIds, setInternalOpenIds] = useState<string[]>(defaultOpenIds);
  const activeIds = controlledOpenIds ?? internalOpenIds;

  const handleItemToggle = (id: string) => {
    const isCurrentlyOpen = activeIds.includes(id);
    const nextOpen = !isCurrentlyOpen;

    if (controlledOpenIds === undefined) {
      setInternalOpenIds((prev) => {
        if (isCurrentlyOpen) return prev.filter((item) => item !== id);
        return allowMultiple ? [...prev, id] : [id];
      });
    }
    onToggle?.(id, nextOpen);
  };

  return (
    <div className={`divide-y divide-white/8 border-t border-white/8 ${className}`.trim()}>
      {items.map((item, idx) => {
        const isOpen = activeIds.includes(item.id);
        const triggerId = `accordion-trigger-${item.id}`;
        const panelId = `accordion-panel-${item.id}`;

        return (
          <div key={item.id} className={compact ? 'py-0.5' : 'py-1'}>
            <button
              id={triggerId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => handleItemToggle(item.id)}
              className={`w-full ${
                compact ? 'min-h-[42px] py-2.5' : 'min-h-[48px] py-3'
              } text-left flex items-start justify-between gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg transition-colors`}
            >
              <div className="min-w-0 space-y-0.5">
                {(item.badge || item.meta) && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-400 tabular-nums">
                    <span className="font-mono text-emerald-400">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    {item.badge && <span className="text-slate-300 font-medium">{item.badge}</span>}
                    {item.badge && item.meta && (
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                    )}
                    {item.meta && <span className="text-slate-500 font-mono">{item.meta}</span>}
                  </div>
                )}
                <div
                  className={`${
                    compact ? 'text-xs sm:text-[13px]' : 'text-sm'
                  } font-medium leading-snug transition-colors ${
                    isOpen ? 'text-white' : 'text-slate-200 group-hover:text-white'
                  }`}
                >
                  {item.title}
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                  isOpen ? 'rotate-180 text-emerald-400' : 'group-hover:text-slate-200'
                }`}
              />
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={triggerId}
                  initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: TERMINAL_EASE }}
                  className="overflow-hidden"
                >
                  <div
                    className={`${
                      compact ? 'pb-3 pr-4 text-xs' : 'pb-4 pr-6 text-xs sm:text-sm'
                    } text-slate-300 leading-relaxed`}
                  >
                    {item.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};

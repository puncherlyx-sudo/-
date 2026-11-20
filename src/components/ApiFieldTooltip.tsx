import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, ShieldCheck, X } from 'lucide-react';
import { triggerHaptic } from '../lib/securityDlp';

interface ApiFieldTooltipProps {
  title: string;
  body: string;
  badge?: string;
}

/**
 * Compact tap-friendly interactive tooltip button next to API key inputs.
 * Works cleanly on 360px–430px mobile touchscreens and desktop without overflowing viewport.
 */
export const ApiFieldTooltip: React.FC<ApiFieldTooltipProps> = ({
  title,
  body,
  badge = 'Read-Only · Без вывода',
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={`Подсказка: ${title}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          triggerHaptic(6);
          setOpen((v) => !v);
        }}
        className={`w-5 h-5 rounded-full inline-flex items-center justify-center transition-colors ${
          open
            ? 'bg-emerald-500/25 text-emerald-300'
            : 'text-slate-400 hover:text-emerald-300 hover:bg-white/8'
        }`}
      >
        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
      </button>

      {open && (
        <div
          id={panelId}
          role="tooltip"
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 z-50 w-[min(280px,82vw)] rounded-xl border border-emerald-500/35 bg-[#080D14] p-3 shadow-2xl shadow-black/80 text-left space-y-1.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-[11px] font-semibold text-white leading-snug">{title}</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть подсказку"
              className="text-slate-400 hover:text-white p-0.5 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">{body}</p>
          <div className="pt-1 border-t border-white/8 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300">
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>{badge}</span>
          </div>
        </div>
      )}
    </div>
  );
};

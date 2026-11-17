import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TERMINAL_EASE } from './MotionPrimitives';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Плавно «набегающее» число. При fromZero первый показ считает от нуля, далее от прошлого значения. */
export const AnimatedNumber: React.FC<{
  value: number;
  format: (n: number) => string;
  duration?: number;
  fromZero?: boolean;
  className?: string;
}> = ({ value, format, duration = 750, fromZero = false, className }) => {
  const [display, setDisplay] = useState(fromZero ? 0 : value);
  const fromRef = useRef(fromZero ? 0 : value);

  useEffect(() => {
    const from = fromRef.current;
    if (prefersReducedMotion() || from === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      fromRef.current = current;
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
};

/** Короткая фирменная заставка при первом открытии за сессию. */
export const SplashIntro: React.FC<{ imageSrc: string }> = ({ imageSrc }) => {
  const [visible, setVisible] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      if (window.sessionStorage.getItem('aegis_splash_seen') === '1') return false;
      if (prefersReducedMotion()) return false;
      if (new URLSearchParams(window.location.search).has('widget')) return false;
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!visible) return;
    try {
      window.sessionStorage.setItem('aegis_splash_seen', '1');
    } catch {
      // хранилище недоступно: заставка просто покажется снова
    }
    const timer = window.setTimeout(() => setVisible(false), 1300);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, filter: 'blur(8px)' }}
          transition={{ duration: 0.45, ease: TERMINAL_EASE }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0B0F17] pointer-events-none"
          aria-hidden="true"
        >
          <motion.img
            src={imageSrc}
            alt=""
            initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: TERMINAL_EASE }}
            className="w-24 h-24 rounded-3xl object-cover shadow-[0_0_60px_-8px_rgba(16,185,129,0.55)]"
          />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5, ease: TERMINAL_EASE }}
            className="mt-5 font-display text-2xl font-bold text-white tracking-tight"
          >
            AegisQuant
          </motion.div>
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.35, duration: 0.8, ease: TERMINAL_EASE }}
            className="mt-4 h-0.5 w-28 origin-left rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

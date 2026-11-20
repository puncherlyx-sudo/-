import { useEffect, useState } from 'react';

/**
 * Дебаунсит быстро меняющееся значение (поиск 250 мс, ползунки 150 мс),
 * чтобы исключить лаги и лишние тяжёлые пересчёты при вводе на мобильных устройствах.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const id = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

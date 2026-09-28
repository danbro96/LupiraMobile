import { useEffect, useRef, useState } from 'react';

/**
 * Re-reads `read` every `intervalMs` (or every animation frame when omitted) and re-renders only when the
 * result changes by `Object.is` — the bridge from worklet `Synchronizable`s to React state.
 */
export function usePolledValue<T>(read: () => T, intervalMs?: number): T {
  const [value, setValue] = useState(read);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    const tick = () => {
      const next = readRef.current();
      setValue(() => next);
    };
    if (intervalMs != null) {
      const id = setInterval(tick, intervalMs);
      return () => clearInterval(id);
    }
    let raf = requestAnimationFrame(function loop() {
      tick();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [intervalMs]);

  return value;
}

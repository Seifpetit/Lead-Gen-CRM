import { useEffect, useRef, useState } from 'react';

/**
 * The value, but changing at most once every `ms`: the first change shows at once, later ones
 * wait their turn and only the newest is kept. For text a screen reader announces, so a fast
 * run does not talk over itself.
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef(shown);
  current.current = shown;
  useEffect(() => {
    // The value already shown is not a change, so it does not use up the wait.
    if (Object.is(value, current.current)) return;
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer.current);
  }, [value, ms]);
  return shown;
}

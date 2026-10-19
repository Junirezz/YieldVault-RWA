import { useState, useEffect } from 'react';

/**
 * A hook that delays the onset of a true `isLoading` state.
 * Useful for preventing loading skeletons from flashing on screen
 * when a network request resolves very quickly (e.g., < 100ms).
 * 
 * @param isLoading The actual loading state from the data fetching library/hook
 * @param delayMs The time to wait before setting the delayed loading state to true
 * @returns boolean representing the delayed loading state
 */
export function useDelayedLoading(isLoading: boolean, delayMs: number = 100): boolean {
  const [delayedLoading, setDelayedLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setDelayedLoading(true);
    }, delayMs);

    return () => {
      clearTimeout(timeoutId);
      setDelayedLoading(false);
    };
  }, [isLoading, delayMs]);

  // Mask the stale flag while not loading so consumers clear their skeleton
  // immediately instead of waiting for a microtask.
  return isLoading && delayedLoading;
}

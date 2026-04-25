import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVaultSummary } from "../lib/vaultApi";
import { queryKeys } from "../lib/queryClient";

const POLL_INTERVAL_MS = 15_000;
const STALE_THRESHOLD_MS = 60_000;
const ANIMATION_DURATION_MS = 500;

/**
 * Polls vault metrics every 15 s and returns an animated TVL value.
 * Exposes `isStale` when the last successful fetch is older than 60 s.
 */
export function useTvlTicker() {
  const { data, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.vault.summary(),
    queryFn: getVaultSummary,
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const targetTvl = data?.tvl ?? 0;

  // Animated display value
  const [displayTvl, setDisplayTvl] = useState(targetTvl);
  const animFrameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(targetTvl);

  useEffect(() => {
    if (targetTvl === 0) return;

    const from = fromRef.current;
    const to = targetTvl;
    if (from === to) return;

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
    }
    startRef.current = null;

    const step = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayTvl(from + (to - from) * eased);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [targetTvl]);

  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const check = () => {
      if (dataUpdatedAt === 0) return;
      setIsStale(Date.now() - dataUpdatedAt > STALE_THRESHOLD_MS);
    };
    check();
    const id = window.setInterval(check, 5_000);
    return () => window.clearInterval(id);
  }, [dataUpdatedAt]);

  return { displayTvl, isStale };
}

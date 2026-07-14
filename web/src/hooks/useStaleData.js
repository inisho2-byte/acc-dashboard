import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Tracks staleness of data based on last fetch timestamp.
 *
 * @param {number|null} lastFetchTime - Unix timestamp (ms) of last successful fetch, or null if never fetched
 * @param {number} threshold - Seconds before data is considered stale (default 60)
 * @returns {{ isStale: boolean, isVeryStale: boolean, secondsAgo: number, label: string }}
 */
export function useStaleData(lastFetchTime, threshold = 60) {
  const [now, setNow] = useState(Date.now());
  const rafRef = useRef(null);
  const intervalRef = useRef(null);

  // Tick every second when a fetchTime is provided
  useEffect(() => {
    if (lastFetchTime == null) return;

    // Use setInterval for reliable 1s ticks (cheaper than rAF for this use case)
    intervalRef.current = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [lastFetchTime]);

  const secondsAgo = lastFetchTime != null ? Math.floor((now - lastFetchTime) / 1000) : -1;
  const isStale = secondsAgo > threshold;
  const isVeryStale = secondsAgo > threshold * 5;

  const label = useCallback(() => {
    if (lastFetchTime == null) return "Never updated";
    if (secondsAgo < 0) return "Never updated";
    if (isVeryStale) return "STALE";
    if (secondsAgo < 60) return `Updated ${secondsAgo}s ago`;
    const mins = Math.floor(secondsAgo / 60);
    if (mins < 60) return `Updated ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `Updated ${hrs}h ago`;
  }, [lastFetchTime, secondsAgo, isVeryStale])();

  return { isStale, isVeryStale, secondsAgo, label };
}
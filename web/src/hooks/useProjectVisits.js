import { useState, useCallback } from "react";

const STORAGE_KEY = "acc-project-visits";

/**
 * Hook to track per-project last visit timestamps in localStorage.
 *
 * Returns { lastVisits, markVisited, getDelta }
 * - lastVisits: Record<slug, timestamp>
 * - markVisited(slug): sets lastVisits[slug] = Date.now()
 * - getDelta(slug, updated): "new" | "updated" | null
 */
export function useProjectVisits() {
  const [lastVisits, setLastVisits] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const markVisited = useCallback((slug) => {
    setLastVisits(prev => {
      const next = { ...prev, [slug]: Date.now() };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage may be full or unavailable — best effort
      }
      return next;
    });
  }, []);

  const getDelta = useCallback((slug, updated) => {
    const visited = lastVisits[slug];
    if (!visited) return "new";
    if (!updated) return null;
    try {
      const updatedDate = new Date(updated);
      if (isNaN(updatedDate.getTime())) return null;
      return updatedDate.getTime() > visited ? "updated" : null;
    } catch {
      return null;
    }
  }, [lastVisits]);

  return { lastVisits, markVisited, getDelta };
}
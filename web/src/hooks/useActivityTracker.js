import { useState, useEffect, useCallback } from "react";

const BUCKETS = 20;
const BUCKET_MS = 10000; // 10 seconds per bucket

export function useActivityTracker() {
  const [history, setHistory] = useState({});

  // Rotate buckets every BUCKET_MS
  useEffect(() => {
    const interval = setInterval(() => {
      setHistory((prev) => {
        const next = {};
        for (const [id, arr] of Object.entries(prev)) {
          next[id] = [...arr.slice(1), 0];
        }
        return next;
      });
    }, BUCKET_MS);
    return () => clearInterval(interval);
  }, []);

  const record = useCallback((agentId) => {
    if (!agentId) return;
    setHistory((prev) => {
      const arr = prev[agentId] ? [...prev[agentId]] : new Array(BUCKETS).fill(0);
      arr[arr.length - 1] = (arr[arr.length - 1] || 0) + 1;
      return { ...prev, [agentId]: arr };
    });
  }, []);

  return { history, record };
}

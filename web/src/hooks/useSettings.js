import { useState, useCallback } from "react";

const STORAGE_KEY = "acc-settings-v1";

const DEFAULTS = {
  refreshInterval: 15,  // A3: minimum 15s (5s/10s options disabled for rate limit compliance)
  theme: "dark",
  adminToken: "",
  apiToken: "",  // A2: Bearer token for API auth
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return [settings, update];
}

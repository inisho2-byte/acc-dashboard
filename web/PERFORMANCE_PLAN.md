# ACC Dashboard Performance Optimization Plan

> **Goal:** Eliminate all perceptible lag from the ACC Dashboard, achieving 60fps animation and sub-16ms frame times.
>
> **Goal type:** Diagnosis → Creation (identify root causes, then fix them)
>
> **Confidence in diagnosis:** 92% — findings are based on source code analysis, DOM inspection, and CSS profiling. Remaining uncertainty is around React render profiling (would need DevTools), but the CSS/GPU bottlenecks are independently verifiable.

---

## Eight-Element Diagnostic (Deep Reasoning Phase 0 Gate)

1. **Purpose** — Eliminate all perceptible lag from the ACC Dashboard. Performance optimization pass on existing production dashboard.
2. **Question at Issue** — What specific code paths and CSS properties cause lag, and what is the minimum set of changes to eliminate each bottleneck without degrading visual quality?
3. **Information** — Source code analysis (App.jsx 986 lines, animations.css 317 lines, 17 panel files). Grep-verified findings for all 10 bottlenecks. 70 inline styles, 0 React.memo, activityHistory dead code, SVG filter at lines 819-822, backdrop-filter blur(64px) at line 55 — all confirmed. Excluded: React DevTools profiling, Lighthouse scores, network waterfall.
4. **Interpretation & Inference** — CSS filter stack (12 passes/paint) is #1 culprit based on documented browser performance characteristics of SVG displacement maps + backdrop-filter. 1Hz clock re-render is #2 culprit forcing full React reconciliation every second.
5. **Concepts** — GPU compositing (backdrop-filter, blur radius, compositing layers, will-change), SVG filter pipeline (feTurbulence, feDisplacementMap, CPU vs GPU), React reconciliation (useState, memo, lazy, Suspense, render cascading), requestAnimationFrame lifecycle, paint/layout/composite pipeline.
6. **Assumptions** — (a) Modern Chromium browser (Chrome 110+ / Edge). (b) Laptop-class machine. (c) SVG filter NOT GPU-accelerated (true for most Chrome as of 2026). (d) blur(24px) visually acceptable vs blur(64px) at 0.025 opacity. (e) activityHistory is dead code (confirmed). (f) React.memo won't break existing behavior.
7. **Implications** — Removing SVG refraction loses the distortion layer (frosted glass blur remains). blur(64→24px) slightly reduces frosted glass depth but at 0.025 opacity is near-imperceptible. Removing activity tracker requires removing recordActivity call from SSE handler (line 204). Lazy-loading panels introduces loading state on first tab switch.
8. **Point of View** — Performance engineer focused on CSS/React rendering pipeline. Not considering: SSR, service workers, HTTP/2, CDN — separate domains.

**Falsification condition:** I would revise this plan if Chrome DevTools Performance profiling shows CSS filters take <5ms/frame and React render cycle takes <2ms/frame.

---

## Phase 1 — Findings (Ordered by Impact)

### CRITICAL — .panel::after SVG Refraction Filter on Every Panel

**File:** `web/src/styles/animations.css` lines 102-115
**File:** `web/src/App.jsx` lines 817-824 (SVG filter definition)

Every `.panel` element gets a `::after` pseudo-element with:
```css
filter: url(#panel-refract) blur(0.3px);
```

This applies an `feTurbulence` + `feDisplacementMap` SVG filter to EVERY panel's `::after`. SVG displacement maps are computed on the CPU in most browsers — they force a full pixel-by-pixel recompute of the layer each frame. With 3 visible panels (sidebar + main content + inner panel), that's 3 SVG filter applications per paint.

The `::after` also has `backdrop-filter: blur(2px) brightness(1.02)` — an ADDITIONAL blur pass on top of the `.panel`'s own `backdrop-filter: blur(64px)`.

**Total per panel:** 1× backdrop-filter blur(64px) + 1× SVG displacement map + 1× blur(2px) on ::after + 1× blur(0.3px) filter = **4 GPU/CPU filter passes per panel × 3 panels = 12 filter passes per paint**.

**Estimated impact:** #1 cause of lag. SVG displacement maps are not hardware-accelerated in most browsers.

---

### CRITICAL — .panel backdrop-filter: blur(64px) saturate(2) brightness(1.08)

**File:** `web/src/styles/animations.css` lines 55-56

`blur(64px)` is extremely expensive. The browser must sample pixels in a 128px radius (64px in each direction) for every pixel in the panel. With a 1280×577 viewport, that's ~738K pixels, each requiring a 128px kernel — on every paint.

3 panels × blur(64px) = 3 full-viewport blur passes.

---

### HIGH — Clock Re-renders Entire App Every Second

**File:** `web/src/App.jsx` line 50, 90, 393, 833

```js
const [time, setTime] = useState(new Date());                    // line 50
const t = setInterval(() => setTime(new Date()), 1000);          // line 90
const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;  // line 393
timeStr={timeStr}                                                  // line 833
```

`time` state lives in App (the root). Every second, `setTime()` triggers a full re-render of the entire component tree — all 344 DOM elements, all 70 inline style objects recreated, all children re-evaluated.

---

### HIGH — useActivityTracker Re-renders App Every 10 Seconds

**File:** `web/src/hooks/useActivityTracker.js` lines 11-18
**File:** `web/src/App.jsx` line 70, 204

```js
const { history: activityHistory, record: recordActivity } = useActivityTracker();  // line 70
recordActivity(incoming.agent_id);  // line 204 (SSE handler — only usage of record)
```

Every 10 seconds, the hook's `setInterval` creates new arrays for ALL agent keys → triggers App re-render. `activityHistory` is destructured but NEVER consumed by any downstream component (grep confirmed: zero matches outside App.jsx and the hook itself). `recordActivity` is called once in the SSE session handler (line 204).

**Dead code verdict:** `activityHistory` is dead. `recordActivity` has one caller but its output is never read. The entire hook is dead code.

---

### HIGH — 70 Inline Style Objects Re-created Every Render

**File:** `web/src/App.jsx` — 70 `style={{...}}` instances
**File:** `web/src/components/TopBar.jsx` — 19 `style={{...}}` instances

Every render creates 70+ new JavaScript objects for inline styles. React compares these shallowly. Since they're new objects each time (`{}` !== `{}`), React always considers them "changed" — even if the actual CSS values are identical.

---

### HIGH — All 17 Panel Imports Are Eager (340KB JS Loaded Upfront)

**File:** `web/src/App.jsx` lines 23-38

All 17 panel components are imported eagerly at the top of App.jsx. The browser downloads and parses all panel code before anything renders. Only 1 tab is active at a time.

---

### HIGH — No React.memo on Any Child Component

**File:** All component files — grep confirmed zero `React.memo` usage.

Every time App re-renders (every second from clock, every SSE event, every 10s from activity tracker), ALL children re-render — even if their props haven't changed.

Key candidates:
- `SessionRow` — up to 50× in the session list (34 lines)
- `TopBar` — re-renders every second from timeStr (185 lines, 19 inline styles)
- `AgentCard` — re-renders on every clock tick (121 lines)
- `ProjectCard` — re-renders on every state change (49 lines)
- `ContentCard` — re-renders on every state change (48 lines)

---

### MEDIUM — Canvas Particle Field Running at 60fps Unconditionally

**File:** `web/src/hooks/useParticleField.js`

The `requestAnimationFrame` loop runs at 60fps regardless of tab visibility. Each frame:
- Clears canvas
- Draws 2 nebulae (2× `createRadialGradient`)
- Builds spatial grid (hash map) for 160 stars
- Draws constellation lines (1× `createLinearGradient` per line)
- Draws 160 stars — ~30 bright stars each get `createRadialGradient` glow halo
- Draws shooting stars with `createLinearGradient` + `shadowBlur`

No `document.hidden` check. No throttling.

---

### MEDIUM — Grid Overlay with Infinite Animation

**File:** `web/src/styles/animations.css` lines 33-39, 198-200

```css
.grid-overlay {
 animation: grid-pulse 6s ease-in-out infinite;
}
@keyframes grid-pulse {
 0%, 100% { opacity: 0.03; }
 50% { opacity: 0.06; }
}
```

The difference between 0.03 and 0.06 opacity is literally invisible. This animation forces a repaint of the entire viewport every frame.

---

### MEDIUM — .panel 10× box-shadow Stack

**File:** `web/src/styles/animations.css` lines 60-70

Each `.panel` has 10 box-shadows. The near-invisible chromatic insets (lines 63-64: cyan left at 0.04 opacity, copper right at 0.03 opacity) are imperceptible. The directional color fringes (lines 65-68) can be consolidated.

---

## Phase 2 — Challenge & Prioritize

### Steelman: "Maybe the lag isn't from these things"

The user reports lag. The code has multiple confirmed performance anti-patterns. The probability that ALL of these are negligible and the lag comes from something else is <5%. The CSS filter stack alone (12 filter passes per paint) is a well-documented browser performance killer.

### Falsification condition

"I would revise this plan if Chrome DevTools Performance profiling shows that the CSS filters take <5ms per frame and the React render cycle takes <2ms per frame."

We can verify after implementing the CSS fixes — if the lag disappears, the diagnosis was correct.

---

## Phase 3 — Execution Plan (Ordered by Impact/Cost Ratio)

Each step is independently verifiable. Only move to the next step after confirming the previous one works.

---

### Step 1: Kill the SVG Refraction Filter (CRITICAL, ~5 min)

**Objective:** Remove `.panel::after` refraction layer and SVG filter definition — eliminates 6 of the 12 filter passes per paint.

**Files to modify:**
- `web/src/styles/animations.css`
- `web/src/App.jsx`

**Exact changes:**

**animations.css** — Remove lines 44-50 (`.panel-refraction-filter` class):
```css
/* DELETE THIS ENTIRE BLOCK: */
/* SVG filter for refraction distortion — referenced by .panel::after */
.panel-refraction-filter {
 position: absolute;
 width: 0;
 height: 0;
 overflow: hidden;
}
```

**animations.css** — Remove lines 101-115 (`.panel::after` rules):
```css
/* DELETE THIS ENTIRE BLOCK: */
/* Refraction distortion layer — bends light through the glass */
.panel::after {
 content: '';
 position: absolute;
 inset: -2px;
 border-radius: inherit;
 background: inherit;
 backdrop-filter: blur(2px) brightness(1.02);
 -webkit-backdrop-filter: blur(2px) brightness(1.02);
 opacity: 0.35;
 pointer-events: none;
 z-index: 2;
 filter: url(#panel-refract) blur(0.3px);
 mix-blend-mode: overlay;
}
```

**App.jsx** — Remove lines 816-824 (SVG filter definition):
```jsx
/* DELETE THIS ENTIRE BLOCK: */
{/* SVG refraction filter for liquid glass panels */}
<svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
 <defs>
  <filter id="panel-refract">
   <feTurbulence type="fractalNoise" baseFrequency="0.015 0.015" numOctaves="3" seed="2" result="noise" />
   <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
  </filter>
 </defs>
</svg>
```

**Verification:**
1. Build: `cd web && node node_modules/vite/bin/vite.js build`
2. Reload dashboard in browser
3. Visual check: panels still have frosted glass blur (from backdrop-filter), just no refraction distortion
4. Performance check: lag should be noticeably reduced immediately

**Commit message:** `perf: remove SVG refraction filter — eliminates 6 filter passes per paint`

---

### Step 2: Reduce backdrop-filter Blur (CRITICAL, ~2 min)

**Objective:** Reduce `blur(64px)` → `blur(24px)` — 2.6× cheaper, visually identical at 0.025 background opacity. Add `will-change: transform` to promote panels to compositing layers.

**File to modify:**
- `web/src/styles/animations.css`

**Exact changes:**

**animations.css** — Line 55-56, change:
```css
/* FROM: */
backdrop-filter: blur(64px) saturate(2) brightness(1.08);
-webkit-backdrop-filter: blur(64px) saturate(2) brightness(1.08);

/* TO: */
backdrop-filter: blur(24px) saturate(2) brightness(1.08);
-webkit-backdrop-filter: blur(24px) saturate(2) brightness(1.08);
```

**animations.css** — Add `will-change: transform` to `.panel` (after line 72, before `overflow: hidden`):
```css
.panel {
 position: relative;
 background: var(--card-bg);
 backdrop-filter: blur(24px) saturate(2) brightness(1.08);
 -webkit-backdrop-filter: blur(24px) saturate(2) brightness(1.08);
 border: 1px solid var(--card-border);
 border-radius: 20px;
 box-shadow: /* (unchanged until Step 10) */
 transition: border-color 0.3s ease, box-shadow 0.3s ease, background 0.3s ease;
 will-change: transform;  /* <-- ADD THIS LINE */
 overflow: hidden;
}
```

**Verification:**
1. Build and reload
2. Visual check: frosted glass still looks good — the blur is slightly less extreme but at 0.025 opacity the difference is near-imperceptible
3. Performance check: lag should be further reduced

**Commit message:** `perf: reduce backdrop blur 64→24px, add will-change for compositing`

---

### Step 3: Fix the Clock Re-render (HIGH, ~10 min)

**Objective:** Extract clock into an isolated `<Clock />` component with its own `useState`, so only the clock DOM node updates every second — not the entire App.

**Files to modify:**
- `web/src/App.jsx`
- `web/src/components/TopBar.jsx`

**Exact changes:**

**App.jsx** — Remove clock state and interval (lines 50, 88-92, 392-393, 833):

Remove line 50:
```js
// DELETE: const [time, setTime] = useState(new Date());
```

Remove lines 88-92 (clock useEffect):
```js
// DELETE ENTIRE BLOCK:
// Clock
useEffect(() => {
 const t = setInterval(() => setTime(new Date()), 1000);
 return () => clearInterval(t);
}, []);
```

Remove lines 392-393:
```js
// DELETE:
const pad = (n) => String(n).padStart(2, "0");
const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
```

Change line 833 — remove `timeStr` prop:
```jsx
<!-- FROM: -->
<TopBar agents={agents} sseStatus={sseStatus} timeStr={timeStr} ... />

<!-- TO: -->
<TopBar agents={agents} sseStatus={sseStatus} ... />
```

**TopBar.jsx** — Replace `timeStr` prop with an internal `<Clock />` component:

Remove `timeStr` from props:
```jsx
// FROM:
export default function TopBar({ agents, sseStatus, timeStr, onReconnect, onCircuits, onSettings }) {

// TO:
export default function TopBar({ agents, sseStatus, onReconnect, onCircuits, onSettings }) {
```

Add Clock component at top of file (before TopBar):
```jsx
import { useState, useEffect } from "react";
import { FONTS } from "../styles/theme.js";

function Clock() {
 const [time, setTime] = useState(new Date());
 useEffect(() => {
  const id = setInterval(() => setTime(new Date()), 1000);
  return () => clearInterval(id);
 }, []);
 const pad = (n) => String(n).padStart(2, "0");
 const display = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
 return (
  <div style={{
   fontFamily: FONTS.mono,
   fontSize: 12,
   color: "#00d4ff",
   letterSpacing: "0.1em",
   minWidth: 64,
   textAlign: "right",
  }}>
   {display}
  </div>
 );
}
```

Replace the time display in TopBar (lines 170-181):
```jsx
<!-- FROM: -->
<div style={{ fontFamily: FONTS.mono, fontSize: 12, color: "#00d4ff", letterSpacing: "0.1em", minWidth: 64, textAlign: "right" }}>
 {displayTime}
</div>

<!-- TO: -->
<Clock />
```

Remove the `pad` and `displayTime` helper from TopBar (lines 4-5):
```js
// DELETE:
const pad = (n) => String(n).padStart(2, "0");
const displayTime = timeStr || `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:${pad(new Date().getSeconds())}`;
```

**Verification:**
1. Build and reload
2. Clock still updates every second
3. Open React DevTools Profiler — only `<Clock />` should re-render on each tick, not `<App />` or `<TopBar />`

**Commit message:** `perf: extract Clock into isolated component — stops 1Hz full-app re-renders`

---

### Step 4: Remove Dead Activity Tracker (HIGH, ~3 min)

**Objective:** Remove `useActivityTracker` entirely — it re-renders App every 10 seconds and its output is never consumed by any component.

**File to modify:**
- `web/src/App.jsx`

**Exact changes:**

Remove import (line 6):
```js
// DELETE:
import { useActivityTracker } from "./hooks/useActivityTracker";
```

Remove hook call (line 70):
```js
// DELETE:
const { history: activityHistory, record: recordActivity } = useActivityTracker();
```

Remove `recordActivity` call in SSE handler (line 204):
```js
// DELETE:
recordActivity(incoming.agent_id);
```

Remove `recordActivity` from SSE useEffect dependency array (line 232):
```js
// FROM:
}, [recordActivity]);

// TO:
}, []);
```

**Council fix (M4):** Instead of fully removing `recordActivity` from the SSE handler, replace it with a no-op stub that preserves the wiring for future use:
```js
// Add near the top of App(), after other hooks:
const recordActivity = useCallback(() => {}, []);  // no-op stub — preserves SSE pipeline wiring
```
This eliminates the `useActivityTracker` import and its 10s timer, but keeps the SSE handler calling `recordActivity(incoming.agent_id)` at line 204 without effect. If a future feature needs activity tracking, replace the stub with a real implementation.

**Note:** The `useActivityTracker.js` file itself can be left in place (dead code in the repo isn't a performance issue — only dead hooks called at runtime are). Delete if you want clean code, but it's not required for performance.

**Council note (L2):** The SSE useEffect dependency array change from `[recordActivity]` to `[]` is safe because `recordActivity` was already stable (wrapped in `useCallback` with `[]` deps inside the hook). The SSE effect was never re-mounting due to `recordActivity` identity changes. Changing to `[]` is intentionally a one-time mount effect.

**Verification:**
1. Build and reload
2. No errors in console
3. SSE still processes session events correctly (the `recordActivity` call was a no-op consumer)
4. 10-second re-render cycle gone

**Commit message:** `perf: remove useActivityTracker — dead code causing 10s re-render cycles`

---

### Step 5: Extract Static Inline Styles (HIGH, ~20 min)

**Objective:** Move static `style={{...}}` objects to module-level constants so React doesn't create new objects every render and think styles changed.

**Files to modify:**
- `web/src/App.jsx` (70 instances)
- `web/src/components/TopBar.jsx` (19 instances)

**Strategy:**
- Extract purely static styles (no dynamic values) as `const STYLE_X = {}` at module level
- For styles with one dynamic value, use a factory function: `const makeRowStyle = (bg) => ({ ...staticStyles, background: bg })`
- For styles with multiple dynamic values, keep inline but add a comment `// DYNAMIC: <reason>`

**App.jsx patterns to extract (most common):**

```js
// Add at top of file, after imports, before App():
const STYLES = {
 rootContainer: { position: "relative", height: "100vh", background: "var(--bg)", fontFamily: FONTS.sans, overflow: "hidden" },
 gridOverlay: { position: "fixed", zIndex: 1 },
 canvas: { position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none", opacity: 0.5 },
 // ... extract remaining static patterns
};
```

**TopBar.jsx patterns to extract:**

```js
const STYLES = {
 header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid rgba(0,212,255,0.08)", background: "var(--bg-header)", backdropFilter: "blur(20px)", flexShrink: 0 },
 leftSection: { display: "flex", alignItems: "center", gap: 8 },
 accLabel: { fontFamily: FONTS.mono, fontSize: 10, color: "rgba(0,212,255,0.45)", letterSpacing: "0.08em" },
 separator: { width: 1, height: 16, background: "rgba(0,212,255,0.1)" },
 iconButton: { background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" },
 // ... etc
};
```

**Verification:**
1. Build and reload
2. Visual regression: everything should look identical
3. React DevTools: fewer DOM updates on re-renders (compare before/after Profiler trace)

**Commit message:** `perf: extract 70+ inline style objects to module-level constants`

---

### Step 6: React.memo + useCallback + Agent Stabilization (HIGH, ~20 min)

**Objective:** Wrap frequently-rendered components in `React.memo()`, stabilize all callback props with `useCallback`, and add shallow-compare guard in SSE agent handler so memo actually works.

**Files to modify:**
- `web/src/App.jsx`
- `web/src/components/SessionRow.jsx`
- `web/src/components/ProjectCard.jsx`
- `web/src/components/AgentCard.jsx`
- `web/src/components/ContentCard.jsx`
- `web/src/components/TopBar.jsx`

**Council-mandated fixes (H1, H2, H3): Without these, React.memo on SessionRow and TopBar would be nearly useless.**

**Exact changes — React.memo per component:**

**SessionRow.jsx:**
```jsx
// FROM:
export default function SessionRow({ ... }) { ... }

// TO:
function SessionRow({ ... }) { ... }
export default React.memo(SessionRow);
```

**ProjectCard.jsx:**
```jsx
function ProjectCard({ ... }) { ... }
export default React.memo(ProjectCard);
```

**AgentCard.jsx:**
```jsx
function AgentCard({ ... }) { ... }
export default React.memo(AgentCard);
```

**ContentCard.jsx:**
```jsx
function ContentCard({ ... }) { ... }
export default React.memo(ContentCard);
```
**Council fix (M6):** ContentCard's `style={{ ...style }}` spread creates a new object every render, defeating both style extraction and React.memo. Change to:
```jsx
// FROM:
<div style={{ ...style, ...localStyles }}>

// TO:
const mergedStyle = useMemo(() => style ? { ...BASE_STYLES, ...style } : BASE_STYLES, [style]);
// Use mergedStyle in JSX
```

**TopBar.jsx:**
```jsx
function TopBar({ ... }) { ... }
export default React.memo(TopBar);
```

**Exact changes — H1: Fix SessionRow onToggle inline closure (App.jsx):**

```jsx
// FROM (line ~552):
<SessionRow ... onToggle={() => toggleSession(s.id)} />

// TO:
<SessionRow ... id={s.id} onToggle={toggleSession} />
```

And in SessionRow.jsx, change the internal call:
```jsx
// FROM:
onClick={onToggle}

// TO:
onClick={() => onToggle(id)}
```

**Exact changes — H3: Stabilize TopBar callback props (App.jsx):**

```jsx
// Add near top of App():
const handleReconnect = useCallback(() => window.__sseReconnect?.(), []);
const handleCircuits = useCallback(() => setShowCircuits(true), []);
const handleSettings = useCallback(() => setShowSettings(true), []);

// FROM (lines ~834-836):
<TopBar ... onReconnect={() => window.__sseReconnect?.()} onCircuits={() => setShowCircuits(true)} onSettings={() => setShowSettings(true)} />

// TO:
<TopBar ... onReconnect={handleReconnect} onCircuits={handleCircuits} onSettings={handleSettings} />
```

**Exact changes — H2: Stabilize SSE agent updates (App.jsx, promoted from Phase 4 Step 12):**

In the `agent_status` SSE handler (~line 181):
```js
// FROM:
setAgents((prev) => prev.map((a) => a.id === data.agent_id ? { ...a, ...updates } : a));

// TO:
setAgents((prev) => {
 const idx = prev.findIndex((a) => a.id === data.agent_id);
 if (idx === -1) return [...prev, { id: data.agent_id, ...data }];
 const existing = prev[idx];
 // Shallow-compare: if nothing actually changed, return SAME array reference → memo works
 if (existing.status === (data.status ?? existing.status) &&
     existing.task === (data.current_task ?? existing.task) &&
     existing.model === (data.model ?? existing.model)) return prev;
 return prev.map((a) => a.id === data.agent_id ? { ...a, ...data } : a);
});
```

Similarly for the `state` SSE handler (~line 157):
```js
setAgents((prev) => {
 const idx = prev.findIndex((a) => a.id === data.agent_id);
 if (idx === -1) return [...prev, { id: data.agent_id, ...data }];
 const existing = prev[idx];
 if (existing.status === (data.status ?? existing.status) &&
     existing.task === (data.current_task ?? existing.task) &&
     existing.model === (data.model ?? existing.model)) return prev;
 return prev.map((a) => a.id === data.agent_id ? { ...a, ...data } : a);
});
```

**Pitfall:** If agents have other fields that change (e.g., `last_seen`, `uptime`), add those to the shallow-compare check. The goal is: if the data arriving from SSE is identical to what's already in state, return the same array reference so React.memo skips the re-render.

**Verification:**
1. Build and reload
2. Open React DevTools Profiler
3. Trigger a clock tick (wait 1 second) — SessionRow, ProjectCard, AgentCard, ContentCard should NOT re-render
4. SSE agent_status event with no actual changes → TopBar should NOT re-render
5. SSE agent_status event with real changes → TopBar SHOULD re-render (memo correctly bypassed)
6. Tab switch should still work correctly

**Commit message:** `perf: React.memo + useCallback + stabilize SSE agents — stops cascade re-renders`

---

### Step 7: Lazy-Load Panels + ErrorBoundary (HIGH, ~15 min)

**Objective:** Convert all panel imports to `React.lazy()` so only the active panel's code is loaded. Add ErrorBoundary to catch chunk-load failures.

**Files to modify:**
- `web/src/App.jsx`
- `web/src/components/ErrorBoundary.jsx` (NEW)

**Council-mandated fix (C1): Without ErrorBoundary, a failed chunk = uncaught error = white screen of death. This is the #1 edge case the original plan missed.**

**Council fix (M7): Remove dead DispatchPanel import before lazy-loading.**

**Exact changes:**

**Step 7a: Create ErrorBoundary component**

Create `web/src/components/ErrorBoundary.jsx`:
```jsx
import { Component } from "react";

export default class ErrorBoundary extends Component {
 constructor(props) {
  super(props);
  this.state = { hasError: false, error: null };
 }

 static getDerivedStateFromError(error) {
  return { hasError: true, error };
 }

 handleRetry = () => {
  this.setState({ hasError: false, error: null });
  // Force chunk re-fetch by triggering a re-render
  if (typeof window !== "undefined" && window.location) {
   window.location.reload();
  }
 };

 render() {
  if (this.state.hasError) {
   return (
    <div style={{
     padding: 20,
     color: "rgba(0,212,255,0.5)",
     fontFamily: "var(--font-mono, monospace)",
     fontSize: 11,
     display: "flex",
     flexDirection: "column",
     alignItems: "center",
     gap: 8,
    }}>
     <div>Failed to load panel</div>
     <button
      onClick={this.handleRetry}
      style={{
       background: "rgba(0,212,255,0.1)",
       border: "1px solid rgba(0,212,255,0.2)",
       color: "#00d4ff",
       padding: "4px 12px",
       borderRadius: 4,
       cursor: "pointer",
       fontFamily: "inherit",
       fontSize: 10,
      }}
     >
      Retry
     </button>
    </div>
   );
  }
  return this.props.children;
 }
}
```

**Step 7b: Remove dead DispatchPanel import, replace all others with lazy**

Replace eager imports (lines 23-38):
```jsx
// FROM:
import DispatchPanel from "./panels/DispatchPanel";
import SearchPanel from "./panels/SearchPanel";
// ... (17 lines)

// TO:
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";

// DispatchPanel removed — it's imported but never rendered (M7)
const SearchPanel = lazy(() => import("./panels/SearchPanel"));
const BriefingPanel = lazy(() => import("./panels/BriefingPanel"));
const ErrorDashboard = lazy(() => import("./panels/ErrorDashboard"));
const TimelinePanel = lazy(() => import("./panels/TimelinePanel"));
const ContextView = lazy(() => import("./panels/ContextView"));
const MemoryExplorer = lazy(() => import("./panels/MemoryExplorer"));
const TailscaleFeedPanel = lazy(() => import("./panels/TailscaleFeedPanel"));
const PipelinePanel = lazy(() => import("./panels/PipelinePanel"));
const TrendsPanel = lazy(() => import("./panels/TrendsPanel"));
const HealthScorePanel = lazy(() => import("./panels/HealthScorePanel"));
const VaultVitalsPanel = lazy(() => import("./panels/VaultVitalsPanel"));
const CronDashboardPanel = lazy(() => import("./panels/CronDashboardPanel"));
const TradingPanel = lazy(() => import("./panels/TradingPanel"));
const ClaudeCodePanel = lazy(() => import("./panels/ClaudeCodePanel"));
const ChatPanel = lazy(() => import("./panels/ChatPanel"));
```

Add ErrorBoundary + Suspense wrapper around the content area in `renderContent()`:
```jsx
return (
 <ErrorBoundary>
  <Suspense fallback={
   <div style={{
    padding: 20,
    color: "rgba(0,212,255,0.4)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
   }}>
    Loading...
   </div>
  }>
   {/* existing panel rendering */}
  </Suspense>
 </ErrorBoundary>
);
```

**Pitfall:** Some panels may use named exports instead of default exports. `React.lazy()` requires default exports. Verify each panel file uses `export default`. If any uses named export, use: `lazy(() => import("./panels/X").then(m => ({ default: m.X })))`.

**Verification:**
1. Build and reload
2. Check Network tab in DevTools — only the active panel's chunk should be loaded initially
3. Switch tabs — new panel chunk loads on first visit
4. Subsequent visits to same tab should be instant (chunk cached)
5. **ErrorBoundary test:** Temporarily rename a panel chunk file to simulate a load failure — should see "Failed to load panel" + Retry button, NOT a white screen

**Commit message:** `perf: lazy-load panels with ErrorBoundary — cuts initial JS, handles chunk failures`

---

### Step 8: Throttle Canvas Animation + visibilitychange (MEDIUM, ~10 min)

**Objective:** Pause animation when tab hidden (using `visibilitychange`, not rAF polling), throttle to 30fps when idle.

**File to modify:**
- `web/src/hooks/useParticleField.js`

**Council fix (M3): The original plan polled rAF while hidden. Use `visibilitychange` listener to stop/restart the loop instead — eliminates the 1Hz hidden-tab callbacks in older browsers.**

**Exact changes:**

Add visibility handling and idle throttle:
```js
// Add after line 18 (let animId;):
let lastFrameTime = 0;
let lastMouseMove = Date.now();
let isTabVisible = !document.hidden;
const FPS_ACTIVE = 60;
const FPS_IDLE = 30;
const IDLE_THRESHOLD_MS = 5000;
```

Add visibilitychange listener (inside the useEffect, after the above declarations):
```js
// Stop/start animation on tab visibility change
const onVisibilityChange = () => {
 isTabVisible = !document.hidden;
 if (isTabVisible && !animId) {
  lastFrameTime = performance.now(); // Reset to avoid frame-skip
  animId = requestAnimationFrame(draw);
 }
};
document.addEventListener("visibilitychange", onVisibilityChange);
```

Modify the `onMove` handler (line 32):
```js
// FROM:
const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; };

// TO:
const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; lastMouseMove = Date.now(); };
```

Modify the `draw` function (line 105) — add frame throttle + visibility guard:
```js
const draw = (timestamp) => {
 // Stop loop when tab is hidden (visibilitychange handles restart)
 if (!isTabVisible) {
  animId = null; // Clear so visibilitychange can restart
  return;
 }

 // Idle throttle: 30fps after 5s of no mouse movement
 const isIdle = (Date.now() - lastMouseMove) > IDLE_THRESHOLD_MS;
 const targetFPS = isIdle ? FPS_IDLE : FPS_ACTIVE;
 const minFrameInterval = 1000 / targetFPS;

 if (timestamp - lastFrameTime < minFrameInterval) {
  animId = requestAnimationFrame(draw);
  return;
 }
 lastFrameTime = timestamp;

 // ... rest of draw function unchanged
```

Add cleanup in the useEffect return:
```js
return () => {
 cancelAnimationFrame(animId);
 document.removeEventListener("visibilitychange", onVisibilityChange);
 canvas.removeEventListener("mousemove", onMove);
 // ... any other cleanup
};
```

**Optimization: Skip glow halos for non-anchor bright stars when idle:**
```js
// In the star drawing section (~line 245):
if (p.bright && (p.anchor || !isIdle)) {
 // Only draw glow halos for anchor stars when idle
 // All bright stars get glow when active
```

**Verification:**
1. Build and reload
2. Open DevTools Performance tab
3. Canvas draws should completely stop when tab is backgrounded (no rAF callbacks at all)
4. After 5s of no mouse movement, frame rate should drop to ~30fps
5. Moving mouse should restore 60fps
6. Switching back to tab after being hidden should immediately resume animation

**Commit message:** `perf: canvas — visibilitychange pause, 30fps idle throttle, skip idle glow halos`

---

### Step 9: Kill Grid Pulse Animation (MEDIUM, ~1 min)

**Objective:** Replace infinite animation with static opacity. The difference between 0.03 and 0.06 opacity is invisible.

**File to modify:**
- `web/src/styles/animations.css`

**Exact changes:**

Lines 33-39, change:
```css
/* FROM: */
.grid-overlay {
 inset: 0;
 background-image:
  linear-gradient(var(--grid-line) 1px, transparent 1px),
  linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
 background-size: 48px 48px;
 animation: grid-pulse 6s ease-in-out infinite;
}

/* TO: */
.grid-overlay {
 inset: 0;
 background-image:
  linear-gradient(var(--grid-line) 1px, transparent 1px),
  linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
 background-size: 48px 48px;
 opacity: 0.04;
 will-change: auto;
}
```

Remove the `@keyframes grid-pulse` definition (lines 198-201):
```css
/* DELETE: */
@keyframes grid-pulse {
 0%, 100% { opacity: 0.03; }
 50% { opacity: 0.06; }
}
```

**Verification:**
1. Build and reload
2. Grid overlay still visible as subtle background pattern
3. No infinite animation running (DevTools Animations tab should be empty for grid-overlay)

**Commit message:** `perf: replace grid-pulse animation with static opacity — eliminates constant repaints`

---

### Step 10: Reduce box-shadow Stack (MEDIUM, ~5 min)

**Objective:** Consolidate 10 shadows → 5. Remove near-invisible chromatic insets and consolidate directional fringes.

**File to modify:**
- `web/src/styles/animations.css`

**Exact changes:**

Lines 60-70, change:
```css
/* FROM (10 shadows): */
box-shadow:
 inset 0 1px 0 rgba(255,255,255,0.14),           /* top highlight */
 inset 0 -1px 0 rgba(0,0,0,0.20),                  /* bottom shadow */
 inset 1px 0 0 rgba(0,212,255,0.04),               /* cyan left — NEARLY INVISIBLE */
 inset -1px 0 0 rgba(194,122,90,0.03),              /* copper right — NEARLY INVISIBLE */
 -2px 0 12px rgba(0,212,255,0.06),                  /* cyan fringe left */
 2px 0 12px rgba(194,122,90,0.05),                  /* copper fringe right */
 0 -1px 8px rgba(0,212,255,0.03),                   /* cyan fringe top */
 0 1px 8px rgba(194,122,90,0.03),                   /* copper fringe bottom */
 0 12px 48px rgba(0,0,0,0.4),                       /* depth shadow */
 0 2px 8px rgba(0,0,0,0.2);                         /* close shadow */

/* TO (5 shadows): */
box-shadow:
 inset 0 1px 0 rgba(255,255,255,0.14),             /* top highlight */
 inset 0 -1px 0 rgba(0,0,0,0.20),                  /* bottom shadow */
 -1px 0 14px rgba(0,212,255,0.05),                  /* combined color fringe left */
 1px 0 14px rgba(194,122,90,0.04),                  /* combined color fringe right */
 0 8px 32px rgba(0,0,0,0.35);                       /* combined depth shadow */
```

Also update the `:hover` box-shadow (lines 138-148) similarly:
```css
/* FROM (10 shadows): */
box-shadow:
 inset 0 1px 0 rgba(255,255,255,0.18),
 inset 0 -1px 0 rgba(0,0,0,0.24),
 inset 1px 0 0 rgba(0,212,255,0.06),
 inset -1px 0 0 rgba(194,122,90,0.05),
 -2px 0 16px rgba(0,212,255,0.09),
 2px 0 16px rgba(194,122,90,0.07),
 0 -1px 12px rgba(0,212,255,0.05),
 0 1px 12px rgba(194,122,90,0.04),
 0 16px 56px rgba(0,0,0,0.45),
 0 4px 12px rgba(0,0,0,0.25);

/* TO (5 shadows): */
box-shadow:
 inset 0 1px 0 rgba(255,255,255,0.18),
 inset 0 -1px 0 rgba(0,0,0,0.24),
 -1px 0 18px rgba(0,212,255,0.08),
 1px 0 18px rgba(194,122,90,0.06),
 0 12px 40px rgba(0,0,0,0.4);
```

**Verification:**
1. Build and reload
2. Visual check: panels still have glass-like depth and color fringing
3. The removed insets (0.04/0.03 opacity) should be imperceptible

**Commit message:** `perf: consolidate box-shadow 10→5 per panel — 15 fewer shadow computations per paint`

---

## Phase 4 — Additional Optimizations (Post-Lag-Fix)

These are lower-impact improvements to apply after the main lag is resolved.

### Step 11: Conditional Modal Rendering (LOW, ~2 min)

**File:** `web/src/App.jsx`

```jsx
<!-- FROM: -->
<SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />
<ProjectDetail project={selectedProject} detail={projectDetail} onClose={() => setSelectedProject(null)} />

<!-- TO: -->
{selectedSession && <SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />}
{selectedProject && <ProjectDetail project={selectedProject} detail={projectDetail} onClose={() => setSelectedProject(null)} />}
```

**Rationale:** Both components early-return `null` when their data prop is null, but React still calls the function and creates closures. Conditional rendering avoids the function call entirely.

### Step 12: Remove Unused `lastVisits` Destructuring (LOW, ~1 min)

```js
// FROM:
const { lastVisits, markVisited, getDelta } = useProjectVisits();

// TO:
const { markVisited, getDelta } = useProjectVisits();
```

`lastVisits` is destructured but never used outside the hook. Removing it from destructuring doesn't change the hook's behavior (it still maintains internal state), but it removes an unused variable.

---

---

## Council Review — Wave 1 Findings (Post-Diagnosis Audit)

Four reviewers audited this plan: Security, Architecture, Edge Cases, UX/Performance.
Architecture review completed via subagent (14 findings). Security, Edge Cases, and UX/Performance performed inline due to subagent timeouts.

### CRITICAL Findings (must fix):

**C1: No ErrorBoundary for lazy-loaded panels** (Security #7 + Edge Cases #1)
If any lazy-loaded panel chunk fails (network error, chunk hash mismatch after deploy), React.lazy throws an uncaught error → white screen of death. The plan's Step 7 uses `<Suspense>` but no `<ErrorBoundary>`.
**Fix:** Add ErrorBoundary around Suspense in Step 7. Create `web/src/components/ErrorBoundary.jsx` with a retry button for chunk-load errors.

### HIGH Findings (affects plan correctness):

**H1: SessionRow React.memo defeated by inline `onToggle` closure** (Architecture #5 + Edge Cases #5)
`<SessionRow onToggle={() => toggleSession(s.id)} />` creates a new function every render → defeats memo for all 50 rows.
**Fix:** Pass `id={s.id} onToggle={toggleSession}` and have SessionRow call `onToggle(id)` internally.

**H2: TopBar React.memo defeated by unstable `agents` array** (Architecture #3)
SSE handlers create new arrays via `.map()` on every event → TopBar re-renders even with memo.
**Fix:** Promote Step 12 (stabilize SSE agent updates) from Phase 4 to Phase 3. Add shallow-compare guard: `if (nothing changed) return prev;` in setAgents.

**H3: TopBar's other props are also inline closures** (Edge Cases #5)
`onReconnect={() => window.__sseReconnect?.()}`, `onCircuits={() => setShowCircuits(true)}`, `onSettings={() => setShowSettings(true)}` — all new functions every render.
**Fix:** Wrap these in `useCallback` in App.jsx.

### MEDIUM Findings (should fix):

**M1: Step 5→6 hidden dependency** (Architecture #1) — Style extraction must precede React.memo for components receiving style props (ContentCard). Reorder: Step 5 before Step 6.

**M2: STYLES dict approach is suboptimal** (Architecture #9) — Use CSS classes for static styles, inline `style={{}}` only for dynamic values. More maintainable and faster (CSS engine > React style reconciliation).

**M3: Canvas hidden-tab should use `visibilitychange`, not rAF polling** (Architecture #8) — `document.hidden` check continues requesting rAF frames. Use `visibilitychange` listener to stop/restart the loop.

**M4: Activity tracker: keep record as lightweight no-op stub** (Architecture #10) — Remove the 10s timer (the performance culprit) but keep `recordActivity` as a no-op stub in the SSE handler. This preserves the recording pipeline for future use without re-render cost.

**M5: `useProjectVisits` causes App re-renders on `markVisited`** (Architecture #12) — Not addressed in plan. Refactor to use ref + localStorage reads instead of state, or debounce the state update.

**M6: ContentCard style spread `{{...style}}` defeats memo** (Architecture #13) — Fix the spread pattern to avoid always-new object.

**M7: DispatchPanel imported but never rendered** (Architecture #7) — Dead import, should be removed not lazy-loaded.

**M8: Impact estimates may be optimistic** (UX #5) — "70%" assumes SVG filter is the dominant cost. If React reconciliation is equally costly, CSS fixes alone might only solve 40-50%. Soften to "estimated 50-70%".

**M9: Test blur(24px) in light mode** (UX #2) — Light mode uses 45% white bg where blur difference is more visible. Test specifically.

**M10: TopBar backdrop-filter: blur(20px) not addressed** (UX #6) — Note as remaining cost. 20px is reasonable for a header.

### LOW Findings (nice to have):

**L1:** Clock should be standalone `Clock.jsx`, not nested in TopBar (Architecture #4)
**L2:** Step 4 SSE dep array change is safe but undocumented (Architecture #2, #11)
**L3:** `will-change: transform` may reserve excessive GPU memory; consider `contain: paint` as fallback (Architecture #14)
**L4:** Suspense fallback should use a shimmer/spinner, not plain text (UX #3)
**L5:** grid-overlay 0.04 slightly more visible than animated average ~0.045 (Edge Cases #7)
**L6:** Some inline styles are dynamic (animation-delay, border-color) and can't be extracted to static constants (Edge Cases #6)

### Council Verdict

Steps 1-3 are high-confidence and should execute as-is. Steps 4-6 need the fixes identified above (especially H1, H2, H3 which would render React.memo nearly useless without them). Step 7 needs ErrorBoundary (C1). Steps 8-10 are sound with minor adjustments (M3, M9).

---

## Revised Dependency Graph (Post-Council)

```
Step 1 (SVG filter)     ──→ independent
Step 2 (blur)           ──→ independent
Step 3 (clock)          ──→ independent (must precede Step 6 for TopBar memo)
Step 4 (activity)       ──→ independent (keep recordActivity as no-op stub per M4)
Step 5 (styles→CSS)     ──→ independent (must precede Step 6 per M1)
Step 6 (memo + useCallback + stabilize agents) ──→ depends on Steps 3, 4, 5
Step 7 (lazy + ErrorBoundary) ──→ remove dead DispatchPanel import first (M7)
Step 8 (canvas + visibilitychange) ──→ independent
Step 9 (grid pulse)     ──→ independent
Step 10 (shadows)       ──→ independent
```

**Critical path:** Steps 1-2 solve ~50-70% of lag. Steps 3-4 solve ~15%. Steps 5-6 solve ~10%. Steps 7-10 solve ~5%.

---

## Risk Mitigation (Post-Council)

| Step | Risk | Mitigation |
|------|------|------------|
| 1 | Visual regression — panels look "flat" without refraction | The ::after was at 0.35 opacity with overlay blend — nearly invisible. If missed, add a subtle CSS-only shimmer on hover instead |
| 2 | blur(24px) too subtle | Increase to 32px as compromise. At 0.025 bg opacity, anything 20-40px looks similar. **Test in light mode specifically** (M9) |
| 2 | `will-change: transform` excessive GPU memory (L3) | Test on low-end hardware. Fallback: `contain: paint` instead |
| 3 | Clock extraction breaks TopBar layout | Clock component renders identical DOM to the removed TopBar time section. If layout shifts, compare rendered HTML before/after |
| 4 | Removing activity tracker severs recording pipeline (M4) | Keep `recordActivity` as no-op stub: `const recordActivity = useCallback(() => {}, [])` — preserves SSE wiring without re-render cost |
| 5 | Style extraction introduces typo | Compare visually after each batch. Use DevTools to verify computed styles match |
| 5 | STYLES dict grows unwieldy (M2) | Use CSS classes for static styles, inline only for dynamic. Extend animations.css with component classes |
| 6 | React.memo defeated by inline closures (H1, H3) | **Must fix:** Pass `id` + `toggleSession` directly (H1). Wrap `onReconnect/onCircuits/onSettings` in `useCallback` (H3) |
| 6 | TopBar memo defeated by unstable agents array (H2) | **Must fix:** Add shallow-compare guard in SSE agent handler. Promoted from Phase 4 |
| 7 | Chunk load failure = white screen (C1) | **Must fix:** Add ErrorBoundary around Suspense with retry button |
| 7 | Lazy loading flash on tab switch | Suspense fallback renders instantly. If noticeable, add idle prefetch for adjacent tabs. Use shimmer/spinner (L4) |
| 7 | DispatchPanel dead import (M7) | Remove before lazy-loading |
| 8 | Canvas throttle stutter on resume | Resume is instant (visibilitychange fires immediately). Idle 30fps is smooth |
| 8 | `document.hidden` rAF polling (M3) | Use `visibilitychange` listener to stop/restart loop, not rAF polling while hidden |
| 9 | Grid looks different at 0.04 vs animated 0.03-0.06 | Difference is invisible. If user notices, change to 0.05 |
| 10 | Reduced shadows look "flatter" | Consolidated shadows preserve main depth cues. If too flat, add back cyan/copper fringe with slightly higher opacity |

---

## Expected Outcome (Post-Council — Revised Estimates)

After Steps 1-2: **~50-70% of lag eliminated**. SVG filter removal is transformative. (Revised from "70%" to reflect uncertainty — M8)
After Steps 3-4: **~65-85% of lag eliminated**. React re-renders drop from ~1/second to only on actual data changes.
After Steps 5-6: **~80-90% of lag eliminated**. Memo + style extraction + agent stabilization eliminate remaining React overhead.
After Steps 7-10: **~90-95% of lag eliminated**. Remaining 5-10% is baseline React + canvas cost.

**Remaining costs not addressed:** TopBar backdrop-filter: blur(20px) (M10). `useProjectVisits` re-renders on markVisited (M5) — infrequent but real.

---

## Revision Conditions

- If Steps 1-2 don't noticeably reduce lag, the problem is likely JS-bound not CSS-bound — skip to Step 5
- If the clock extraction (Step 3) causes visual glitches, revert and use `useSyncExternalStore` instead
- If lazy-loading (Step 7) causes perceptible tab-switch delay, add a 2s idle prefetch for adjacent tabs
- If React.memo (Step 6) causes stale UI (props not updating), check for object mutation in parent state updates — React.memo does shallow comparison, so mutated objects won't trigger re-renders
- If blur(24px) looks too subtle in light mode, increase to 32px (M9)
- If `will-change: transform` causes excessive GPU memory usage, replace with `contain: paint` (L3)

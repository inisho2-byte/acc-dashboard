# Architecture & Scalability Review — PERFORMANCE_PLAN.md

**Reviewer:** Architecture & Scalability Lens  
**Date:** 2026-05-24  
**Scope:** Dependency graph, Clock extraction, React.memo, lazy-loading, canvas throttle, style extraction, activity tracker removal

---

## Findings

### 1. Hidden Dependency: Step 5 ↔ Step 6 (Inline Styles vs. React.memo)

**Severity: MEDIUM**

The dependency graph states Step 5 (style extraction) and Step 6 (React.memo) are independent. This is partially incorrect.

After Step 5 extracts inline `style={{}}` objects to module-level `STYLES` constants, React.memo's shallow-equality comparison on props will actually work correctly for style props — they'll be stable references instead of new objects each render. Currently, without Step 5, any component that receives a `style` prop from App.jsx (like `ContentCard` which receives `style={{ flex: 1 }}` at line 841) will always re-render even with React.memo, because the inline style creates a new object identity on every App render.

Additionally, `ContentCard` spreads `style` into its own local style object: `style={{ ...style }}` (line 12 of ContentCard.jsx). Even with extracted STYLES, the spread creates a new object. React.memo on ContentCard would be defeated.

**Recommendation:** Step 5 should precede Step 6, or at minimum be done in the same pass. The dependency graph should note: "Step 6 depends on Step 5 for style-prop components (ContentCard). For non-style-prop components (SessionRow, AgentCard), Step 6 is independent." Also fix ContentCard's `style={{ ...style }}` to avoid the spread when `style` is already a stable reference.

---

### 2. Hidden Dependency: Step 4 → Step 6 (Activity Tracker Removal vs. TopBar Memo)

**Severity: LOW**

The `recordActivity` callback is in the SSE useEffect dependency array (line 232). After Step 4 removes `useActivityTracker`, the dependency array changes from `[recordActivity]` to `[]`. This is functionally correct — the SSE effect should only mount once. However, removing `recordActivity` from the dep array means the SSE effect will not re-fire if it was previously keyed to `recordActivity`'s identity. This is fine (it's a one-time mount), but the plan should note it explicitly since Step 4 changes the SSE effect's dependency signature, which could interact with React's strict-mode double-invocation in development.

**Recommendation:** Add a note to Step 4 that changing the SSE dependency array from `[recordActivity]` to `[]` is intentional and safe. Verify in dev mode (React.StrictMode double-invokes effects).

---

### 3. Clock Extraction: Correct Architecture but TopBar React.memo Will Be Defeated by `agents` Array

**Severity: HIGH**

The Clock extraction (Step 3) is architecturally sound — moving the 1Hz timer out of App root is the single most impactful React-side change. However, the plan's Step 3 note says TopBar's memo depends on `agents` array stability, and acknowledges SSE events create new arrays via `.map()`. This means TopBar will re-render on every SSE `state` or `agent_status` event even after both Steps 3 and 6.

Looking at the actual code: the SSE handler at line 157-173 and 181-199 creates entirely new agent objects with `.map()` for every SSE event. The `agent_status` handler at line 181 does `prev.map(a => ...)` which creates a new array AND new objects for the changed agent, but also returns the same object references for unchanged agents. However, the *array* itself is always new.

**Recommendation:** This is acknowledged in Phase 4 Step 12, but Step 12 is listed as "MEDIUM" priority. For TopBar specifically, the memo is nearly worthless without Step 12 because SSE events are frequent in a real-time dashboard. Promote Step 12 to Phase 3, or at minimum, stabilize the `agents` array in App.jsx using a shallow-comparison pattern in the `agent_status` handler (return `prev` if no actual field values changed). This is a 5-line change:

```js
setAgents((prev) => {
  const existing = prev.find(a => a.id === data.agent_id);
  if (!existing) return [...prev, newAgent];
  // Shallow-check if anything actually changed
  if (existing.status === (data.status || existing.status) &&
      existing.task === (data.current_task || existing.task) &&
      existing.model === (data.model || existing.model)) return prev; // SAME REFERENCE
  return prev.map(a => a.id === data.agent_id ? { ...a, ...updates } : a);
});
```

---

### 4. Clock Component Placement: TopBar.jsx Is Suboptimal

**Severity: LOW**

The plan places `<Clock />` inside `TopBar.jsx` as a sibling function. This works, but it means TopBar.jsx now owns both "top bar layout" and "clock timer" concerns. More importantly, the Clock component can't be reused elsewhere (e.g., a future panel header) without coupling to TopBar.

**Recommendation:** Consider placing Clock in `web/src/components/Clock.jsx` as a standalone component. TopBar imports and renders `<Clock />`. This is a minor point — the current approach works fine for a performance-only pass. But for scalability, a standalone component is cleaner and testable in isolation.

---

### 5. React.memo on SessionRow Is Defeated by `onToggle` Inline Closure

**Severity: HIGH**

Line 552 of App.jsx:
```jsx
<SessionRow ... onToggle={() => toggleSession(s.id)} />
```

The `onToggle` prop creates a new arrow function on every render. This completely defeats `React.memo` on SessionRow — every SessionRow will re-render every time App re-renders, even if `s` (the session object) hasn't changed. With up to 50 SessionRows in the list, this is the exact scenario memo was supposed to prevent.

The plan's Step 6 mentions the `onClose={() => ...}` pitfall for child components but does not address this `onToggle` closure for SessionRow specifically.

**Recommendation:** Two options:
- (a) Create a stable callback per session using a `useMemo`+map pattern, which is messy.
- (b) Pass `toggleSession` as the prop directly and pass the session `id` separately, letting SessionRow call `onToggle(s.id)` internally. This requires changing SessionRow's interface but makes memo work.
- (c) Use a custom `areEqual` as the second argument to `React.memo` that ignores `onToggle` in the comparison. This is the quickest fix but hides the real issue.

Option (b) is cleanest. Change to:
```jsx
<SessionRow ... id={s.id} onToggle={toggleSession} />
```
And in SessionRow, call `onToggle(id)` instead of `onToggle()`.

---

### 6. React.memo on AgentCard: `delay` Prop Creates Unnecessary Re-renders

**Severity: LOW**

AgentCard receives a `delay` prop (typically `${i * 100}ms`). This is a static value per-card, but since it's likely computed as a string literal inline (`delay={i * 100}`), it's a number — stable. No issue here. But if AgentCard's parent re-renders and `i` doesn't change, memo will work correctly since the number is the same by value. Confirmed: no issue.

---

### 7. Lazy-Loading: Vite Chunking Correct, but Two Panels Receive Runtime Props

**Severity: MEDIUM**

The plan correctly uses `React.lazy(() => import(...))` which works with Vite's automatic code-splitting — each `import()` becomes a separate chunk. All 17 panels confirmed as `export default`. Good.

However, two panels receive props from App.jsx:
- `ErrorDashboard` receives `errors={errors}` (line 749)
- `DispatchPanel` receives `skills`, `agents`, `onToast` (line 745 — but looking at the actual code, the `renderTabContent` switch at line 736 shows DispatchPanel is NOT passed props in the current code at line 744: `return <SearchPanel />`, line 746: `return <BriefingPanel />`, etc.)

Wait — examining the actual code (lines 736-811), **DispatchPanel is not rendered in the switch statement at all**. It's imported (line 23) but not used in `renderTabContent()`. Same for several other panels. Let me check the TABS array... The TABS array includes "sessions", "errors", "skills", "search", "briefing", etc., but there's no "dispatch" tab in the switch. The DispatchPanel import is dead code.

**Recommendation:** Before lazy-loading, audit which panels are actually rendered. DispatchPanel (imported but unused in renderTabContent) should be removed from imports entirely, not lazy-loaded. The plan should also verify `ErrorDashboard` is the only panel receiving dynamic props, and confirm that when it lazy-loads, the `errors` prop is still correctly passed through the Suspense boundary. (It will be — Suspense doesn't affect prop passing.)

---

### 8. Canvas Throttle: Timestamp-Based Approach Has Tab-Resume Edge Case

**Severity: MEDIUM**

The plan's throttle uses `timestamp - lastFrameTime < minFrameInterval` with rAF timestamps. This is correct for normal operation. However, the `document.hidden` check is handled by continuing the rAF loop and returning early:

```js
if (document.hidden) {
  animId = requestAnimationFrame(draw);
  return;
}
```

**Edge case:** When a tab is backgrounded, rAF is automatically throttled by the browser to ~0fps (most browsers stop calling rAF for hidden tabs). When the tab resumes, rAF fires immediately with the current timestamp. The issue: `lastFrameTime` was set before the tab was hidden, so `timestamp - lastFrameTime` will be very large (hours, potentially). The throttle check will pass (large delta > minFrameInterval), and rendering resumes immediately. This is actually fine — no visual stutter.

**But there's a different edge case:** The `isIdle` check uses `Date.now() - lastMouseMove`. If the user leaves the tab open and walks away for hours, `lastMouseMove` is stale and `isIdle` is true, throttling to 30fps. When they return and move the mouse, `lastMouseMove` updates and 60fps resumes. This is correct.

**The real problem:** After a long sleep (laptop lid closed), when the browser resumes, the `draw` function's first frame will see `lastFrameTime` from hours ago. The rAF `timestamp` parameter jumps forward discontinuously. Star positions will NOT jump (they update by incremental `spdX`/`spdY` per frame, not by elapsed time), so stars will appear exactly where they were before the sleep. This is visually correct — no jump. The concern is that `idleTimer` concept is abandoned in favor of `Date.now() - lastMouseMove`, which works fine.

**However, there is a genuine bug:** `lastFrameTime` is initialized to `0`, not to the first frame's timestamp. On the very first frame, `timestamp - 0` will be very large, so the first frame always renders. This is fine. But if you wanted to be pedantic, initialize `lastFrameTime = performance.now()` to avoid the theoretical first-frame spike. Not a real issue.

**One actual issue:** The `document.hidden` check continues requesting animation frames even when hidden. Most browsers won't actually call the callback while hidden, but some (older Chrome) may call it once per second. This wastes a tiny amount of CPU. Better to stop the rAF loop entirely and listen for `visibilitychange` to restart it:

```js
if (document.hidden) {
  cancelAnimationFrame(animId);
  // Don't re-request; instead listen for visibilitychange to restart
  return;
}
```

**Recommendation:** Replace the "keep requesting rAF while hidden" pattern with a proper `visibilitychange` listener that stops/restarts the animation loop. This eliminates the 1Hz hidden-tab callbacks in older browsers and is cleaner architecturally.

---

### 9. Style Extraction STYLES Dict: Will Grow Unwieldy

**Severity: MEDIUM**

The plan proposes a single `STYLES` dict per file. For App.jsx with ~50+ unique inline style instances (confirmed: the file is dense with `style={{}}`), this dict will grow to 50+ entries. Problems:

- **Naming:** `STYLES.rootContainer`, `STYLES.gridOverlay`, `STYLES.canvas`... you'll run out of meaningful names quickly. `STYLES.sessionFilterInput`, `STYLES.sessionFilterTagButtonActive`, `STYLES.sessionFilterTagButtonInactive` — this becomes harder to read than the inline styles.
- **Discovery:** With inline styles, you can see a component's styling at the usage site. With extracted STYLES, you must jump to the dict definition to understand what styles apply.
- **Dynamic styles:** Many App.jsx styles contain dynamic values (`animationDelay: ${i * 80}ms`, `border: 1px solid ${sev.border}`, etc.). These can't be fully extracted and will need factory functions, creating a mixed pattern where some styles are in the dict and some remain inline.

**Recommendation:** Instead of one monolithic `STYLES` dict, use a CSS-modules or BEM approach for static styles (the majority), and reserve inline `style={{}}` only for genuinely dynamic values. The project already uses `animations.css` — extend it with component-specific classes. For example, `sessionFilterInput` class in CSS rather than `STYLES.sessionFilterInput` in JS. This is more maintainable, offloads style computation to CSS engine (faster than React style reconciliation), and is the standard React pattern. The STYLES dict approach is a valid quick-fix but will become technical debt within months.

If staying with STYLES dict for the performance-only scope: group by component/section (`STYLES.sessionFilter.input`, `STYLES.sessionFilter.tagButton`) to keep naming manageable and add a lint rule preventing new inline `style={{}}` additions.

---

### 10. Removing Activity Tracker: Missed Opportunity for Refactoring

**Severity: MEDIUM**

The plan correctly identifies `useActivityTracker` as dead code — `activityHistory` is never consumed by any component. However, the hook's `record` function IS called on every SSE session event (line 204: `recordActivity(incoming.agent_id)`), which means the infrastructure for tracking agent activity is already wired into the SSE pipeline.

The backend has an `activity_engine.py` aggregator and a `TimelinePanel.jsx` that presumably shows activity data. The `useActivityTracker` hook was likely built to feed a local activity sparkline (AgentCard has a `sparklineData` prop that's never populated in the current App.jsx). Deleting the hook removes the only client-side mechanism to populate those sparklines.

**Recommendation:** Instead of deleting the hook entirely:
1. Remove the 10-second rotation interval (the performance problem — it creates new arrays every 10s regardless of data).
2. Keep the `record` callback but make it a simple counter that only triggers state updates when the value actually changes (not on a timer).
3. Wire `activityHistory` to AgentCard's `sparklineData` prop (currently unused) to complete the feature.

If the performance-only scope forbids feature work, then at minimum: remove the `setInterval` rotation (the performance culprit) but keep the `record` function as a no-op stub or simple counter. This preserves the SSE-wired recording for future use without the 10s re-render cost. The plan's approach of keeping the file but removing the import is acceptable as a minimal fix, but it severs the recording pipeline that was already in place.

---

### 11. Missing Dependency: Step 4's Effect on SSE Error Handling

**Severity: LOW**

Line 232: `}, [recordActivity]);` — After Step 4 removes `recordActivity` and changes to `}, []);`, this removes the dependency that might have caused the SSE effect to remount if `recordActivity` changed identity. Since `recordActivity` was already wrapped in `useCallback` with `[]` deps (line 23-30 of useActivityTracker.js), it was stable and the effect never remounted. So changing to `[]` is safe. But the plan should explicitly state this analysis to prevent future confusion.

---

### 12. `useProjectVisits` Hook Causes Re-renders on Every `markVisited` Call

**Severity: MEDIUM (not addressed in plan)**

The `useProjectVisits` hook (line 71 of App.jsx) calls `setLastVisits` inside `markVisited`, which creates a new object (`{ ...prev, [slug]: Date.now() }`) and triggers an App re-render. This happens every time a user clicks a project card. While infrequent, it IS an App-level re-render from a hook that the plan doesn't address.

More critically, `getDelta` depends on `[lastVisits]` (line 46 of useProjectVisits.js), so every `markVisited` call also creates a new `getDelta` function reference. If `getDelta` is passed as a prop to any memo'd component, it would defeat the memo. Currently `getDelta` is called inline in the JSX (`delta={getDelta(p.slug, p.updated)}`) rather than passed as a prop, so it doesn't directly defeat memo — but the App re-render itself cascades to all children.

**Recommendation:** Add to Phase 4 or integrate into Step 4: Remove `lastVisits` from destructuring (the plan's Step 13 already does this, which helps with linting but doesn't fix the re-render). The real fix: `markVisited` should not trigger a full App re-render. Move the `lastVisits` state into a ref and read from localStorage directly in `getDelta`, eliminating the state entirely. Or debounce the state update.

---

### 13. ContentCard's Style Spread Defeats Style Extraction

**Severity: LOW**

ContentCard.jsx line 12: `style={{ ...style }}`. Even if App.jsx passes a stable `STYLES.contentCard` reference, the spread in ContentCard creates a new object every render. This means:
- If ContentCard is wrapped in React.memo, the `style` prop will always appear "changed" from ContentCard's perspective because its own internal merge creates a new object.
- The style extraction benefit is lost at this component boundary.

**Recommendation:** Change ContentCard to merge styles without always creating a new object when the incoming `style` prop hasn't changed:

```jsx
const mergedStyle = style
  ? { ...STATIC_STYLES.base, ...style }
  : STATIC_STYLES.base;
```

Or better, use CSS classes for the base styles and only use `style` prop for overrides.

---

### 14. Step 2's `will-change: transform` Can Cause Excessive Memory Usage

**Severity: LOW**

Adding `will-change: transform` to `.panel` promotes each panel to its own compositing layer. With 3+ panels visible, this creates 3+ additional GPU layers. Each layer reserves GPU memory proportional to the element's pixel dimensions. For the viewport-sized panels in this dashboard, that's significant GPU memory.

`will-change` should be used sparingly — the CSS spec warns that applying it to many elements can cause worse performance than the original problem. In this case, since the panels don't actually animate `transform`, `will-change: transform` is being used purely to promote to a compositing layer (so backdrop-filter is applied on the GPU). This is a valid use, but it should be tested on lower-end hardware.

**Recommendation:** Add a caveat to Step 2: if memory usage becomes an issue on low-end devices, remove `will-change: transform` and rely solely on the blur reduction. Consider `contain: paint` as an alternative compositing hint that doesn't reserve GPU memory upfront.

---

## Summary Table

| # | Finding | Severity | Action Required |
|---|---------|----------|-----------------|
| 1 | Step 5 ↔ Step 6 hidden dependency (style props defeat memo) | MEDIUM | Reorder: Step 5 before Step 6, or combine |
| 2 | Step 4 SSE dependency array change | LOW | Note in plan, verify in dev mode |
| 3 | TopBar React.memo defeated by unstable `agents` array | HIGH | Promote Step 12 (stabilize agents) to Phase 3 |
| 4 | Clock component should be standalone, not inside TopBar | LOW | Create Clock.jsx, import into TopBar |
| 5 | SessionRow React.memo defeated by `onToggle` inline closure | HIGH | Refactor: pass `id` + `toggleSession` directly |
| 6 | AgentCard memo: no issue (delay is stable number) | — | No action |
| 7 | DispatchPanel imported but unused; audit before lazy-load | MEDIUM | Remove dead imports before Step 7 |
| 8 | Canvas hidden-tab: rAF should stop, not poll | MEDIUM | Use `visibilitychange` listener instead of rAF polling |
| 9 | STYLES dict will become unwieldy at 50+ entries | MEDIUM | Use CSS classes for static styles, reserve inline for dynamic only |
| 10 | Activity tracker removal severs recording pipeline | MEDIUM | Remove rotation timer, keep record function as lightweight stub |
| 11 | Step 4 dep array change: safe but undocumented | LOW | Document the analysis in plan |
| 12 | useProjectVisits re-renders App on markVisited | MEDIUM | Refactor to use ref + localStorage reads instead of state |
| 13 | ContentCard style spread defeats extraction | LOW | Merge styles without always-new object |
| 14 | will-change on .panel may use excessive GPU memory | LOW | Test on low-end hardware; fallback to `contain: paint` |

**Overall Assessment:** The plan's diagnosis is excellent — the CSS filter stack and clock re-render are correctly identified as the top bottlenecks. Steps 1-3 are high-confidence, low-risk, and should be executed as-is. Steps 4-6 have the architectural issues identified above (especially #3 and #5 which would render Step 6 nearly useless). Steps 7-10 are sound but need the minor adjustments noted. The plan should be revised to address findings #3 and #5 before execution of Steps 6 and 7.

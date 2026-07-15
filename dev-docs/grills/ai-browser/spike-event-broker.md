# Navigation ticket and event broker spike

> Status: **PASS — deterministic broker behavior covered by unit tests**

`BrowserEventBroker` subscribes once per app lifecycle, buffers bounded terminal results,
correlates waiters by `(tabId, navigationId)`, and resolves older waiters as superseded
when a newer ticket commits. Legacy payloads without `navigationId` receive a stable
fallback ticket for compatibility.

Evidence: `pnpm exec vitest run src/services/browser/browserEventBroker.test.ts
--maxWorkers=1` — 5 passed.

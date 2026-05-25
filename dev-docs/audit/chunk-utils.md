# Audit: Utils + Export

**Scope:** `src/utils/`, `src/export/`
**Files scanned:** ~146 source files (excluding test files)
**Findings:** 13

---

## Critical (must fix)

### [C1] Stack overflow on large font binary data — `btoa(String.fromCharCode(...data))`

- **File:** `src/export/fontEmbedder.ts:141` and `src/export/fontEmbedder.ts:216`
- **Issue:** Both `fontDataToDataUri` and `fetchFontAsDataUri` call `btoa(String.fromCharCode(...data))` where `data` is a `Uint8Array`. The spread operator passes every byte as a separate argument. V8's argument limit is ~65,536. KaTeX woff2 fonts are typically 80-200KB. Any font above ~65K bytes throws "Maximum call stack size exceeded." In `fetchFontAsDataUri` this is silently swallowed; in `fontDataToDataUri` there is no try/catch — it crashes the export pipeline.
- **Fix:** Use chunked accumulation:
  ```ts
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return `data:font/woff2;base64,${btoa(binary)}`;
  ```

### [C2] Same stack overflow in image embedding

- **File:** `src/export/resourceResolver.ts:130`
- **Issue:** `fileToDataUri` reads a full image with `readFile` then calls `btoa(String.fromCharCode(...data))`. Large images (PNG screenshots, photos) easily exceed the V8 argument limit. Crashes standalone HTML export for documents with large local images.
- **Fix:** Same chunked approach as C1.

### [C3] Unsafe `as Error & { cause?: unknown }` cast

- **File:** `src/utils/markdownPipeline/adapter.ts:69` and `:99`
- **Issue:** Violates AGENTS.md rule against `as Error` casts. Although `wrapped` is a freshly constructed `new Error()`, the ES2022 constructor supports `{ cause }` natively.
- **Fix:** `const wrapped = new Error(message, { cause: error });`

---

## Warning (should fix)

### [W1] 41 bare `console.log` calls in `hotExit/` — no debug logger

- **Files:** `useHotExitRestore.ts` (22), `restartWithHotExit.ts` (15), `useHotExitStartup.ts` (1), `useHotExitCapture.ts` (3)
- **Issue:** No `hotExitLog` in `debug.ts`. All 41 calls fire unconditionally in production.
- **Fix:** Add `hotExitLog` to `debug.ts` and replace all calls.

### [W2] Bare `console.log` in `imageResize.ts` — fires every image paste/drop

- **File:** `src/utils/imageResize.ts:185`
- **Issue:** Fires on every image paste/drop when auto-resize enabled.
- **Fix:** Add `imageResizeLog` to `debug.ts`.

### [W3] Bare `console.*` in multiple production utility files

- **Files:** `saveToPath.ts:64,99`, `workspaceStorage.ts:85`, `resolveMediaSrc.ts:82,88,105`, `sourcePeek.ts:171`, `imageHashRegistry.ts:53,59,77`, `fontEmbedder.ts:98,241`, `resourceResolver.ts:113,133,197,259,275`
- **Issue:** Bare `console.warn`/`console.error` for non-critical diagnostics in production. `saveToPath.ts:64` is also redundant with `toast.error`.
- **Fix:** Add per-subsystem loggers (`mediaLog`, `exportLog`) or use existing ones (e.g., `historyLog` for `saveToPath.ts:99`).

### [W4] `resizeImageFileIfNeeded` is dead code

- **File:** `src/utils/imageResize.ts:203-207`
- **Issue:** Exported one-line passthrough with zero callers.
- **Fix:** Remove entirely.

### [W5] Dead exported API in `fontEmbedder.ts` and `themeSnapshot.ts`

- **Files:** `fontEmbedder.ts` (`embedFonts`, `getFontsFromSettings`, `generateExportFontCSS`) and `themeSnapshot.ts` (`capturePartialSnapshot`)
- **Issue:** Re-exported from `src/export/index.ts` but have no callers. Superseded API.
- **Fix:** Remove functions and re-exports.

### [W6] File size violations

| File | Lines |
|---|---|
| `src/services/persistence/hotExit/useHotExitRestore.ts` | 497 |
| `src/utils/markdownPipeline/mdastBlockConverters.ts` | 444 |
| `src/utils/openPolicy.ts` | 433 |
| `src/utils/textTransformations.ts` | 388 |
| `src/utils/exportNaming.ts` | 324 |
| `src/utils/markdownPipeline/parser.ts` | 320 |

- **Fix:** `useHotExitRestore.ts` — extract 6 private helpers into `restoreHelpers.ts`. `textTransformations.ts` — split case transforms. `exportNaming.ts` — move sanitize helpers to `fileNameUtils.ts`.

### [W7] `getKaTeXFontCSS()` duplicates font data already in `getKaTeXFontFiles()`

- **File:** `src/export/fontEmbedder.ts:149-204`
- **Issue:** Hardcodes 8 `@font-face` blocks. `getKaTeXFontFiles()` already returns the same metadata. CDN URL redeclared inline instead of using module-level `KATEX_CDN_BASE` constant — sync hazard.
- **Fix:** Replace body with `return generateLocalFontCSS(getKaTeXFontFiles(), KATEX_CDN_BASE);`

---

## Info (consider)

### [I1] `perfLog.ts` bare `console.log` is intentional and acceptable

- **File:** `src/utils/perfLog.ts`
- **Note:** All 7 calls gated by `if (!PERF_ENABLED()) return` checking `localStorage`. Zero output in production without opt-in.

### [I2] Module-level mutable flag in `useHotExitRestore.ts` is a test hazard

- **File:** `src/services/persistence/hotExit/useHotExitRestore.ts:46`
- **Note:** `let mainWindowRestoreStarted = false` persists across test runs. Consider exporting a reset helper.

### [I3] `restartWithHotExit.ts` approaching 300-line limit (267 lines)

- **Note:** Currently within limit. Monitor as hot-exit protocol evolves.

---

## Summary

- **Critical:** 3
- **Warning:** 7
- **Info:** 3
- **Healthiest areas:** `crashRecovery.ts` (proper logger, atomic writes, full validation), `sanitize.ts` (thorough DOMPurify allowlists, XSS-safe), `openPolicy.ts` / `closeDecision.ts` (pure functions, well-tested), `exportNaming.ts` (comprehensive Windows-safe filename sanitization).
- **Most concerning areas:** `fontEmbedder.ts` + `resourceResolver.ts` (stack-overflow bug silently breaks standalone HTML export for math or large images), `hotExit/` subsystem (41 bare console calls, 497-line file).

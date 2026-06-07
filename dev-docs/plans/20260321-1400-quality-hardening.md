# Quality Hardening Plan

> **Status:** Shipped, except WI-003 (2 outstanding `expect()` calls) and WI-010 (residual `console.warn`).

---
title: "Comprehensive Quality Hardening"
created_at: "2026-03-21 14:00 CST"
mode: "full-plan"
branch: "quality/comprehensive-hardening"
---

## Outcomes

- **Desired behavior:**
  - Rust backend tests run in CI and cover all critical modules (hot_exit, mcp_bridge, window_manager, menu, ai_provider)
  - All production Rust code eliminates panicking unwrap()/expect() calls
  - Pandoc source_dir path traversal vulnerability is fixed
  - All modal/dialog components meet WCAG 2.1 AA focus management requirements
  - All interactive elements have visible `:focus-visible` indicators
  - All 239 console.error/warn/log calls migrate to the structured debug.ts logger system
  - MCP server tool arguments validated with proper type guards (no unsafe `as Type` casts)

- **Constraints:**
  - macOS is primary platform — all changes must preserve macOS behavior
  - No breaking changes to MCP protocol or tool schemas
  - Keep diffs focused — no drive-by refactors
  - TDD: write failing test first for every behavioral change
  - `pnpm check:all` must pass at every commit

- **Non-goals:**
  - E2E test suite (requires separate infrastructure work)
  - Feature flags system
  - Cross-platform test automation
  - Hooks directory reorganization (cosmetic, no quality impact)
  - ADR documentation expansion

## Constraints & Dependencies

- Runtime: Rust 1.x (stable), Node 22, pnpm
- OS: macOS primary (CI runs on ubuntu for frontend)
- External services: None (all changes are local)
- Required tools: `cargo`, `pnpm`, `vitest`
- Feature flags: None needed

## Current Behavior Inventory

### Rust Backend Testing
- 163 tests passing across 14 modules (1.09s runtime)
- `cargo test` NOT in any CI workflow
- Test infrastructure: tempfile, tokio test-util (unused), no mocking framework
- Patterns: inline `#[cfg(test)]` modules, fixture builders, concurrency tests

### Security
- Pandoc `source_dir` parameter passed to `--resource-path` without validation (commands.rs:133)
- `lib.rs:453` — `.expect()` on updater plugin header (startup panic risk)
- `lib.rs:653` — `.expect()` on app build (startup panic risk)
- MCP server tools use unsafe `as Type` casts without type guards (document.ts:144, 335)

### Accessibility
- Global `:where(*):focus-visible { outline: none }` reset in index.css
- HeadingPicker: createPortal without role="dialog", aria-modal, focus trap, or focus restoration
- 6 popup CSS files have `outline: none` without `:focus-visible` replacement
- Settings components (Toggle, Select, Button, CopyButton, TagInput, CollapsibleGroup) lack focus styling
- QuickOpen and GeniePicker already have aria-modal="true" + focus restoration (GOOD)

### Console Logging
- 175 console.error, 46 console.warn, 18 console.log in non-test src/ code
- 48 structured loggers already exist in debug.ts
- 20 new logger functions needed to cover all categories

## Target Rules

### R1: Rust tests in CI
- **Trigger:** Every PR and push to main
- **Behavior:** `cargo test --manifest-path src-tauri/Cargo.toml` runs in CI
- **Failure:** CI fails if any Rust test fails
- **Scope:** All `#[cfg(test)]` modules

### R2: No production panics
- **Trigger:** Any `.unwrap()`, `.expect()` in non-test Rust code
- **Behavior:** Must use `.map_err()` + `?` or `.unwrap_or_*()` with logged fallback
- **Exclusion:** Test code (`#[cfg(test)]` blocks) may use unwrap

### R3: Path validation before external tools
- **Trigger:** Any file path passed to Pandoc, shell, or external process
- **Behavior:** Canonicalize, check for traversal, verify within allowed directory
- **Scope:** pandoc/commands.rs, any future external tool integration

### R4: WCAG focus management for modals
- **Trigger:** Any component using createPortal or position:fixed overlay
- **Behavior:** Must have role="dialog", aria-modal="true", aria-label, focus trap, focus restoration
- **Scope:** HeadingPicker (currently missing), all future modals

### R5: Focus-visible on all interactive elements
- **Trigger:** Any element with `outline: none`
- **Behavior:** Must have a corresponding `:focus-visible` rule with visible indicator
- **Scope:** 6 popup CSS files + settings components

### R6: Structured logging only
- **Trigger:** Any error/warning output in production code
- **Behavior:** Must use debug.ts logger function, never bare console.*
- **Scope:** All src/ files except test files and perfLog.ts (opt-in dev tool)

## Decision Log

- **D1: Scope of Rust test additions**
  - Options: (a) Test every untested file, (b) Test critical paths only, (c) Add CI gate + critical tests
  - Decision: (c) — Add CI gate immediately, then write tests for highest-risk untested modules
  - Rationale: CI gate prevents regression NOW; test coverage grows incrementally
  - Rejected: (a) would take weeks and many modules are thin wrappers around Tauri APIs that can't be unit-tested without mocking framework

- **D2: Focus trap implementation**
  - Options: (a) Add focus-trap-react library, (b) Custom implementation, (c) Extend existing McpConfigPreviewDialog pattern
  - Decision: (c) — Extend the Tab-cycle pattern already in McpConfigPreviewDialog
  - Rationale: Already proven in codebase, no new dependency, consistent with existing patterns
  - Rejected: (a) adds dependency for one component; (b) reinvents wheel when pattern exists

- **D3: Console migration batch size**
  - Options: (a) All 239 at once, (b) By category in separate commits, (c) By severity (errors first)
  - Decision: (b) — One commit per handler category (history, fileOps, export, etc.)
  - Rationale: Smaller, reviewable commits; each category is self-contained
  - Rejected: (a) creates unreviewable mega-commit; (c) splits related files across commits

## Open Questions

- **Q1: Should we add mockall to Cargo.toml for Rust mocking?**
  - Why it matters: Some modules (window_manager, menu) need Tauri AppHandle mocks to test properly
  - Who decides: Xiaolai
  - Default if unresolved: Skip modules requiring AppHandle mocks; test pure logic only

- **Q2: Should settings components use Tailwind focus-visible or custom CSS?**
  - Why it matters: Settings page uses Tailwind classes; rest of app uses custom CSS
  - Who decides: Xiaolai
  - Default if unresolved: Use Tailwind `focus-visible:` classes since settings already uses Tailwind

## Work Items

### WI-001: Add cargo test to CI

- **Goal:** Ensure Rust test regressions are caught automatically
- **Acceptance:** CI workflow runs `cargo test` and fails on test failures
- **Tests (first):**
  - File: `.github/workflows/ci.yml`
  - Intent: Verify existing 163 tests pass in CI environment
- **Touched areas:**
  - File: `.github/workflows/ci.yml`
  - Symbols: New `rust-test` job
- **Dependencies:** None
- **Risks:** CI may need Rust toolchain setup; ubuntu runner may lack macOS-specific deps
  - Mitigation: Use `#[cfg(not(target_os = "macos"))]` to skip platform-specific tests; install Rust via dtolnay/rust-toolchain action
- **Rollback:** Revert CI change
- **Estimate:** S

### WI-002: Security — Validate Pandoc source_dir

- **Goal:** Prevent path traversal via Pandoc's `--resource-path` argument
- **Acceptance:** (1) `source_dir` with `..` is rejected with clear error. (2) `source_dir` is canonicalized before use. (3) Test covers traversal attempt, symlink, and valid path.
- **Tests (first):**
  - File: `src-tauri/src/pandoc/commands.rs` (inline `#[cfg(test)]`)
  - Intent: Test path traversal rejection, canonicalization, normal path acceptance
- **Touched areas:**
  - File: `src-tauri/src/pandoc/commands.rs` (lines 66–134)
  - Symbols: `convert_with_pandoc()` — add validation before `format!("--resource-path={}", dir)`
- **Dependencies:** None
- **Risks:** Overly strict validation could reject legitimate paths with symlinks
  - Mitigation: Canonicalize first (resolves symlinks), then check prefix
- **Rollback:** Revert the validation function
- **Estimate:** S

### WI-003: Security — Replace expect() with graceful errors in lib.rs

- **Goal:** Eliminate startup panics from malformed machine ID or build failures
- **Acceptance:** (1) Invalid machine ID falls back to empty string with warning log. (2) Tauri build failure produces user-readable error, not panic. (3) No `.expect()` calls remain in lib.rs.
- **Tests (first):**
  - File: `src-tauri/src/lib.rs` (inline `#[cfg(test)]`)
  - Intent: Test machine ID header creation with invalid input; verify error propagation
- **Touched areas:**
  - File: `src-tauri/src/lib.rs` (lines 453, 653)
  - Symbols: Updater plugin setup, `run()` builder chain
- **Dependencies:** None
- **Risks:** Low — changing `.expect()` to `.unwrap_or_default()` or `match` is safe
- **Rollback:** Revert two lines
- **Estimate:** S

### WI-004: Security — MCP server type validation

- **Goal:** Replace unsafe `as Type` casts with proper type guards in MCP server tools
- **Acceptance:** (1) All `args.*` accesses use typeof checks or Zod validation. (2) Invalid types return clear error responses. (3) Tests cover type mismatch scenarios.
- **Tests (first):**
  - File: `vmark-mcp-server/__tests__/unit/tools/document.test.ts`
  - Intent: Test type validation for action, mode, operations arguments
- **Touched areas:**
  - File: `vmark-mcp-server/src/tools/document.ts` (lines 144, 335, 336, 401)
  - Symbols: `handleDocumentTool()`, argument extraction sections
- **Dependencies:** None
- **Risks:** Low — adding validation only rejects currently-invalid inputs
- **Rollback:** Revert type guard additions
- **Estimate:** S

### WI-005: Accessibility — HeadingPicker ARIA + focus trap

- **Goal:** Make HeadingPicker accessible to keyboard and screen reader users
- **Acceptance:** (1) Portal div has `role="dialog"`, `aria-modal="true"`, `aria-label`. (2) Tab key cycles within picker (focus trap). (3) Focus restored to previous element on close. (4) VoiceOver announces picker as dialog.
- **Tests (first):**
  - File: `src/components/Editor/HeadingPicker.test.tsx` (new or extend existing)
  - Intent: Test aria attributes rendered, Tab trapping, Escape closes and restores focus
- **Touched areas:**
  - File: `src/components/Editor/HeadingPicker.tsx` (lines 208–250)
  - Symbols: Portal render, keyboard handler, useEffect cleanup
- **Dependencies:** None
- **Risks:** Focus trap may interfere with editor focus restoration
  - Mitigation: Use requestAnimationFrame for focus restoration (pattern from QuickOpen)
- **Rollback:** Revert component changes
- **Estimate:** M

### WI-006: Accessibility — Missing focus-visible in popup CSS

- **Goal:** All interactive elements in popup plugins have visible keyboard focus indicators
- **Acceptance:** (1) Each `outline: none` has a corresponding `:focus-visible` rule. (2) Focus indicators follow patterns from `33-focus-indicators.md`. (3) Visual verification in both light and dark themes.
- **Tests (first):**
  - No automated test (CSS-only change)
  - Manual test: Tab through each popup, verify focus is visible
- **Touched areas:**
  - Files (6): `source-image-popup.css`, `mermaid-preview.css`, `source-peek-inline.css`, `link-create-popup.css`, `source-wiki-link-popup.css`, `footnote-popup.css`
  - Symbols: `:focus-visible` rules for inputs and buttons
- **Dependencies:** None
- **Risks:** Low — additive CSS only
- **Rollback:** Revert CSS additions
- **Estimate:** S

### WI-007: Accessibility — Settings components focus styling

- **Goal:** All settings page interactive elements have visible focus indicators
- **Acceptance:** (1) Toggle, Select, Button, CopyButton, TagInput remove button, CollapsibleGroup button all have `:focus-visible` styling. (2) Uses Tailwind `focus-visible:` classes consistent with settings page patterns.
- **Tests (first):**
  - No automated test (CSS-only change)
  - Manual test: Tab through settings page, verify all controls show focus
- **Touched areas:**
  - File: `src/pages/settings/components.tsx`
  - Symbols: Toggle, Select, Button, CopyButton, TagInput, CollapsibleGroup components
- **Dependencies:** None
- **Risks:** Low — additive Tailwind classes only
- **Rollback:** Revert class additions
- **Estimate:** S

### WI-008: Add 20 error loggers to debug.ts

- **Goal:** Create structured error loggers for all categories currently using bare console.error
- **Acceptance:** (1) 20 new error loggers exported from debug.ts. (2) Each follows existing pattern (dev: console.error with tag, prod: prodError with tag). (3) No bare console.error calls remain outside debug.ts (excluding test files and perfLog.ts).
- **Tests (first):**
  - File: `src/utils/debug.test.ts` (extend if exists, create if not)
  - Intent: Verify new loggers export correctly and follow naming convention
- **Touched areas:**
  - File: `src/utils/debug.ts`
  - Symbols: 20 new exports (historyError, fileOpsError, fileExplorerError, menuError, smartPasteError, dragDropError, linkPopupError, mediaPopupError, wikiLinkPopupError, pasteError, imageHandlerError, sourceActionError, exportError, genieError, imageContextError, tabContextError, tiptapError, footnotePopupError, mcpBridgeError, appError)
- **Dependencies:** None
- **Risks:** Low — additive exports only
- **Rollback:** Revert debug.ts additions
- **Estimate:** S

### WI-009: Migrate console.error calls to debug loggers (batch by category)

- **Goal:** Replace all 175 console.error calls with structured loggers
- **Acceptance:** (1) Zero console.error calls in src/ outside debug.ts, test files, and App.tsx ErrorBoundary. (2) All error output uses named loggers from debug.ts. (3) Error labels are consistent with logger names.
- **Tests (first):**
  - File: CI lint — add `pnpm lint:console` script that greps for bare console.error
  - Intent: Prevent regression after migration
- **Touched areas:**
  - Files: ~45 source files across hooks/, plugins/, components/, export/
  - Symbols: Replace `console.error("[Tag]", ...)` with `tagError(...)`
- **Dependencies:** WI-008 (loggers must exist first)
- **Risks:** Typos in import paths could break builds
  - Mitigation: `pnpm check:all` catches import errors; commit per category for reviewability
- **Rollback:** Revert individual category commits
- **Estimate:** L

### WI-010: Migrate console.warn calls to debug loggers

- **Goal:** Replace all 46 console.warn calls with structured loggers
- **Acceptance:** (1) Zero console.warn calls in src/ outside debug.ts and test files. (2) All warning output uses named loggers from debug.ts.
- **Tests (first):**
  - Extend `pnpm lint:console` to cover console.warn
- **Touched areas:**
  - Files: ~20 source files
  - Symbols: Replace `console.warn("[Tag]", ...)` with `tagWarn(...)`
- **Dependencies:** WI-008
- **Risks:** Same as WI-009
- **Rollback:** Revert individual commits
- **Estimate:** M

### WI-011: Rust backend tests — mcp_bridge/state.rs expansion

- **Goal:** Expand MCP bridge state tests for edge cases
- **Acceptance:** (1) Test all read-only operation classifications. (2) Test webview liveness detection edge cases. (3) Increase mcp_bridge test coverage to >80%.
- **Tests (first):**
  - File: `src-tauri/src/mcp_bridge/state.rs` (extend existing #[cfg(test)])
  - Intent: Exhaustive operation classification, concurrent state access
- **Touched areas:**
  - File: `src-tauri/src/mcp_bridge/state.rs`
- **Dependencies:** WI-001 (CI must run cargo test)
- **Risks:** Low — test-only additions
- **Rollback:** Remove new tests
- **Estimate:** S

### WI-012: Rust backend tests — pandoc module

- **Goal:** Test Pandoc command construction and error handling
- **Acceptance:** (1) Tests verify correct Pandoc argument assembly. (2) Tests cover extension allowlist enforcement. (3) Tests cover error path (missing Pandoc, invalid input).
- **Tests (first):**
  - File: `src-tauri/src/pandoc/commands.rs` (new #[cfg(test)] module)
  - Intent: Argument construction, extension validation, error paths
- **Touched areas:**
  - File: `src-tauri/src/pandoc/commands.rs`
- **Dependencies:** WI-002 (source_dir validation)
- **Risks:** Tests may need to mock Command execution
  - Mitigation: Extract argument-building logic into pure function, test that
- **Rollback:** Remove test module
- **Estimate:** M

### WI-013: Rust backend tests — quit module expansion

- **Goal:** Expand quit confirmation tests for edge cases
- **Acceptance:** (1) Test double-quit within timeout. (2) Test quit after timeout reset. (3) Test concurrent quit requests.
- **Tests (first):**
  - File: `src-tauri/src/quit.rs` (extend existing tests)
  - Intent: Timing edge cases, concurrent access
- **Touched areas:**
  - File: `src-tauri/src/quit.rs`
- **Dependencies:** WI-001
- **Risks:** Low
- **Rollback:** Remove new tests
- **Estimate:** S

### WI-014: Console lint CI gate

- **Goal:** Prevent new bare console.* calls from being introduced
- **Acceptance:** (1) `pnpm lint:console` script checks for bare console.error/warn/log in src/ (excluding allowed files). (2) Integrated into `pnpm check:all`. (3) Allowlist for ErrorBoundary, perfLog.ts, debug.ts.
- **Tests (first):**
  - Run the script against current codebase — should fail before migration, pass after
- **Touched areas:**
  - File: `package.json` (new script)
  - File: New lint script file (e.g., `scripts/lint-console.sh`)
- **Dependencies:** WI-009, WI-010 (all migrations must complete first)
- **Risks:** False positives from comments or strings containing "console.error"
  - Mitigation: Use grep with proper patterns; allowlist specific files
- **Rollback:** Remove script and package.json entry
- **Estimate:** S

## Testing Procedures

- **Fast checks:** `cargo test --manifest-path src-tauri/Cargo.toml` (Rust), `pnpm test` (frontend)
- **Full gate:** `pnpm check:all` + `cargo test --manifest-path src-tauri/Cargo.toml`
- **When to run:**
  - After every WI: fast check for the affected area
  - Before pushing: full gate
  - After WI-001: verify CI runs both frontend and Rust tests

## Manual Test Checklist

- [ ] Tab through HeadingPicker — focus stays inside picker, Escape restores focus
- [ ] Tab through all 6 popup types — focus indicators visible on every interactive element
- [ ] Tab through Settings page — all controls show focus
- [ ] Export via Pandoc with normal document — still works after source_dir validation
- [ ] App launches without crash after lib.rs expect → graceful error change
- [ ] Open MCP tool with invalid args — returns clear error, doesn't crash
- [ ] Verify both light and dark themes show focus indicators
- [ ] VoiceOver announces HeadingPicker as dialog

## Plan → Verify Handoff

**Per-WI evidence:**

| WI | Evidence |
|----|----------|
| WI-001 | CI workflow green with Rust test step |
| WI-002 | `cargo test` — pandoc path traversal test passes |
| WI-003 | `cargo test` — lib.rs error handling test passes; app launches normally |
| WI-004 | `pnpm test` — MCP tool type validation tests pass |
| WI-005 | `pnpm test` — HeadingPicker a11y tests pass; manual VoiceOver check |
| WI-006 | Manual: Tab through popups in both themes, screenshot focus states |
| WI-007 | Manual: Tab through settings in both themes |
| WI-008 | `pnpm test` passes; debug.ts exports all 20 new loggers |
| WI-009 | `grep -r "console\.error" src/ --include="*.ts" --include="*.tsx"` returns only allowed files |
| WI-010 | `grep -r "console\.warn" src/ --include="*.ts" --include="*.tsx"` returns only allowed files |
| WI-011–013 | `cargo test` — new tests pass |
| WI-014 | `pnpm lint:console` passes; `pnpm check:all` includes it |

## Execution Order

```
Phase 1 — Security & CI Foundation (WI-001, WI-002, WI-003, WI-004)
  ↓
Phase 2 — Accessibility (WI-005, WI-006, WI-007)
  ↓
Phase 3 — Logging Infrastructure (WI-008)
  ↓
Phase 4 — Console Migration (WI-009, WI-010) — can parallelize by category
  ↓
Phase 5 — Rust Test Expansion (WI-011, WI-012, WI-013)
  ↓
Phase 6 — CI Lint Gate (WI-014) — must be last (requires all migrations complete)
```

# i18n Polish + Announce Plan — 2026-04-19

Branch: `feat/i18n-polish`
Worktree: `/Users/joker/github/xiaolai/myprojects/vmark-i18n`

## Goal

Close the remaining gaps between "app is technically multilingual" and "app ships as an international product". Four bounded phases, each independently shippable.

VMark already has:
- React i18next with 10 locales (en, zh-CN, zh-TW, ja, ko, de, es, fr, it, pt-BR) and ~1,136 keys across 9 namespaces.
- Rust `rust-i18n` with the same 10 locales, full menu translation, `set_locale` command.
- VitePress website with all 32 guide pages translated to all 10 locales.
- Single multilingual binary — every build already ships every locale.

The missing pieces are:
1. First-run defaults to `"en"` regardless of OS language.
2. ~71 Rust error strings leak English on failure paths (file I/O, Pandoc).
3. The `translate-docs` skill covers `website/**/*.md` only, not `src/locales/` or `src-tauri/locales/`.
4. No language-related release messaging exists.

## Non-goals

- Do NOT migrate away from `rust-i18n` or i18next.
- Do NOT refactor the locale file layout (`src/locales/{lang}/{namespace}.json`, `src-tauri/locales/{lang}.yml`).
- Do NOT localize developer-only strings — `console.log/warn/error`, debug logger calls, panic messages, log file entries stay English.
- Do NOT set up Crowdin / Weblate / external TMS — out of scope for this plan.
- Do NOT add new locales. Scope is the existing 10.
- Do NOT touch mobile / Tauri iOS or Android. Desktop-only.

If you feel the urge to do any of these mid-phase — stop.

---

## Phase 1 — OS language auto-detection on first launch (~1 day)

**Why first:** smallest change, highest user-visible impact, unblocks "just install and it works" messaging for non-English users.

### The problem

`src/stores/settingsStore.ts:142` hardcodes `language: "en"` in the default settings object. On first launch, i18next reads this default (`src/i18n.ts:53`) and the UI renders in English even on a Japanese macOS.

Existing users have a persisted `general.language` — their setting must NOT change.

### Design

Replace the hardcoded `"en"` default with **lazy OS-locale resolution**, applied only when there is no persisted value. Zustand `persist` already handles the "is there a saved value" check — we just need the default to compute from the OS.

1. Add a `resolveInitialLanguage()` helper in `src/utils/localeDetect.ts` (new file):
   - Read `navigator.language` and `navigator.languages`.
   - Match against the 10 supported codes with a fallback chain:
     - `zh-Hans-*`, `zh-CN`, `zh-SG` → `zh-CN`
     - `zh-Hant-*`, `zh-TW`, `zh-HK`, `zh-MO` → `zh-TW`
     - `pt-BR`, `pt-PT`, `pt` → `pt-BR`
     - Exact match for `en`, `ja`, `ko`, `de`, `es`, `fr`, `it`.
     - Anything else → `"en"`.
   - Pure function, easy to test.
2. In `settingsStore.ts`, change `language: "en"` in `initialState.general` to `language: resolveInitialLanguage()`.
   - Called once at module load. Existing persisted settings override this — verified via Zustand `persist` merge semantics.
3. In `src/i18n.ts`, after `useSettingsStore.getState().general.language` resolves, ensure `document.documentElement.lang` is synced (already done — confirm).

### Tests (RED first)

`src/utils/localeDetect.test.ts` — new:
- `navigator.language = "en-US"` → `"en"`.
- `navigator.language = "zh-CN"` → `"zh-CN"`.
- `navigator.language = "zh-Hans-SG"` → `"zh-CN"`.
- `navigator.language = "zh-TW"` → `"zh-TW"`.
- `navigator.language = "zh-Hant-HK"` → `"zh-TW"`.
- `navigator.language = "pt-PT"` → `"pt-BR"`.
- `navigator.language = "ja"` → `"ja"`.
- `navigator.language = "ru"` (unsupported) → `"en"`.
- `navigator.language = undefined` → `"en"`.
- `navigator.languages = ["fr-CA", "en-US"]`, primary unsupported → first supported fallback `"en"` OR fuzzy `"fr"`. Decide: prefer `"fr"` (base-language match).
- Mixed case: `"zh-hans-cn"` → `"zh-CN"`.

Store test `src/stores/settingsStore.test.ts`:
- With no persisted storage + mocked `navigator.language = "ja"`, initial state has `general.language === "ja"`.
- With persisted `{general: {language: "en"}}` + mocked `navigator.language = "ja"`, initial state has `general.language === "en"` (persisted wins).

### Acceptance

- [ ] New install on Japanese macOS opens in Japanese.
- [ ] New install on `LANG=fr_FR.UTF-8` Linux opens in French.
- [ ] Existing installs (upgraders) keep their persisted choice.
- [ ] Language picker in Settings still works live (no regression).
- [ ] `pnpm check:all` green.

### Files touched

- `src/utils/localeDetect.ts` (new, ~40 lines)
- `src/utils/localeDetect.test.ts` (new, ~60 lines)
- `src/stores/settingsStore.ts` (1-line change)
- `src/stores/settingsStore.test.ts` (2 new cases)

---

## Phase 2 — Rust error strings (~3–5 days)

**Why second:** largest scope, structural groundwork (new error keys namespace) benefits later maintenance.

### The problem

`rust-i18n` is only wired into `src-tauri/src/menu/localized.rs`. The 10 YAML locale files have one top-level namespace — `menu:` — and nothing else.

Error strings across Rust commands (Pandoc export, hot-exit storage, menu dynamic updates, workflow runner, genies, cli_install, etc.) use `format!("Failed to …: {}", e)` inline. Top 3 hotspots:
- `src-tauri/src/hot_exit/storage.rs` — 30 occurrences
- `src-tauri/src/menu/dynamic.rs` — 27 occurrences
- `src-tauri/src/workflow/runner.rs` — 25 occurrences

These errors return to the frontend as `Result<T, String>` and surface via `sonner` `toast.error(...)` in components like `TabContextMenu.tsx`, image handlers, export flows.

### Design

Two-layer approach:

**Layer A: key-based errors for user-facing paths.**
- Add `errors:` top-level namespace to each `src-tauri/locales/*.yml`.
- Introduce a `vmark_error!(key, arg1=value1, …)` helper macro in `src-tauri/src/errors.rs` (new, ~40 lines) that wraps `rust_i18n::t!()` with interpolation.
- Migrate **only user-facing error paths** — errors that reach a toast or dialog. Not every `map_err` in a helper function.

**Layer B: leave developer-facing errors English.**
- Panics, log messages, debug output, internal plumbing errors (e.g., "BUG: queue empty") remain untranslated. They go to `~/Library/Logs/vmark/...` and are for us, not users.

### Classification (do this FIRST)

Before touching any file, produce `dev-docs/plans/20260419-rust-error-audit.csv` (committed) with columns:
- `file:line`
- `error text`
- `classification: user-facing | dev-only | borderline`
- `new key (if user-facing)`

Criteria:
- **user-facing**: error propagates from a `#[tauri::command]` return `Result<_, String>` AND there's a `toast.error` / dialog showing the string on the React side.
- **dev-only**: error is logged via `log::error!`, never shown in UI, or message contains developer context (e.g., "mutex poisoned", "channel closed").
- **borderline**: shown in UI but only in debug builds / dev tools — default to dev-only.

Target: migrate ~40–50 user-facing errors. Leave the other ~25 alone.

### en.yml structure (proposed)

```yaml
menu:
  # existing keys, unchanged
errors:
  file:
    readFailed: "Failed to read file: %{detail}"
    writeFailed: "Failed to write file: %{detail}"
    notFound: "File not found: %{path}"
    permissionDenied: "Permission denied: %{path}"
  pandoc:
    notInstalled: "Pandoc is not installed. Install it to enable export."
    exitedWithCode: "Pandoc exited with code %{code}"
    startFailed: "Failed to start Pandoc: %{detail}"
  export:
    invalidSourceDir: "Invalid source directory '%{dir}': %{detail}"
    notADirectory: "'%{dir}' is not a directory"
  storage:
    appDataUnavailable: "Failed to get app data directory: %{detail}"
    jsonSerializeFailed: "Failed to save session state: %{detail}"
  genie:
    pathOutsideAllowed: "Genie path is outside allowed directories"
  workspace:
    cliInstallSilentFail: "Installation appeared to succeed but the file was not created."
```

Group keys by module. Keep placeholders as `%{name}` (rust-i18n syntax).

### Error helper

```rust
// src-tauri/src/errors.rs
#[macro_export]
macro_rules! vmark_error {
    ($key:expr) => { rust_i18n::t!($key).to_string() };
    ($key:expr, $($arg:ident = $val:expr),+ $(,)?) => {
        rust_i18n::t!($key, $($arg = $val),+).to_string()
    };
}
```

Usage migration example:

```rust
// BEFORE
.map_err(|e| format!("Failed to get app data dir: {}", e))?;

// AFTER
use crate::vmark_error;
.map_err(|e| vmark_error!("errors.storage.appDataUnavailable", detail = e.to_string()))?;
```

### Migration order

1. Scaffolding: add `errors:` namespace to `en.yml` only, add `errors.rs` helper, migrate ONE hotspot (`hot_exit/storage.rs`). Ship.
2. Migrate `pandoc/commands.rs` (export errors — high user visibility).
3. Migrate remaining user-facing hotspots per audit CSV.
4. Copy `errors:` namespace to 9 other YAML files with English values.
5. Extend `translate-docs` skill scope (see Phase 3) OR translate manually (small, one-time).

### Tests

Rust:
- `src-tauri/src/errors.rs` unit tests: `vmark_error!("errors.pandoc.exitedWithCode", code = 2)` returns `"Pandoc exited with code 2"` when locale is `en`.
- Switch locale to `zh-CN` via `rust_i18n::set_locale("zh-CN")` and assert translated output.
- Missing-key case: calling with a non-existent key returns the key itself (rust-i18n default) — regression test so we notice typos.

Frontend:
- No new tests — errors are already rendered via `toast.error`, the data shape doesn't change.

### Acceptance

- [ ] `src-tauri/locales/en.yml` has `errors:` namespace populated.
- [ ] All 9 non-English YAMLs have `errors:` namespace translated.
- [ ] Audit CSV shows every row is either migrated or explicitly marked dev-only.
- [ ] Switching UI language and triggering an export error shows the toast in the UI language.
- [ ] `pnpm check:all` green, `cargo test` green.
- [ ] Manual test: Japanese UI + force a Pandoc failure → toast renders in Japanese.

### Files touched

- `src-tauri/src/errors.rs` (new)
- `src-tauri/src/lib.rs` (add `mod errors;`, re-export macro)
- `src-tauri/locales/*.yml` (all 10 — add `errors:` tree)
- `src-tauri/src/{hot_exit,pandoc,menu,workflow,genies,cli_install,…}/*.rs` (migration sites)
- `dev-docs/plans/20260419-rust-error-audit.csv` (audit artifact)

---

## Phase 3 — Extend `translate-docs` skill to cover app strings (~2 days)

**Why third:** Phase 2 produces ~50 new English error strings in `en.yml`. Without automation, keeping 9 other YAMLs synced becomes manual work forever. Extending the skill solves it before the debt compounds.

### Current skill

`.claude/skills/translate-docs/SKILL.md` — three-stage pipeline (translate → audit → cultural polish), 9 locales in parallel via subagents, scoped to `website/**/*.md` only.

### Extension design

Add a second mode to the same skill, invoked as `/translate-docs --app` or similar. The skill learns three new targets:

1. **React namespaces**: `src/locales/en/*.json` → write to `src/locales/{locale}/*.json`.
2. **Rust YAML**: `src-tauri/locales/en.yml` → merge into `src-tauri/locales/{locale}.yml`.
3. **Sync mode**: detect keys present in `en` but missing in a target locale; translate only the missing subset. Do NOT retranslate existing keys (risk of unwanted churn).

### Skill work

Update `.claude/skills/translate-docs/SKILL.md`:
- New section "App string mode" with invocation, target files, sync semantics.
- Reuse the same subagent-per-locale pattern.
- Reuse the audit stage — but adapted: JSON/YAML structural diff instead of markdown heading-count check.
- Reuse cultural polish for CJK (fullwidth punctuation in UI strings matters — "保存文件。" not "保存文件.").

### Preservation rules (new, must be in the prompt)

- Keep all keys identical across locales — never rename.
- Preserve placeholders verbatim: `{{username}}` (i18next), `%{detail}` (rust-i18n). NEVER translate placeholder names.
- Preserve JSON/YAML structure (no reordering, no comment loss).
- Keep HTML entities and emoji as-is.
- Numeric arguments, keyboard shortcut names (`Cmd+S`), technical terms (`Markdown`, `Pandoc`, `YAML`) — do NOT translate.

### Tests

Skill testing is manual (subagent behavior). Validation is:
1. Run `/translate-docs --app` against a deliberately-stubbed `en.yml` with 3 new keys and no other changes.
2. Verify: only those 3 keys get added to each target YAML; no existing values modified.
3. Verify: CJK locales use fullwidth punctuation.
4. Verify: placeholders survive round-trip (`%{detail}` still `%{detail}` in zh-CN).

Add the above as a section in SKILL.md under "Verification".

### Acceptance

- [ ] SKILL.md has App string mode documented.
- [ ] Dry run on a single added key successfully propagates to all 9 locales.
- [ ] After Phase 2 completes, running the skill once syncs all new `errors.*` keys to all 9 YAMLs with no manual editing.
- [ ] Existing translations are untouched (git diff confirms only additions).

### Files touched

- `.claude/skills/translate-docs/SKILL.md` (extend)
- Potentially `.claude/skills/translate-docs/prompts/*.md` if the skill uses extracted prompts (check current structure first).

---

## Phase 4 — Announce ready (~0.5 day)

**Why last:** only after 1–3 land is "international" true in the product sense.

### Tasks

1. Landing page: `website/index.md` (and all 9 locale equivalents) — add a small "Available in 10 languages" line or flag row.
2. Release notes for the next version bump: highlight auto-detect + localized errors. One paragraph.
3. `README.md` top: add a language-flag selector pointing to `website/{locale}/`.
4. Social / GitHub Discussions post template (draft only, don't auto-post) in `dev-docs/announcements/20260419-i18n-ga.md`.

### Acceptance

- [ ] Landing page shows language availability.
- [ ] Version bumped per `.claude/rules/40-version-bump.md` (all 5 files).
- [ ] Release notes mention auto-detect and localized errors.

### Files touched

- `website/**/index.md`
- `README.md`
- `dev-docs/announcements/20260419-i18n-ga.md` (new)
- version files (per the bump rule)

---

## Total effort

| Phase | Estimate | Risk | Shippable alone? |
|-------|----------|------|------------------|
| 1 — OS auto-detect | 1 day | Low | Yes |
| 2 — Rust error i18n | 3–5 days | Medium (audit scope) | Yes |
| 3 — Extend skill | 2 days | Low | Yes (no code impact) |
| 4 — Announce | 0.5 day | Low | Yes |
| **Total** | **6.5–8.5 days** | — | — |

## Order of operations

Phase 1 → Phase 2 → Phase 3 → Phase 4. No parallelism — each depends on the previous.

Exception: Phase 3's skill extension can be drafted in parallel with Phase 2's audit CSV work — both are prep, neither ships without the other.

## Rollback

Each phase is a separate PR against `feat/i18n-polish`. If Phase 2 regresses export flows, revert that PR only; Phase 1 stands alone.

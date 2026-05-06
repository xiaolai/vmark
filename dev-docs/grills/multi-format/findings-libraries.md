# Phase 0 — WI-0.5 + WI-0.6 — Library + community pack audit

**Date:** 2026-05-06
**Auditor:** coding-researcher (Phase 0 spike)
**Plan:** `dev-docs/plans/20260506-multi-format-rebrand.md`

## WI-0.5 — Tree preview library

| Library | Version | Weekly DL | Last commit | Last release | Stars | Issues | Virtualization | A11y (kbd / ARIA) | TS | License | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `@uiw/react-json-view` | 2.0.0-alpha.42 | 459,127 | 2026-04-21 | recent (alpha train) | 408 | 49 | No | Not documented | Yes (built-in `.d.ts`) | MIT | PASS but rough |
| `react-json-tree` | 0.20.0 | 819,406 | 2026-04-11 (monorepo) | 0.20.0 (active in `reduxjs/redux-devtools` monorepo) | 14,352 (monorepo) | 226 (monorepo) | No | Not documented | Yes (`@types` shipped) | MIT | PASS — plan's "unmaintained" tag is wrong |
| `react-json-view-lite` | 2.5.0 | 1,056,180 | 2026-02-16 | 2.5.0 | 242 | 8 | No | **Yes** — arrow-key navigation + collapse/expand, configurable `ariaLabels` (`expandJson` / `collapseJson`), explicit "better a11y support" in v2 changelog | Yes (written in TS) | MIT | **PASS — winner** |

All three clear AI gov rule 4 (>1000 weekly DL, commits in last 12 months, no published CVEs in npm/Snyk/GitHub Advisory DBs).

**Pick:** `react-json-view-lite` v2.5.0
**Mechanism:** It is the **only one of the three with documented keyboard navigation and ARIA labelling** (arrow-key tree traversal, screen-reader text via `ariaLabels` prop, dedicated v2 a11y release notes). VMark's accessibility-token + focus-indicator rules (`33-focus-indicators.md`) make a11y a hard requirement, not nice-to-have. Secondary: zero runtime deps and ~2.3 KB gzipped vs `@uiw`'s `@babel/runtime` dep + larger bundle, which matters per-tab.

**Trade-off accepted:** None of the three offer virtualization. For >10 MB JSON trees, the format adapter must either (a) gate behind a size threshold and fall back to source-only, or (b) virtualize at the adapter layer. Lite's smaller render footprint is the best base to add this on top of later.

**Rejected:**
- `@uiw/react-json-view` — alpha train (2.0.0-alpha.42 is the "stable"); 49 open issues against 408 stars is a high noise-to-signal ratio; no documented a11y story.
- `react-json-tree` — monorepo dilutes signal (the 14k stars / 226 issues are redux-devtools-wide), API requires more wrapping, no documented keyboard nav.

## WI-0.6 — Community pack + utility audit

| Package | Version | Weekly DL | Last commit | Stars | Issues | CVEs | License | Verdict |
|---|---|---|---|---|---|---|---|---|
| `codemirror-lang-mermaid` | 0.5.0 | 90,965 | **2023-09-14** (>2.5y stale) | 33 | 0 | None known | MIT | **SUFFICIENT-FALLBACK** — fails recency, passes everything else |
| `smol-toml` | 1.6.1 | 14,760,131 | 2026-03-23 | 279 | 8 | GHSA-v3rj-xjv7-4jmq + GHSA-pqhp-25j4-6hq9 (DoS via deeply nested / commented TOML; **both fixed in 1.6.1 and earlier**) | BSD-3-Clause | **PASS — winner for TOML** |
| `@iarna/toml` | 2.2.5 | 4,668,928 | **2024-05-30** (~24 mo stale) | 341 | 28 | None published | ISC | FALLBACK ONLY |
| Ruby CodeMirror 6 dedicated pack | — | — | — | — | — | — | — | **FAIL — no maintained Lezer pack exists** |
| Lua CodeMirror 6 dedicated pack | — | — | — | — | — | — | — | **FAIL — same as Ruby** |
| `@codemirror/legacy-modes` (covers Ruby + Lua via streaming-mode) | 6.5.2 | 1,612,541 | 2026-04-15 | 108 | 0 | None known | MIT | **PASS — sufficient substitute via `StreamLanguage.define()`** |
| `dompurify` | 3.4.2 | 36,795,587 | 2026-05-05 | 16,953 | 1 | CVE-2025-15599 (fixed 3.2.7), CVE-2026-0540 (fixed 3.3.2) — **3.4.2 contains both fixes** | MPL-2.0 OR Apache-2.0 | **PASS** |

### Verdicts against AI gov rule 4

- **`codemirror-lang-mermaid` — SUFFICIENT-FALLBACK.** 90k weekly DL, no CVEs, MIT, but last commit 2023-09-14 fails the implicit "<12 months" recency expectation. Mermaid grammar evolves slowly so functional risk is low; pin to `0.5.0` exactly, document staleness, plan a fork-or-replace task in v1.x backlog if upstream remains dormant past 2026-09 (3-year mark). **Use only for syntax-highlighting standalone `.mmd` files.**
- **`smol-toml` — PASS.** Active maintenance; prior DoS CVEs all fixed in current 1.6.1. Wrap `parse()`/`stringify()` in try/catch when reading user files.
- **`@iarna/toml` — FALLBACK ONLY.** Effectively unmaintained. Use only if `smol-toml` proves incompatible with a specific TOML edge case discovered later.
- **Ruby/Lua dedicated CM6 packs — FAIL.** No maintained Lezer-grammar package exists. **Substitute:** `@codemirror/legacy-modes/mode/{ruby,lua}` via `StreamLanguage.define()`. Legacy-modes itself is PASS (1.6M weekly DL, commits in last 3 weeks). This is the path CodeMirror's own docs recommend for languages without a Lezer port.
- **`dompurify` — PASS.** Pin `>=3.4.2` to avoid both 2025/2026 XSS CVEs. Defense-in-depth use only.

## Risks / blockers

- **None block Phase 1A.**
- **Phase 3 `.mmd` adapter (WI-3.1) carries a stale-dep risk** from `codemirror-lang-mermaid`. Mitigation: pin exact version, plan a fork-or-replace task in v1.x backlog.
- **Plan revision recommendation:** ADR-3 currently removes `.rb` and `.lua` from v1. Audit rescues both via `@codemirror/legacy-modes` — same path the plan already uses for TOML CodeMirror highlighting and `.sh`/`.bash`. Quality is "syntax-coloring only," fits ADR-3's viewer-mode posture. **Reinstate .rb and .lua for v1.**
- **Plan revision recommendation:** Background-area note about `react-json-tree` being "flagged unmaintained in original plan" is incorrect — actively maintained inside `reduxjs/redux-devtools`. Pick still stands on a11y grounds, but the framing was wrong.

## Sources

- [@uiw/react-json-view](https://registry.npmjs.org/@uiw/react-json-view)
- [react-json-tree](https://registry.npmjs.org/react-json-tree)
- [react-json-view-lite](https://registry.npmjs.org/react-json-view-lite) + [GitHub a11y in v2](https://github.com/AnyRoad/react-json-view-lite)
- [codemirror-lang-mermaid](https://registry.npmjs.org/codemirror-lang-mermaid) + [GitHub](https://github.com/inspirnathan/codemirror-lang-mermaid)
- [smol-toml](https://registry.npmjs.org/smol-toml) + [GHSA-v3rj-xjv7-4jmq](https://advisories.gitlab.com/pkg/npm/smol-toml/GHSA-v3rj-xjv7-4jmq/) + [GHSA-pqhp-25j4-6hq9](https://advisories.gitlab.com/pkg/npm/smol-toml/GHSA-pqhp-25j4-6hq9/)
- [@iarna/toml](https://registry.npmjs.org/@iarna/toml)
- [@codemirror/legacy-modes](https://registry.npmjs.org/@codemirror/legacy-modes) + [GitHub](https://github.com/codemirror/legacy-modes)
- [dompurify](https://registry.npmjs.org/dompurify) + [CVE-2025-15599](https://github.com/advisories/GHSA-v8jm-5vwx-cfxm) + [CVE-2026-0540](https://github.com/advisories/GHSA-v2wj-7wpq-c8vv)
- [CodeMirror Ruby discussion](https://discuss.codemirror.net/t/ruby-language/8889)

# Audit Findings

**Run**: audit-fix 20260807-193000 | **Scope**: uncommitted changes, filtered to files authored this session | **Audit type**: full (9-dim)
**Model**: gpt-5.6-sol | **Effort**: high | **Audit threads**: `019fdc17-8c2e-7c62-9903-042913234f67` (group 1), `019fdc17-8a0e-7c22-9d8e-7d3418430785` (group 3)
**Stalled groups**: 2 (`019fdc17-8833-79c0-9408-06f07936bee4`) and 4 (`019fdc17-8827-7952-8286-2f1877f142ae`) hit the 600s deadline — audited manually per `shared/fallback.md`.
**Status values**: open | fixed | not-fixed | partial | regressed | skipped

## Scope notes

- The config default is `mini`, but mini skips test files, `.json`, `.yaml`, `.md` and `.css`. This change set is test infrastructure plus config, so a strict mini audit would have covered exactly 2 files. Ran the **full** 9-dimension audit with test and config files explicitly included.
- 832 of the 867 changed files received exactly one added line (`// @vitest-environment node`) and nothing else — verified byte-exact (+28 bytes each, no other hunks). Audited as a class, not per file.
- Concurrent maintainer work in the tree (`scripts/clean-dev.*`, `dev-disk.*`, `tauri-wrapper.*`, `check-design-tokens.*`, `knip.json`, `.claude/rules/*`, CSS files) is **excluded** — not authored this session.

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | scripts/check-scripts-parity.test.mjs | 139 | High | D9 | `ROOTS` comment claims "the check below fails if one appears" for a test file outside the roots. It does not — `filesOnDisk()` only globs the roots, so such a file is invisible. The comment asserts the opposite of the behaviour. | Make the claim true: scan repo-wide and fail on an unclassified test file | fixed | 1 |
| 2 | scripts/check-scripts-parity.test.mjs | 182 | High | D7 | `INFRA_EXCLUDES` are `continue`d — skipped, never applied. A test file under a nested `node_modules/` or `dist/` inside a root counts as owned, so the partition can report green on files Vitest never runs. | Apply every exclude to the snapshot | fixed | 1 |
| 3 | scripts/check-scripts-parity.test.mjs | 240 | High | D7 | Dead-include detection tests each include against the raw snapshot, ignoring excludes. An include whose only matches are excluded reads as live while its tier runs zero tests. | Evaluate include-minus-exclude | fixed | 1 |
| 4 | scripts/check-scripts-parity.test.mjs | 152 | High | D7 | The partition gate rests on a hand-written glob→RegExp that silently mis-parses valid glob syntax (character classes, extglobs, negation, nested braces). A mis-parsed pattern yields a wrong partition that still reports green. | Reject unsupported syntax loudly; add conformance tests | fixed | 1 |
| 5 | scripts/check-scripts-parity.test.mjs | 250 | High | D7 | "gate self-tests run inside check:static, so CI still blocks on them" only checks package-script reachability. It never verifies `fe-static` is in the required `frontend` gate's `needs`, so the claim in its own name is unverified. | Parse ci.yml; assert the aggregator's needs and result-checking | fixed | 1 |
| 6 | package.json | 73 | High | D7 | The partition guard is discovered through the same `scripts/**` glob it polices — narrowing that glob removes the guard along with the tests it protects. | Assert the guard's own file is collected by some tier | fixed | 1 |
| 7 | vitest.gates.config.ts | 60 | High | D5 | Worker-policy expression duplicated verbatim from `vitest.config.ts`; future tuning drifts between tiers. | Extract one shared definition | fixed | 1 |
| 8 | vitest.config.ts | 121 | Medium | D7 | `include` accepts 8 extensions but the webkit/soak excludes match only `ts,tsx`. A `*.webkit.test.mjs` would run under jsdom and still appear correctly owned by the partition check. | Share one extension list across include and excludes | fixed | 1 |
| 9 | package.json | 17 | Medium | D7 | `test:changed` runs only the app tier, so editing a gate script under `scripts/` yields a green `check:fast` having run no gate self-test. | Document the gap in the stated blind spots | fixed | 1 |
| 10 | src/test/waitBudget.ts | 46 | Medium | D5 | The required ordering (wait budget < enclosing test timeout) exists only in prose; two independent magic numbers can drift into an invalid pair. | Derive the timeout from the wait plus named headroom | fixed | 1 |
| 11 | vitest.config.ts | 54 | Medium | D6 | `Math.max(4, …)` yields 4× oversubscription on a 1-core and 2× on a 2-core runner, contradicting the documented 1.6× policy which was measured only at 10 cores. | State the floor's purpose and bound it | fixed | 1 |
| 12 | vitest.gates.config.ts | 57 | Medium | D6 | The 1.6× ratio is copied from an app-tier sweep; the gate tier spawns subprocesses that consume CPU outside the worker, so the ratio is not established for this workload. | Measure the gate tier, or state it is inherited and unverified | fixed | 1 |
| 13 | vitest.config.ts | 61, 77 | Low | D9 | Stale counts: says 857 of 1,438; actual is 834 of 1,439. | Correct, or stop embedding volatile counts | fixed | 1 |
| 14 | AGENTS.md | 103, 113 | Low | D9 | Same stale counts (857 / 1,438). | Correct | fixed | 1 |
| 15 | src/test/nodeEnvironmentDirective.test.ts | 6, 8, 34 | Low | D9 | Same stale counts (857 / 1,438). | Correct | fixed | 1 |
| 16 | vitest.config.ts | 144 | Low | D9 | Coverage comment says script tests are "in the include glob above" — that glob is now `src/**` only. | Point at the gates config | fixed | 1 |
| 17 | vitest.config.ts / vitest.gates.config.ts / check-scripts-parity.test.mjs | 106 / 27 / 119 | Low | D9 | Comments say "two configs" partition the universe; the assertion actually spans four tiers (app, gates, webkit, soak). | Say four | fixed | 1 |
| 18 | scripts/check-rust-cache-parity.test.mjs | 100 | Low | D1 | `warm.on ?? warm[true]` — the `[true]` branch is dead: the `yaml` package parses YAML 1.2, where `on:` is the string key `"on"`. | Drop the dead branch or assert why it stays | fixed | 1 |

## Out of scope — pre-existing, not authored this session

Reported by the audit against files this session touched, but describing code that predates it. Listed so they are not lost; not fixed here, because changing them is unrelated to this work and `src/test/setup.ts`'s mocks feed ~1,400 tests.

| File:Line | Severity | Finding |
|---|---|---|
| src/test/setup.ts:151 | High | Promise-returning Tauri APIs mocked as bare `vi.fn()` returning `undefined`, hiding missing awaits on I/O paths |
| src/test/setup.ts:288 | High | Path mocks concatenate/split `/` with no normalization, so path-safety tests pass against unlike-Tauri behaviour |
| src/test/setup.ts:106 | High | `useTranslation` mock rejects namespace arrays, coercing them to keys like `"dialog,common"` |
| src/shell/AppShell.a11y.test.tsx:23, 79 | High | Landmarks come from test fixtures, and the complementary check passes with a null accessible name |
| scripts/check-scripts-parity.test.mjs:48 | High | Pre-existing CI assertions use raw `includes` and positional slices, satisfiable by a comment |
| src/test/setup.ts:80, 138 | Medium | Plural selection uses `count === 1` (diverges for -1); mocked `on`/`off` neither record nor dispatch |
| src/test/setup.ts:54 | Low | `walkNestedKey` dormant under the enforced flat-locale invariant (deliberate, documented) |
| package.json:1 | Low | No `engines` or `packageManager` pin |

---

## Round 2 — defects introduced by the round-1 fixes

Codex verified round 1 independently (thread `019fdc35-5868-7b91-961f-778aa354e6e6`)
and found three new defects in the fixes themselves, plus two findings not
actually resolved. All addressed in round 2.

| # | File | Severity | Finding | Status | Round |
|---|------|----------|---------|--------|-------|
| 19 | scripts/check-scripts-parity.test.mjs | High | The `website` exemption claimed another runner owned those tests. It did not — `website/package.json` has no test script and there is no vitest config there, so `cjkSpacing.test.ts` (16 assertions) ran **nowhere**. The exemption converted a real dropped test into a green partition. | fixed | 2 |
| 20 | scripts/check-scripts-parity.test.mjs | High | The new CI assertion searched for `fe-static:` and `!= "success"` as free text, never checking the env var is bound to `needs.fe-static.result` — a removed mapping would pass. | fixed | 2 |
| 21 | scripts/check-scripts-parity.test.mjs | Medium | An unmatched `{` set `close = -1`, resetting the loop index to `-1` — the matcher span forever instead of throwing. | fixed | 2 |
| 6 (re-open) | scripts/check-scripts-parity.test.mjs | High | Guard still verified its own collection from inside itself. | fixed | 2 |
| 9 (re-open) | package.json | Medium | `test:changed` still ran the app tier only. | fixed | 2 |
| 17 (re-open) | several | Low | Residual "two configs" / "NEITHER…BOTH" wording. | fixed | 2 |

## Round 2 — pre-existing defects surfaced by the gate

| # | File | Severity | Finding | Status | Round |
|---|------|----------|---------|--------|-------|
| 22 | website/.vitepress/theme/cjkSpacing.test.ts | High | 16 committed assertions that no runner executed. Now collected by the app tier (`website/.vitepress` named literally — a leading-dot segment is not traversed by `**`); coverage excluded, as the website is a separate deployable. | fixed | 2 |
| 23 | 5 sites across `src/` | Medium | In-process `performance.now()` wall-clock assertions (5000/2000/500 ms). `mathSourceGuards` measured 6779ms against 5000ms in a loaded `check:all` — a busy machine, not a regression, while the two assertions describing the actual behaviour passed. Replaced with `src/test/timeBudget.ts`: a generous **liveness** bound always enforced, the tight **budget** only under `PERF=1` — the mechanism `performance.test.ts` already uses. | fixed | 2 |
| 24 | src/test/timeBudget.ts | Low | `PERF_ENABLED` exported but unused — caught by the knip ratchet (17 vs baseline 16). Un-exported rather than raising the baseline. | fixed | 2 |

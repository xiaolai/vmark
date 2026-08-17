# Audit Findings

**Run**: audit-fix 20260817-183000 | **Scope**: branch feat/pdf-page-numbers (6 commits vs origin/main, 16 production files) | **Audit type**: mini
**Model**: gpt-5.6-sol | **Effort**: high | **Sandbox**: read-only (audit)
**Audit threads**: A `01a00fb3-2649-75c2-a8be-c5389fe06a4a`, B `01a00fb3-29cf-72e3-9ac3-ac9c4322b29f`, C `01a00fb3-3d2d-7fa2-9ed9-866b0b3142be`, D `01a00fb3-4421-7071-abad-14f1aff0e01c`, E `01a00fb3-5f71-7391-a52c-887364d252d1`
**Status values**: open | fixed | not-fixed | partial | regressed | rejected (with reason) | skipped

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src/export/PdfExportDialog.tsx | 168 | High | Logic | Verbose template resolved via `tDialog` but the key lives in `export.json` — i18next returns the key, so every page stamps the literal `pdf.pageNumbers.verboseTemplate` | Use `t(...)` | fixed | 1 |
| 2 | src/export/pdfOptions.ts | 79 | High | Logic | CJK verbose template is rejected backend-side, leaving every page unnumbered while export reports success; the doc comment claims a numeric fallback that does not exist | Fall back to the numeric form in the backend, where font capability is known | fixed | 1 |
| 3 | src/export/PdfSettingsSidebar.tsx | 254 | High | Logic | Same as #2 from the UI side — verbose is offered in CJK locales where it cannot render | Covered by #2's backend fallback | fixed | 1 |
| 4 | src-tauri/src/pdf_export/page_numbers.rs | 70 | Medium | Logic | Unencodable verbose label silently skipped rather than falling back | Same as #2 | fixed | 1 |
| 5 | src-tauri/src/pdf_export/pdf_io.rs | 49 | High | Logic | `into_temp_path()` closes the securely created file, then `Document::save` reopens the path — a symlink can be swapped in between | Keep the handle open and write through it | fixed | 1 |
| 6 | src-tauri/src/pdf_export/pdf_io.rs | 39 | High | Duplication | Reimplements existing atomic-replacement machinery; omits permission preservation and `sync_all` | Reuse `crate::atomic_replace` | fixed | 1 |
| 7 | src-tauri/src/pdf_export/page_numbers.rs | 143 | Medium | Logic | `page_size` discards MediaBox `x0`/`y0`; `baseline` assumes origin at (0,0) | Preserve the origin and offset the baseline | fixed | 1 |
| 8 | src-tauri/src/pdf_export/commands.rs | 114 | High | Logic | Stamping failure is logged only; command returns success while requested page numbers are absent | Propagate or surface a partial-success warning | fixed | 1 |
| 9 | src-tauri/src/pdf_export/commands.rs | 90 | Medium | Shortcuts | `PageNumberSpec` crosses IPC unvalidated — non-finite or extreme sizes/margins reach PDF operator generation | Add `validate()` like `PageSpec` has | fixed | 1 |
| 10 | src-tauri/src/pdf_export/commands.rs | 103 | Medium | Logic | Blocking PDF load/serialize inside an async command occupies Tokio workers | `spawn_blocking` around the post-processing pipeline | fixed | 1 |
| 11 | src-tauri/src/pdf_export/outline.rs | 173 | Medium | Logic | Duplicate heading text always searched from the next page, so two identical headings on one page cannot both resolve | Occurrence-aware matching within a page | fixed | 1 |
| 12 | src-tauri/src/pdf_export/commands.rs | 92 | Low | Logic | macOS emits `"done"` before post-processing begins | Emit completion after post-processing | fixed | 1 |
| 13 | src/export/pdfOptions.ts | 43 | High | Logic | Spec carries no colour; stamper always draws black, unreadable on a dark-theme export | Send an effective foreground colour | fixed | 1 |
| 14 | src/export/pdfOptions.ts | 82 | Medium | Logic | Zero/small bottom margin lets the footer overlap content | Enforce a minimum effective bottom margin when numbering | fixed | 1 |
| 15 | src/export/pdfPresets.ts | 40 | High | Duplication | Style presets copy all four margin values from `MARGIN_PRESETS` | Reference the preset key | fixed | 1 |
| 16 | src/export/PdfSettingsSidebar.tsx | 119 | High | Duplication | `handleMarginChange` reimplements the imported `detectMarginPreset` | Call the helper | fixed | 1 |
| 17 | src/export/PdfSidebarPrimitives.tsx | 85 | High | Duplication | The number-input markup is copied four times | Extract a `MarginInput` | fixed | 1 |
| 18 | src/export/PdfSidebarPrimitives.tsx | 89 | Medium | Logic | `step={1}` on inputs whose real values are tenths (25.4, 12.7, 38.1) | `step={0.1}` | fixed | 1 |
| 19 | src-tauri/src/bin/pdf_smoke/verify.rs | 97 | High | Logic | `check_stamped` never verifies `/VMarkPageNo` actually resolves to a font in effective resources | Resolve direct/indirect/inherited resources and check the mapping | fixed | 1 |
| 20 | src-tauri/src/bin/pdf_smoke/main.rs | 170 | High | Logic | `large` case never checks the `SENTINEL-PAST-2MIB` marker it exists to prove | Extract text and require the sentinel | fixed | 1 |
| 21 | src-tauri/src/bin/pdf_smoke/main.rs | 263 | High | Logic | `concurrent` case accepts two `Ok`s without validating both artifacts or their distinct content | Validate both artifacts and sentinels | fixed | 1 |
| 22 | src-tauri/src/bin/pdf_smoke/{page_numbers_case,render_one}.rs | 27/202 | High | Duplication | Margins and `PageNumberSpec` defaults (9.35, 72.0, template) duplicated across the two harness modes | One shared fixture helper | fixed | 1 |
| 23 | src-tauri/src/bin/pdf_smoke/main.rs | 90 | High | Duplication | Standalone `legal`/`landscape` cases re-render geometries the matrix already covers, and `legal` reuses a transcript name | Drop the redundant cases | fixed | 1 |
| 24 | src-tauri/src/bin/pdf_smoke/main.rs | 196 | Medium | Logic | The "missing" parent dir has a fixed name; a stale or concurrent dir makes badpath exercise a valid destination | Unique name, assert the parent is absent | fixed | 1 |
| 25 | src-tauri/src/bin/pdf_smoke/main.rs | 255 | Medium | Logic | `sequential` can print `PASS 20 exports` after breaking out on failure | Only PASS when all 20 rendered | fixed | 1 |
| 26 | src-tauri/src/bin/pdf_smoke/render_one.rs | 34 | Medium | Logic | A bare `--html` silently falls back to matrix mode | Reject malformed invocations | fixed | 1 |
| 27 | src-tauri/src/bin/pdf_smoke/render_one.rs | 181 | Medium | Logic | `strip_tags` does not decode HTML entities, unlike the frontend's `textContent` | Decode entities | fixed | 1 |
| 28 | src-tauri/src/bin/pdf_smoke/main.rs | 83 | Medium | Refactoring | `run_cases` is a ~189-line coordinator mixing every scenario | Extract per-scenario functions | fixed | 1 |

## Round 2 — independent verify (thread `01a00fde-910f-70f0-982a-ba14428def3c`)

23 FIXED, 2 PARTIAL, 3 REGRESSED, 0 NOT FIXED. All five resolved in round 2:

| # | Verify verdict | Resolution | Status |
|---|---|---|---|
| 5 | REGRESSED — the symlink window closed, but the PDF was serialized into an unbounded `Vec` first | Added `atomic_replace_with`, a writer-closure form of the shared core — which is what finding #6 originally suggested. The PDF streams straight into the still-open temp file: no second copy, no reopen-by-name. | fixed | 2 |
| 6 | REGRESSED — same unbounded buffer | Same fix; `pdf_io` uses the streaming form. | fixed | 2 |
| 9 | PARTIAL — `validate()` did not check `verbose_template` | Handled in `render_label`, NOT `validate()`: a template with no `{n}` falls back to the numeric form like a CJK one. Rejecting would have failed the whole export over a translation typo. A frontend test asserts all ten shipped templates carry `{n}`, so a regression is caught at gate time instead. | fixed | 2 |
| 14 | REGRESSED — `pdfFitToPage` still sized images from the raw `marginBottom` | It reads `effectiveBottomMarginMm` now. Three consumers, one helper. | fixed | 2 |
| 27 | PARTIAL — only core entities decoded | Added the common named entities. An unknown one is still left literal on purpose: a wrong substitution breaks the match as badly as a missed one and is harder to see. | fixed | 2 |

Also closed the verifier's test-gap note: the harness's pure helpers (argument
parsing, entity decoding, heading extraction) now have 10 unit tests, and
`pdf-smoke.yml` runs them — they sit in a feature-gated bin that `cargo test` in
`ci.yml` never compiles, so without that step they would have been tests nothing
runs.

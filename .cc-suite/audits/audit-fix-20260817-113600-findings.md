# Audit Findings

**Run**: audit-fix 20260817-113600 | **Scope**: branch feat/pdf-export-cross-platform (41 commits vs origin/main) | **Audit type**: mini
**Model**: gpt-5.6-sol | **Effort**: high | **Audit threads**: renderer-core (see log), 01a00dbd-4282-7623-a791-5ef8c29657ef (ts), 01a00dc3-51cf-71d0-889b-773f940814b4 (rust-2)
**Status values**: open | fixed | not-fixed | partial | regressed | skipped (severity filter) | skipped (user stop)

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src/export/pdfHtmlTemplate.ts | 51 | High | Logic | resolveFontFamily treats font IDs (pingfang, songti…) as literal CSS families; leading system-ui also blocks the CJK stack | Reuse buildFontStack from utils/fontStacks.ts; test every selectable font | partial | 1 |
| 2 | src/export/pdfHtmlTemplate.ts | 149 | High | Logic | expandDetails regex is not quote-aware: `data-open="false"` / `title="open"` match \bopen\b, and a quoted `>` truncates the tag | Attribute-aware parse; test data-open, quoted open, quoted `>`, mixed case | fixed | 2 |
| 3 | src/export/pdfFitToPage.ts | 77 | High | Logic | The 20mm floor can exceed the printable area (100mm margins on A4 landscape leaves 10mm) | Clamp to the real printable area; never emit a bound larger than it | open | - |
| 4 | src/export/pdfPrintCss.ts | 28 | High | Duplication | Table-fit and page-break rules duplicated in exportOverrides.ts; both ship in the PDF | Single shared stylesheet or one selector set | open | - |
| 5 | src/export/pdfOptions.ts | 11 | High | Duplication | Page-size domain declared in 4 places (union, KEYWORDS, PAGE_SIZE_PT, UI) | One typed catalog; derive union and maps | open | - |
| 6 | src/export/primitiveTokens.ts | 31 | High | Duplication | Primitive subset hand-copied from index.css (gate detects drift but the copy remains) | Generate at build time | open | - |
| 7 | src-tauri/src/pdf_export/commands.rs | 31 | High | Logic | validate_output_path only checks parent.exists(): relative paths, parent-is-file, unwritable dir, dir named *.pdf all pass | Require absolute, verify parent is a dir, reject dir outputs | fixed | 1 |
| 8 | src-tauri/src/pdf_export/renderer/macos.rs | 95 | High | Logic | !isLoading treated as success; WKWebView also reports false after a failed load → blank PDF reported as success | Use WKNavigationDelegate didFinish / didFail | open | - |
| 9 | src-tauri/src/pdf_export/renderer/macos.rs | 121 | High | Shortcut | Fixed 200ms settle assumed sufficient for fonts/images/layout | Await document.fonts.ready + image decode under a bounded timeout | open | - |
| 10 | src-tauri/src/pdf_export/renderer/macos_ops.rs | 122 | High | Logic | Failure to remove an existing destination is ignored; stale PDF can satisfy size-stability checks → false success | Ignore only NotFound; propagate other errors | open | - |
| 11 | src-tauri/src/pdf_export/renderer/mod.rs | 103 | Medium | Shortcut | Temp file uses predictable pid+clock name with non-atomic write (symlink/collision risk) despite tempfile being a dependency | Use tempfile::Builder | fixed | 1 |
| 12 | src-tauri/src/pdf_export/renderer/mod.rs | 113 | Medium | Logic | Multi-MB HTML written with blocking std::fs::write inside an async command | tokio::fs::write or spawn_blocking | fixed | 1 |
| 13 | src-tauri/src/pdf_export/renderer/mod.rs | 133 | Medium | Logic | to_string_lossy can corrupt a non-UTF-8 temp path | Keep PathBuf; Url::from_file_path | open | - |
| 14 | src-tauri/src/pdf_export/renderer/mod.rs | 62 | Medium | Dead | Comment claims Windows/Linux are stubs and suppresses dead-code warnings; both are implemented | Remove stale allowance/comment | fixed | 1 |
| 15 | src-tauri/src/pdf_export/renderer/mod.rs | 55 | Low | Shortcut | Timeout comment says ~60s ceiling doubled, value is 180s | Correct the comment or the value | fixed | 1 |
| 16 | src-tauri/src/pdf_export/renderer/linux.rs | 217 | Medium | Shortcut | Window title "VMark Print" hardcoded, not localized | Add a locale key | open | - |
| 17 | src-tauri/src/pdf_export/renderer/windows_print.rs | 58 | Medium | Shortcut | Same hardcoded print-window title on Windows | Same locale key | open | - |
| 18 | src-tauri/src/pdf_export/renderer/windows.rs | 224 | Medium | Shortcut | Raw English stage strings ("navigation handler", "print settings") interpolated into localized errors | Keep stage text in logs; localize the message | open | - |
| 19 | src-tauri/src/pdf_export/renderer/sink.rs | 60 | Medium | Shortcut | Temp-file deletion failures silently ignored in settle and Drop | Log failures with path and error | fixed | 1 |
| 20 | src-tauri/src/pdf_export/renderer/windows.rs | 52 | High | Duplication | close/com_error/path_to_file_url/window_error helpers shared ad hoc between windows.rs and windows_print.rs | Move platform-neutral helpers up; centralize teardown | open | - |
| 21 | src-tauri/src/pdf_export/page_spec.rs | 41 | High | Logic | Public mutable fields + unchecked constructor let callers bypass validate() | Validate at renderer entry, or an immutable validated type | open | - |
| 22 | src-tauri/src/bin/pdf_smoke/render_one.rs | 48 | High | Duplication | SIZES/margin constants duplicated with main.rs matrix | Share one table | open | - |

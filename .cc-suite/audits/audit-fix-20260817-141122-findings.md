# Audit Findings

**Run**: audit-fix outline branch | **Scope**: feat/pdf-outline-cross-platform vs origin/main | **Audit type**: mini
**Model**: gpt-5.6-sol | **Effort**: high | **Audit thread**: 01a00e4f-c2ef-7080-9e73-ff46fc1da227
**Status values**: open | fixed | not-fixed | partial | regressed | skipped

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src-tauri/src/pdf_export/outline.rs | 195 | High | Logic | `Document::save` truncates the rendered PDF before serializing; a failure mid-write leaves a corrupt file | Write to a temp file in the destination dir, then atomically rename | open | - |
| 2 | src-tauri/src/pdf_export/commands.rs | 101 | High | Logic | Outline errors are swallowed as "PDF still valid", but a truncating save may already have destroyed it — command returns success on a corrupt file | Make the write atomic so the claim is true, or propagate | open | - |
| 3 | src-tauri/src/pdf_export/outline.rs | 163 | High | Logic | `extract_text(..).unwrap_or_default()` turns parser/font errors into empty pages; headings then get false destinations with no diagnostic | Record failures; log degraded extraction | open | - |
| 4 | src-tauri/src/pdf_export/outline_match.rs | 73 | High | Logic | "Not found" is page 0, indistinguishable from a real first-page hit; it also resets `last_page`, so one miss rewinds all later matching | Return Option; preserve the last confirmed page | open | - |
| 5 | src-tauri/src/pdf_export/outline_match.rs | 89 | High | Logic | Wrap-around lets a destination move backward, usually onto an earlier TOC mention rather than the real heading | Search monotonically forward | open | - |
| 6 | src-tauri/src/pdf_export/outline_match.rs | 83 | High | Logic | Search starts inclusively at the previous page, so two identical headings both match the first occurrence | Advance past the consumed occurrence | open | - |
| 7 | src-tauri/src/pdf_export/outline_match.rs | 69 | High | Logic | The final unrestricted substring pass defeats the boundary protection of the earlier passes | Drop it or bound it | open | - |
| 8 | src-tauri/src/pdf_export/outline.rs | 129 | High | Logic | `emit` recurses per nesting level without a depth bound | Bound the depth | open | - |
| 9 | src-tauri/src/pdf_export/outline.rs | 91 | High | Logic | `node.page as u32` can wrap on a pathological index | Use try_from | open | - |
| 10 | src-tauri/src/pdf_export/outline.rs | 92 | High | Refactor | `emit` is long and does id allocation, linkage, destination and recursion together | Split | open | - |
| 11 | src-tauri/src/pdf_export/outline_match.rs | 36 | High | Duplication | Four near-identical search passes | Table-drive them | open | - |
| 12 | src-tauri/src/pdf_export/outline.rs | 150 | Medium | Shortcut | Error strings are raw English, not localized | Use t!() | open | - |
| 13 | src-tauri/src/pdf_export/outline.rs | 176 | Low | Dead | `/Count` on an empty root omitted rather than 0 | Set 0 | open | - |

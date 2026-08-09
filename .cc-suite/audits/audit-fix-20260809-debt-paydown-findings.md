# Audit Findings

**Run**: audit-fix 20260809 (execute-plan Step 5) | **Scope**: 5 pilot test conversions + 4 dead-symbol deletions | **Audit type**: mini
**Model**: gpt-5.6-sol | **Effort**: high | **Audit thread**: 019fe61c-2870-72d2-b107-3484aa0cfc6d
**Fixer**: Claude | **Rounds**: 1

| # | File | Line | Severity | Dimension | Finding | Status | Round |
|---|------|------|----------|-----------|---------|--------|-------|
| 1 | src/components/BottomBar/BottomBar.test.tsx | 18 | High | testing | Comment (and plan:291) claimed the real subscription is exercised, but every setActive() ran BEFORE render() — only initial snapshots were tested | fixed | 1 |
| 2 | src/lib/browser/agent/consoleShim.ts | 39 | High | security | After deleting CONSOLE_SHIM, installConsoleCapture is test-only while production injects a DUPLICATE JS copy from console_shim_macos.rs:25; header falsely said the page-world half "was never registered" | fixed | 1 |
| 3 | src/components/Editor/useTiptapFlush.test.ts | 57 | Medium | testing | Real-store setup present but not observed: activeTabId always supplied (tabStore fallback dead) and serializer mock discarded options (preserveBlankLines unproven) | fixed | 1 |
| 4 | src/components/BottomBar/BottomBar.test.tsx | 26 | Medium | maintainability | `[{id, kind}] as unknown as Tab[]` fabricated an invalid Tab, defeating the contract the real store was meant to add | fixed | 1 |
| 5 | src/lib/browser/agent/consoleShim.ts | 109 | Low | maintainability | trailing blank line at EOF | fixed | 1 |

**Clean per the audit:** fileLinkProvider.test.ts, setupCopyOnSelect.test.ts, markdownCopy/tiptap.test.ts, siteReader.ts, operationManifest.ts, mdastConverters.registry.ts.

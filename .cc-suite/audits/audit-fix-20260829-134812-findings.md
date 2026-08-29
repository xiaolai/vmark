# Audit Findings

**Run**: audit-fix 20260829-134812 | **Scope**: uncommitted working tree (415 files, UI-consistency plan) | **Audit type**: mini
**Model**: codex (gpt-5 codex CLI) | **Effort**: default | **Audit threads**: 01a04c12-1dad-7e00-9877-24110ba1ed39 (services/i18n half), Claude fallback workflow wf_43bdc013-517 (styles/theme half — Codex runner stalled)
**Status values**: open | fixed | not-fixed | partial | regressed | skipped

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src/pages/settings/AboutSettings.tsx | 235 | Medium | error-handling | async IIFE discards confirmAction rejection | catch + report | fixed | 1 |
| 2 | src/pages/settings/ShortcutsSettings.tsx | 225 | Medium | error-handling | same unhandled rejection path | catch + report | fixed | 1 |
| 3 | src/hooks/useSidebarResize.ts | 50 | Medium | correctness | viewport cap only applies during interaction; narrowed window keeps wide sidebar | reclamp on resize | fixed | 1 |
| 4 | src/plugins/codemirror/theme.ts | 88 | Medium | consistency | tags.quote/list colour whole subtrees as md-char, not just markers | remove both mappings | fixed | 1 |
| 5 | src/plugins/codemirror/theme.ts + source-syntax.css | 91/83 | Medium | consistency | tags.monospace surface leaks onto block CodeText | revert to font-only | fixed | 1 |
| 6 | src/locales/*/settings.json (9 locales) | 147 | Medium | correctness | cjkFormatting.hint still names the obsolete menu path | update per locale | fixed | 1 |
| 7 | src/hooks/useSidebarResize.ts | 16/54 | Low | consistency | hook constants 150/500 vs store's 180/480 | import canonical constants | fixed | 1 |
| 8 | src/pages/settings/layout.tsx + buttons.tsx | 43 | Low | consistency | label[for] dangles on non-labelable children; Button drops cloned id/aria | forward props; labelable guard | fixed | 1 |
| 9 | src/pages/settings/AboutSettings.test.tsx | 81 | Low | test-integrity | dismissal test still mocks window.confirm | mock the funnel, await | fixed | 1 |
| 10 | src/pages/settings/ShortcutsSettings (site tests) | 225 | Low | test-integrity | no confirmed/cancelled site test for the async reset | add both branches | fixed | 1 |
| 11 | finder/fileOpen toast tests (5 sites) | various | Low | test-integrity | first line asserted as any(String) | assert the localized key/message | fixed | 1 |
| 12 | FormatsSettings/ModelComboBox/HotExitDevTools tests (4 pins) | various | Low | test-integrity | weakened prefix pins drop the recovery guidance | assert full copy | fixed | 1 |
| 13 | codeHighlightTags.test.ts | 16/24 | Low | test-integrity | isolated-tag tests can't see parser overreach | rewrite with the tag fix (#4/#5) | fixed | 1 |
| 14 | hljsSyntax.test.ts | 38/43 | Low | test-integrity | substring scope matching; colour scan misses background-color | harden both | fixed | 1 |
| 15 | ~40 empty-state/copy keys × 9 locales | various | Low | consistency | en semantic rewrites not propagated to translations (incl. Open Workspace…, WYSIWYG Mode, version-not-snapshot, errorBoundary pair) | translate the class | fixed | 1 |
| 16 | scripts/lib/uiConsistencyCss.mjs | 73 | High | gate-soundness | rulesWithMarkers pairs raw/blanked rule lists BY INDEX; a comment containing { or } desyncs every later rule's markers | slice raw views from original via length-preserving offsets | fixed | 1 |
| 17 | scripts/lib/designTokenChecks.mjs | 37 | Medium | gate-soundness | C2b identity per-rule lets a baselined selector accumulate new colour literals invisibly (verified by mutation) | per-declaration identity file:selector:prop:value + @keyframes disambiguation; baseline re-keyed rgbaLiteralDecls (verify said PARTIAL on prop-only IDs; value segment added same round) | fixed | 1 |
| 18 | scripts/check-i18n-keys.ts | 619 | Medium | gate-soundness | checkDialogLiterals misses sonner's primary bare toast(...) call form | set isToast on bare toast identifier calls | fixed | 1 |
| 19 | scripts/check-i18n-keys.ts | 749 | Medium | gate-soundness | checkCopyConventions fails OPEN: missing baseline silently rewritten with every violation baselined | missing baseline errors; only --update-copy writes | fixed | 1 |
| 20 | scripts/check-keybinding-manifest.mjs | 838 | Medium | gate-soundness | label-parity leg has no aliveness guard; a builder rewrite silences every comparison | fail when compared < half the manifest | fixed | 1 |
| 21 | scripts/lib/uiConsistencyCss.mjs | 321 | Medium | gate-soundness | focusPaintedClasses marks ancestor context classes as focus-painted, masking C10 gaps | collect classes only from the :focus-carrying compound | fixed | 1 |
| 22 | scripts/check-keybinding-manifest.mjs | 786 | Low | gate-soundness | LABEL_EXEMPT never checked for staleness in either direction | fail on unknown ids and byte-equal (no-longer-exempting) entries | fixed | 1 |
| 23 | scripts/check-ui-consistency.mjs | 126 | Medium | gate-soundness | @theme assertion regex spans past the block closing brace | bound each gap to [^}]* | fixed | 1 |
| 24 | src/styles/index.css | 534 | Medium | accessibility | WI-UI4.5 forced-colors block cascade-dead (overlay-shared.css imported later wins every tie) | moved into overlay-shared.css below its base rules; reduced-motion banner re-homed | fixed | 1 |
| 25 | src/styles/index.css | 39 | Low | dark-theme | @theme shadow-popup embeds the static light-only --popup-shadow literal | self-name mapping onto applyTheme's adaptive var + static :root fallback + rule-31 row | fixed | 1 |
| 26 | src/plugins/codemirror/source-syntax.css | 3 | Low | doc-rot | three comments still name deleted styles/syntax-palette.css as source of truth | repointed at ThemeTokens.syntax/applyTheme + index.css fallbacks | fixed | 1 |
| 27 | src/components/Terminal/TerminalTabBar.css | 64 | Medium | cascade-regression | terminal tab rename input lost border/ink/font to .terminal-tab (lazy chunk beats early vm-input) | re-declared border-bottom/color/font/cursor on .terminal-tab-rename | fixed | 1 |
| 28 | src/components/Editor/heading-picker.css | 10 | Medium | cascade-regression | residual loses stretch/padding to .popup-container (imported after it in Editor.tsx) | raised to .popup-container.heading-picker (specificity, order-independent) | fixed | 1 |
| 29 | src/components/Workspace/workspace-approval-dialog.css | 7 | Medium | missed-unit-conversion | --vm-overlay-width: 30em shrank 540px→~390px when chrome body basis went 18px→13px | 540px with the sibling-style conversion comment | fixed | 1 |
| 30 | src/components/WorkflowApproval/approval-dialog.css | 13 | Low | specificity-regression | 80vh cap dead under (0,2,0) shared panel max-height; same class in workflow-expression-editor | both restored at .vm-overlay--center <class> specificity | fixed | 1 |
| 31 | src/plugins/imagePreview/image-preview.css | 13 | Low | cascade-regression | gap: 4px loses to .popup-container's 2px (WindowContext chunk loads first) | raised to .popup-container.image-preview-popup | fixed | 1 |
| 32 | src/services/ime/imeToast.ts | 217 | Medium | correctness | (verification sweep) errorDetail used String(detail) on unknown — typed rejection renders [object Object]; caught by lint:type-aware | route through commandErrorMessage | fixed | 1 |
| 33 | src/theme + src/shell (3 knip findings) | various | Low | dead-code | (verification sweep) withAlpha barrel re-export unused; LegacyDarkOverrides exported but never imported; CHROME_HEIGHT duplicate export of BAR_HEIGHT | barrel trimmed; type un-exported; alias moved to AppShell (its consumer) | fixed | 1 |
| 34 | src/components/StatusBar/StatusBar.a11y.test.tsx | 12 | Low | test-integrity | (verification sweep) new a11y test mocked imagePasteToastStore + settingsStore — mock-boundaries gate: tests mock boundaries, not app state | dropped both mocks; real stores | fixed | 1 |
| 35 | .size-limit.cjs | 174 | Low | budget | (verification sweep) EAGER App chunk 23 B over its 610 kB budget after the funnel + commandErrorMessage additions | raised to 612 kB with mechanism comment (hand-maintained budget, kept tight) | fixed | 1 |

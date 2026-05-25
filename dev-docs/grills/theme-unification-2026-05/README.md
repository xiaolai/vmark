# Theme & Token Unification — Spike

Validates that migrating xterm `ITheme` generation from the legacy
`terminalTheme.ts` `ansiPalettes` const into `ThemeTokens` produces
byte-identical output for all 5 themes.

## Probe

`paper-probe.test.ts` calls the legacy `buildXtermThemeForId("paper")`
and asserts every field matches a manually-constructed paper baseline.
If this probe passes BEFORE migration, we have a frozen reference
against which the post-migration code can be diffed.

The probe is also extended to cover all 5 themes (white, paper, mint,
sepia, night) so the regression test in Phase 2 can compare against
the same baseline.

## Result

PASS — see `paper-probe.test.ts`. Frozen baseline captured in
`baseline.ts`.

## What this is NOT

This is not a visual-rendering test. xterm's actual rendering depends
on webgl / canvas state we don't simulate. The byte-identical `ITheme`
guarantee is necessary but not sufficient — visual QA must follow.

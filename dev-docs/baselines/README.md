# Theme baselines

Screenshot baselines for the 5 vmark themes — one PNG per theme,
captured against the canonical reference document
`dev-docs/css-reference.md`.

These PNGs are **gitignored** (see `.gitignore`). Regenerate locally
when:
- The reskin lands a visual change you've reviewed.
- A new theme is added.
- The codemod for `index.css` alias chains has run and you've
  visually confirmed no regression.

## Regenerate

1. Run `pnpm tauri dev` (the app must be running with the MCP bridge
   plugin active — `enabledPlugins["mcp-bridge"]: true` in your
   capabilities).
2. Run `node scripts/screenshot-themes.mjs`.
3. The script opens `dev-docs/css-reference.md`, cycles through the
   5 themes, and writes `<themeId>.png` here.

## Visual diff workflow

After a CSS change, regenerate the screenshots and `git diff` won't
show binary changes (PNGs are gitignored). Instead, the reviewer
compares manually side-by-side, or runs `scripts/screenshot-themes.mjs
--compare <previous-dir>` to print SSIM scores.

The harness is a development aid, not a CI gate. Visual review
remains a human responsibility.

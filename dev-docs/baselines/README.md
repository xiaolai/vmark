# Theme baselines

Screenshot baselines for the 5 vmark themes — one PNG per theme,
captured against the running app. Used for visual-zero-impact
verification of token-system refactors (e.g. the alias-chain codemod
in `theme(phase-4)`).

These PNGs are **gitignored** (see `.gitignore`). Regenerate locally
when:

- The reskin lands a visual change you have reviewed.
- A new theme is added.
- A codemod across `src/styles/*.css` or `src/theme/themes/*.ts` runs
  and you want post-codemod baseline confirmation.

## Regenerate (Claude Code with Tauri MCP plugin)

The capture uses the Tauri MCP plugin's tools (`tauri_webview_execute_js`,
`tauri_webview_screenshot`) — NOT a standalone script. The earlier
`scripts/screenshot-themes.mjs` was deleted because it called bridge
methods (`window.eval`, `webview.screenshot`) that don't exist in
`src-tauri/src/mcp_bridge/`; adding them would overload a production
surface with dev tooling.

### Procedure

1. **Start the app**: `pnpm tauri dev` in the project root.
2. **In Claude Code**, with the Tauri MCP plugin installed:
   1. `mcp__tauri__tauri_driver_session` — `action: "start"`, `port: 9223`.
   2. For each theme in `["white", "paper", "mint", "sepia", "night"]`:
      - `mcp__tauri__tauri_webview_execute_js` with:
        ```js
        (async () => {
          const m = await import("/src/stores/settingsStore.ts");
          m.useSettingsStore.setState((s) => ({
            appearance: { ...s.appearance, theme: "<theme-id>" },
          }));
          await new Promise((r) => setTimeout(r, 500));
        })()
        ```
      - `mcp__tauri__tauri_webview_screenshot` with:
        - `filePath: "dev-docs/baselines/<theme-id>.png"`
        - `format: "png"`
   3. Reset to the user's original theme.
   4. `mcp__tauri__tauri_driver_session` — `action: "stop"`.

The dev-mode dynamic import (`await import("/src/stores/...")`)
works because Vite serves source modules. In a production build,
`useSettingsStore` is not on `window` and a different mechanism would
be needed — but visual baselining is a dev concern only.

## Visual diff workflow

After the codemod (or any CSS change):

1. Capture pre-change baselines following the procedure above. Save
   them to a temp directory (`dev-docs/baselines-pre/` etc., also
   gitignored).
2. Apply the change.
3. Capture post-change baselines to `dev-docs/baselines/`.
4. Compare per-theme: `shasum -a 256 dev-docs/baselines/*.png
   dev-docs/baselines-pre/*.png | sort` — matching hashes per theme
   prove byte-identical render.

Per-pixel diff is the strict test; for less-strict review use
`magick compare -metric SSIM` or any image-diff tool.

## What's already captured

The 5 baselines currently in this directory were captured against the
post-Phase-4 theme-unification state (the alias-chain codemod is
already applied). They serve as the "current good" reference. To
reset them after future intentional changes, follow the procedure
above and overwrite.

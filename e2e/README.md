# VMark E2E Smoke Harness

> **RW-13 (L12) · hardening v2-005** — closes the audit gap "No executable E2E
> smoke harness." See `dev-docs/audit/20260607-wi-audit-report.md` (L12 / v2-005).

A minimal, runnable happy-path smoke test that drives a **live VMark debug
build** through its Tauri MCP automation bridge.

## What it exercises

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Connect to the automation bridge WebSocket | Connection opens on `127.0.0.1:9323` |
| 2 | `list_windows` | At least one window/webview is reported |
| 3 | `execute_js` — probe the webview | `.ProseMirror` editor is present and the IPC result channel is live |
| 4 | `execute_js` — focus editor, select-all, `execCommand("insertText", …)` | A unique marker string is typed into the document |
| 5 | `execute_js` — read `.ProseMirror` textContent back | Content contains the typed marker (round-trip verified) |
| 6 | `capture_native_screenshot` | A base64 PNG is returned and written to `e2e/artifacts/smoke.png` |

Exit code is `0` only if every step passes; any failure (connection,
assertion, or timeout) exits non-zero and prints a `FAIL` line.

## Why the Tauri MCP bridge, not Chrome DevTools

VMark is a **Tauri desktop app**, not a browser page. Per `AGENTS.md`:

- The automation bridge (`tauri-plugin-mcp-bridge`, **debug-only**) is pinned to
  `127.0.0.1:9323` in `src-tauri/src/lib.rs`.
- Port **9223** is VMark's *own*, auth-protected MCP server (sidecar ↔ webview).
  Sending commands there drops with `"Connection closed"`. **This harness uses
  9323 only.**
- **Never use Chrome DevTools MCP** for VMark.

## Wire protocol

The bridge is a plain WebSocket server. The harness speaks its JSON
request/response protocol directly (verified against
`tauri-plugin-mcp-bridge 0.8` `src/websocket.rs`):

```jsonc
// request
{ "id": "smoke-1", "command": "execute_js", "args": { "script": "…" } }
// response
{ "id": "smoke-1", "success": true, "data": <json> }
// or
{ "id": "smoke-1", "success": false, "error": "…" }
```

Commands used: `list_windows`, `execute_js`, `capture_native_screenshot`.

## Dependencies

**None.** The harness uses Node's built-in global `WebSocket` (stable in
Node ≥ 22; this repo runs Node 22). No `ws` package, no MCP client library is
required or added.

## Prerequisites

1. **A live VMark debug build** so the 9323 bridge is active (it is compiled in
   only under `#[cfg(debug_assertions)]`):

   ```bash
   pnpm tauri:dev
   ```

   Wait until the document window is open and the editor is visible.

2. **A headed environment (a real display).** Step 6 captures a *native*
   screenshot of the OS window, which cannot succeed on a headless runner
   without a virtual display (e.g. an Xvfb/`runner` with a display, or a macOS
   self-hosted runner with a logged-in GUI session). Steps 1–5 are
   display-independent, but the harness asserts the screenshot too, so treat the
   whole smoke as **headed-only**.

## Running

With the debug app already running:

```bash
pnpm e2e:smoke
# equivalently:
node e2e/smoke.mjs
```

Options:

| Flag | Default | Purpose |
|------|---------|---------|
| `--port <n>` | `9323` | Bridge port |
| `--host <addr>` | `127.0.0.1` | Bridge host |
| `--timeout <ms>` | `15000` | Per-step timeout (also the connect timeout) |

The screenshot is written to `e2e/artifacts/smoke.png` (gitignored).

### Running via a Tauri MCP session (agent-driven)

An AI agent can perform the same flow interactively with the `tauri_*` MCP
tools (see `.claude/skills/tauri-mcp-testing`): `tauri_driver_session`
(`action: start`, `port: 9323`) → `tauri_manage_window` (`list`) →
`tauri_webview_execute_js` to type/verify → `tauri_webview_screenshot`. This
script is the **non-interactive, CI-shaped** equivalent of that flow.

## CI

This smoke is **not** wired into the per-PR CI gate. Doing so honestly requires
a headed runner (display + a running debug build), which the current CI
infrastructure does not provide. Running it under a headless GitHub-hosted
runner would fail at the native-screenshot step and produce false negatives.

Run it **locally / manually** before releases, or on a self-hosted headed
runner via a dedicated `workflow_dispatch` job if/when one exists. Keep it out
of the blocking `pnpm check:all` gate until that infrastructure is in place.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `Timed out connecting … on port 9323` | Debug app not running, or built in release mode (bridge is debug-only). Start `pnpm tauri:dev`. |
| `Connection closed` immediately | You hit port **9223** (the auth-protected app bridge). Use 9323. |
| `No .ProseMirror editor surface found` | App still booting, or a non-document window is focused. Wait for the editor, retry. |
| `window.__TAURI__.event.emit is unavailable` | Not the document webview, or not a Tauri build. |
| `Screenshot did not return a base64 data URL` | Headless environment with no display. Run headed. |

# E2E Testing with MCP

How to drive a **running VMark app** for end-to-end testing. VMark exposes **two
independent MCP bridges** — a debug-only automation harness and its own AI-client
bridge. Which one you use depends on **what** you're testing.

> Unit tests (`pnpm test`) and the gates (`pnpm check:all`) do NOT need a running app.
> This guide is only for E2E flows that need the real app — the embedded browser, AI
> automation, menus, native windows, IPC.

## Which bridge for what — the one rule that matters

| You are testing… | Use | Why |
|---|---|---|
| **Any AI-driven feature** (embedded browser automation, the `browser`/`document`/`selection`/`workspace` MCP tools, approval flows) | **VMark MCP** (`mcp__vmark__*`) — **exclusively** | This is the surface that ships to users. It is the only faithful test of the real approval gates, sandbox posture, and tool schemas. |
| UI / plumbing that is **not** an AI feature — menus, shortcuts, window/tab lifecycle, Tauri IPC commands, screenshots, reading logs, poking the DOM | **Tauri MCP** (`mcp__tauri__*`) | It can execute webview JS, simulate real input, invoke Tauri commands, and screenshot. It does **not** exist in release builds, so never treat it as the AI-feature path. |

**Rule (non-negotiable):** when the thing under test is an **AI-driven feature**, drive it
through **VMark MCP only**. The Tauri MCP is a dev harness; using it to fake an AI flow
tests a path users never take. Use the Tauri MCP for setup/inspection (enable a setting,
read a log, screenshot) — not as a stand-in for the AI tool surface.

**Never use Chrome DevTools MCP.** VMark is a Tauri app, not a browser app.

## The two bridges

| | **Tauri MCP** (`mcp__tauri__*`) | **VMark MCP** (`mcp__vmark__*`) |
|---|---|---|
| Crate / source | `tauri-plugin-mcp-bridge` (`src-tauri/Cargo.toml`), registered in `src-tauri/src/lib.rs` under `#[cfg(debug_assertions)]` | VMark's own `src-tauri/src/mcp_bridge/` + `mcp_server.rs`; the Node sidecar in `vmark-mcp-server/` |
| Port | **pinned `127.0.0.1:9323`** (`.base_port(9323)` in `lib.rs`) | **dynamic — OS-assigned** (bridge binds `127.0.0.1:0`, `mcp_bridge/server.rs`) |
| Discovery | fixed — connect to `9323` | sidecar reads `PORT:TOKEN` from the **port file** (below) on every (re)connect |
| Auth | none | required — 64-hex token in the port file; unauthenticated sockets are dropped |
| Build | **dev only — absent in release** | ships in release; this is the real product |
| Client | third-party `mcp__tauri__*` tools | the Node sidecar an AI client (Claude Code / Codex / Gemini) spawns |

**Do not point anything at port 9223.** That default is cosmetic — the VMark bridge
always binds port `0` and the settings value is discarded. The real port is dynamic and
is only discoverable via the port file. Historically 9223 was VMark's own bridge, which
is why the Tauri harness was pinned to **9323** — connecting the harness to 9223 lands on
the auth-protected VMark bridge and drops with "Connection closed".

### The port file (VMark MCP)

- Path (macOS): `~/Library/Application Support/app.vmark/mcp-port`
  (`app_paths.rs` → `app_data_dir()/mcp-port`; the dir is the Tauri identifier `app.vmark`).
- Format: `PORT:TOKEN` (e.g. `61139:89963df5…`), atomically written by `mcp_bridge/state.rs`
  when the bridge starts, and **deleted when it stops**.
- The bridge auto-starts on launch when `mcpServer.autoStart` is on (default **true**).
- The sidecar (`vmark-mcp-server/src/cli.ts`) re-reads this file on every connect attempt
  and reconnects with backoff, so the **dynamic port needs no manual configuration**.

## Prerequisites: a running dev app

Both bridges require the app to be running as a **debug build**:

```bash
pnpm tauri:dev      # builds + launches; opens a GUI window; both bridges come up
```

You may launch it yourself (it runs until killed — a GUI window appears on the user's
machine) or ask the user to. Confirm it's up:

```bash
lsof -iTCP:9323 -sTCP:LISTEN            # Tauri harness listening
cat ~/Library/Application\ Support/app.vmark/mcp-port   # VMark bridge PORT:TOKEN
```

## Dev-mode setup — reconfigure the AI-client integration

This is the step that makes **VMark MCP** usable against a **dev** build. The trap: an AI
client's config (`~/.claude.json` → `mcpServers.vmark.command`) points at a **prebuilt
sidecar binary**, and that binary can be weeks stale — missing tools/actions you just
added. Symptom: `session.get_state` says *"Not connected"*, or the tool surface is missing
`browser` (or a new action). Two independent things must be current:

**1. Rebuild the sidecar binary** (or new tools/actions aren't in it):

```bash
pnpm --dir vmark-mcp-server build:sidecar
# → src-tauri/binaries/vmark-mcp-server-<triple>  (gitignored pkg artifact)

# verify it carries what you expect:
src-tauri/binaries/vmark-mcp-server-aarch64-apple-darwin --health-check
# tools: ['session','workspace','document','workflow','selection','browser'] ...
```

**2. Point the AI client at the *dev* binary.** VMark writes the client config itself via
`mcp_config_install(provider)` (`src-tauri/src/mcp_config/`). The binary path it writes is
**build-aware** (`providers.rs`, `cfg!(debug_assertions)`): install **from the dev build**
→ it writes the repo path `src-tauri/binaries/vmark-mcp-server-<triple>`; from a release
install → the path inside the `.app`. Providers: `claude`, `codex`, `gemini`,
`claude-desktop`.

- **In-app:** Settings → **Integrations** → install for your client. (Shows a restart hint.)
- **Scripted (dev):** invoke the command over the Tauri harness —
  ```js
  // via mcp__tauri__webview_execute_js against the dev app:
  await window.__TAURI__.core.invoke('mcp_config_install', { provider: 'claude' });
  ```
  Because the dev build has `debug_assertions`, this writes the dev binary path.

**3. Restart the AI client.** MCP servers bind at **client startup** — Claude Code will not
pick up a reconfigured server or newly-built tools mid-session. Rebuild + reconfigure, then
restart the client, then reconnect.

## Gotchas

- **Stale sidecar binary** — the #1 cause of "the browser MCP doesn't work." Always
  `build:sidecar` after touching `vmark-mcp-server/`. Confirm with `--health-check`.
- **Restart required** — the client loads MCP servers once. New tools/config ⇒ restart the
  client. (You can still exercise a freshly-built sidecar out-of-band by speaking MCP to it
  directly over stdio — see the example below — but that's a probe, not the normal path.)
- **Dev + release collide.** Both use identifier `app.vmark` (dev conf overrides only the
  icon), so they share the one `mcp-port` file and clobber each other — whichever started
  its bridge **last** owns it. Simplest: run **only** the dev app (quit any installed
  release). To run both side-by-side, give dev its own namespace: add an `identifier`
  override to `src-tauri/tauri.dev.conf.json`, and set `VMARK_APP_IDENTIFIER` (honored by
  the sidecar, `cli.ts`) to that identifier in the client's MCP server env — **both**, or
  the sidecar still reads `app.vmark/mcp-port` and races.
- **No port pointing.** Never configure a fixed VMark-bridge port. It's dynamic; discovery
  is the port file.

## Worked examples

### AI-driven feature → VMark MCP (the shipping path)

The `browser` tool actions: `read, act, open, navigate, wait, wait_for, screenshot,
query, style, execute_js, session_save, session_load, console`. Example — open a page and
read its content:

```
browser { action: "open", url: "https://weibo.com" }
→ { tabId, title: "微博 – 随时随地发现新鲜事", url: "https://weibo.com/newlogin", loading: false }

browser { action: "read", tabId }
→ { url, snapshot: [ {role:"textbox", name:"搜索微博", ref:"e1"}, {role:"button", name:"登录/注册", ref:"e3"}, … ] }
```

`act`/`type`/etc. are approval-gated: an un-granted operation returns
`success:false, data.needsApproval:true` — surface it and wait, don't retry.

**Probe a freshly-built sidecar without restarting the client** (verify a build end-to-end
against the running app) — spawn the binary and speak MCP over stdio:

```
initialize → notifications/initialized → tools/call { name:"browser", arguments:{ action:"open", url:"…" } }
```

The sidecar auto-discovers the running app via the port file and routes the call. Useful
to confirm a new tool/action works before restarting the client for real use.

### UI / IPC / non-AI E2E → Tauri MCP (dev harness)

```
driver_session { action: "start", port: 9323 }

# invoke a Tauri command through the app's own webview (real IPC):
webview_execute_js: (async () => window.__TAURI__.core.invoke('some_command', { … }))()

# simulate real input (e.g. the "New Browser Tab" shortcut Alt-Mod-Shift-b):
webview_keyboard { action: "press", key: "b", modifiers: ["Meta","Alt","Shift"] }

webview_screenshot        # captures VMark's own webview (NOT native subviews — see below)
read_logs { source: "system", filter: "…" }
```

**Screenshot caveat:** the embedded browser is a **native `WKWebView` subview**;
`webview_screenshot` captures VMark's Tauri webview, so it shows the browser *chrome* but
not the rendered page. To read the embedded page's content, use the **VMark MCP** `browser`
`read`/`screenshot` actions, not the Tauri screenshot.

## Quick reference

| What | Value |
|---|---|
| Tauri harness port | `127.0.0.1:9323` (pinned, debug-only) |
| VMark bridge port | dynamic (OS-assigned); discover via port file |
| Port file (macOS) | `~/Library/Application Support/app.vmark/mcp-port` → `PORT:TOKEN` |
| Run the app | `pnpm tauri:dev` |
| Rebuild sidecar | `pnpm --dir vmark-mcp-server build:sidecar` |
| Sidecar binary | `src-tauri/binaries/vmark-mcp-server-<triple>` (gitignored) |
| Verify sidecar tools | `<binary> --health-check` |
| Reconfigure client (dev) | `mcp_config_install` (Integrations settings, or invoke via Tauri harness) → writes dev binary path |
| Providers | `claude`, `codex`, `gemini`, `claude-desktop` |
| After reconfigure | **restart the AI client** |

## Key source references

- Tauri harness registration + `9323`: `src-tauri/src/lib.rs` (`#[cfg(debug_assertions)]`).
- VMark bridge dynamic port: `src-tauri/src/mcp_bridge/server.rs`; port file:
  `src-tauri/src/mcp_bridge/state.rs`, `src-tauri/src/app_paths.rs`.
- Sidecar discovery/connect: `vmark-mcp-server/src/cli.ts`, `src/bridge/websocket.ts`.
- Sidecar build: `vmark-mcp-server/scripts/build-sidecar.js` (`pnpm build:sidecar`).
- Client-config writer (build-aware binary path): `src-tauri/src/mcp_config/`
  (`providers.rs`, `config_io.rs`, `commands.rs`); UI in
  `src/pages/settings/IntegrationsSettings.tsx` + `McpConfigInstaller.tsx`.
- Browser tool schema: `vmark-mcp-server/src/tools/browser.ts`.

# Privacy

VMark is a local-first editor: your documents are files on your disk, rendering happens on your machine, and there is no account, no telemetry and no crash reporting. This page lists every way VMark touches the network, what each one sends, and how to turn it off — and what VMark is allowed to read on your disk.

## Every network connection VMark makes

| When | Where it goes | What is sent | How to stop it |
|------|---------------|--------------|----------------|
| Update check — on launch by default | `log.vmark.app`, then GitHub Releases as a fallback | Platform, architecture, app version and an anonymous machine hash — [details below](#the-update-check-in-detail) | **Settings → About → Check frequency → Manual only**, or block `log.vmark.app` |
| Running an AI genie with a **REST provider** | The endpoint you configured — Anthropic, OpenAI, an OpenAI-compatible host, Google AI, or your Ollama host | The filled prompt: the selected text, block or document plus any surrounding context the genie asked for, and your API key. The **Test** and model-refresh buttons also contact the endpoint | Configure no provider, or use a local Ollama |
| Running an AI genie with a **CLI provider** | Nothing from VMark itself — the `claude`, `codex` or `gemini` CLI you installed talks to its own vendor under its own account | VMark pipes the prompt to the CLI on your machine | Same as above |
| Exporting HTML | jsDelivr (cdnjs as fallback) and Google Fonts | Nothing — downloads only: the KaTeX math fonts when the document has math, and any web font you chose in Settings, so they can be embedded | Export with no connection; the export falls back to system fonts |
| Opening an exported `index.html` | jsDelivr | Nothing — downloads the KaTeX stylesheet for documents with math | Use `standalone.html`, which inlines it |
| Editing a GitHub Actions workflow | `raw.githubusercontent.com` | The `owner/repo@ref` of each `uses:` step, to fetch its `action.yml` (cached 24 h) | **Settings → Advanced → Fetch action metadata** off |
| The embedded browser | Whatever site you — or, under your approval, an AI assistant — open | It is a web browser; see the [browser guide](/guide/browser) for the AI posture, sandboxed sessions and destination policy | **Settings → Advanced → Embedded browser** off |
| Documents that reference the web | The hosts named in your document | Remote images and YouTube / Vimeo / Bilibili embeds load from their hosts when rendered in the editor or in exported HTML | Keep images local |

Two things that look like network services are loopback-only and never leave your machine:

- **The MCP server** — AI assistants connect through a WebSocket bridge bound to `127.0.0.1`, authenticated with a token VMark keeps in its app data directory. The assistant itself (Claude Desktop, Claude Code, Codex CLI…) talks to its own vendor; VMark only answers its tool calls. See [AI Integration](/guide/mcp-setup).
- **The knowledge base and Slidev preview** — a local server bound to `127.0.0.1` with a per-session token; the [Knowledge Base guide](/guide/knowledge-base#privacy-security) describes its containment.

The integrated terminal runs your own shell — anything it connects to is your command, not VMark's.

## What VMark does NOT send

- Your documents or their contents (except to an AI provider you configured, when you run a genie)
- File names or paths
- Usage patterns or feature analytics
- Personal information of any kind
- Crash reports
- Keystroke or editing data
- Reversible hardware identifiers or fingerprints

## The update check in detail

VMark's **auto-update checker** contacts our server to see if a new version is available. Each check sends exactly these fields — nothing more:

| Data | Example | Purpose |
|------|---------|---------|
| IP address | `203.0.113.42` | Inherent in any HTTP request — we can't not receive it |
| OS | `darwin`, `windows`, `linux` | To serve the correct update package |
| Architecture | `aarch64`, `x86_64` | To serve the correct update package |
| App version | `0.5.10` | To determine if an update is available |
| Machine hash | `a3f8c2...` (64-char hex) | Anonymous device counter — SHA-256 of hostname + OS + arch; not reversible |

The full URL looks like:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

If that server cannot be reached, the updater tries the same manifest from GitHub Releases (`github.com/xiaolai/vmark/releases/latest/download/latest.json`). Updates themselves are verified with a minisign signature before they install.

You can verify this yourself — the endpoints are in [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (search for `"endpoints"`), and the hash is in [`app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) (search for `machine_id_hash`).

### How we use the data

We aggregate the update check logs to produce the live statistics shown on our [homepage](/):

| Metric | How it's calculated |
|--------|-------------------|
| **Unique devices** | Count of distinct machine hashes per day/week/month |
| **Unique IPs** | Count of distinct IP addresses per day/week/month |
| **Pings** | Total number of update check requests |
| **Platforms** | Count of pings per OS + architecture combination |
| **Versions** | Count of pings per app version |

These numbers are published openly at [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Nothing is hidden.

**Important caveats:**
- Unique IPs undercount real users — multiple people behind the same router/VPN count as one
- Unique devices provide more accurate counts, but a hostname change or fresh OS install generates a new hash
- Pings overcount real users — one person may check multiple times per day

### Data retention

- Logs are stored on our server in standard access log format
- Log files rotate at 1 MB and only the 3 most recent files are kept
- Logs are not shared with anyone
- There is no account system — VMark doesn't know who you are
- The machine hash is not linked to any account, email, or IP address — it is a pseudonymous device counter only
- We do not use tracking cookies, fingerprinting, or any analytics SDK

### Disabling update checks

Set **Settings → About → Check frequency** to **Manual only** and VMark never contacts the update server on its own; **Check Now** still works when you want it. To be certain at the network level, block `log.vmark.app` (firewall, `/etc/hosts`, or DNS) — VMark keeps working normally without it; you just won't receive update notifications.

## Where API keys are stored

API keys for REST AI providers live in the operating system's credential store — macOS Keychain, Windows Credential Manager, or Linux Secret Service — under the service name `app.vmark.secrets`. They are never written to VMark's settings files or to `localStorage`, and the app's persisted provider settings are saved without the key. Keys are sent only to the provider endpoint you configured, when you run a genie or press **Test**. Details in [AI Providers](/guide/ai-providers#where-api-keys-live).

## What an AI assistant can reach

An assistant connected over MCP acts only within what you have already opened: its file operations are confined to the open workspace root and to the folders of the documents open in VMark, and a request outside that boundary is refused. Saving a document to a **new** path needs the **Auto-approve saves to a new location and genie results** setting (off by default) — otherwise the call is refused and VMark shows a toast naming the file; even with it on, an assistant can never overwrite a different existing file that way. Opening a workspace it names asks you first. Every AI write to a document is checkpointed so you can restore what was there ([edit checkpoints](/guide/mcp-setup#edit-checkpoints)). The embedded browser has its own approval model, described in the [browser guide](/guide/browser).

## What VMark can read on disk

VMark's file access is a narrow capability scope, not the whole disk:

- **Static scope**: your home folder (`$HOME/**`) plus mounted volumes — `/Volumes/**` on macOS, `/mnt/**` and `/media/**` on Linux. On Windows `$HOME` is `C:\Users\<you>`, so other drive letters are outside the static scope.
- **Runtime grants**: anything you open explicitly — a file from Finder or Explorer, the `vmark` command line, a file dialog, a workspace on another drive — gets an in-memory grant for exactly that file, or that folder tree for a workspace. Grants are re-issued on every launch (session-restored and recent workspaces go through the same path), so nothing accumulates on disk.
- **Media previews** get asset access only for files with a media extension; a request for any other path is refused rather than widening the scope.

Nothing here is sent anywhere; the scope decides what the app itself may read.

## Open source transparency

VMark is fully open source. You can verify everything described here:

- Update endpoint configuration: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Machine hash generation: [`src-tauri/src/app_setup.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/app_setup.rs) — search for `machine_id_hash`
- Filesystem scope: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json) and [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs)
- Keychain storage: [`src-tauri/src/secure_store.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/secure_store.rs)
- Server-side stats aggregation: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — the exact script that runs on our server to produce the [public stats](https://log.vmark.app/api/stats)
- The network call sites are the ones listed above — search the repository for `reqwest` (Rust) and `fetch(` (TypeScript) to check for yourself

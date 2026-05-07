# AI Providers

VMark's [AI Genies](/guide/ai-genies) need an AI provider to generate suggestions. You can use a locally installed CLI tool or connect directly to a REST API.

## Quick Setup

The fastest way to get started:

1. Open **Settings > Integrations**
2. Click **Detect** to scan for installed CLI tools
3. If a CLI is found (e.g., Claude, Gemini), select it — you're done
4. If no CLI is available, choose a REST provider, enter your API key, and select a model

Only one provider can be active at a time.

## CLI Providers

CLI providers use locally installed AI tools. VMark runs them as subprocesses and streams their output back to the editor.

| Provider | CLI Command | Install |
|----------|-------------|---------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |
### How CLI Detection Works

Click **Detect** in Settings > Integrations. VMark searches your `$PATH` for each CLI command and reports availability. If a CLI is found, its radio button becomes selectable.

### Advantages

- **No API key needed** — the CLI handles authentication using your existing login
- **Dramatically cheaper** — CLI tools use your subscription plan (e.g., Claude Max, ChatGPT Plus/Pro, Google One AI Premium), which costs a fixed monthly fee. REST API providers charge per token and can cost 10–30x more for heavy usage
- **Uses your CLI config** — model preferences, system prompts, and billing are managed by the CLI itself
::: tip Subscription vs API for Developers
If you're also using these tools for vibe-coding (Claude Code, Codex CLI, Gemini CLI), the same subscription covers both VMark's AI Genies and your coding sessions — no extra cost.
:::

### Setup: Claude CLI

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` once in your terminal to authenticate
3. In VMark, click **Detect**, then select **Claude**

### Setup: Gemini CLI

1. Install Gemini CLI: `npm install -g @google/gemini-cli` (or via the [official repo](https://github.com/google-gemini/gemini-cli))
2. Run `gemini` once to authenticate with your Google account
3. In VMark, click **Detect**, then select **Gemini**

## REST API Providers

REST providers connect directly to cloud APIs. Each requires an endpoint, API key, and model name.

| Provider | Default Endpoint | Env Variable |
|----------|-----------------|--------------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Google AI | *(built-in)* | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### Configuration Fields

When you select a REST provider, three fields appear:

- **API Endpoint** — The base URL (hidden for Google AI, which uses a fixed endpoint)
- **API Key** — Your secret key (stored in the app data directory, not in browser localStorage)
- **Model** — The model identifier (e.g., `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### Environment Variable Auto-Fill

VMark reads standard environment variables on launch. If `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` is set in your shell profile, the API key field auto-populates when you select that provider.

This means you can set your key once in `~/.zshrc` or `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Then restart VMark — no manual key entry needed.

### Setup: Anthropic (REST)

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In VMark Settings > Integrations, select **Anthropic**
3. Paste your API key
4. Choose a model (default: `claude-sonnet-4-5-20250929`)

### Setup: OpenAI (REST)

1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. In VMark Settings > Integrations, select **OpenAI**
3. Paste your API key
4. Choose a model (default: `gpt-4o`)

### Setup: Google AI (REST)

1. Get an API key from [aistudio.google.com](https://aistudio.google.com)
2. In VMark Settings > Integrations, select **Google AI**
3. Paste your API key
4. Choose a model (default: `gemini-2.0-flash`)

### Setup: Ollama API (REST)

Use this when you want REST-style access to a local Ollama instance, or when Ollama is running on another machine on your network.

1. Ensure Ollama is running: `ollama serve`
2. In VMark Settings > Integrations, select **Ollama (API)**
3. Set endpoint to `http://localhost:11434` (or your Ollama host)
4. Leave API key empty
5. Set model to your pulled model name (e.g., `llama3.2`)

## Choosing a Provider

| Situation | Recommendation |
|-----------|---------------|
| Already have Claude Code installed | **Claude (CLI)** — zero config, uses your subscription |
| Already have Codex or Gemini installed | **Codex / Gemini (CLI)** — uses your subscription |
| Need privacy / offline | Install Ollama → **Ollama (API)** at `http://localhost:11434` |
| Custom or self-hosted model | **Ollama (API)** with your endpoint |
| Want the cheapest cloud option | **Any CLI provider** — subscription is dramatically cheaper than API |
| No subscription, light usage only | Set API key env var → **REST provider** (pay-per-token) |
| Need the highest quality output | **Claude (CLI)** or **Anthropic (REST)** with `claude-sonnet-4-5-20250929` |

## Per-Genie Model Override

Individual genies can override the provider's default model using the `model` frontmatter field:

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

This is useful for routing simple tasks to faster/cheaper models while keeping a powerful default.

## Reliability and timeouts

VMark guards every provider call so a hung CLI or a malformed API response can never block the editor:

- **CLI subprocess timeout**: every CLI provider invocation runs under an execution timeout. If the CLI doesn't respond, VMark cancels the call, returns the error to the genie, and frees the worker — the thread pool can't be wedged by a runaway subprocess.
- **REST JSON parse safety**: if a REST provider returns an unexpected response shape (HTML error page, truncated JSON, schema drift after an upstream change), VMark surfaces a typed error to the frontend instead of leaving the AI listener waiting forever. You'll see the error in the genie's status banner with an option to retry.
- **Cancellation tokens**: long-running genie or workflow steps can be cancelled at any point — Cancel in the genie picker or close the panel and the in-flight request aborts cleanly.
- **Shared HTTP client**: REST providers share a single connection-pooled `reqwest` client, so back-to-back genie runs don't pay the TCP/TLS handshake cost each time.
- **Windows path discovery**: on Windows, VMark reads the user's full `PATH` (including PowerShell-only entries) when detecting CLIs, so user-installed tools that work in a terminal also work inside VMark.

## Security Notes

- **API keys are ephemeral** — stored in memory only, never written to disk or `localStorage`
- **Environment variables** are read once on launch and cached in memory
- **CLI providers** use your existing CLI authentication — VMark never sees your credentials
- **All requests go directly** from your machine to the provider — no VMark servers in between

## Troubleshooting

**"No AI provider available"** — Click **Detect** to scan for CLIs, or configure a REST provider with an API key.

**CLI shows "Not found"** — The CLI is not in your `$PATH`. Install it or check your shell profile. On macOS, GUI apps may not inherit terminal `$PATH` — try adding the path to `/etc/paths.d/`.

**CLI hangs / no response** — VMark's execution timeout will cancel the call automatically; you'll see an error in the genie status banner. If a particular CLI consistently hits the timeout, run it once from a terminal to confirm it works there, then check whether it requires interactive auth.

**REST provider returns 401** — Your API key is invalid or expired. Generate a new one from the provider's console.

**REST provider returns 429** — You've hit a rate limit. Wait a moment and try again, or switch to a different provider.

**REST provider returns garbled / unexpected JSON** — VMark surfaces a typed parse error (e.g. "list_models returned an unexpected response shape"). Check the endpoint URL and that the API contract matches the provider type you selected; some self-hosted gateways advertise OpenAI-compatible URLs but ship a different schema.

**Slow responses** — CLI providers add subprocess overhead. For faster responses, use REST providers which connect directly. For the fastest local option, use Ollama with a small model.

**Model not found error** — The model identifier doesn't match what the provider offers. Check the provider's docs for valid model names.

## See Also

- [AI Genies](/guide/ai-genies) — How to use AI-powered writing assistance
- [MCP Setup](/guide/mcp-setup) — External AI integration via Model Context Protocol

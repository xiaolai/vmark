# ADR-005: CLI-Based AI Provider Routing

> Status: **Reversed in practice** (2026-07-22 audit,
> `dev-docs/audit/20260722-adr-reality-audit.md`) — the option this ADR
> explicitly **rejected** (Option 1: direct REST APIs with managed API keys) is
> now fully implemented and shipping (`ai_provider/rest_api.rs`,
> `ai_provider/rest_providers.rs`, `secure_store.rs`), so the load-bearing
> "zero API key management" premise is false. CLI routing (Option 2) also ships;
> the two coexist. The ADR was never amended when the reversal landed — that
> process gap is the finding, more than the drift itself.
> Original status: **Accepted** | Date: 2026-01-10

## Context

VMark integrates AI capabilities for in-editor writing assistance (Genies). The
app needed a way to route AI prompts to different providers (Codex CLI, Claude
Code CLI, OpenAI API, Anthropic API) based on availability and user preference.

The key constraint: VMark is a desktop app distributed outside app stores. It
cannot bundle API keys or manage OAuth flows for cloud AI services. Users
already have CLI tools installed and authenticated on their machines.

## Considered Options

1. **Direct API integration** — embed HTTP clients for OpenAI/Anthropic APIs,
   manage API keys in VMark settings.
2. **CLI-based routing** — detect installed CLI tools (Codex, Claude Code) and
   invoke them as subprocesses, streaming results via Tauri events.
3. **Plugin architecture** — let users install provider plugins that implement a
   common interface.

## Decision

Chosen: **CLI-based routing** (`src-tauri/src/ai_provider/`, a module directory), because it
leverages existing user authentication and avoids key management.

Architecture:

- `ai_provider/detection.rs` detects available providers by checking CLI tool presence
  and login status (e.g., `codex login status` exit code).
- Prompts are executed via shell commands (`codex -p`, `claude -p`) with
  streamed stdout piped back to the frontend as Tauri events.
- Provider selection is configurable in settings with automatic fallback.
- All command spawning uses `build_command()` (handles `.cmd` shims on Windows)
  and `login_shell_path()` (resolves full PATH on macOS GUI apps).

## Consequences

- Good: Zero API key management — users authenticate once via CLI tools.
- Good: Subscription-based pricing via CLI tools is dramatically cheaper than
  direct API billing for sustained use.
- Good: Adding new providers requires only a new detection + invocation path,
  not an SDK integration.
- Bad: Depends on external CLI tools being installed and in PATH. macOS GUI
  apps have minimal PATH — mitigated by `login_shell_path()`.
- Bad: CLI output parsing is fragile — provider CLI format changes can break
  streaming. Mitigated by defensive parsing and error handling.
- Bad: No fine-grained control over model parameters (temperature, max tokens)
  beyond what the CLI exposes.

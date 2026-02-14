//! AI Provider Router
//!
//! Detects available CLI AI providers and executes prompts via shell commands
//! or REST APIs. Streams results back to the frontend via Tauri events.
//!
//! # Submodules
//!
//! - `types`          -- Shared types (`CliProviderEntry`, `AiResponseChunk`) and event helpers
//! - `detection`      -- CLI provider detection, login-shell PATH, env API keys
//! - `rest_api`       -- API key testing, model listing, model validation
//! - `cli`            -- CLI provider spawning and stdout streaming
//! - `rest_providers` -- REST provider prompt execution (Anthropic, OpenAI, Google AI, Ollama)

mod cli;
mod detection;
mod rest_api;
mod rest_providers;
mod types;

// Re-export everything from submodules that define Tauri `#[command]`s.
// Wildcard re-exports are required because `generate_handler!` resolves
// hidden `__cmd__*` companion items at the same module path.
#[allow(unused_imports)]
pub use detection::*;
#[allow(unused_imports)]
pub use rest_api::*;

// Re-export crate-internal helpers used by other modules (e.g. mcp/).
#[allow(unused_imports)]
pub(crate) use cli::build_command;
#[allow(unused_imports)]
pub(crate) use detection::login_shell_path;

use tauri::{command, WebviewWindow};
use types::require_api_key;

// ============================================================================
// Prompt Execution Dispatcher
// ============================================================================

/// Run an AI prompt and stream results back via `ai:response` events.
///
/// For CLI providers: pipes prompt to stdin of the CLI tool.
/// For REST providers: sends HTTP request via reqwest.
/// `cli_path` is the resolved absolute path from detection (used on
/// Windows where bare command names may not find `.cmd`/`.bat` shims).
#[command]
pub async fn run_ai_prompt(
    window: WebviewWindow,
    request_id: String,
    provider: String,
    prompt: String,
    model: Option<String>,
    api_key: Option<String>,
    endpoint: Option<String>,
    cli_path: Option<String>,
) -> Result<(), String> {
    match provider.as_str() {
        // CLI providers -- run on blocking thread pool to avoid starving tokio
        "claude" => {
            cli::run_cli_blocking(
                &window,
                &request_id,
                "claude",
                vec!["--print".into(), "--output-format".into(), "text".into()],
                Some(prompt),
                cli_path,
            )
            .await
        }
        "codex" => {
            cli::run_cli_blocking(
                &window,
                &request_id,
                "codex",
                vec!["exec".into(), prompt],
                None,
                cli_path,
            )
            .await
        }
        "gemini" => {
            cli::run_cli_blocking(
                &window,
                &request_id,
                "gemini",
                vec!["-p".into(), prompt],
                None,
                cli_path,
            )
            .await
        }

        // REST providers
        "anthropic" => {
            let Some(key) = require_api_key(&window, &request_id, &api_key, "Anthropic") else {
                return Ok(());
            };
            rest_providers::run_rest_anthropic(
                &window,
                &request_id,
                &endpoint.unwrap_or_else(|| "https://api.anthropic.com".to_string()),
                key,
                &model.unwrap_or_else(|| "claude-sonnet-4-5-20250929".to_string()),
                &prompt,
            )
            .await
        }
        "openai" => {
            let Some(key) = require_api_key(&window, &request_id, &api_key, "OpenAI") else {
                return Ok(());
            };
            rest_providers::run_rest_openai(
                &window,
                &request_id,
                &endpoint.unwrap_or_else(|| "https://api.openai.com".to_string()),
                key,
                &model.unwrap_or_else(|| "gpt-4o".to_string()),
                &prompt,
            )
            .await
        }
        "google-ai" => {
            let Some(key) = require_api_key(&window, &request_id, &api_key, "Google AI") else {
                return Ok(());
            };
            rest_providers::run_rest_google(
                &window,
                &request_id,
                key,
                &model.unwrap_or_else(|| "gemini-2.0-flash".to_string()),
                &prompt,
            )
            .await
        }
        "ollama-api" => {
            rest_providers::run_rest_ollama(
                &window,
                &request_id,
                &endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()),
                &model.unwrap_or_else(|| "llama3.2".to_string()),
                &prompt,
            )
            .await
        }

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

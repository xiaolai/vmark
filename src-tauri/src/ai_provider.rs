//! AI Provider Router
//!
//! Detects available CLI AI providers and executes prompts via shell commands
//! or REST APIs. Streams results back to the frontend via Tauri events.

use serde::Serialize;
use std::io::{BufRead, BufReader, Write as IoWrite};
use std::process::{Command, Stdio};
use tauri::{command, Emitter, WebviewWindow};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct CliProviderEntry {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub command: String,
    pub available: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AiResponseChunk {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
    pub error: Option<String>,
}

// ============================================================================
// CLI Provider Detection
// ============================================================================

/// Detect which CLI AI providers are available on the system.
#[command]
pub fn detect_ai_providers() -> Vec<CliProviderEntry> {
    let providers = [
        ("claude", "Claude", "claude"),
        ("codex", "Codex", "codex"),
        ("gemini", "Gemini", "gemini"),
    ];

    providers
        .iter()
        .map(|(typ, name, cmd)| {
            let (available, path) = check_command(cmd);
            CliProviderEntry {
                provider_type: typ.to_string(),
                name: name.to_string(),
                command: cmd.to_string(),
                available,
                path,
            }
        })
        .collect()
}

/// Resolve the user's full login-shell `$PATH`.
///
/// macOS/Linux app bundles launched from Finder/Dock (or some Linux
/// desktop environments) inherit a minimal PATH.  We spawn the user's
/// interactive login shell and ask for its PATH.  Using `-li` ensures
/// both profile AND rc files are sourced (needed for nvm, fnm, pyenv,
/// etc.).  Markers isolate PATH from shell startup noise.
///
/// On Windows, GUI apps inherit the full system PATH — no shell dance
/// needed.  On fish shell, `$PATH` is a list so we use `string join`.
///
/// The result is cached for the lifetime of the process.
pub(crate) fn login_shell_path() -> String {
    use std::sync::OnceLock;
    static CACHED: OnceLock<String> = OnceLock::new();

    CACHED
        .get_or_init(|| {
            // Windows GUI apps inherit full system PATH — skip the shell dance
            if cfg!(target_os = "windows") {
                return std::env::var("PATH").unwrap_or_default();
            }

            const START: &str = "__VMARK_PATH_START__";
            const END: &str = "__VMARK_PATH_END__";

            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

            // Fish uses list-based $PATH — need `string join` for colon-separated
            let cmd = if shell.ends_with("/fish") {
                format!("echo {START}(string join : $PATH){END}")
            } else {
                format!("echo {START}${{PATH}}{END}")
            };

            let output = Command::new(&shell)
                .args(["-lic", &cmd])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .spawn()
                .ok()
                .and_then(|child| {
                    // Wait with a 5-second timeout to avoid hanging on interactive shells
                    let output = child.wait_with_output().ok()?;
                    if output.status.success() {
                        Some(String::from_utf8_lossy(&output.stdout).to_string())
                    } else {
                        None
                    }
                });

            if let Some(raw) = output {
                if let Some(start) = raw.find(START) {
                    if let Some(end) = raw.find(END) {
                        let path = &raw[start + START.len()..end];
                        return path.trim().to_string();
                    }
                }
            }
            std::env::var("PATH").unwrap_or_default()
        })
        .clone()
}

fn check_command(cmd: &str) -> (bool, Option<String>) {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    match Command::new(which_cmd)
        .arg(cmd)
        .env("PATH", login_shell_path())
        .output()
    {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout);
            // `where` on Windows may return multiple lines — take the first
            let path = raw.lines().next().unwrap_or("").trim().to_string();
            if path.is_empty() {
                (false, None)
            } else {
                (true, Some(path))
            }
        }
        _ => (false, None),
    }
}

// ============================================================================
// Environment API Keys
// ============================================================================

/// Read well-known API key environment variables for REST providers.
///
/// Returns a map of `RestProviderType → key` for any env var that is set
/// and non-empty. The frontend uses this to pre-fill empty API key fields.
#[command]
pub fn read_env_api_keys() -> std::collections::HashMap<String, String> {
    let mapping: &[(&str, &[&str])] = &[
        ("anthropic", &["ANTHROPIC_API_KEY"]),
        ("openai", &["OPENAI_API_KEY"]),
        ("google-ai", &["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
    ];

    let mut result = std::collections::HashMap::new();
    for (provider, vars) in mapping {
        for var in *vars {
            if let Ok(val) = std::env::var(var) {
                if !val.is_empty() {
                    result.insert(provider.to_string(), val);
                    break; // first match wins
                }
            }
        }
    }
    result
}

// ============================================================================
// Shared Helpers (test / list / validate)
// ============================================================================

fn make_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

fn resolve_endpoint(endpoint: Option<String>, default: &str) -> String {
    endpoint
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn require_key(api_key: Option<String>) -> Result<String, String> {
    api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "API key is required".to_string())
}

async fn check_response(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    Err(format!("HTTP {}: {}", status.as_u16(), text))
}

// ============================================================================
// API Key Testing
// ============================================================================

/// Test an API key by hitting the cheapest possible endpoint per provider.
///
/// Returns a short success message or an error string.
#[command]
pub async fn test_api_key(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<String, String> {
    let client = make_client(10)?;

    match provider.as_str() {
        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let resp = client
                .get(format!("{}/v1/models", base))
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let resp = client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .header("x-goog-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let resp = client
                .get(format!("{}/api/tags", base))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "anthropic" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.anthropic.com");
            let body = serde_json::json!({
                "model": "claude-sonnet-4-5-20250929",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/messages", base))
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ============================================================================
// Model Listing
// ============================================================================

/// List available models for a REST provider.
///
/// - Ollama: fetches from local `/api/tags`
/// - OpenAI: fetches `/v1/models`, filters to chat-capable prefixes
/// - Google AI: fetches `/v1beta/models`, strips `models/` prefix
/// - Anthropic: returns curated list (no listing endpoint)
#[command]
pub async fn list_models(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<Vec<String>, String> {
    let client = make_client(10)?;

    match provider.as_str() {
        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let resp = client
                .get(format!("{}/api/tags", base))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            let models = json
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(models)
        }

        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let resp = client
                .get(format!("{}/v1/models", base))
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            // Use dash-suffixed prefixes to avoid false matches (e.g. "o1" matching "o100-*")
            let prefixes = ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];
            let exact = ["o1", "o3", "o4"];
            let mut models: Vec<String> = json
                .get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                        .filter(|id| {
                            prefixes.iter().any(|p| id.starts_with(p))
                                || exact.iter().any(|e| id.as_str() == *e)
                        })
                        .collect()
                })
                .unwrap_or_default();
            models.sort();
            Ok(models)
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let resp = client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .header("x-goog-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            let mut models: Vec<String> = json
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            m.get("name")
                                .and_then(|n| n.as_str())
                                .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
                        })
                        .collect()
                })
                .unwrap_or_default();
            models.sort();
            Ok(models)
        }

        "anthropic" => Ok(vec![
            "claude-sonnet-4-5-20250929".to_string(),
            "claude-haiku-4-5-20251001".to_string(),
        ]),

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ============================================================================
// Model Validation
// ============================================================================

/// Validate that a specific model works by sending a minimal request.
///
/// - OpenAI: POST /v1/chat/completions with max_tokens=1
/// - Anthropic: POST /v1/messages with max_tokens=1
/// - Google AI: POST generateContent with minimal content
/// - Ollama: POST /api/show to check model existence
#[command]
pub async fn validate_model(
    provider: String,
    model: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<String, String> {
    let client = make_client(15)?;

    match provider.as_str() {
        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/chat/completions", base))
                .header("Authorization", format!("Bearer {}", key))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "anthropic" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.anthropic.com");
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/messages", base))
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let body = serde_json::json!({
                "contents": [{"parts": [{"text": "Hi"}]}]
            });
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                model
            );
            let resp = client
                .post(&url)
                .header("x-goog-api-key", &key)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let body = serde_json::json!({ "name": model });
            let resp = client
                .post(format!("{}/api/show", base))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ============================================================================
// Prompt Execution
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
        // CLI providers — run on blocking thread pool to avoid starving tokio
        "claude" => {
            let w = window.clone(); let rid = request_id.clone(); let p = prompt.clone(); let cp = cli_path.clone();
            tokio::task::spawn_blocking(move || {
                run_cli_provider(&w, &rid, "claude", &["--print", "--output-format", "text"], Some(&p), cp.as_deref())
            }).await.map_err(|e| format!("Task join error: {e}"))??;
            Ok(())
        }
        "codex" => {
            let w = window.clone(); let rid = request_id.clone(); let p = prompt.clone(); let cp = cli_path.clone();
            tokio::task::spawn_blocking(move || {
                run_cli_provider(&w, &rid, "codex", &["exec", &p], None, cp.as_deref())
            }).await.map_err(|e| format!("Task join error: {e}"))??;
            Ok(())
        }
        "gemini" => {
            let w = window.clone(); let rid = request_id.clone(); let p = prompt.clone(); let cp = cli_path.clone();
            tokio::task::spawn_blocking(move || {
                run_cli_provider(&w, &rid, "gemini", &["-p", &p], None, cp.as_deref())
            }).await.map_err(|e| format!("Task join error: {e}"))??;
            Ok(())
        }

        // REST providers
        "anthropic" => {
            let Some(key) = require_api_key(&window, &request_id, &api_key, "Anthropic") else {
                return Ok(());
            };
            run_rest_anthropic(
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
            run_rest_openai(
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
            run_rest_google(
                &window,
                &request_id,
                key,
                &model.unwrap_or_else(|| "gemini-2.0-flash".to_string()),
                &prompt,
            )
            .await
        }
        "ollama-api" => {
            run_rest_ollama(
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

// ============================================================================
// CLI Execution
// ============================================================================

/// Build a `Command` for the given executable and args.
///
/// On Windows, `.cmd`/`.bat` shims (created by npm/yarn global installs)
/// must run through `cmd.exe /c`.  On macOS/Linux this is a plain spawn.
pub(crate) fn build_command(exe: &str, args: &[&str]) -> Command {
    if cfg!(target_os = "windows") {
        let lower = exe.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut c = Command::new("cmd");
            c.args(["/c", exe]);
            c.args(args);
            return c;
        }
    }
    let mut c = Command::new(exe);
    c.args(args);
    c
}

/// Run a CLI AI provider and stream stdout back as `ai:response` events.
///
/// When `stdin_prompt` is `Some`, the prompt is piped to stdin (for
/// providers like `claude --print` and `ollama run`).  When `None`,
/// the prompt must already be embedded in `args` (for providers like
/// `codex exec` and `gemini -p`).
///
/// `cli_path` is the resolved path from detection.  When available it
/// is used instead of the bare command name so that Windows `.cmd`
/// shims are handled correctly.
fn run_cli_provider(
    window: &WebviewWindow,
    request_id: &str,
    cmd: &str,
    args: &[&str],
    stdin_prompt: Option<&str>,
    cli_path: Option<&str>,
) -> Result<(), String> {
    let stdin_cfg = if stdin_prompt.is_some() { Stdio::piped() } else { Stdio::null() };
    let effective_cmd = cli_path.unwrap_or(cmd);

    let mut child = build_command(effective_cmd, args)
        .env("PATH", login_shell_path())
        .stdin(stdin_cfg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", cmd, e))?;

    // Write prompt to stdin when the provider expects it
    if let Some(prompt) = stdin_prompt {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            // stdin is dropped here, closing it
        }
    }

    // Stream stdout line by line
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    emit_chunk(window, request_id, &(text + "\n"));
                }
                Err(e) => {
                    emit_error(window, request_id, &format!("Read error: {}", e));
                    let _ = child.kill();
                    return Ok(());
                }
            }
        }
    }

    // Check exit status — include stderr in error message
    let output = child.wait_with_output().map_err(|e| format!("Wait failed: {}", e))?;
    if !output.status.success() {
        let stderr_text = String::from_utf8_lossy(&output.stderr);
        let stderr_msg = stderr_text.trim();
        let msg = if stderr_msg.is_empty() {
            format!("{} exited with status {}", cmd, output.status)
        } else {
            format!("{} exited with status {}: {}", cmd, output.status, stderr_msg)
        };
        emit_error(window, request_id, &msg);
    } else {
        emit_done(window, request_id);
    }

    Ok(())
}

// ============================================================================
// REST Execution (reqwest)
// ============================================================================

async fn run_rest_anthropic(
    window: &WebviewWindow,
    request_id: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/messages", endpoint))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(window, request_id, &format!("Anthropic API error {}: {}", status, text));
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Extract text from content blocks
    if let Some(content) = json.get("content").and_then(|c| c.as_array()) {
        for block in content {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                emit_chunk(window, request_id, text);
            }
        }
    } else {
        emit_error(window, request_id, "No content blocks in Anthropic response");
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

async fn run_rest_openai(
    window: &WebviewWindow,
    request_id: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/chat/completions", endpoint))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(window, request_id, &format!("OpenAI API error {}: {}", status, text));
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(text) = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
    {
        emit_chunk(window, request_id, text);
    } else {
        emit_error(window, request_id, "No choices in OpenAI response");
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

async fn run_rest_google(
    window: &WebviewWindow,
    request_id: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "contents": [{"parts": [{"text": prompt}]}]
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    let resp = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Google AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(window, request_id, &format!("Google AI error {}: {}", status, text));
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(text) = json
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|candidates| candidates.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .and_then(|parts| parts.first())
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
    {
        emit_chunk(window, request_id, text);
    } else {
        emit_error(window, request_id, "No candidates in Google AI response");
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

async fn run_rest_ollama(
    window: &WebviewWindow,
    request_id: &str,
    endpoint: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false
    });

    let resp = client
        .post(format!("{}/api/generate", endpoint))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(window, request_id, &format!("Ollama API error {}: {}", status, text));
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(text) = json.get("response").and_then(|r| r.as_str()) {
        emit_chunk(window, request_id, text);
    } else {
        emit_error(window, request_id, "No response field in Ollama response");
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

// ============================================================================
// Helpers
// ============================================================================

/// Validate that an API key is present and non-empty.
///
/// Returns `Some(key)` if valid, or emits an error event and returns `None`.
fn require_api_key<'a>(
    window: &WebviewWindow,
    request_id: &str,
    api_key: &'a Option<String>,
    provider_name: &str,
) -> Option<&'a str> {
    match api_key.as_deref() {
        Some(k) if !k.is_empty() => Some(k),
        _ => {
            emit_error(window, request_id, &format!("{} API key is required", provider_name));
            None
        }
    }
}

fn emit_chunk(window: &WebviewWindow, request_id: &str, text: &str) {
    let _ = window.emit(
        "ai:response",
        AiResponseChunk {
            request_id: request_id.to_string(),
            chunk: text.to_string(),
            done: false,
            error: None,
        },
    );
}

fn emit_done(window: &WebviewWindow, request_id: &str) {
    let _ = window.emit(
        "ai:response",
        AiResponseChunk {
            request_id: request_id.to_string(),
            chunk: String::new(),
            done: true,
            error: None,
        },
    );
}

fn emit_error(window: &WebviewWindow, request_id: &str, msg: &str) {
    let _ = window.emit(
        "ai:response",
        AiResponseChunk {
            request_id: request_id.to_string(),
            chunk: String::new(),
            done: true,
            error: Some(msg.to_string()),
        },
    );
}

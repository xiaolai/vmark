//! Which AI client holds which credential — read from the client configs
//! themselves.
//!
//! **The client configs ARE the token store.** VMark writes a credential into
//! a provider's MCP config entry at install time and reads it back from there;
//! nothing is persisted anywhere else, no keychain entry is created, and there
//! is no stored-secret migration. The configs already have to survive restarts
//! for MCP to work at all, so the credentials survive with them.
//!
//! `mcp_bridge` consumes [`snapshot`]; it never parses a config itself. The
//! dependency runs one way — `mcp_bridge` → `mcp_config` — so "who owns the
//! client configs" has one answer.
//!
//! ## Failure policy
//!
//! A config VMark cannot read or parse is **skipped with a log line**, never
//! fatal. A syntax error a third-party tool left in `~/.claude.json` must not
//! stop the bridge from starting, and must not stop the *other* clients from
//! being identified. The cost is bounded and stated: that client's sidecar
//! authenticates normally and is simply not identified, so only delegated
//! actions are refused, with an error that says how to fix it.
//!
//! ## Refresh
//!
//! The snapshot is rebuilt at bridge start and after every successful
//! install/uninstall. Without the second trigger, clicking Install while VMark
//! is running would appear to do nothing until the app was restarted.

use super::client_token_field::TOKEN_PLACEHOLDER;
use super::config_io::client_token_in;
use super::install_io::read_config_for_merge;
use super::providers::{get_config_path, PROVIDERS};
use crate::secret_token::generate_secret_token;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};

/// One provider's configured credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderToken {
    /// The provider id (`claude`, `codex`, …) — this is the principal the
    /// bridge records when this credential authenticates.
    pub provider: String,
    pub token: String,
}

/// Mint a credential for one AI client.
///
/// Same construction as the bridge's ephemeral port-file token — see
/// `crate::secret_token`. This one is long-lived (it lives in the client's
/// config until the entry is removed) while that one is per-launch, but the
/// entropy requirement is identical.
pub(crate) fn mint_client_token() -> String {
    generate_secret_token()
}

/// How the install path decides which credential lands in a provider's config.
///
/// Install is **idempotent** with respect to the credential: an existing,
/// usable, unshared token is kept. Repair is a routine user action (the
/// Integrations panel offers it for a stale binary path), and making it rotate
/// credentials would mean every Repair click silently unidentified whatever
/// sidecar was already running. A user who *wants* rotation has an explicit
/// path: Uninstall removes the entry and its token, Install issues a new one.
pub(crate) struct TokenPolicy {
    /// Minted once, up front, so a `mutate_config_at` RETRY reuses one value
    /// instead of burning a fresh credential per attempt.
    pub fresh: String,
    /// Credentials already claimed by OTHER providers. A config whose token
    /// appears here is re-issued rather than preserved: a credential two
    /// clients share names neither of them, so preserving it would leave both
    /// permanently ambiguous.
    pub taken: Vec<String>,
}

impl TokenPolicy {
    /// The credential to write, given the one already in this provider's
    /// config.
    pub(crate) fn choose(&self, existing: Option<String>) -> String {
        match existing {
            Some(token) if !self.taken.contains(&token) => token,
            _ => self.fresh.clone(),
        }
    }

    /// Build the policy for installing `provider_id`: a freshly minted
    /// candidate plus every credential the OTHER providers currently hold.
    pub(crate) fn for_provider(provider_id: &str) -> Self {
        let taken = read_tokens_at(&provider_paths_excluding(provider_id))
            .into_iter()
            .map(|t| t.token)
            .collect();
        TokenPolicy {
            fresh: mint_client_token(),
            taken,
        }
    }
}

/// Every provider's `(id, config path)`, skipping any whose path cannot be
/// resolved (no home directory).
fn provider_paths() -> Vec<(&'static str, PathBuf)> {
    PROVIDERS
        .iter()
        .filter_map(|p| get_config_path(p).ok().map(|path| (p.id, path)))
        .collect()
}

fn provider_paths_excluding(provider_id: &str) -> Vec<(&'static str, PathBuf)> {
    provider_paths()
        .into_iter()
        .filter(|(id, _)| *id != provider_id)
        .collect()
}

/// Read the configured credential for each `(provider id, config path)`.
///
/// Path-taking so the whole policy is testable against temp files instead of a
/// real `$HOME`. Unreadable and unparseable configs are logged and skipped —
/// see the failure policy above.
pub(crate) fn read_tokens_at(entries: &[(&str, PathBuf)]) -> Vec<ProviderToken> {
    let mut tokens = Vec::new();
    for (provider, path) in entries {
        match read_one(provider, path) {
            Ok(Some(token)) => tokens.push(ProviderToken {
                provider: (*provider).to_string(),
                token,
            }),
            Ok(None) => {}
            Err(detail) => log::warn!(
                "[MCP] Cannot read the client credential for {provider} from {}: {detail} \
                 — that client will connect but will not be identified",
                path.display()
            ),
        }
    }
    tokens
}

fn read_one(provider: &str, path: &Path) -> Result<Option<String>, String> {
    let content = read_config_for_merge(path)?;
    client_token_in(provider, content.as_deref())
}

/// The live credential set. `Arc` so a reader never holds the lock while the
/// bridge compares tokens.
static TOKENS: OnceLock<RwLock<Arc<Vec<ProviderToken>>>> = OnceLock::new();

fn cell() -> &'static RwLock<Arc<Vec<ProviderToken>>> {
    TOKENS.get_or_init(|| RwLock::new(Arc::new(Vec::new())))
}

/// Re-read every provider config and publish the result.
///
/// Called at bridge start and after a successful install/uninstall. A poisoned
/// lock is not fatal — the previous snapshot stays live and clients keep the
/// identities they had.
pub(crate) fn refresh() {
    let tokens = read_tokens_at(&provider_paths());
    publish(tokens);
}

/// Publish a snapshot directly. Separate from [`refresh`] so tests can install
/// a known set without a real `$HOME`.
pub(crate) fn publish(tokens: Vec<ProviderToken>) {
    match cell().write() {
        Ok(mut guard) => *guard = Arc::new(tokens),
        Err(e) => log::error!("[MCP] Client-credential registry lock poisoned: {e}"),
    }
}

/// The credentials the bridge should compare a presented token against.
pub(crate) fn snapshot() -> Arc<Vec<ProviderToken>> {
    match cell().read() {
        Ok(guard) => guard.clone(),
        Err(e) => {
            log::error!("[MCP] Client-credential registry lock poisoned: {e}");
            Arc::new(Vec::new())
        }
    }
}

/// The credential to show in an install PREVIEW: the one already configured,
/// or the placeholder for a credential that will be minted on install.
pub(crate) fn preview_token(provider_id: &str, content: Option<&str>) -> String {
    client_token_in(provider_id, content)
        .ok()
        .flatten()
        .unwrap_or_else(|| TOKEN_PLACEHOLDER.to_string())
}

#[cfg(test)]
#[path = "client_tokens.test.rs"]
mod tests;

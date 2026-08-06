//! The app's one cryptographic-token minter.
//!
//! Two secrets are minted from here: the ephemeral bridge token written to the
//! MCP port file (`mcp_bridge::state::generate_auth_token`) and the per-client
//! credential written into each AI client's MCP config
//! (`mcp_config::client_tokens::mint_client_token`). They live in different
//! modules and are read by different code, but the *property* they depend on is
//! the same one, so it is defined once here rather than copied.
//!
//! The property: 32 bytes of CSPRNG entropy, hex-encoded. `Uuid::new_v4` draws
//! from `getrandom`; `RandomState`/`SipHash` — the obvious other source of
//! "random-looking" bytes in std — is NOT a cryptographic RNG and must never
//! back a secret (audit 20260612).

/// Mint a 64-character hex secret backed by 32 bytes of CSPRNG entropy.
pub(crate) fn generate_secret_token() -> String {
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    format!("{}{}", a.simple(), b.simple())
}

#[cfg(test)]
#[path = "secret_token.test.rs"]
mod tests;

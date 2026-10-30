//! The app's one cryptographic-token minter.
//!
//! Three secrets are minted from here: the ephemeral bridge token written to the
//! MCP port file (`mcp_bridge::state::generate_auth_token`), the per-client
//! credential written into each AI client's MCP config
//! (`mcp_config::client_tokens::mint_client_token`), and the trusted-HTML
//! preview grant token (`trusted_html::state`). They live in different modules
//! and are read by different code, but the *property* they depend on is the
//! same one, so it is defined once here rather than copied.
//!
//! The property: two v4 UUIDs drawn from the CSPRNG, hex-encoded as 64
//! characters. Each v4 UUID fixes 6 of its 128 bits (version and variant), so
//! the token carries 244 random bits. `Uuid::new_v4` draws
//! from `getrandom`; `RandomState`/`SipHash` — the obvious other source of
//! "random-looking" bytes in std — is NOT a cryptographic RNG and must never
//! back a secret.

/// Mint a 64-character hex secret carrying 244 bits of CSPRNG entropy.
pub(crate) fn generate_secret_token() -> String {
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    format!("{}{}", a.simple(), b.simple())
}

#[cfg(test)]
#[path = "secret_token.test.rs"]
mod tests;

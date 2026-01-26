//! API Key Storage for VMark Agent SDK
//!
//! Securely stores the Anthropic API key in the OS keychain:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (via libsecret)

use keyring::Entry;
use tauri::command;

const SERVICE_NAME: &str = "app.vmark";
const KEY_NAME: &str = "anthropic_api_key";

/// Get the keyring entry for the API key
fn get_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, KEY_NAME).map_err(|e| format!("Failed to access keychain: {}", e))
}

/// Store the API key in the OS keychain
#[command]
pub async fn set_api_key(key: String) -> Result<(), String> {
    // Validate key format (basic check)
    if !key.starts_with("sk-ant-") {
        return Err("Invalid API key format. Key should start with 'sk-ant-'".to_string());
    }

    let entry = get_entry()?;
    entry
        .set_password(&key)
        .map_err(|e| format!("Failed to store API key: {}", e))
}

/// Retrieve the API key from the OS keychain
#[command]
pub async fn get_api_key() -> Result<Option<String>, String> {
    let entry = get_entry()?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve API key: {}", e)),
    }
}

/// Remove the API key from the OS keychain
#[command]
pub async fn clear_api_key() -> Result<(), String> {
    let entry = get_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already cleared
        Err(e) => Err(format!("Failed to clear API key: {}", e)),
    }
}

/// Check if an API key is stored
#[command]
pub async fn has_api_key() -> Result<bool, String> {
    let entry = get_entry()?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check API key: {}", e)),
    }
}

/// Test the API key by making a minimal API call
/// Returns true if the key is valid, false if invalid
#[command]
pub async fn test_api_key(key: Option<String>) -> Result<bool, String> {
    // Get key from parameter or keychain
    let api_key = match key {
        Some(k) => k,
        None => {
            let stored = get_api_key().await?;
            match stored {
                Some(k) => k,
                None => return Err("No API key provided or stored".to_string()),
            }
        }
    };

    // Make a minimal API request to validate the key
    // We use a simple models list endpoint which is cheap
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    match response.status().as_u16() {
        200 => Ok(true),
        401 => Ok(false), // Invalid key
        _ => Err(format!("API error: {}", response.status())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_validation() {
        // Valid format
        assert!(validate_key_format("sk-ant-api03-abc123"));

        // Invalid formats
        assert!(!validate_key_format("invalid-key"));
        assert!(!validate_key_format(""));
        assert!(!validate_key_format("sk-openai-abc"));
    }

    fn validate_key_format(key: &str) -> bool {
        key.starts_with("sk-ant-")
    }
}

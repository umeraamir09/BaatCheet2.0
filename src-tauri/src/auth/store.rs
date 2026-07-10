use crate::auth::{oauth::TokenSet, profile::User};
use serde::{Deserialize, Serialize};

/// OS keychain service name (Windows Credential Manager / macOS Keychain / Linux Secret Service).
const KEYCHAIN_SERVICE: &str = "baatcheet";

/// OS keychain account/username for the Discord token entry.
const KEYCHAIN_ACCOUNT: &str = "discord_tokens";

/// Persisted token set stored in the OS keychain (Decision D1 — never plaintext).
/// `expires_at` is absolute epoch seconds (spec task 4.4).
/// `client_id` is the Discord Client ID needed for token refresh on cold start.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub user: Option<User>,
}

/// Save the token set to the OS keychain. The `TokenSet` from Discord (which
/// has relative `expires_in`) is converted to absolute `expires_at` before storage.
/// The `client_id` is persisted alongside tokens so refresh works on cold start.
pub fn save(tokens: &TokenSet, client_id: Option<&str>, user: Option<&User>) -> Result<(), String> {
    let expires_at = current_epoch_secs() + tokens.expires_in;
    let stored = StoredTokens {
        access_token: tokens.access_token.clone(),
        refresh_token: tokens.refresh_token.clone(),
        expires_at,
        client_id: client_id.map(|s| s.to_string()),
        user: user.cloned(),
    };
    save_stored(&stored)
}

pub fn save_stored(stored: &StoredTokens) -> Result<(), String> {
    let json = serde_json::to_string(&stored).map_err(|e| format!("serialize tokens: {e}"))?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("create keychain entry: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("save to keychain: {e}"))
}

/// Load the token set from the OS keychain. Returns `None` if no entry exists
/// (first launch or after logout).
pub fn load() -> Result<Option<StoredTokens>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("create keychain entry: {e}"))?;
    match entry.get_password() {
        Ok(json) => {
            let stored: StoredTokens =
                serde_json::from_str(&json).map_err(|e| format!("deserialize tokens: {e}"))?;
            Ok(Some(stored))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("load from keychain: {e}")),
    }
}

/// Clear the token set from the OS keychain (spec task 7.1 — log out).
pub fn clear() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("create keychain entry: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already cleared — idempotent.
        Err(e) => Err(format!("clear keychain: {e}")),
    }
}

/// Current Unix epoch in seconds (used to compute `expires_at` from `expires_in`).
fn current_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before Unix epoch")
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_epoch_secs_is_reasonable() {
        let now = current_epoch_secs();
        // Sanity: should be after 2020-01-01 (1577836800) and before 2100-01-01 (4102444800).
        assert!(now > 1_577_836_800);
        assert!(now < 4_102_444_800);
    }

    #[test]
    fn legacy_session_without_cached_user_still_deserializes() {
        let json = r#"{"access_token":"a","refresh_token":"r","expires_at":123,"client_id":"c"}"#;
        let stored: StoredTokens = serde_json::from_str(json).unwrap();
        assert!(stored.user.is_none());
    }
}

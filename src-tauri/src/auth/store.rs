use crate::auth::{oauth::TokenSet, profile::User};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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

/// Directory for file-based fallback storage (resolved lazily from `dirs::data_dir()`).
fn fallback_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("baatcheet")
}

/// File path for the fallback token store.
fn fallback_path() -> PathBuf {
    fallback_dir().join("discord_tokens.json")
}

/// Save the token set to BOTH the OS keychain AND a file-based fallback.
/// The `TokenSet` from Discord (which has relative `expires_in`) is converted
/// to absolute `expires_at` before storage. The `client_id` is persisted
/// alongside tokens so refresh works on cold start.
pub fn save(tokens: &TokenSet, client_id: Option<&str>, user: Option<&User>) -> Result<(), String> {
    let expires_at = current_epoch_secs() + tokens.expires_in;
    let stored = StoredTokens {
        access_token: tokens.access_token.clone(),
        refresh_token: tokens.refresh_token.clone(),
        expires_at,
        client_id: client_id.map(|s| s.to_string()),
        user: user.cloned(),
    };

    let mut last_err = None;

    // Always try keychain first.
    match save_to_keychain(&stored) {
        Ok(()) => eprintln!("[store] Keychain save succeeded"),
        Err(e) => {
            eprintln!("[store] Keychain save failed (non-fatal, using file fallback): {e}");
            last_err = Some(e);
        }
    }

    // Always write to file fallback too.
    match save_to_file(&stored) {
        Ok(()) => eprintln!("[store] File fallback save succeeded ({})", fallback_path().display()),
        Err(e) => {
            eprintln!("[store] File fallback save failed: {e}");
            last_err = Some(e);
        }
    }

    match last_err {
        None => Ok(()),
        Some(e) => Err(format!("token save failed (keychain and file both tried): {e}")),
    }
}

pub fn save_stored(stored: &StoredTokens) -> Result<(), String> {
    save_to_keychain(stored)?;
    save_to_file(stored).ok(); // non-fatal
    Ok(())
}

fn save_to_keychain(stored: &StoredTokens) -> Result<(), String> {
    let json = serde_json::to_string(&stored).map_err(|e| format!("serialize tokens: {e}"))?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("create keychain entry: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("save to keychain: {e}"))
}

fn save_to_file(stored: &StoredTokens) -> Result<(), String> {
    let dir = fallback_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create fallback dir {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| format!("serialize tokens: {e}"))?;
    let path = fallback_path();
    std::fs::write(&path, &json)
        .map_err(|e| format!("write fallback file {}: {e}", path.display()))
}

/// Load the token set from the OS keychain, falling back to a file-based store.
/// Returns `None` if no entry exists (first launch or after logout).
pub fn load() -> Result<Option<StoredTokens>, String> {
    // Try keychain first.
    match load_from_keychain() {
        Ok(Some(stored)) => {
            eprintln!("[store] Loaded from keychain successfully");
            return Ok(Some(stored));
        }
        Ok(None) => {
            eprintln!("[store] Keychain has no entry — checking file fallback...");
        }
        Err(e) => {
            eprintln!("[store] Keychain load error: {e}");
        }
    }

    // Fall back to file.
    load_from_file()
}

fn load_from_keychain() -> Result<Option<StoredTokens>, String> {
    let entry_result = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    let entry = match entry_result {
        Ok(e) => e,
        Err(err) => {
            eprintln!("[store] keyring::Entry::new failed: {err}");
            return Err(format!("create keychain entry: {err}"));
        }
    };
    match entry.get_password() {
        Ok(json) => {
            eprintln!("[store] Keychain raw entry found ({} bytes)", json.len());
            match serde_json::from_str::<StoredTokens>(&json) {
                Ok(stored) => {
                    eprintln!(
                        "[store] Deserialized OK: expires_at={}, has_client_id={}, has_cached_user={}",
                        stored.expires_at,
                        stored.client_id.is_some(),
                        stored.user.is_some(),
                    );
                    Ok(Some(stored))
                }
                Err(e) => {
                    eprintln!("[store] Failed to deserialize keychain JSON: {e}");
                    eprintln!(
                        "[store] Raw JSON (first 500 chars): {}",
                        &json[..json.len().min(500)]
                    );
                    Err(format!("deserialize tokens: {e}"))
                }
            }
        }
        Err(keyring::Error::NoEntry) => {
            eprintln!("[store] No keychain entry for 'baatcheet'/'discord_tokens' (NoEntry)");
            Ok(None)
        }
        Err(e) => {
            eprintln!("[store] Keychain access error (not NoEntry): {e:?}");
            Err(format!("load from keychain: {e}"))
        }
    }
}

fn load_from_file() -> Result<Option<StoredTokens>, String> {
    let path = fallback_path();
    if !path.exists() {
        eprintln!("[store] File fallback does not exist at {}", path.display());
        return Ok(None);
    }

    match std::fs::read_to_string(&path) {
        Ok(json) => {
            eprintln!("[store] File fallback read ({} bytes)", json.len());
            match serde_json::from_str::<StoredTokens>(&json) {
                Ok(stored) => {
                    eprintln!(
                        "[store] File fallback deserialized OK: expires_at={}, has_client_id={}, has_cached_user={}",
                        stored.expires_at,
                        stored.client_id.is_some(),
                        stored.user.is_some(),
                    );
                    Ok(Some(stored))
                }
                Err(e) => {
                    eprintln!("[store] Failed to deserialize file fallback JSON: {e}");
                    eprintln!(
                        "[store] Raw file JSON (first 500 chars): {}",
                        &json[..json.len().min(500)]
                    );
                    Err(format!("deserialize file fallback: {e}"))
                }
            }
        }
        Err(e) => {
            eprintln!("[store] Failed to read file fallback: {e}");
            Err(format!("read file fallback: {e}"))
        }
    }
}

/// Clear the token set from BOTH the OS keychain AND the file fallback.
pub fn clear() -> Result<(), String> {
    let mut last_err = None;

    // Clear keychain.
    match clear_keychain() {
        Ok(()) => eprintln!("[store] Keychain cleared"),
        Err(e) => {
            eprintln!("[store] Keychain clear error: {e}");
            last_err = Some(e);
        }
    }

    // Clear file fallback.
    match clear_file() {
        Ok(()) => eprintln!("[store] File fallback cleared ({})", fallback_path().display()),
        Err(e) => {
            eprintln!("[store] File fallback clear error: {e}");
            last_err = Some(e);
        }
    }

    match last_err {
        None => Ok(()),
        Some(e) => Err(format!("token clear failed (keychain and file both tried): {e}")),
    }
}

fn clear_keychain() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("create keychain entry: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already cleared — idempotent.
        Err(e) => Err(format!("clear keychain: {e}")),
    }
}

fn clear_file() -> Result<(), String> {
    let path = fallback_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove fallback file: {e}"))
    } else {
        Ok(())
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

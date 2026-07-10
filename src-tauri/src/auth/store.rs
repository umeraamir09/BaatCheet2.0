use crate::auth::{oauth::TokenSet, profile::User};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const KEYCHAIN_SERVICE: &str = "baatcheet";
const KEYCHAIN_ACCOUNT: &str = "discord_session_v2";
const SCHEMA_VERSION: u8 = 2;

/// Secret session material. It is stored only in Credential Manager and, on
/// Windows, a DPAPI CurrentUser-encrypted recovery copy. Never log this type.
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    #[serde(default = "schema_version")]
    pub schema_version: u8,
    #[serde(default)]
    pub generation: u64,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub user: Option<User>,
}

fn schema_version() -> u8 { SCHEMA_VERSION }

fn fallback_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("BaatCheet").join("auth")
}

fn fallback_path() -> PathBuf { fallback_dir().join("session.v2.bin") }
fn legacy_path() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("baatcheet").join("discord_tokens.json")
}

pub fn save(tokens: &TokenSet, client_id: Option<&str>, user: Option<&User>) -> Result<(), String> {
    let previous_generation = load().ok().flatten().map(|s| s.generation).unwrap_or(0);
    save_stored(&StoredTokens {
        schema_version: SCHEMA_VERSION,
        generation: previous_generation.saturating_add(1),
        access_token: tokens.access_token.clone(),
        refresh_token: tokens.refresh_token.clone(),
        expires_at: current_epoch_secs().saturating_add(tokens.expires_in),
        client_id: client_id.map(ToOwned::to_owned),
        user: user.cloned(),
    })
}

pub fn save_stored(stored: &StoredTokens) -> Result<(), String> {
    let json = serde_json::to_vec(stored).map_err(|_| "could not serialize session".to_string())?;
    let mut saved = false;
    if save_to_keychain(&json).is_ok() { saved = true; }
    if save_to_protected_file(&json).is_ok() { saved = true; }
    if !saved { return Err("Could not securely save the session. Check Credential Manager and retry.".into()); }
    // Migration is deliberately after at least one protected write succeeds.
    let _ = std::fs::remove_file(legacy_path());
    Ok(())
}

pub fn load() -> Result<Option<StoredTokens>, String> {
    let mut records = Vec::new();
    if let Some(record) = load_from_keychain()? { records.push(record); }
    if let Some(record) = load_from_protected_file()? { records.push(record); }
    // One-time migration from the old plaintext fallback. Do not retain it.
    if records.is_empty() {
        if let Ok(bytes) = std::fs::read(legacy_path()) {
            if let Ok(mut legacy) = serde_json::from_slice::<StoredTokens>(&bytes) {
                legacy.schema_version = SCHEMA_VERSION;
                legacy.generation = 1;
                save_stored(&legacy)?;
                return Ok(Some(legacy));
            }
        }
        return Ok(None);
    }
    records.sort_by_key(|record| record.generation);
    let selected = records.pop().expect("records is non-empty");
    // Heal a missing/stale protected copy; errors are non-fatal when one secure
    // source successfully restored the session.
    let _ = save_stored(&selected);
    Ok(Some(selected))
}

pub fn clear() -> Result<(), String> {
    let mut cleared = false;
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => cleared = true,
            Err(_) => {},
        },
        Err(_) => {},
    }
    match std::fs::remove_file(fallback_path()) {
        Ok(()) => cleared = true,
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => cleared = true,
        Err(_) => {},
    }
    let _ = std::fs::remove_file(legacy_path());
    if cleared { Ok(()) } else { Err("Could not clear the protected session; logout will retry on next launch.".into()) }
}

fn save_to_keychain(bytes: &[u8]) -> Result<(), String> {
    let value = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes);
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|_| "Credential Manager unavailable".to_string())?
        .set_password(&value)
        .map_err(|_| "Credential Manager write failed".to_string())
}

fn load_from_keychain() -> Result<Option<StoredTokens>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|_| "Credential Manager unavailable".to_string())?;
    let value = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err("Credential Manager read failed".into()),
    };
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, value)
        .map_err(|_| "Stored session is corrupt".to_string())?;
    decode(&bytes).map(Some)
}

fn save_to_protected_file(bytes: &[u8]) -> Result<(), String> {
    let protected = platform_protect(bytes)?;
    std::fs::create_dir_all(fallback_dir()).map_err(|_| "Could not create secure session directory".to_string())?;
    let tmp = fallback_path().with_extension("tmp");
    std::fs::write(&tmp, protected).map_err(|_| "Could not write protected session".to_string())?;
    std::fs::rename(tmp, fallback_path()).map_err(|_| "Could not finalize protected session".to_string())
}

fn load_from_protected_file() -> Result<Option<StoredTokens>, String> {
    let bytes = match std::fs::read(fallback_path()) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read protected session".into()),
    };
    decode(&platform_unprotect(&bytes)?).map(Some)
}

fn decode(bytes: &[u8]) -> Result<StoredTokens, String> {
    let stored: StoredTokens = serde_json::from_slice(bytes).map_err(|_| "Stored session is corrupt".to_string())?;
    if stored.schema_version != SCHEMA_VERSION || stored.access_token.is_empty() || stored.refresh_token.is_empty() {
        return Err("Stored session has an unsupported format".into());
    }
    Ok(stored)
}

// Credential Manager is the primary store on Windows. The recovery-file hook
// intentionally fails closed until the packaged DPAPI adapter is enabled; it
// never silently falls back to plaintext when Credential Manager is absent.
fn platform_protect(_: &[u8]) -> Result<Vec<u8>, String> { Err("Protected recovery storage is unavailable".into()) }
fn platform_unprotect(_: &[u8]) -> Result<Vec<u8>, String> { Err("Protected recovery storage is unavailable".into()) }

fn current_epoch_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

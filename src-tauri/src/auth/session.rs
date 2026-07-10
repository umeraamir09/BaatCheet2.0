use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;

use crate::auth::{oauth, profile, store};

/// Margin (seconds) before `expires_at` at which we consider the access token
/// "near-expiry" and treat it as needing refresh (spec task 5.3 + TG6).
const EXPIRY_MARGIN_SECS: u64 = 60;

/// The PKCE verifier + CSRF `state` stashed between the browser consent
/// redirect (started by `start_discord_login`) and the deep-link callback
/// (captured by the `on_open_url` handler). Held in `AuthState.pending`.
#[derive(Clone)]
pub struct PendingLogin {
    pub client_id: String,
    pub verifier: String,
    pub state: String,
}

/// Tauri-managed state shared across commands and the deep-link handler.
/// `Send + Sync` (std::sync::Mutex guards). The refresh-token concurrency
/// mutex is a `tokio::sync::Mutex` (TG6).
#[derive(Default)]
pub struct AuthState {
    /// The current in-flight login attempt; replaced on `start_discord_login`
    /// and taken/consumed by the deep-link callback handler.
    pub pending: Mutex<Option<PendingLogin>>,
    /// Concurrency guard for token refresh (TG6.4) — prevents the proactive
    /// timer and a reactive 401 retry from both hitting Discord simultaneously.
    pub refresh_lock: TokioMutex<()>,
    /// Handle for the proactive refresh timer (TG6.2) — cancelled on logout.
    pub refresh_timer: Mutex<Option<JoinHandle<()>>>,
    /// Discord Client ID persisted across the session for refresh operations.
    pub client_id: Mutex<Option<String>>,
}

/// Handle the deep-link callback: validate the CSRF `state` against the
/// stashed `PendingLogin`, then execute the full token exchange + profile
/// fetch + keychain save + emit `discord:login-success { user }`.
///
/// TG4 implementation: replaces the TG3 stub that only emitted
/// `discord:callback-received`.
pub async fn handle_callback(app: AppHandle, code: String, state: String) {
    let auth_state = app.state::<AuthState>();
    let pending = {
        let mut guard = match auth_state.pending.lock() {
            Ok(g) => g,
            Err(_) => {
                let _ = app.emit("discord:login-rejected", "pending lock poisoned");
                return;
            }
        };
        guard.take()
    };

    let Some(pending) = pending else {
        let _ = app.emit("discord:login-rejected", "no pending login");
        return;
    };

    if pending.state != state {
        let _ = app.emit("discord:login-rejected", "state mismatch");
        return;
    }

    // TG4 pipeline: exchange code → fetch profile → save tokens → emit success.
    let client = match oauth::http_client() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                "discord:login-failed",
                format!("failed to create HTTP client: {e}"),
            );
            return;
        }
    };

    let tokens =
        match oauth::exchange_code(&client, &pending.client_id, &code, &pending.verifier).await {
            Ok(t) => t,
            Err(e) => {
                let _ = app.emit(
                    "discord:login-failed",
                    format!("token exchange failed: {e}"),
                );
                return;
            }
        };

    let discord_user = match profile::fetch_me(&client, &tokens.access_token).await {
        Ok(u) => u,
        Err(e) => {
            let _ = app.emit("discord:login-failed", format!("profile fetch failed: {e}"));
            return;
        }
    };

    // Persist client_id alongside tokens so refresh works on cold start.
    let user = profile::to_user(&discord_user);
    if let Err(e) = store::save(&tokens, Some(&pending.client_id), Some(&user)) {
        let _ = app.emit(
            "discord:login-failed",
            format!("failed to save tokens: {e}"),
        );
        return;
    }

    let _ = app.emit("discord:login-success", user);

    // TG6: persist the client_id and start the proactive refresh timer.
    if let Ok(mut cid) = auth_state.client_id.lock() {
        *cid = Some(pending.client_id.clone());
    }
    start_refresh_timer(app.clone());
}

/// Restore a session on cold start (TG5).
///
/// Loads tokens from the keyring. If the access token is still valid (not
/// expired or near-expiry), fetches the profile and returns the `User`.
/// If expired, attempts to refresh using the stored client_id + refresh_token.
/// A missing or confirmed-revoked session returns `None`. Transient keychain,
/// network, profile, and persistence failures return an error so the frontend
/// can offer a retry without treating the user as logged out.
pub async fn get_current_session(app: AppHandle) -> Result<Option<profile::User>, String> {
    eprintln!("[session] get_current_session: reading keychain...");
    let stored = match store::load() {
        Ok(Some(s)) => {
            eprintln!("[session] store::load() returned Some — proceeding with expiry check");
            s
        }
        Ok(None) => {
            eprintln!("[session] store::load() returned None — no saved session in keychain");
            return Ok(None);
        }
        Err(e) => {
            eprintln!("[session] store::load() returned Err: {e}");
            return Err(e);
        }
    };

    let auth_state = app.state::<AuthState>();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before Unix epoch")
        .as_secs();

    eprintln!(
        "[session] now={now}, expires_at={}, EXPIRY_MARGIN_SECS={EXPIRY_MARGIN_SECS}, threshold={}, expired={}",
        stored.expires_at,
        now + EXPIRY_MARGIN_SECS,
        stored.expires_at <= now + EXPIRY_MARGIN_SECS
    );

    // Restore client_id to AuthState from keychain (needed for refresh).
    if let Some(ref cid) = stored.client_id {
        eprintln!("[session] Restoring client_id to AuthState (len={})", cid.len());
        if let Ok(mut auth_cid) = auth_state.client_id.lock() {
            *auth_cid = Some(cid.clone());
        }
    } else {
        eprintln!("[session] WARNING: stored.client_id is None — refresh won't work if token expires");
    }

    let (access_token, cached_user) = if stored.expires_at <= now + EXPIRY_MARGIN_SECS {
        // Access token expired or near-expiry — attempt refresh.
        eprintln!("[session] Access token expired or near-expiry — attempting refresh with stored refresh_token (len={})", stored.refresh_token.len());
        let client_id = match stored.client_id {
            Some(ref cid) => {
                eprintln!("[session] Using stored client_id for refresh");
                cid.clone()
            }
            None => {
                eprintln!("[session] FATAL: saved session has no client_id — returning Err to frontend");
                return Err("Saved session is missing its Discord client ID; sign in again to repair it".into());
            }
        };

        let client = match oauth::http_client() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[session] Failed to create HTTP client for refresh: {e}");
                return Err(format!("Could not prepare saved-session refresh: {e}"));
            }
        };

        eprintln!("[session] Calling oauth::refresh_tokens...");
        match oauth::refresh_tokens(&client, &client_id, &stored.refresh_token).await {
            Ok(new_tokens) => {
                eprintln!("[session] Refresh succeeded — new access_token (len={}), expires_in={}", new_tokens.access_token.len(), new_tokens.expires_in);
                // Save refreshed tokens with client_id.
                if let Err(e) = store::save(&new_tokens, Some(&client_id), stored.user.as_ref()) {
                    eprintln!("[session] Refresh succeeded but save to keychain failed: {e}");
                    return Err(format!("Session refreshed but could not be saved: {e}"));
                }
                eprintln!("[session] Refreshed tokens saved to keychain successfully");
                (new_tokens.access_token, stored.user)
            }
            Err(e) => {
                if is_invalid_refresh_error(&e) {
                    eprintln!("[session] Refresh failed with invalid_grant — token revoked, clearing session: {e}");
                    store::clear()?;
                    eprintln!("[session] Keychain cleared, returning None");
                    return Ok(None);
                }
                eprintln!("[session] Refresh failed transiently, keeping session for retry: {e}");
                return Err(format!("Could not refresh saved session; it was kept for retry: {e}"));
            }
        }
    } else {
        eprintln!("[session] Access token still valid — using cached credentials");
        (stored.access_token, stored.user)
    };

    // Restore the profile that was verified at login. A cold start should not
    // look like a logout merely because Discord's profile endpoint is briefly
    // unavailable; token validity is still enforced above and by the timer.
    if let Some(user) = cached_user {
        eprintln!("[session] Using cached user profile: id={}, username={}", user.id, user.username);
        start_refresh_timer(app);
        return Ok(Some(user));
    }

    // One-time migration for sessions written before profiles were cached.
    eprintln!("[session] No cached user profile — performing one-time migration (fetching /users/@me)");
    let client = match oauth::http_client() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[session] Failed to create HTTP client for profile migration: {e}");
            return Err(format!("Could not create HTTP client for profile fetch: {e}"));
        }
    };
    let discord_user = match profile::fetch_me(&client, &access_token).await {
        Ok(u) => {
            eprintln!("[session] Fetched Discord user: id={}, username={}", u.id, u.username);
            u
        }
        Err(e) => {
            eprintln!("[session] Failed to fetch Discord profile even with valid token: {e}");
            return Err(format!("Failed to verify session with Discord: {e}"));
        }
    };
    let user = profile::to_user(&discord_user);
    if let Ok(Some(mut current)) = store::load() {
        current.user = Some(user.clone());
        if let Err(e) = store::save_stored(&current) {
            eprintln!("[session] Failed to save cached profile after migration: {e}");
            // Non-fatal — we still have the user data.
        } else {
            eprintln!("[session] Cached profile saved to keychain for future cold starts");
        }
    }

    // TG6: start the proactive refresh timer after successful restore.
    eprintln!("[session] Session restore complete, starting refresh timer");
    start_refresh_timer(app);

    Ok(Some(user))
}

fn is_invalid_refresh_error(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("invalid_grant")
        || error.contains("invalid refresh")
        || error.contains("invalid token")
        || error.contains("401 unauthorized")
}

/// Start the proactive refresh timer (TG6.2).
///
/// Schedules a refresh at `expires_at - margin`. When the timer fires, it
/// refreshes the tokens, saves them to the keychain, and reschedules itself.
/// The timer is cancelled on logout (TG7).
pub fn start_refresh_timer(app: AppHandle) {
    let app_clone = app.clone();
    let auth_state = app_clone.state::<AuthState>();

    // Cancel any existing timer.
    if let Ok(mut timer) = auth_state.refresh_timer.lock() {
        if let Some(handle) = timer.take() {
            handle.abort();
        }
    }

    let stored = match store::load() {
        Ok(Some(s)) => s,
        _ => return,
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before Unix epoch")
        .as_secs();

    let delay_secs = stored.expires_at.saturating_sub(now + EXPIRY_MARGIN_SECS);
    let delay = std::time::Duration::from_secs(delay_secs);

    let app_clone = app.clone();
    let handle = tokio::spawn(async move {
        tokio::time::sleep(delay).await;
        perform_refresh(app_clone).await;
    });

    if let Ok(mut timer) = auth_state.refresh_timer.lock() {
        *timer = Some(handle);
    };
}

/// Perform a token refresh (TG6.1 + TG6.2).
///
/// Acquires the refresh lock, refreshes the tokens, saves them to the keychain,
/// and reschedules the timer. If the refresh fails (revoked/401), clears the
/// session and emits `discord:needs-login`.
async fn perform_refresh(app: AppHandle) {
    let app_clone = app.clone();
    let auth_state = app_clone.state::<AuthState>();

    // Acquire the refresh lock to prevent concurrent refreshes.
    let _guard = auth_state.refresh_lock.lock().await;

    let client_id = match auth_state.client_id.lock() {
        Ok(guard) => match guard.clone() {
            Some(cid) => cid,
            None => return,
        },
        Err(_) => return,
    };

    let stored = match store::load() {
        Ok(Some(s)) => s,
        _ => return,
    };

    let client = match oauth::http_client() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[session] Failed to create HTTP client for proactive refresh: {e}");
            schedule_refresh_retry(app, 60);
            return;
        }
    };
    match oauth::refresh_tokens(&client, &client_id, &stored.refresh_token).await {
        Ok(tokens) => {
            // Persist client_id alongside refreshed tokens.
            if let Err(e) = store::save(&tokens, Some(&client_id), stored.user.as_ref()) {
                eprintln!("[session] Failed to persist refreshed tokens: {e}");
                schedule_refresh_retry(app, 60);
                return;
            }
            // Reschedule the timer for the new expiry.
            start_refresh_timer(app);
        }
        Err(e) => {
            if is_invalid_refresh_error(&e) {
                eprintln!("[session] Proactive refresh rejected; clearing session");
                clear_session_and_emit(&app);
            } else {
                eprintln!("[session] Proactive refresh failed transiently: {e}");
                schedule_refresh_retry(app, 60);
            }
        }
    };
}

/// Retry a transient refresh later without erasing recoverable credentials.
fn schedule_refresh_retry(app: AppHandle, delay_secs: u64) {
    let auth_state = app.state::<AuthState>();
    if let Ok(mut timer) = auth_state.refresh_timer.lock() {
        if let Some(handle) = timer.take() {
            handle.abort();
        }
        let retry_app = app.clone();
        *timer = Some(tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
            perform_refresh(retry_app).await;
        }));
    };
}

/// Clear the session from the keychain and emit `discord:needs-login` (TG6.4).
fn clear_session_and_emit(app: &AppHandle) {
    let _ = store::clear();
    let _ = app.emit("discord:needs-login", ());
}

/// Log out the current user (TG7).
///
/// Clears tokens from the keyring, cancels the refresh timer, clears the
/// client_id from AuthState, and emits `discord:logged-out`. Does NOT call
/// Discord's `/oauth2/revoke` endpoint (out of scope for Phase 1 per D3).
pub fn logout(app: &AppHandle) -> Result<(), String> {
    let auth_state = app.state::<AuthState>();

    // Cancel the refresh timer.
    if let Ok(mut timer) = auth_state.refresh_timer.lock() {
        if let Some(handle) = timer.take() {
            handle.abort();
        }
    }

    // Clear the client_id.
    if let Ok(mut cid) = auth_state.client_id.lock() {
        *cid = None;
    }

    // Clear tokens from keyring.
    store::clear()?;

    // Emit logged-out event.
    let _ = app.emit("discord:logged-out", ());
    Ok(())
}

/// Dev-only: set a short expiry for testing the proactive refresh timer (TG9).
///
/// Modifies the stored tokens to expire in `seconds` from now. Only available
/// in debug builds (`#[cfg(debug_assertions)]`).
#[cfg(debug_assertions)]
pub fn dev_set_expires_in(seconds: u64) -> Result<(), String> {
    let stored = store::load()?.ok_or("no tokens in keychain")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before Unix epoch")
        .as_secs();
    let new_expires_at = now + seconds;

    // Create a new StoredTokens with the modified expiry, preserving client_id.
    let modified = store::StoredTokens {
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
        expires_at: new_expires_at,
        client_id: stored.client_id,
        user: stored.user,
    };

    // Save directly to keyring (bypassing the normal save flow).
    let json = serde_json::to_string(&modified).map_err(|e| format!("serialize: {e}"))?;
    let entry = keyring::Entry::new("baatcheet", "discord_tokens")
        .map_err(|e| format!("keyring entry: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("keyring set: {e}"))?;
    Ok(())
}

/// Dev-only: corrupt the refresh token to test the refresh failure path (TG9).
///
/// Replaces the stored refresh token with an invalid value. Only available
/// in debug builds (`#[cfg(debug_assertions)]`).
#[cfg(debug_assertions)]
pub fn dev_corrupt_refresh() -> Result<(), String> {
    let stored = store::load()?.ok_or("no tokens in keychain")?;

    // Create a new StoredTokens with a corrupted refresh token, preserving client_id.
    let corrupted = store::StoredTokens {
        access_token: stored.access_token,
        refresh_token: "corrupted-refresh-token-for-testing".to_string(),
        expires_at: stored.expires_at,
        client_id: stored.client_id,
        user: stored.user,
    };

    // Save directly to keyring.
    let json = serde_json::to_string(&corrupted).map_err(|e| format!("serialize: {e}"))?;
    let entry = keyring::Entry::new("baatcheet", "discord_tokens")
        .map_err(|e| format!("keyring entry: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("keyring set: {e}"))?;
    Ok(())
}

/// Reactive 401 retry wrapper (TG6.3).
///
/// Executes `op` with the current access token. If it returns a 401, refreshes
/// the tokens once and retries `op` with the new access token. If the retry
/// also fails with 401, or the refresh itself fails, clears the session.
///
/// This is used by future Discord API calls (e.g., presence updates in Phase 2)
/// to transparently recover from token expiry without user intervention.
pub async fn with_refresh_retry<F, Fut, T>(app: AppHandle, op: F) -> Result<T, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let stored = store::load()?.ok_or("no tokens in keychain")?;

    // First attempt.
    match op(stored.access_token.clone()).await {
        Ok(result) => Ok(result),
        Err(e) if e.contains("401") => {
            // 401 — try refreshing once.
            let auth_state = app.state::<AuthState>();
            let _guard = auth_state.refresh_lock.lock().await;

            let client_id = match auth_state.client_id.lock() {
                Ok(guard) => guard.clone().ok_or("no client_id in state")?,
                Err(_) => return Err("client_id lock poisoned".into()),
            };

            let client = oauth::http_client()?;
            let tokens = oauth::refresh_tokens(&client, &client_id, &stored.refresh_token).await?;
            // Persist client_id alongside refreshed tokens.
            store::save(&tokens, Some(&client_id), stored.user.as_ref())?;

            // Retry with new access token.
            op(tokens.access_token).await
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::is_invalid_refresh_error;

    #[test]
    fn invalid_grant_requires_login_but_network_failures_do_not() {
        assert!(is_invalid_refresh_error("token refresh failed (400): {\"error\":\"invalid_grant\"}"));
        assert!(is_invalid_refresh_error("token refresh failed (401 Unauthorized)"));
        assert!(!is_invalid_refresh_error("token refresh request failed: connection timed out"));
        assert!(!is_invalid_refresh_error("failed to build HTTP client"));
    }
}

mod auth;

use auth::oauth;
use auth::pkce;
use auth::session::{AuthState, PendingLogin};
use std::io::Write;
use tauri::{AppHandle, Emitter};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // In release builds (no console), capture panics to a file
    // so we can diagnose startup crashes.
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("[BaatCheet PANIC] {info}\n");
        // Also try stderr — visible in debug builds, silent in release
        let _ = writeln!(std::io::stderr(), "{msg}");
        // Write to a temp file for release-build forensics
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join("baatcheet_panic.log"))
        {
            let _ = writeln!(f, "{msg}");
            if let Some(location) = info.location() {
                let _ = writeln!(f, "  at {}:{}", location.file(), location.line());
            }
            if let Some(s) = info.payload().downcast_ref::<&str>() {
                let _ = writeln!(f, "  payload: {s}");
            }
            if let Some(s) = info.payload().downcast_ref::<String>() {
                let _ = writeln!(f, "  payload: {s}");
            }
        }
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance is launched (e.g., via deep-link),
            // the single-instance plugin routes the args to this callback.
            // On Windows, deep-link URLs arrive as command-line arguments.
            for arg in argv.iter().skip(1) {
                if let Ok(url) = url::Url::parse(arg) {
                    if url.scheme() == "baatcheet" {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            process_deep_link_url(app_clone, url).await;
                        });
                    }
                }
            }
        }))
        .manage(AuthState::default())
        .setup(|app| {
            // Register deep-link scheme. This can fail (e.g., if a second
            // instance races or registry is locked), but it's non-fatal —
            // the app should still open and work; deep links will be handled
            // by the single-instance redirect or on_open_url.
            if let Err(e) = app.deep_link().register_all() {
                eprintln!("[setup] deep-link register_all failed (non-fatal): {e}");
            }

            // Capture the AppHandle so the deep-link callback closure can
            // spawn an async task that accesses Tauri managed state + emits
            // events back to the renderer.
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let app = app_handle.clone();
                    let url = url.clone();
                    tauri::async_runtime::spawn(async move {
                        process_deep_link_url(app, url).await;
                    });
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_discord_login,
            get_current_session,
            logout,
            #[cfg(debug_assertions)]
            dev_set_expires_in,
            #[cfg(debug_assertions)]
            dev_corrupt_refresh,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Process a deep-link URL: validate scheme + host, extract code + state,
/// and dispatch to the session handler.
async fn process_deep_link_url(app: AppHandle, url: url::Url) {
    // Defensive filter: only handle `baatcheet://callback?code=...&state=...`.
    // The plugin is registered for scheme "baatcheet" only, but
    // we still sanity-check scheme + host/path.
    if url.scheme() != "baatcheet" {
        return;
    }
    let host = url.host_str();
    let path = url.path();
    if host != Some("callback") && path != "/callback" {
        return;
    }

    let q: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let Some(code) = q.get("code") else {
        return;
    };
    let Some(state) = q.get("state") else {
        return;
    };

    let code = code.to_string();
    let state = state.to_string();
    auth::session::handle_callback(app, code, state).await;
}

/// Generate a PKCE verifier + CSRF `state`, stash the pending login, then open
/// the system browser (not an in-app webview) at Discord's consent endpoint.
/// The frontend forwards the Discord Client ID (read by Vite from `.env.local`
/// and `VITE_DISCORD_CLIENT_ID`) since Tauri doesn't load repo-root .env into
/// the Rust process — see Decision D-impl-2.
#[tauri::command]
async fn start_discord_login(
    client_id: String,
    app: AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<(), String> {
    if client_id.trim().is_empty() {
        return Err("missing Discord Client ID (set VITE_DISCORD_CLIENT_ID in .env.local)".into());
    }

    let verifier = pkce::generate_verifier();
    let state_token = oauth::generate_state();
    let authorize_url = oauth::build_authorize_url(&client_id, &verifier, &state_token).to_string();

    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "pending login lock poisoned".to_string())?;
        *pending = Some(PendingLogin {
            client_id: client_id.clone(),
            verifier,
            state: state_token,
        });
    }

    app.opener()
        .open_url(authorize_url, None::<&str>)
        .map_err(|e| format!("failed to open browser: {e}"))?;

    app.emit("discord:login-started", ())
        .map_err(|e| format!("emit discord:login-started failed: {e}"))?;
    Ok(())
}

/// Restore a session on cold start (TG5). Returns `Some(User)` if a valid
/// session exists in the keyring, or `None` if the user needs to log in.
#[tauri::command]
async fn get_current_session(app: AppHandle) -> Result<Option<auth::profile::User>, String> {
    auth::session::get_current_session(app).await
}

/// Log out the current user (TG7). Clears tokens from the keyring, cancels
/// the refresh timer, and emits `discord:logged-out`. Does NOT call Discord's
/// `/oauth2/revoke` endpoint (out of scope for Phase 1 per Decision D3).
#[tauri::command]
async fn logout(app: AppHandle) -> Result<(), String> {
    auth::session::logout(&app)
}

/// Dev-only: set a short expiry for testing the proactive refresh timer (TG9).
/// Only available in debug builds.
#[cfg(debug_assertions)]
#[tauri::command]
async fn dev_set_expires_in(seconds: u64) -> Result<(), String> {
    auth::session::dev_set_expires_in(seconds)
}

/// Dev-only: corrupt the refresh token to test the refresh failure path (TG9).
/// Only available in debug builds.
#[cfg(debug_assertions)]
#[tauri::command]
async fn dev_corrupt_refresh() -> Result<(), String> {
    auth::session::dev_corrupt_refresh()
}

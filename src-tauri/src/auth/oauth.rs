use crate::auth::pkce;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;

/// Discord OAuth2 authorize endpoint.
const DISCORD_AUTHORIZE: &str = "https://discord.com/oauth2/authorize";

/// Discord OAuth2 token endpoint.
const DISCORD_TOKEN: &str = "https://discord.com/api/oauth2/token";

/// Deep-link redirect registered on the Discord portal (Phase 0 prereq).
pub const REDIRECT_URI: &str = "baatcheet://callback";

/// Discord OAuth scopes requested for Phase 1 — `identify` only (Decision D4).
pub const SCOPE: &str = "identify";

/// Create an HTTP client with headers that avoid bot-detection blocks.
/// Discord's endpoints are behind Cloudflare, which may block requests
/// without proper User-Agent and Accept headers.
pub fn http_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("BaatCheet/0.1.0 (Discord OAuth2 PKCE)")
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/json"),
            );
            headers
        })
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

/// Random CSRF `state` token, base64url no-pad (~43 chars; spec task 2.3).
pub fn generate_state() -> String {
    pkce::random_url_safe_token(32)
}

/// Build the Discord `/oauth2/authorize` URL with PKCE S256 challenge + state.
/// Scope is hardcoded to `identify` (D4) — not parameterizable by callers.
pub fn build_authorize_url(client_id: &str, verifier: &str, state: &str) -> Url {
    let code_challenge = pkce::challenge(verifier);
    let mut url = Url::parse(DISCORD_AUTHORIZE).expect("static Discord authorize URL parses");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", client_id);
        q.append_pair("redirect_uri", REDIRECT_URI);
        q.append_pair("scope", SCOPE);
        q.append_pair("code_challenge", &code_challenge);
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("state", state);
    }
    url
}

/// Response from Discord's `/oauth2/token` endpoint after a successful code
/// exchange or refresh. `expires_in` is relative (seconds); callers compute
/// `expires_at = now + expires_in` for absolute storage (spec task 4.4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub scope: String,
    pub token_type: String,
}

/// Exchange an authorization code + PKCE verifier for a `TokenSet`.
///
/// POSTs to Discord's `/oauth2/token` with form-encoded data:
/// `client_id`, `code`, `grant_type=authorization_code`, `code_verifier`,
/// `redirect_uri`, `scope=identify`. No client secret (PKCE public client).
pub async fn exchange_code(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenSet, String> {
    let form = [
        ("client_id", client_id),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
        ("redirect_uri", REDIRECT_URI),
        ("scope", SCOPE),
    ];

    let resp = client
        .post(DISCORD_TOKEN)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("token exchange request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("token exchange failed ({status}): {body}"));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))?;

    serde_json::from_str::<TokenSet>(&body)
        .map_err(|e| format!("failed to parse token response: {e}\nRaw body: {body}"))
}

/// Refresh an expired access token using a refresh token (TG6).
///
/// POSTs to Discord's `/oauth2/token` with form-encoded data:
/// `client_id`, `refresh_token`, `grant_type=refresh_token`, `scope=identify`.
///
/// Discord rotates the refresh token on each refresh — the returned `TokenSet`
/// contains a new `refresh_token` that must replace the old one in storage.
pub async fn refresh_tokens(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenSet, String> {
    let form = [
        ("client_id", client_id),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
        ("scope", SCOPE),
    ];

    let resp = client
        .post(DISCORD_TOKEN)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("refresh request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("refresh failed ({status}): {body}"));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))?;

    serde_json::from_str::<TokenSet>(&body)
        .map_err(|e| format!("failed to parse refresh response: {e}\nRaw body: {body}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_has_identify_scope_only() {
        let url = build_authorize_url("CLIENT_ID", "verifier", "state-token");
        let scope = url.query_pairs().find(|(k, _)| k == "scope").unwrap().1;
        assert_eq!(scope, "identify");
        assert!(!scope.contains("email"));
        assert!(!scope.contains("guilds"));
        assert!(!scope.contains("connections"));
    }

    #[test]
    fn authorize_url_uses_s256_pkce() {
        let url = build_authorize_url("CLIENT_ID", "verifier", "state-token");
        let q: Vec<_> = url.query_pairs().collect();
        assert_eq!(
            q.iter().find(|(k, _)| k == "code_challenge_method").unwrap().1,
            "S256"
        );
        assert_eq!(
            q.iter().find(|(k, _)| k == "response_type").unwrap().1,
            "code"
        );
        assert_eq!(
            q.iter().find(|(k, _)| k == "redirect_uri").unwrap().1,
            REDIRECT_URI
        );
    }

    #[test]
    fn authorize_url_embeds_state_and_challenges_verifier() {
        let url = build_authorize_url("CLIENT_ID", "verifier", "state-token");
        let q: Vec<_> = url.query_pairs().collect();
        assert_eq!(q.iter().find(|(k, _)| k == "state").unwrap().1, "state-token");
        assert_eq!(
            q.iter().find(|(k, _)| k == "code_challenge").unwrap().1,
            pkce::challenge("verifier")
        );
    }
}
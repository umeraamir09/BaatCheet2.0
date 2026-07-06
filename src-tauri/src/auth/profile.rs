use reqwest::Client;
use serde::{Deserialize, Serialize};

/// Discord API v10 base URL.
const DISCORD_API: &str = "https://discord.com/api/v10";

/// Discord CDN base URL for avatar images.
const DISCORD_CDN: &str = "https://cdn.discordapp.com";

/// Discord user profile returned by `GET /users/@me` (spec task 4.2).
/// Fields: id, username, global_name (display name), avatar hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub global_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
}

/// Frontend-facing user payload emitted via `discord:login-success` after
/// the profile fetch + avatar URL derivation (spec task 4.7).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: String,
}

/// Fetch the authenticated user's profile from Discord's `/users/@me` endpoint.
/// Returns a `DiscordUser` with id, username, global_name, avatar hash.
pub async fn fetch_me(client: &Client, access_token: &str) -> Result<DiscordUser, String> {
    let resp = client
        .get(format!("{DISCORD_API}/users/@me"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("/users/@me request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("/users/@me failed ({status}): {body}"));
    }

    resp.json::<DiscordUser>()
        .await
        .map_err(|e| format!("failed to parse /users/@me response: {e}"))
}

/// Derive the avatar URL from a Discord user's id + avatar hash.
///
/// If `avatar` is `Some(hash)`, returns `https://cdn.discordapp.com/avatars/{id}/{hash}.png?size=128`.
/// If `avatar` is `None`, returns a default avatar URL based on the user's id
/// (Discord's documented fallback for users without a custom avatar).
pub fn derive_avatar_url(user: &DiscordUser) -> String {
    match &user.avatar {
        Some(hash) => format!("{DISCORD_CDN}/avatars/{}/{}.png?size=128", user.id, hash),
        None => {
            // Default avatar: Discord uses modulo 5 of the user's snowflake id
            // (or discriminator for legacy users). For v10 users without a
            // discriminator, we use the id modulo 5.
            let default_index = user
                .id
                .parse::<u64>()
                .map(|id| id % 5)
                .unwrap_or(0);
            format!("{DISCORD_CDN}/embed/avatars/{default_index}.png")
        }
    }
}

/// Convert a `DiscordUser` (raw API response) into the frontend-facing `User`
/// payload with derived avatar URL (spec task 4.3 + 4.7).
pub fn to_user(discord_user: &DiscordUser) -> User {
    User {
        id: discord_user.id.clone(),
        username: discord_user.username.clone(),
        display_name: discord_user.global_name.clone(),
        avatar_url: derive_avatar_url(discord_user),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_avatar_url_with_custom_avatar() {
        let user = DiscordUser {
            id: "123456789".into(),
            username: "testuser".into(),
            global_name: Some("Test User".into()),
            avatar: Some("abc123hash".into()),
        };
        assert_eq!(
            derive_avatar_url(&user),
            "https://cdn.discordapp.com/avatars/123456789/abc123hash.png?size=128"
        );
    }

    #[test]
    fn derive_avatar_url_with_default_avatar() {
        let user = DiscordUser {
            id: "123456789".into(),
            username: "testuser".into(),
            global_name: Some("Test User".into()),
            avatar: None,
        };
        // 123456789 % 5 = 4
        assert_eq!(
            derive_avatar_url(&user),
            "https://cdn.discordapp.com/embed/avatars/4.png"
        );
    }

    #[test]
    fn to_user_maps_fields_correctly() {
        let discord_user = DiscordUser {
            id: "123".into(),
            username: "testuser".into(),
            global_name: Some("Test User".into()),
            avatar: Some("hash".into()),
        };
        let user = to_user(&discord_user);
        assert_eq!(user.id, "123");
        assert_eq!(user.username, "testuser");
        assert_eq!(user.display_name, Some("Test User".into()));
        assert!(user.avatar_url.contains("avatars/123/hash.png"));
    }
}
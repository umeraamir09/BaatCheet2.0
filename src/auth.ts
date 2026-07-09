import { invoke } from "@tauri-apps/api/core";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

/**
 * Kick off the Discord OAuth2 + PKCE flow. The Rust `start_discord_login`
 * command generates a PKCE verifier + CSRF state, opens the system browser
 * at Discord's consent screen, and stashes the pending login for the
 * deep-link callback handler (`baatcheet://callback`) to validate.
 *
 * Decision D-impl-2: the Client ID is read by Vite from `.env.local`
 * (`VITE_DISCORD_CLIENT_ID`) and forwarded to Rust as a command arg —
 * one source of truth, no Rust-side env loader, no client secret anywhere
 * (PKCE public client).
 */
export function startDiscordLogin(): Promise<void> {
  if (!CLIENT_ID) {
    throw new Error(
      "VITE_DISCORD_CLIENT_ID is not set. Copy .env.example to .env.local and set VITE_DISCORD_CLIENT_ID.",
    );
  }
  return invoke<void>("start_discord_login", { clientId: CLIENT_ID });
}

/**
 * Restore a session on cold start (TG5). Returns the current user if a valid
 * session exists in the keyring, or `null` if the user needs to log in.
 */
export function getCurrentSession(): Promise<User | null> {
  return invoke<User | null>("get_current_session");
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string;
}

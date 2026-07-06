# Phase 1 — Auth (Discord OAuth2 + PKCE): Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates.

## 1. Prereqs check + finish deep-link wiring if needed
- 1.1 Confirm Phase 0's deep-link registration: invoke `baatcheet://callback` from the OS → opens the BaatCheet window. If broken, re-wire `tauri-plugin-deep-link` in `tauri.conf.json` + `src-tauri/Cargo.toml`/`lib.rs` per plugin docs.
- 1.2 Confirm Discord OAuth app on the portal has `baatcheet://callback` listed as a redirect URI (user-performed prerequisite; visual confirm with the user if needed).
- 1.3 Confirm the Discord **Client ID** is in env (`src-tauri/.env` or a config the rust side can read at runtime). Confirm the **Client Secret is absent** (PKCE public client — no secret anywhere in the repo; assert via grep on a clean tree).
- 1.4 Install crypto + http deps for the Rust side: `rand` (verifier/code generation), `sha2` (S256), `base64` (challenge encoding), `reqwest` (browserless token exchange + `/users/@me`), `url`. Pin versions in `src-tauri/Cargo.toml`.
- 1.5 Install `tauri-plugin-stronghold` (or OS-keychain plugin) for secure token storage; wire in `lib.rs`.
- **Done:** `baatcheet://callback` opens the app; Client ID readable by Rust; no secret in tree; crypto/http/secure-store crates available.

## 2. PKCE generation + auth-request URL
- 2.1 In Rust, generate a random **code verifier** (43–128 chars, unreserved-URL-safe) on each login attempt; keep it in memory keyed to the attempt (so the deep-link callback can match it).
- 2.2 Compute the **S256 challenge** = base64url(sha256(verifier)), no padding.
- 2.3 Build the Discord `/oauth2/authorize` URL: `client_id`, `redirect_uri=baatcheet://callback`, `response_type=code`, `scope=identify` (Decision D4 — `identify` only), `code_challenge`, `code_challenge_method=S256`, `state` (random, validated on return).
- 2.4 Expose a Tauri command `start_discord_login` that generates verifier+state, stashes them, and opens the system browser (Tauri shell `open`) to the auth URL.
- 2.5 Frontend: a "Continue with Discord" button on the bare screen that invokes `start_discord_login`.
- **Done:** button → system browser opens Discord consent with a valid PKCE challenge and `state`.

## 3. Deep-link callback → extract + validate code
- 3.1 Register a deep-link handler (Tauri `onOpenUrl`/plugin event) for `baatcheet://callback` that captures `code` + `state` from the redirect URL, **including** the cold-launch-into-callback case (app not running when the browser redirects).
- 3.2 Validate `state` matches the stashed value before doing anything else; reject mismatches silently (no token exchange).
- 3.3 Emit an in-app event with the validated `code` + the matched verifier, surfaced to the waiting login attempt.
- **Done:** `baatcheet://callback?code=...&state=...` (warm or cold launch) results in a validated code held in-app for exchange.

## 4. Token exchange + profile fetch
- 4.1 In Rust, POST to Discord `/oauth2/token` with `client_id`, `code`, `grant_type=authorization_code`, `code_verifier`, `redirect_uri`, `scope=identify`. Discord returns `access_token`, `refresh_token`, `expires_in`, `scope`, `token_type=bearer`.
- 4.2 Call `GET /users/@me` with `Authorization: Bearer <access_token>` → id, username, global_name/display_name, avatar hash.
- 4.3 Derive the avatar URL (e.g. `https://cdn.discordapp.com/avatars/{id}/{avatar_hash}.png` or `.webp`; handle null avatar → default Discord avatar).
- 4.4 Compute `expires_at = now + expires_in` (store absolute, not relative).
- 4.5 Persist the **refresh token**, **access token**, and **expires_at** to the Tauri secure store (Decision D1 — never plaintext, never localStorage).
- 4.6 Write/update the Convex `users` doc: keyed by Discord id; fields `{ discordId, username, displayName, avatarUrl, updatedAt }`. Create if missing, patch if any field changed (Decision D3 — photo/title in-scope, conv→Discord sync deferred).
- 4.7 Surface the authenticated state to the frontend: current user (id, username, displayName, avatarUrl) + a "logged in" flag.
- **Done:** consent → tokens exchanged + secured → `/users/@me` fetched + avatar URL derived → tokens in secure store → Convex `users` doc upserted → frontend shows avatar.

## 5. Session restore on cold start
- 5.1 On launch, read refresh token + access token + expires_at from the secure store.
- 5.2 If no refresh token → "Continue with Discord" screen (Phase-1 bare button, no styling).
- 5.3 If a refresh token exists but the stored access token is expired/near-expiry → run the silent refresh path from task group 6 first; only then consider the session restored.
- 5.4 If a refresh token exists and the access token still has TTL → trust it provisionally, fetch `/users/@me` to re-derive avatar + upsert the Convex `users` doc (handles server-side display-name/avatar changes since last login), and surface authenticated state.
- 5.5 If `/users/@me` returns 401 → trigger refresh-and-retry (task group 6); if refresh succeeds, retry `/users/@me`; if refresh fails → clear session, show login screen.
- **Done:** kill+reopen lands in an authenticated window with avatar visible, no browser step, no re-consent (the Phase-1 DoD second half).

## 6. Silent background refresh (Decision D2)
- 6.1 Implement a `refresh_tokens(refresh_token)` helper: POST `/oauth2/token` with `grant_type=refresh_token`. Returns a new access/refresh pair + new `expires_in`; **rotate** — replace the stored refresh token with the new one (Discord issues a new refresh token per refresh).
- 6.2 **Proactive timer** (the core of D2): once tokens are loaded, schedule a refresh at `expires_at - margin` (margin ~60s). On fire → `refresh_tokens` → store rotated tokens → reschedule. Timer must be cancelled on log-out.
- 6.3 **Reactive 401 retry** (the other half of D2): a single retry wrapper around Discord API calls — on 401, call `refresh_tokens` once, retry the original request once; if the retry 401s or the refresh itself fails, clear the session.
- 6.4 If `refresh_tokens` returns 401 / invalid_grant → clear the secure store + show the "Continue with Discord" screen (Decision D2 — refreshing a revoked token falls back to login, no half-states).
- 6.5 UX: show a brief non-blocking "reconnecting…" indicator only on a **failed** refresh; successful silent refresh is invisible. A failing refresh that falls back to login shows the login screen plainly.
- **Done:** token approaching expiry refreshes silently before any 401; a 401 recovers with one refresh+retry; revoked tokens drop to the login screen cleanly; no polling/background noise when idle.

## 7. Log out (Decision D3)
- 7.1 Frontend "Log out" button (visible when authenticated) → invokes a Tauri command that clears access token, refresh token, and expires_at from the secure store.
- 7.2 Cancel any pending refresh timer from task group 6.
- 7.3 Reset the in-app authenticated state to the "Continue with Discord" screen.
- 7.4 **Do not** call Discord's `/oauth2/revoke` in v1 (out-of-scope per requirements.md "Token revocation UI"); tokens are simply dropped locally.
- **Done:** Log out → secure store cleared, timer cancelled, login screen restored, no background work, no Discord network activity.

## 8. Build + merge readiness
- 8.1 Run `bun run lint` + `bun run typecheck` — clean.
- 8.2 `bun tauri build` → release binary produced.
- 8.3 Walk the four manual smokes in `validation.md`: cold-start login → avatar; kill+reopen → restored session; token-near-expiry → silent refresh; log-out → clean return to login.
- 8.4 Update repo `README.md` Phase 1 notes (Discord scopes `identify`, PKCE S256, secure-store usage, the `users` Convex table). Record a Phase 1 complete marker in `specs/roadmap.md` style with Phase 0's precedent.
- **Done:** all validation in `validation.md` passes; phase ready to merge.

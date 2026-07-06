# Phase 1 — Auth (Discord OAuth2 + PKCE): Requirements

Feature dir: `specs/2026-07-06-auth-discord-oauth2-pkce/`
Roadmap phase: **Phase 1 — Auth (Discord OAuth2 + PKCE)** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` · Stack ref: `specs/tech-stack.md`

## Goal
The trickiest infra piece validated before any feature: a Discord OAuth2 Authorization-Code + PKCE flow, run in the bare shell (Phase 0 app), that lands the user authenticated inside the Tauri window with avatar visible, and survives a kill+reopen without re-consent. Per `specs/roadmap.md`, this is Phase 0's call to "do this first."

## In scope
- **PKCE flow end-to-end** in the bare shell (no UI polish; that's Phase 7):
  - App generates a code verifier + challenge (S256), opens the system browser to Discord's `/oauth2/authorize` with `redirect_uri=baatcheet://callback`, `response_type=code`, `scope=identify`.
  - After Discord consent, the browser redirects to `baatcheet://callback?code=...`; the Tauri deep-link plugin (already registered in Phase 0, task 6.3) captures it.
  - App exchanges the auth code + verifier for an access/refresh token pair at Discord's `/oauth2/token`.
- **Profile fetch**: on first login, call `GET /users/@me` and pull id, username, global display name, avatar hash → derive avatar URL.
- **Session persistence + restore**:
  - Refresh token persisted locally in the Tauri secure store (OS keychain); access token + expiry also stored so reopen resumes cleanly.
  - User profile persisted to a Convex `users` table on first login (Discord id as the natural key); updated on subsequent logins if any field changed.
  - Cold start → if a valid refresh token exists, restore the session silently (no browser step, no re-consent); only fall back to "Continue with Discord" if no token or refresh fails (revoked/401 on refresh).
- **Silent background refresh** (Decision D2): a proactive timer scheduled shortly before the access token's `expires_at`; on any Discord API 401, refresh once and retry the request.
- **Log out** affordance (Decision D3): clears the stored refresh token + access token from secure store; returns to the "Continue with Discord" screen. (No Discord token-revocation API call in v1; tokens are simply dropped locally.)

## Out of scope (deferred — explicitly NOT Phase 1)
- **Presence / status list** → Phase 2 (the Convex `users` doc written here is the foundation but no presence/status updates yet).
- **1:1 DM text or any chat** → Phase 3.
- **Voice (1:1 or group)** → Phases 4, 6.
- **Multi-account / account switching** → not on the v1 roadmap (single friend group, single Discord identity per client per `specs/mission.md`).
- **Token revocation UI / "Revoke session from Discord's side"** → not in v1; Discord's `/oauth2/revoke` endpoint is available but the mission treats Discord as the sole identity provider and doesn't require a revocation UX for v1.
- **Convex → Discord profile re-sync policy / cron-style re-fetch of `/users/@me`** → no periodic refresh; profile is updated opportunistically on login (first or restored session). Revisit if drift becomes a problem.
- **Custom status / "now playing" text** → Phase 2 (presence).
- **Full Discord-derived theme** → Phase 7 (Phase 1 shows a "Continue with Discord" button + the fetched avatar; nothing styled).

## Decisions (locked for this phase)
- **D1 — Token storage: Tauri secure store (OS keychain), never plaintext on disk.** Phase 0's D1 put reactive data on Convex Cloud for v1 dev; auth/session storage is a different concern and stays local. Use `tauri-plugin-stronghold` (or, if simpler/available, OS keychain binding); the refresh token, access token, and `expires_at` are all stored securely. Per `specs/tech-stack.md`, Discord access tokens expire ~1 week; the refresh token is long-lived. No plaintext at rest, no `localStorage`/files.
- **D2 — Refresh trigger: proactive timer + reactive 401 retry (one retry).** Schedule a silent refresh shortly before `expires_at`. If a Discord API call returns 401 nonetheless (clock skew, early expiry), refresh once and retry the request. If the refresh itself fails (revoked/401 on the refresh endpoint), clear the session and fall back to the "Continue with Discord" screen. The user sees a brief non-blocking "reconnecting…" state if refresh fails; only a hard refresh-token failure surfaces a login prompt.
- **D3 — Scope edges: include log-out + Convex `users` sync, defer the rest.** Per the user's Phase-1 scope decision: Phase 1 includes (a) a minimal "Log out" button that clears the stored tokens and returns to the consent screen, and (b) a write/update of a Convex `users` doc on every login so Phase 2 (presence) has a user record to attach presence to. Deferred: presence/status sync, multi-account, token-revocation API call, periodic `/users/@me` re-fetch.
- **D4 — Scopes requested: `identify` only.** `identify` returns id, username, global display name, avatar hash — all Phase 1 needs. No `email`, `guilds`, `connections`, etc. — none needed for v1 (`specs/mission.md` carries identity, not guild membership).
- **D5 — Convex Cloud for the `users` table (inherits Phase 0 D1).** Same dev-posture as Phase 0: the `users` table lives on Convex Cloud for v1 dev; migration to the self-hosted Coolify Convex is deferred. `tech-stack.md` already records this deviation note.
- **D6 — Validation: automated gates green + three manual smokes.** Lint, typecheck, and `cargo tauri build` must pass (inherited from Phase 0 conventions). Plus a manual smoke for (i) cold-start login with avatar, (ii) kill+reopen restores session, (iii) token-expiry-→-silent-refresh path, and (iv) log-out clears session. See `validation.md`.

## Context
- `specs/mission.md` — **Discord is the sole identity provider**; no password system, no auth vendor (Clerk etc.), identity pulled from `/users/@me` on first login. The hard constraint (idle-light while gaming) is not profiled here (Phase 7) but the OAuth/refresh logic must not introduce visible background work (no polling).
- `specs/tech-stack.md` — Auth row specifies **Discord OAuth2 — Authorization Code + PKCE**, custom-implemented, with Tauri registering `baatcheet://callback`. No client secret — PKCE public client. Refresh happens silently in background so friends aren't re-authenticating constantly.
- `specs/roadmap.md` Phase 0 — already registered the Discord OAuth application (Client ID stored in env, no secret) and claimed the `baatcheet://callback` deep-link scheme. Phase 1 builds the flow on top of those prereqs; it does **not** re-do registration.
- Phase 0 D1 — Convex on Coolify is deferred to a later phase; Phase 1 writes the `users` table to Convex Cloud.
- The Phase 1 DoD from the roadmap: *cold start → "Continue with Discord" → landed back in-app authenticated, avatar visible. Killing and reopening the app restores the session without re-consent.*

## User-performed prerequisites (not agent-executable)
- The Phase 0 Discord OAuth application must already have `baatcheet://callback` registered as a **redirect URI** on the Discord Developer portal (Phase 0 task 6.1). If the redirect was set incorrectly, the user must fix it on the portal — the agent has no portal access.
- Discord **Client ID** is already in env from Phase 0 task 6.2. The agent uses that; if missing, asks the user to confirm it.
- If Phase 0's deep-link plugin (`tauri-plugin-deep-link`) was not fully wired (task 6.3/6.4 — `baatcheet://callback` opening the app), the agent completes that wiring as a Phase 1 prerequisite group (see `plan.md` task group 1).

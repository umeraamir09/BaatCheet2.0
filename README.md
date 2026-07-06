# BaatCheet — Product & Technical Plan

A lightweight desktop app for one friend group. Discord, minus everything you don't use.

## 1. Product vision

Discord's core loop for a small group is really just three things: talk to one friend, talk to everyone, and see who's around. Everything else — servers, roles, channels, bots, nitro, threads — is overhead a five-to-fifteen-person group doesn't need and pays for in RAM and CPU while gaming. BaatCheet is that stripped loop, native-fast, with your existing Discord identity carried over.

## 2. Core features (refined)

### 2.1 Authentication — Discord OAuth2
- "Continue with Discord" — standard OAuth2 authorization code flow (+ PKCE, since this is a public desktop client with no safe place to store a client secret).
- On first login: pull username, global display name, and avatar from Discord's `/users/@me` endpoint so migration feels instant — no separate signup, no new avatar to upload.
- Store a long-lived session (refresh token) so friends aren't re-authenticating constantly; Discord access tokens expire in ~1 week and refresh silently in the background.
- No password system to build or secure — Discord is the sole identity provider.

### 2.2 Personal calls & DMs
- 1:1 text chat, persisted so history is there next time you open the app.
- 1:1 voice call, peer-to-peer (no server relay needed for 2 people — cheaper and lower latency).
- Simple call UI: incoming call toast/notification, accept/decline, mute, deafen, leave.

### 2.3 The hangout lobby (the centerpiece)
- One single shared space for the whole group — no channel switching, no server list.
- Side-by-side layout: **group voice call** on one side (anyone can join/leave freely, like a Discord voice channel that's always "open"), **group text chat** on the other (always-on, persists history).
- Joining voice is a single click; you're dropped straight into the shared call already in progress.

### 2.4 Presence / status list
- Collapsible sidebar listing every friend: online/offline (and idle, if you want a third state later).
- "Now playing" / custom status line under each name, matching what Discord already shows for a familiar feel.
- Real-time updates — no refresh, no polling delay when a friend joins or logs off.

### 2.5 Look & feel
- Discord-derived visual language: dark base theme, the same rough type scale and spacing rhythm, familiar iconography for mute/deafen/call — but pared down. Fewer nested panels than Discord, since there's no server/channel hierarchy to render.

### 2.6 Performance requirement (the actual hard constraint)
This is the feature that shapes every other decision below: the app must sit idle at low CPU/RAM while a game is running, and voice must not introduce audio stutter or spike CPU. This single requirement is why the shell choice (§3.1) matters more than almost anything else in this plan.

## 3. Recommended tech stack

| Layer | Choice | Why |AA
|---|---|---|
| Desktop shell | **Tauri** (Rust core + OS-native webview) | Ships without a bundled Chromium — apps are typically single-digit-to-low-tens of MB and idle far lighter on RAM/CPU than an Electron equivalent. This is the single biggest lever for your "don't touch my FPS" requirement. |
| Frontend framework | **React + TypeScript + Vite** (or Next.js with `output: 'export'` for static output) | You already know this stack. Tauri just wraps whatever static frontend you point it at — no server-side rendering is needed or useful for a desktop app, so a plain Vite SPA is actually a slightly better fit than full Next.js here. |
| Styling | **Tailwind CSS** | Matches what you already use on RoutReach; fast to hand-tune a Discord-like dark theme. |
| Auth | **Discord OAuth2 (Authorization Code + PKCE)**, custom-implemented | For a closed friend group, a full auth vendor (Clerk etc.) is unnecessary weight — you only need one provider and no user management UI. Tauri can register a custom URI scheme (`baatcheet://callback`) so the OAuth redirect comes straight back into the app after the system browser step. |
| Realtime data (chat, presence, session) | **Convex (self-hosted)** | You're already running this on your Oracle VM behind Coolify. Its reactive subscriptions give you live presence and chat updates with no manual websocket/polling code — a natural reuse of infra you already operate. |
| Voice — 1:1 calls | **WebRTC, direct peer-to-peer** | No server relay needed for two people; lowest latency, zero extra infra cost. |
| Voice — group lobby | **LiveKit (self-hosted SFU)** | Mesh WebRTC breaks down past a handful of participants since every peer uploads N-1 streams. An SFU centralizes that. LiveKit is open-source, self-hostable, and ships official React client SDKs — deployable as another service on the same Coolify VM. |
| STUN/TURN | **coturn (self-hosted)** or LiveKit's bundled TURN | Needed for the peer-to-peer DM calls and as fallback for LiveKit when direct UDP is blocked (e.g. strict NAT/firewalls). |
| Native notifications | **Tauri's notification API** | Incoming call / DM alerts without a heavyweight in-app toast system. |
| Updates | **Tauri's built-in updater** | Ship patches without asking friends to manually redownload. |

## 3.1 Phase 1 — Auth (Discord OAuth2 + PKCE)

Phase 1 implements the Discord OAuth2 + PKCE authentication flow. This validates the trickiest infra piece (custom URI redirect handling) before any feature work begins.

**Implementation details:**

- **PKCE flow end-to-end:** App generates a code verifier + challenge (S256), opens the system browser to Discord's `/oauth2/authorize` with `redirect_uri=baatcheet://callback`, `response_type=code`, `scope=identify`. After Discord consent, the browser redirects to `baatcheet://callback?code=...`; the Tauri deep-link plugin captures it.
- **Token exchange:** App exchanges the auth code + verifier for an access/refresh token pair at Discord's `/oauth2/token`. No client secret (PKCE public client).
- **Profile fetch:** On first login, call `GET /users/@me` and pull id, username, global display name, avatar hash → derive avatar URL.
- **Session persistence:** Refresh token, access token, and `expires_at` persisted in the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) via the `keyring` crate. Never plaintext on disk, never in localStorage.
- **Session restore on cold start:** If a valid refresh token exists, restore the session silently (no browser step, no re-consent). Only fall back to "Continue with Discord" if no token or refresh fails.
- **Silent background refresh:** Proactive timer scheduled shortly before the access token's `expires_at` (60s margin). On any Discord API 401, refresh once and retry the request. If refresh itself fails (revoked/401), clear the session and fall back to login.
- **Convex `users` table:** User profile persisted to a Convex `users` table on first login (Discord id as the natural key). Updated on subsequent logins if any field changed. Public mutation (no Convex auth in Phase 1).
- **Log out:** Clears the stored refresh token + access token from keychain; returns to the "Continue with Discord" screen. Does NOT call Discord's `/oauth2/revoke` endpoint (out of scope for v1).

**Dev-only commands (debug builds only):**

- `dev_set_expires_in(seconds)` — set a short expiry for testing the proactive refresh timer
- `dev_corrupt_refresh()` — corrupt the refresh token to test the refresh failure path

**Manual smoke tests (see `specs/2026-07-06-auth-discord-oauth2-pkce/validation.md`):**

1. Cold-start login with avatar
2. Kill + reopen restores session without re-consent
3. Token near expiry triggers silent refresh
4. Log out clears session cleanly

## 4. Suggested build order

1. **Auth first.** Get Discord OAuth2 + PKCE working end-to-end in a bare Tauri shell — this validates the trickiest infra piece (custom URI redirect handling) before any UI exists.
2. **Presence + DM text**, backed by Convex. This proves the realtime data layer and gives you a usable (if ugly) app quickly.
3. **1:1 voice** via direct WebRTC — smaller surface area than group voice, good place to learn the API.
4. **Hangout lobby UI** (text half) — reuses the DM chat components against a single shared "room" instead of a friend pair.
5. **Hangout lobby voice** via LiveKit — the most infra-heavy step, saved for when the rest of the app already works.
6. **Theme pass + performance profiling** — measure idle CPU/RAM with a game running before calling it done; this was the whole point.

## 5. Open questions worth deciding early
- **Group size ceiling** — LiveKit scales far past a friend group's needs, but worth deciding roughly how many concurrent voice participants you're designing for, since it affects VM sizing.
- **Message history retention** — forever, or rolling window? Affects Convex storage growth over time.
- **Push notifications when the app is fully closed** (not just backgrounded) — out of scope for v1 unless a friend specifically wants it, since it adds a whole separate delivery mechanism (APNs/FCM-equivalent) that a LAN-friends app usually doesn't need.
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

## 3.2 Phase 2 — Presence

Phase 2 proves the realtime data layer and gives the first sign of "who's around": each online client maintains a live presence doc in Convex; everyone else sees appear/disappear + status text in a collapsible sidebar, with no refresh and no polling.

**Implementation details:**

- **`presence` table (separate from `users`):** A new Convex `presence` table keyed by `userId` (FK to `users`) + denormalized `discordId`. Keeping presence separate avoids thrashing the rarely-changing `users` profile doc with ~10s heartbeat writes. Indexes: `byUser`, `byDiscordId`.
- **Binary Online/Offline + self-set status:** `online: boolean` + `status: string` (free-text "now playing"/custom line). No Idle/DND in v1. Status persists across log out (only `online` flips), so the user doesn't retype on next login. Status is self-set in BaatCheet — Discord's `identify` scope can't read rich presence.
- **Heartbeat + TTL sweep (crash-resilient offline detection):** The client writes `lastSeen` every ~10s. A Convex cron `sweepOffline` runs every ~5s and flips any presence doc whose `lastSeen` is older than 30s to `online:false`. Graceful close (window close / log out) sets `online:false` immediately. Result: online appears within ~1s (reactive subscription); crash-disconnect resolves within ~30–35s (30s staleness + up to 5s until next sweep).
- **Reactive presence list (no polling, no manual websocket):** The sidebar subscribes to a live `listPresence` query (joined with `users` profile). Appear/disappear and status edits propagate automatically via Convex reactive subscriptions.
- **Collapsible friends sidebar:** Left rail listing every `users` doc (one pre-existing friend group — no friend-request flow). Entries grouped online-first (alpha by displayName, fallback username), then offline. Each row shows avatar, name, status text, and an online/offline dot. Collapsible to a narrow icon rail; collapse state persists across relaunch via localStorage (a UI pref, not a credential). The sidebar is the only new chrome — the main area stays the Phase-1 post-auth screen.
- **Graceful close:** A Tauri `onCloseRequested` listener fires `setOffline` before the window closes (best-effort, 2s timeout). The TTL sweep is the backstop if the mutation doesn't land in time.
- **Log-out teardown:** The log-out path now stops the heartbeat + calls `setOffline` before clearing tokens. The `usePresence` unmount cleanup is the backstop for Rust-initiated teardown (refresh-failure → `discord:needs-login`).
- **Public mutations (known v1 limitation):** Presence mutations are public (no Convex auth middleware), keyed by `userId`/`discordId`. A misbehaving client could spoof another user's presence. Acceptable for v1 (≤10 trusted friends, Convex Cloud dev backend); hardening (Convex auth or signed writes) is deferred.

**Manual smoke tests (see `specs/2026-07-06-presence/validation.md`):**

1. Two clients see each other appear/disappear live, with status, within ~1s (the Phase-2 DoD)
2. Crash-disconnect → offline within ~30–35s (TTL sweep path)
3. Status set on A → visible on B live; log-out flips offline and stops the heartbeat

## 3.3 Phase 3 — 1:1 DM text

Phase 3 is the first usable chat: a 1:1 text conversation between two friends backed by Convex — messages sent from client A appear on client B live (no refresh, no polling), and reopening the DM shows full history. It lands the 2-pane app shell (friends/DM sidebar | DM thread) that Phase 5 retargets at the group lobby.

**Implementation details:**

- **Generic `conversations` + `messages` tables (Decision D1):** a `conversations` doc carries `type` (`"dm"` now; `"group"` lands Phase 5), `participantIds` (exactly 2 for a DM, stored sorted), and a canonical sorted `key` (`"userIdA__userIdB"`) so both participants resolve to the **same** conversation doc via a single upsert/lookup path (index `byKey`). A separate `messages` table is keyed by `conversationId` + ordered by `createdAt` (index `byConversation`). Phase 5's group lobby is a `type:"group"` doc reusing the same `messages` table — a UI retarget, not a schema migration.
- **DM lifecycle:** clicking a friend in the sidebar calls `getOrCreateDM(myUserId, peerUserId)` (computes the canonical `key`, inserts if missing, returns the `_id`) and swaps the main pane to that DM thread. The sidebar gains a reorderable "Direct Messages" section (`listMyDMs`, sorted by `lastMessageAt` desc, with last-message preview) above the Phase-2 friends list (which is preserved and now DM-launchable).
- **Sending + history:** `sendMessage(conversationId, senderId, body)` inserts a `messages` doc AND patches `conversations.lastMessageAt` in one transaction (so the DM list reorders live). History is a single reactive `listMessages(conversationId)` subscription returning the **full** ordered history — no pagination, no lazy-loading in v1 (Decision D5 — YAGNI for a ≤10-person group; revisit only if subscription size becomes a problem). Messages persist forever for v1.
- **Typing indicators (Decision D3):** a `typing` table (`conversationId`, `userId`, `lastTyped`) + a `setTyping` mutation (debounced ~300ms client-side, not per keystroke) + a recency-filtered `listTyping` query (`lastTyped > now - 3000`, self-excluded). The DM thread shows "… is typing" for the peer. Stale docs are invisible by recency — **no cron** is required for v1 (the table stays tiny; a sweep can be added if it grows).
- **2-pane app shell (Decision D2):** the Phase-2 collapsible sidebar becomes DM-selectable; the main pane swaps from the Phase-1 post-auth placeholder to the active DM thread (or an empty state). There is **no narrow icon rail** — in Phase 3 there is only one place to chat (1:1 DMs), so a DM-vs-group switcher has nothing to switch between; the icon rail defers to Phase 5 when the group lobby becomes the second surface. The last-opened DM persists across relaunch via localStorage (a UI pref — an id, not a credential) and is cleared on logout.
- **Message UI:** a composer (textarea + Send button; Enter sends, Shift+Enter newline) at the bottom; a scrollable message list above with bubbles (own right-aligned, peer left-aligned with avatar + name); auto-scroll to bottom on new message and on conversation switch. Light Tailwind styling only (Phase 7 owns the polished Discord-derived theme).
- **Public mutations (known v1 limitation — Decision D4):** `sendMessage`, `setTyping`, and `getOrCreateDM` are public (no Convex auth middleware), keyed by `conversationId`/`userId`/`senderId`. A misbehaving client could spoof another user's messages or typing. Acceptable for v1 (≤10 trusted friends, Convex Cloud dev backend); hardening (Convex auth or signed writes) is deferred. Inherits Phase 1 D-impl-3 / Phase 2 D7.

**Manual smoke tests (see `specs/2026-07-06-dm-text/validation.md`):**

1. Send A→B live + B→A live (the Phase-3 DoD, first half) — messages propagate in both directions within ~1s, no manual refresh, both clients resolve to the same `conversations` doc
2. Reopening the DM shows full history (the Phase-3 DoD, second half) — full history restored on DM reopen and on app relaunch; no truncation (no pagination in v1)
3. Typing indicator A→B live — appears within ~1s, disappears ~3s after the peer stops typing (recency filter, no cron)
4. DM list reorders by `lastMessageAt` + sidebar selection round-trips — a new message reorders the sender's DM to the top live; the last selection persists across relaunch

## 3.4 Phase 4 — 1:1 voice (direct WebRTC)

Phase 4 is the first voice: prove direct peer-to-peer WebRTC audio between two friends, with coturn as TURN fallback. A calls B from the DM thread → B sees an incoming-call toast → B accepts → two-way audio works → either side can mute/deafen/leave cleanly. The roadmap calls this "smaller surface area than group voice — good place to learn the WebRTC API," so Phase 4 uses the raw WebRTC API directly (no SFU, no wrapper library); the LiveKit SFU for group voice is Phase 6.

**Implementation details:**

- **`calls` table in Convex (Decision D3):** a `calls` doc carries `callerId`, `calleeId`, `status` (`"calling"` | `"accepted"` | `"rejected"` | `"ended"` | `"missed"`), `offerSdp`, `answerSdp` (nullable), `callerIceCandidates`/`calleeIceCandidates` (JSON-encoded `RTCIceCandidateInit` arrays), `startedAt`, `connectedAt`, `endedAt`, `endReason`. Indexed by `byCallee` (incoming-call toast subscription) and `byCaller`. Both sides subscribe to the single call doc via `getCall(callId)` for state transitions + ICE trickle.
- **Signaling over Convex (Decision D1):** exchange the SDP offer/answer + trickled ICE candidates via Convex docs that both sides subscribe to — reusing the Phase-2/3 reactive subscription + public-mutation pattern. No new WebSocket infra; signaling state lives in the `calls` doc.
- **Raw WebRTC layer (Decision D4):** a thin in-repo wrapper (`src/webrtc/peerConnection.ts`) over the browser `RTCPeerConnection` — no `simple-peer`/`peerjs` dependency. Handles `onicecandidate` → `addIceCandidate` mutation, `ontrack` → remote `<audio>` element, `createOffer`/`createAnswer`/`setLocalDescription`/`setRemoteDescription`/`addIceCandidate`, `close`. ICE servers config read from `VITE_ICE_SERVERS` (Vite-embedded JSON of `RTCIceServer[]`) — STUN + coturn TURN (Decision D2).
- **coturn provisioning (Decision D2):** a single self-hosted coturn on the Coolify VM, shared with Phase 6 (group voice + LiveKit fallback). Static long-term-mechanism credentials for v1 (Decision D5). The ICE servers JSON is provided to the frontend via `VITE_ICE_SERVERS` (env, not in the repo).
- **Call UI (Decision D12):** a call button (phone icon) in the DM thread header — clicking it starts a 1:1 voice call with the DM peer. The call button is disabled when the peer is offline (Decision D11). The incoming-call toast + floating call controls are rendered by `AuthenticatedLayout` (independent of the active DM, so the user can browse DMs mid-call). Mute = local audio track `enabled = false`; deafen = remote audio element muted AND local track muted (Discord semantics).
- **Busy + offline handling (Decision D11):** call button is disabled when the peer's `presence.online === false`. If an incoming call arrives while the callee is already in a call, the callee's client auto-rejects (no toast shown) so the caller gets a fast busy signal.
- **Public mutations (known v1 limitation — Decision D7):** `startCall`, `answerCall`, `rejectCall`, `endCall`, `addIceCandidate`, `markMissed` are all public (no Convex auth middleware), keyed by `callerId`/`calleeId`/`callId`. A misbehaving client could spoof a call, hijack another user's call doc, or inject ICE candidates. Acceptable for v1 (≤10 trusted friends, Convex dev backend); hardening deferred.
- **Platform scope (Decision D9):** Phase 4 is validated on Windows (WebView2) only. No macOS `NSMicrophoneUsageDescription` or Linux WebKitGTK permission handling is wired. Cross-platform mic hardening defers.
- **Deferred:** OS notifications for incoming calls (Decision D6 — in-app toast is the DoD surface), video, screen share, call recording, call history UI, time-limited coturn credentials, call quality stats.

**Manual smoke tests (see `specs/2026-07-07-voice-1-1/validation.md`):**

1. A calls B → B sees toast → accept → two-way audio (the Phase-4 DoD, first half) — A→B call reaches two-way audio within a few seconds of Accept; the toast → controls transition is live on both sides
2. Mute / deafen round-trip (the Phase-4 DoD, second half) — mute and deafen toggle cleanly on both sides with the correct speaker/mic semantics; the UI state reflects the toggles
3. Either side leaves cleanly (the Phase-4 DoD, third half) — either side can leave; both clients tear down cleanly (UI removed, tracks stopped, mic indicator cleared); a subsequent call works
4. Reject path — the reject path tears down both sides cleanly without ever establishing a peer connection; the `calls` doc records the rejection
5. Busy + offline callee handling — call button is disabled when peer offline; incoming call while in-call is auto-rejected (no toast), giving the caller a fast busy signal
6. coturn TURN fallback across NAT (conditional — requires a strict-NAT test client) — the call connects via a TURN `relay` candidate on a strict-NAT network; two-way audio works

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
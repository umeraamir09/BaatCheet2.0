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

## 3.5 Phase 5 — Hangout lobby (text half)

Phase 5 is the group text half of the centerpiece: one shared, always-on "lobby" room for the whole friend group. Any member posts to the lobby → all members see it live; history persists across restarts. This is the roadmap's Phase 5 and the text half of the "Talk to everyone" loop. The key insight: **zero schema change** — Phase 3's generic `conversations`/`messages`/`typing` tables were designed for this. The lobby is a `conversations` doc with `type: "group"`, `key: "group:lobby"`, reusing `messages` + `typing` verbatim.

**Implementation details:**

- **No schema change (Decision D1):** `convex/schema.ts` is untouched. The `conversations` table already supports `type: "group"` (it's `v.string()`), `participantIds` with >2 entries (it's `v.array(v.id("users"))`), and `key: "group:lobby"` (it's `v.string()`). This validates Phase 3 D1's forward-looking generic design.
- **Lobby Convex functions (`convex/lobby.ts`):** `getOrCreateLobby(userId)` mutation (looks up by `key === "group:lobby"` via `byKey` index; inserts if missing; adds self to `participantIds` if found) + `getLobby` reactive query (returns the single lobby doc or null). Both public (Decision D7 — v1 spoofing limitation accepted).
- **Icon rail (Decision D3):** the deferred Phase-3 D2 surface lands now. A narrow (~56px) leftmost vertical rail with "Lobby" (hash icon) and "Direct Messages" (person icon). Selecting "Lobby" shows the group text thread; selecting "DMs" shows the selected DM. The sidebar (friends/DMs/presence) persists in both modes. Clicking a friend/DM in the sidebar while in "Lobby" mode switches to "DMs" mode + opens that DM (cross-navigation).
- **Shared chat components (`src/components/chat/`):** `MessageBubble` + `Composer` extracted from `DMThread` into shared files. Both `DMThread` and `LobbyThread` import them — single source of truth for bubble/composer rendering.
- **Chat hook generalization (Decision D4):** `useDMThread` renamed to `useChatThread` (`src/hooks/useChatThread.ts`). The hook was already generic (keyed on `conversationId` + `myUserId`); the rename makes the name honest. Both `DMThread` and `LobbyThread` use it.
- **LobbyThread (`src/components/LobbyThread.tsx`):** group text thread with "Lobby" header + group icon + live "N online" count (from the existing presence subscription). Multi-person typing indicator ("X and Y are typing…", "X, Y and N others are typing…"). No call button (group voice is Phase 6 — Decision D8).
- **View mode state + persistence (Decision D10):** `AuthenticatedLayout` owns a `viewMode` state (`"lobby" | "dms"`). Last-selected mode persists across relaunch via localStorage (`baatcheet.viewmode`). Default on fresh login: `"lobby"` (the centerpiece). Cleared on logout (no cross-user leakage).
- **Lobby auto-creation on login (Decision D6):** `getOrCreateLobby(userId)` called once per session when `presence.userId` becomes available (ref-guarded). The lobby is always-on.
- **Floating call overlay persists across view modes (Decision D8):** the Phase-4 call overlay (`CallControls` + `IncomingCallToast`) renders outside the view-mode conditional — a 1:1 call works while browsing the lobby.
- **Public mutations (known v1 limitation — Decision D7):** `getOrCreateLobby` is public (no Convex auth middleware), keyed by `userId`. A misbehaving client could create a rogue lobby. Acceptable for v1 (≤10 trusted friends, Convex dev backend); hardening deferred.
- **Deferred:** group voice / LiveKit SFU (Phase 6), side-by-side lobby layout (Phase 6), multiple channels/rooms (not in v1), message editing/deletion/reactions/attachments (not in v1), full Discord-derived theme polish (Phase 7).

**Manual smoke tests (see `specs/2026-07-08-hangout-lobby-text/validation.md`):**

1. Post to lobby → all members see it live (the Phase-5 DoD, first half) — any group member posts to the lobby → all members viewing the lobby see it live within ~1s
2. History persists across restarts (the Phase-5 DoD, second half) — full lobby history restored on app restart; no data loss
3. Typing indicator in group context — multi-person format renders correctly (1, 2, and 3+ typers); self excluded
4. Navigation round-trip (lobby ↔ DMs, view-mode persistence) — icon rail switches between lobby and DMs; cross-navigation from sidebar works; view mode persists across relaunch and is cleared on logout
5. No regression in Phase 2/3/4 — presence, DM text, and 1:1 voice all still work; floating call overlay persists across view-mode switches

## 3.6 Rich messaging (images, links, emojis, GIFs)

Rich messaging extends the text chat with image uploads, clickable links with OpenGraph preview cards, an Apple-style emoji picker, and a GIPHY-powered GIF picker. All features work in both DM and lobby threads.

**Implementation details:**

- **Schema extension:** `messages` table gains two optional fields: `attachments` (array of image/GIF objects) and `linkPreview` (OG metadata object or null). Both `v.optional()` for backward compatibility with existing messages.
- **Image uploads (`convex/storage.ts`):** `generateUploadUrl` mutation produces a short-lived upload URL. The client POSTs the file directly to Convex file storage, receives a `storageId`, and passes it to `sendMessage` as an image attachment. `listMessages` resolves `storageId` → URL via `ctx.storage.getUrl()`.
- **Link previews (`convex/linkPreviews.ts`):** `fetchLinkPreview` internal action fetches a URL server-side (no CORS), parses HTML for OpenGraph meta tags (`og:title`, `og:description`, `og:image`, `og:site_name`), and stores the result on the message via `storeLinkPreview` internal mutation. Scheduled by `sendMessage` when a URL is detected in the body. Preview card appears reactively ~1-3s after the message.
- **Rich text rendering (`src/components/chat/RichContent.tsx`):** Parses message text for URLs (via `linkifyjs`) and renders them as clickable links that open in the system browser (via Tauri `opener` plugin). Preserves `whitespace-pre-wrap break-words`.
- **Link preview card (`src/components/chat/LinkPreviewCard.tsx`):** Renders a Discord-style preview card below the message text with thumbnail, title, description, and domain. Clickable — opens URL in system browser.
- **Emoji picker (`src/components/chat/EmojiPicker.tsx`):** Wraps `@emoji-mart/react` Picker with `set="apple"` and `theme="dark"`. Selected emoji's native Unicode character is inserted at the textarea cursor position.
- **GIF picker (`src/components/chat/GifPicker.tsx`):** Custom GIPHY search UI with trending GIFs by default, debounced search, and a grid of thumbnails. Uses raw `fetch` calls to the GIPHY API (no SDK dependency). GIFs are referenced by GIPHY CDN URL (no Convex storage). Requires `VITE_GIPHY_API_KEY` env var — GIF button hidden if key is missing.
- **Composer toolbar:** Three icon buttons (emoji, GIF, image upload) above the textarea. Image upload uses `<input type="file" accept="image/*">` (no Tauri plugin needed). Pending image/GIF preview shown above the textarea with remove button.
- **`useChatThread` extended:** `send(body, attachments?)` handles image upload flow (generateUploadUrl → POST → storageId) before calling `sendMessage`. GIF attachments passed by URL directly.
- **`useComposerState` hook (`src/hooks/useComposerState.ts`):** Shared state management for pending image, pending GIF, and emoji insertion. Used by both `DMThread` and `LobbyThread`.
- **New dependencies:** `@emoji-mart/react` (7KB), `@emoji-mart/data` (28MB unpacked, tree-shakeable), `linkifyjs` (259KB, zero deps).
- **New env var:** `VITE_GIPHY_API_KEY` — GIPHY beta key (client-safe, Vite-embedded).

**Manual smoke tests:**

1. Send an image — select a file, preview appears, send → image renders in the bubble for both sender and receiver
2. Send a message with a URL — link is clickable, preview card appears ~1-3s later with title/description/thumbnail
3. Use the emoji picker — click emoji button, picker opens with Apple-style emojis, select one → inserted at cursor
4. Use the GIF picker — click GIF button, trending GIFs load, search for a term, select a GIF → GIF renders in the bubble
5. No regression — all Phase 2/3/4/5 features still work

## 3.7 Phase 6 — Hangout lobby (group voice via LiveKit)

Phase 6 is the voice half of the centerpiece: one always-open group voice room for the whole friend group, backed by a self-hosted LiveKit SFU. Any member clicks "Join Voice" in the lobby → dropped straight into the in-progress call (no invite/accept dance); mute/deafen/leave reuse the Phase-4 semantics; leaving and rejoining is one click with no call-teardown dance. This is the roadmap's Phase 6 and the voice half of the "Talk to everyone" loop.

**Implementation details:**

- **LiveKit SFU (Decision D1):** a self-hosted LiveKit server on your Ubuntu VM is the group voice backend. The single shared voice room is named `"lobby"` (mirrors the text lobby's `key: "group:lobby"`). LiveKit auto-starts the room on first connect + auto-empties on last disconnect — no create/destroy lifecycle. See `docs/livekit-deployment.md` for the full deploy guide.
- **`livekit-client` SDK only (Decision D2-deviated):** `livekit-client` (core) + `livekit-server-sdk` (token mint) — 2 deps. The `@livekit/components-react` provider layer was dropped in favor of a hook-driven design: the `useGroupVoice` hook owns the `Room` lifecycle + drives the roster from `RoomEvent` listeners + attaches audio tracks manually via `track.attach()` (mirrors `useCall` owning `PeerCall`).
- **Token mint via Convex action (Decision D3):** `convex/livekit.ts` → `mintToken(userId)` is a public Convex action (the codebase's first public `action`) that reads `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` from the Convex deployment environment (set via `bunx convex env add`, NOT `.env.local`) and mints a JWT scoped to room `"lobby"`. The API secret never reaches the client.
- **No schema change (Decision D16):** voice room state lives in LiveKit (D4), not Convex. `convex/schema.ts` is untouched. A `convex/users_internal.ts` file provides an `internalQuery` for the action to load user docs (actions don't have direct DB access).
- **Single-click join (Decision D5):** a "Join Voice" / "Leave Voice" button in the `LobbyThread` header. Click → `mintToken` → `room.connect()` → you're in. No toast/invite flow (contrast with 1:1 Phase 4).
- **Side-by-side layout (Decision D6):** when connected to group voice, the lobby view splits inside `<main>`: `VoiceStage` (left, `w-72`) + `LobbyThread` (right, `flex-1`). When not in voice, full-width text (Phase-5 behavior unchanged). Audio persists across view-mode switches (the `Room` lives in the hook, not the component).
- **VoiceStage component (`src/components/voice/VoiceStage.tsx`):** fixed-width column showing the live participant roster (avatar + name + green speaking ring + muted mic icon), mute/deafen/leave controls bar, and a hidden audio container for attached `<audio>` elements.
- **Mute/deafen reuse (Decision D7):** Discord semantics inherited from Phase 4. Mute = `localParticipant.setMicrophoneEnabled(false)`. Deafen = mute mic + mute all attached `<audio>` elements (remote playback).
- **Mutual exclusivity (Decision D9):** one active voice connection per user. Joining group voice leaves any active 1:1 call; starting/accepting a 1:1 call leaves group voice. Enforced in `AuthenticatedLayout` wrapper callbacks (hooks stay decoupled).
- **coturn as LiveKit TURN (Decision D10):** LiveKit's server config points at the Phase-4 coturn as its TURN server. Participants behind strict NAT relay through coturn. Server config concern, not client code.
- **Teardown (Decision D12):** `handleLogout` + `onCloseRequested` call `groupVoice.leave()` BEFORE `call.leave()` + `goOffline()`. Race-timeout-guarded (3s).
- **Public token-mint (known v1 limitation — Decision D13):** `mintToken` is public (no Convex auth); a misbehaving client could pass another user's `userId` and join as them. Acceptable for v1 (≤10 trusted friends).
- **Platform scope (Decision D14):** Windows-only (inherits Phase 4 D9). WebView2 mic access validated in Phase 4.
- **Deferred:** video, screen share, call recording, push-to-talk, VAD tuning, multiple voice rooms, voice permissions, 1:1 via LiveKit, OS notifications for voice events, Convex auth for token minting, full theme polish, formal idle-CPU/RAM profiling under gaming load.

**Manual smoke tests (see `specs/2026-07-09-hangout-lobby-voice-livekit/validation.md`):**

1. 3+ join/leave freely, audio stable (the Phase-6 DoD, first half) — 3+ members join/leave freely; audio stays stable with 3 concurrent speakers; roster updates live
2. Mute / deafen round-trip in group (the Phase-6 DoD, second half) — mute and deafen toggle cleanly in the group context with Discord semantics; UI state reflects the toggles; muted mic icon propagates to other clients
3. Leave + rejoin one-click, no teardown dance (the Phase-6 DoD, third half) — leaving and rejoining is one click each way; rapid rejoin cycles are clean with no stale state
4. Side-by-side layout + roster + speaking indicators — voice left + text right when in voice; roster shows participants with avatars/names/speaking-ring/mute-icons; text thread works alongside voice; audio persists across view-mode switches
5. Mutual exclusivity with 1:1 call — joining group voice leaves any active 1:1 call; starting a 1:1 call leaves group voice; only one voice connection at a time
6. coturn TURN fallback across NAT (conditional — requires a strict-NAT test client) — the strict-NAT client connects via a TURN relay candidate through coturn
7. Teardown on logout + window close — group voice disconnects before 1:1 call + goOffline; OS mic indicator clears; other clients see the departure live
8. No regression in Phase 2/3/4/5 — presence, DM text, 1:1 voice, and lobby text all still work

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
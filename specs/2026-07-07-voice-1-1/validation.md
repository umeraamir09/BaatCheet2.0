# Phase 4 — 1:1 voice (direct WebRTC): Validation

How to know the implementation succeeded and can be merged. Per Decision D8, merge requires **automated gates green AND manual smokes**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors) — inherited from Phase 0/1/2/3.
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`) — inherited from Phase 0/1/2/3.
- [ ] `bun tauri build` completes and emits a release binary for the current platform — inherited from Phase 0/1/2/3.
- [ ] Convex schema deploys cleanly: `bunx convex dev` (or `codegen`) regenerates `_generated/` for the new `calls` table with no schema errors; `convex/schema.ts` declares `calls` with `byCallee` + `byCaller` indexes (Decision D3).
- [ ] No credentials/tokens introduced into the tree (Phase 1 D1 still holds): `git grep -iE "client[_-]?secret|refresh[_-]?token|access[_-]?token"` returns nothing outside code identifiers; the coturn `credential` is NOT committed — it is read from `VITE_ICE_SERVERS` in `.env.local` (Decision D5). Re-verify `git grep -iE "VITE_ICE_SERVERS"` only appears in code reading `import.meta.env`, never in committed `.env*` files.
- [ ] No extra Discord scopes requested (Phase 1 D4 `identify`-only still holds): `git grep -iE "scope.*email|scope.*guilds|scope.*presence"` returns nothing.
- [ ] No external WebRTC dependency added (Decision D4): `package.json` does not gain `simple-peer`, `peerjs`, or any WebRTC wrapper; only raw `RTCPeerConnection` is used.
- [ ] **Windows-only validation** (Decision D9): Phase 4 is validated on Windows (WebView2) only. No macOS `NSMicrophoneUsageDescription` or Linux WebKitGTK permission handling is wired. If the first mic smoke fails on Windows, the fix is likely Windows OS mic privacy settings, not Tauri config.

## Manual smoke 1 — A calls B → B sees toast → accept → two-way audio (the Phase-4 DoD, first half)
1. Two machines (or two OS user profiles) running `bun tauri dev`, each logged in as a different Discord account (both in `users` via Phase 1; both appear in each other's sidebar via Phase 2; both have an open 1:1 DM via Phase 3). Requires the user's second Discord test account.
2. A opens B's DM thread and clicks the call button (phone icon in the thread header).
3. B's client shows the `IncomingCallToast` ("A is calling you…") live within ~1s (reactive `listIncomingCalls` subscription — confirm via DevTools it is a live query, no polling).
4. B clicks Accept → A's `CallControls` bar appears showing "Connecting…" then "Connected" once the ICE/DTLS handshake completes; B's bar likewise.
5. A speaks → B hears A; B speaks → A hears B (two-way audio). Confirm the remote `<audio autoplay>` element has a live `srcObject` and is not muted (unless deafened).
- [ ] Pass: A→B call reaches two-way audio within a few seconds of Accept; the toast → controls transition is live on both sides.

## Manual smoke 2 — Mute / deafen round-trip (the Phase-4 DoD, second half)
1. While the smoke-1 call is connected, A clicks mute → A's mic icon shows muted; B confirms A's audio goes silent (B can no longer hear A). A clicks mute again → B hears A again.
2. A clicks deafen → A's speakers mute AND A's mic mutes (Discord deafen semantics — Decision D3/plan 3.2): B confirms A goes silent (mic muted), and A confirms B goes silent (speakers muted). A clicks deafen again → both restore.
3. B repeats the same mute/deafen round-trip from B's side; A confirms symmetrically.
- [ ] Pass: mute and deafen toggle cleanly on both sides with the correct speaker/mic semantics; the UI state reflects the toggles.

## Manual smoke 3 — Either side leaves cleanly (the Phase-4 DoD, third half)
1. While the call is connected, A clicks leave → A's `CallControls` disappears; A's local mic/camera tracks stop (`getUserMedia` released — confirm the OS mic-in-use indicator clears); the `calls` doc transitions to `status: "ended"`, `endReason: "left"`, `endedAt` set.
2. B's client reacts live: B's `CallControls` disappears (the `getCall` subscription saw `status → ended`); B's local tracks stop; B's OS mic indicator clears.
3. Repeat the call (A calls B again) → a fresh `calls` doc is created; the second call connects cleanly (no stale state from the first).
4. B initiates the leave this time → symmetric behavior; A sees B leave live.
- [ ] Pass: either side can leave; both clients tear down cleanly (UI removed, tracks stopped, mic indicator cleared); a subsequent call works; the `calls` doc records the end.

## Manual smoke 4 — Reject path (Decision D3)
1. A calls B (smoke 1 setup). B's toast appears. B clicks Decline.
2. A's client reacts live: A's "Connecting…" bar transitions to "Call declined" (or disappears) within ~1s; A's `getUserMedia` is released; the `calls` doc transitions to `status: "rejected"`, `endReason: "rejected"`, `endedAt` set.
3. B's toast disappears; B's client never created a `PeerCall` (no `getUserMedia` acquired on the reject path).
- [ ] Pass: the reject path tears down both sides cleanly without ever establishing a peer connection; the `calls` doc records the rejection.

## Manual smoke 5 — Busy + offline callee handling (Decision D11)
1. A opens B's DM thread. B is offline (presence shows offline dot). Confirm the call button in the DM header is disabled (grayed out or not clickable).
2. B comes online. A's call button becomes enabled. A clicks call → B sees the toast (smoke 1 path).
3. While A and B are in a call, C calls A. A's client should auto-reject (no toast shown to A) so C gets a fast busy signal. Confirm A's `calls` doc for C's call transitions to `status: "rejected"`, `endReason: "rejected"` within ~1s.
- [ ] Pass: call button is disabled when peer offline; incoming call while in-call is auto-rejected (no toast), giving the caller a fast busy signal.

## Manual smoke 6 — coturn TURN fallback across NAT (Decision D2; conditional — requires a strict-NAT test client)
1. Same setup as smoke 1, but one client is on a network where direct UDP is blocked (e.g. a mobile hotspot with strict/symmetric NAT, or a corporate wifi). The other is on a normal network.
2. A calls B. Inspect `RTCPeerConnection` stats (DevTools `pc.getStats()` or `chrome://webrtc-internals`-equivalent in the Tauri webview) — confirm the selected candidate pair includes a `relay` type (TURN) candidate, not just `host`/`srflx`.
3. Two-way audio works despite the strict NAT (this is what coturn provides — without it, the call would fail ICE on the strict-NAT side).
4. If no strict-NAT test network is available, mark this smoke as "not exercised this round" and note it in the merge notes — it is the one smoke that depends on network topology the user controls. The DoD's "two-way audio works" is satisfied by smoke 1 on any topology; smoke 5 specifically validates the coturn fallback path.
- [ ] Pass: the call connects via a TURN `relay` candidate on a strict-NAT network; two-way audio works; coturn is the fallback path (Decision D2).

## Repo hygiene + Phase-4-specific checks
- [ ] The `calls` table is the **single source of truth** for call state (Decision D3): `status`, `offerSdp`, `answerSdp`, `callerIceCandidates`, `calleeIceCandidates`, `startedAt`, `connectedAt`, `endedAt`, `endReason` all live on the one doc both sides subscribe to via `getCall(callId)`. Confirm no second signaling channel (no WebSocket, no `messages`-table signaling noise — Decision D1).
- [ ] **Convex is the signaling channel** (Decision D1): confirm via DevTools that the call setup exchanges SDP + ICE via Convex mutations + the `getCall` reactive subscription; no polling; no separate WS connection in the Network tab.
- [ ] **Raw WebRTC only** (Decision D4): `package.json` adds no WebRTC wrapper dependency; `src/webrtc/peerConnection.ts` is the single in-repo module wrapping the browser `RTCPeerConnection`.
- [ ] **coturn is provisioned** (Decision D2): the user has confirmed coturn is running on the Coolify VM, ports 3478 UDP/TCP are open on the firewall, and `VITE_ICE_SERVERS` in `.env.local` includes the `turn:` endpoint with working credentials. The committed code reads ICE servers from `import.meta.env.VITE_ICE_SERVERS` with a public-STUN fallback for local dev.
- [ ] **Static coturn credentials, not committed** (Decision D5): `git grep -iE "VITE_ICE_SERVERS"` only matches code reading `import.meta.env`; no `.env*` file with the real credential is committed (`.gitignore` covers `.env.local` as in Phase 1). The v1 static-credential limitation is documented in `README.md` Phase 4 section.
- [ ] **In-app toast is the DoD surface; no OS notifications wired** (Decision D6): confirm `@tauri-apps/plugin-notification` is NOT added in Phase 4; the incoming-call surface is the in-app `IncomingCallToast` reacting to `listIncomingCalls`.
- [ ] **Floating overlay owned by `AuthenticatedLayout`** (Decision D12): `CallControls` + the hidden `<audio>` element render in `AuthenticatedLayout` as a floating bar over the main pane, independent of the active DM. The user can browse DMs / switch conversations while on a call; the call bar persists. `DMThread` has a call button + a `startCallWithPeer` callback prop from `AuthenticatedLayout`.
- [ ] Foreign-key integrity: `calls.callerId` and `calls.calleeId` are `v.id("users")`; no call doc exists without both participants in `users`.
- [ ] Call teardown is wired into logout + window close: `AuthenticatedLayout`'s `onCloseRequested` + `handleLogout` paths call `useCall.leave()` (or equivalent) BEFORE `goOffline` so an active call is torn down on close/logout. Confirm no `getUserMedia` handle lingers after close/logout (OS mic indicator clears).
- [ ] `getUserMedia` is acquired only on the accept/initiate paths and released on every end path (leave, reject, missed, error, close, logout); no mic-in-use indicator lingers when no call is active.
- [ ] Phase-3 behavior is **preserved**: DM send/receive still works live; typing indicators still work; the sidebar still shows presence + status + DM ordering; graceful close + log-out still fire `goOffline`; the sidebar is still collapsible. No regression in Phase-3 smokes.
- [ ] Phase-2 behavior is **preserved**: presence/heartbeat still work; online/offline + status still render; no regression in Phase-2 smokes.
- [ ] **Known v1 limitations documented** (Decisions D5 + D7): `README.md` Phase 4 section records (i) static coturn credentials are a v1 stance (HMAC-issued creds deferred), and (ii) call mutations are public (no Convex auth — spoof/hijack risk accepted for v1, hardening deferred). A comment in `convex/calls.ts` notes the spoofing risk.
- [ ] `counter` table (Phase-0 remnant) is untouched — not removed in Phase 4 (cleanup deferred).
- [ ] **All three docs updated** (gap: README/roadmap/AGENTS out of sync): `README.md` Phase 4 section present (`## 3.4 Phase 4 — 1:1 voice`); `specs/roadmap.md` Phase 4 STATUS marker added; `AGENTS.md` phase status line updated (currently stale — says only 0/1 complete). The Phase 4 section records: `calls` table, Convex-as-signaling, coturn setup + `VITE_ICE_SERVERS` env, raw-WebRTC stance, mute/deafen semantics, the static-credential + public-mutation v1 limitations, deferred OS notifications, Windows-only platform scope (D9).

## Explicitly NOT validated here (out of scope — later phases)
- ~~Group voice / LiveKit SFU~~ → Phase 6 (Decision D4 — Phase 4 is direct P2P, no SFU).
- ~~Video~~ → not in v1 (mission: voice only).
- ~~Screen share~~ → not in v1.
- ~~Call recording~~ → not in v1.
- ~~Call history / recent calls UI~~ → later polish (`calls` docs persist but no UI in Phase 4).
- ~~OS notifications for incoming calls~~ → later polish phase (Decision D6 — in-app toast is the DoD surface).
- ~~Time-limited / HMAC-issued coturn credentials~~ → later hardening pass (Decision D5 — static creds are v1).
- ~~Call quality stats / network indicator bars~~ → not in v1.
- ~~Re-ring / call-waiting~~ → not in v1 (one active call per user at a time).
- ~~Convex auth / per-user write authorization~~ → deferred (Decision D7 — public call mutations are a known v1 limitation, not a validation failure).
- ~~Full Discord-derived theme polish~~ → Phase 7 (Phase 4 call UI is functional, lightly styled).
- ~~Idle CPU/RAM profiling under gaming load + audio-stutter-under-load~~ → Phase 7.

## Merge criteria
All automated gates green + manual smokes 1–5 passing + repo-hygiene + Phase-4-specific checks box-checked. Smoke 6 (coturn TURN fallback across NAT) is conditional on the user having a strict-NAT test network; if unavailable this round, note it and mark it pending — it validates the coturn fallback path specifically, while smoke 1 satisfies the literal DoD on any topology. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-4 DoD from `specs/roadmap.md` is satisfied when smokes 1 + 2 + 3 pass: *A calls B → B sees toast → accept → two-way audio works → either side can mute/deafen/leave cleanly.* Smokes 4 + 5 + 6 validate the reject path (Decision D3), busy/offline handling (Decision D11), and the coturn TURN fallback (Decision D2) beyond the literal DoD.

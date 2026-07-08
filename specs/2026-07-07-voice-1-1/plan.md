# Phase 4 — 1:1 voice (direct WebRTC): Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0/1/2/3 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regen via `bunx convex dev`). Branch: `phase-4/voice-1-1`, off the Phase-3 tip.

## 1. Prereqs check + schema + env (Decisions D3, D9, D10)
- 1.1 Confirm Phase 3 is present on the branch: the 2-pane shell renders, `useDMThread` + `usePresence` work, `convex/schema.ts` declares `users`/`presence`/`conversations`/`messages`/`typing`, and `AuthenticatedLayout` owns the active-DM state + the Tauri close-requested teardown.
- 1.2 In `convex/schema.ts`, add the `calls` table (Decision D3):
  - `callerId: v.id("users")`, `calleeId: v.id("users")`, `status: v.string()` (`"calling"` | `"accepted"` | `"rejected"` | `"ended"` | `"missed"`), `offerSdp: v.string()`, `answerSdp: v.union(v.string(), v.null())`, `callerIceCandidates: v.array(v.string())`, `calleeIceCandidates: v.array(v.string())` (JSON-encoded `RTCIceCandidateInit`), `startedAt: v.number()`, `connectedAt: v.union(v.number(), v.null())`, `endedAt: v.union(v.number(), v.null())`, `endReason: v.union(v.string(), v.null())`.
  - Indexes: `byCallee` on `["calleeId", "startedAt"]` (incoming-call toast subscription), `byCaller` on `["callerId", "startedAt"]`.
  - Leave `users`, `presence`, `conversations`, `messages`, `typing`, and `counter` untouched.
- 1.3 In `src/vite-env.d.ts`, add `readonly VITE_ICE_SERVERS?: string;` to `ImportMetaEnv`.
- 1.4 In `.env.example`, remove the `VITE_TURN_URL`/`VITE_TURN_USERNAME`/`VITE_TURN_PASSWORD`/`VITE_STUN_URL` block (lines 49-60); add one `VITE_ICE_SERVERS=` line with the JSON example per `requirements.md:60`. Don't touch `.env.local` (gitignored; user rewrites their copy). (Decision D10)
- 1.5 No Tauri capability change for Windows (Decision D9 — WebView2 handles mic via OS permission; verify on first smoke).
- 1.6 Run `bunx convex dev` (or `bunx convex codegen`) to regenerate `_generated/` for the new `calls` table; confirm imports resolve.
- **Done:** `calls` declared + indexed; env reconciled; `_generated/` regenerated; lint/typecheck still clean.

## 2. Convex call functions (`convex/calls.ts`) — signaling + lifecycle (Decisions D1, D3, D7)
- 2.1 `startCall(callerId, calleeId, offerSdp)` mutation: validate `callerId !== calleeId`; insert `{ callerId, calleeId, status: "calling", offerSdp, answerSdp: null, callerIceCandidates: [], calleeIceCandidates: [], startedAt: now, connectedAt: null, endedAt: null, endReason: null }`; return the `callId`. Public (Decision D7). Document the v1 spoofing limitation in a comment matching `presence.ts`/`messages.ts`.
- 2.2 `answerCall(callId, answerSdp)` mutation: load the doc; only transition `status: "calling"` → `"accepted"` (idempotent — ignore if not `calling`); set `answerSdp`, `connectedAt = now`. Public.
- 2.3 `rejectCall(callId)` mutation: transition `calling` → `rejected`; set `endedAt = now`, `endReason = "rejected"`. Public.
- 2.4 `endCall(callId, reason)` mutation: transition `accepted` → `ended`; set `endedAt = now`, `endReason = reason` (`"completed"` | `"error"` | `"left"`). If the call is still `calling` (caller cancels before pickup), set `endedAt` + `endReason = "cancelled"`. Public.
- 2.5 `markMissed(callId)` mutation: if `status` is still `calling`, set `status = "missed"`, `endedAt = now`, `endReason = "missed"`. Called by the caller's client after a ~30s ring timeout (no cron needed for v1 — client-driven). Public.
- 2.6 `addIceCandidate(callId, side, candidate)` mutation: append the JSON string to `callerIceCandidates` or `calleeIceCandidates` based on `side` (`"caller"` | `"callee"`). Idempotent-ish (trickle means duplicates are possible; the client dedups by `candidate.candidate` string). Public.
- 2.7 `listIncomingCalls(calleeId)` query: return `calls` where `calleeId === calleeId` AND `status === "calling"`, ordered by `startedAt` desc, take the latest (1). **Join the caller's `users` profile** (avatar, displayName, username) so the toast can render caller identity. Reactive — powers the incoming-call toast (Decision D6).
- 2.8 `getCall(callId)` query: return the full call doc. Reactive — the single subscription both caller and callee hold for state transitions + ICE trickle.
- **Done:** `calls.ts` exposes the 6 mutations + 2 queries; all public; the v1 spoofing limitation is documented in a comment; lint/typecheck clean.

## 3. WebRTC layer (`src/webrtc/peerConnection.ts`, Decision D4)
- 3.1 Read ICE servers from `import.meta.env.VITE_ICE_SERVERS` (JSON string of `RTCIceServer[]`); fall back to a public STUN (Google `stun:stun.l.google.com:19302`) if unset so local dev without coturn still gets host/srflx candidates. Parse once, memoize.
- 3.2 A `PeerCall` class (or factory) wrapping `RTCPeerConnection`:
  - Constructor takes the ICE servers config + callbacks: `onIceCandidate(side)`, `onRemoteStream(stream)`, `onConnectionStateChange(state)`, `onIceConnectionStateChange(state)`.
  - `startCaller()`: `createOffer({ offerToReceiveAudio: true })` → `setLocalDescription` → return the offer SDP. Caller sends it via `startCall`.
  - `startCallee(remoteOfferSdp)`: `setRemoteDescription(offer)` → `createAnswer` → `setLocalDescription` → return the answer SDP. Callee sends it via `answerCall`.
  - `addRemoteIceCandidate(candidate)`: `pc.addIceCandidate(candidate)`.
  - `addLocalIceCandidate`: handled by the `onicecandidate` event → the host marshals it to `addIceCandidate` mutation.
  - `getLocalStream()` / `getRemoteStream()`: accessors for the audio elements.
  - `setMuted(bool)`: toggle the local audio track's `enabled`.
  - `setDeafened(bool)`: toggle the remote `<audio>` element's `muted` AND set the local track `enabled = !deafened` (Discord deafen semantics — you can't hear and you don't accidentally talk).
  - `close()`: stop all tracks, close the PC, release `getUserMedia` handles.
- 3.3 `getUserMedia` helper: `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }`. Default device only in Phase 4 (device picker deferred).
- 3.4 No external WebRTC dependency — raw `RTCPeerConnection` only (Decision D4). Confirm `package.json` does not gain `simple-peer`/`peerjs`/etc.
- **Done:** a single in-repo module owns all WebRTC surface; mute/deafen/leave work; ICE servers are env-driven; lint/typecheck clean.

## 4. Call hook (`src/hooks/useCall.ts`) — the state machine
- 4.1 State machine: `idle` → `initiating` (caller, after `startCall`) → `connected` (on `accepted` + remote stream) → `ended`; and `idle` → `ringing` (callee, on incoming doc) → `connected` → `ended`. Expose `{ status, peer, callId, mute, deafen, leave, accept, reject, startCall }`.
- 4.2 Caller path (`startCall(peerUserId)`): `getUserMedia` → create `PeerCall` → `startCaller()` → `offerSdp` → `startCall` mutation → `callId` → subscribe to `getCall(callId)` → on each new `callerIceCandidates`/`calleeIceCandidates` entry, `addRemoteIceCandidate` (dedup by candidate string); wire `onIceCandidate` → `addIceCandidate(callId, "caller", c)`; on `answerSdp` arriving (status → `accepted`), `setRemoteDescription(answer)`; on `onRemoteStream`, attach to the remote `<audio>` element + set status `connected`; start the call timer.
- 4.3 Callee path: `AuthenticatedLayout` subscribes to `listIncomingCalls(myUserId)`; on a new doc, set status `ringing` + expose `accept`/`reject`. **Decision D11 auto-reject**: if `status !== idle` (already in a call), auto-call `rejectCall` immediately (no toast shown) so the caller gets a fast busy signal. `accept`: `getUserMedia` → create `PeerCall` → `startCallee(offerSdp)` → `answerSdp` → `answerCall(callId, answerSdp)` → subscribe to `getCall(callId)` → trickle ICE both ways → on `onRemoteStream`, attach + status `connected`. `reject`: `rejectCall(callId)` → status `ended` (no PC created).
- 4.4 `leave(reason = "left")`: `endCall(callId, reason)` → `PeerCall.close()` → stop local tracks → release `getUserMedia` → status `ended` → unsubscribe from `getCall`. Either side can call `leave`.
- 4.5 Ring timeout (caller): if `status === "calling"` for ~30s with no `answerSdp`, call `markMissed(callId)` + close the (unused) PC + stop tracks + status `ended`. Client-driven (no cron — Decision D3).
- 4.6 Cleanup: on `connectionState === "failed"` or `iceConnectionState === "disconnected"` for >some grace, auto-`leave("error")`. On component unmount / logout / window close, `leave` if a call is active. Reuse the Phase-3 `onCloseRequested` hook in `AuthenticatedLayout` to tear down the call before `goOffline`.
- 4.7 Mute/deafen state lifted to the hook so the `CallControls` UI reflects it; `setMuted`/`setDeafened` proxy to `PeerCall`.
- **Done:** the hook owns the full call lifecycle; caller and callee paths both reach `connected` with two-way audio; mute/deafen/leave round-trip; teardown is wired into logout + window close.

## 5. Call UI (`src/components/call/`) + DM-thread integration (Decisions D6, D11, D12)
- 5.1 `IncomingCallToast.tsx`: bottom-right fixed-position toast; caller avatar + display name (from `listIncomingCalls` join) + "is calling you…" + Accept (phone icon) / Decline buttons; auto-hide when the call doc transitions out of `calling` (accepted/rejected/missed/ended). Light Tailwind styling (Phase 7 owns polish).
- 5.2 `CallControls.tsx`: in-call bar (mute toggle, deafen toggle, leave button, live `mm:ss` timer, peer avatar + name, "Connected" / "Connecting…" state). **Decision D12**: rendered as a floating bar in `AuthenticatedLayout` over the main pane, independent of the active DM. User can browse DMs mid-call. Hosts the hidden `<audio autoplay>` element whose `srcObject` the hook sets on `onRemoteStream`.
- 5.3 `DMThread.tsx`: add a call button (phone icon) in the thread header next to the peer name; clicking it calls a `startCallWithPeer(peerUserId)` prop from `AuthenticatedLayout`. **Decision D11**: disable the button when `peer.online === false` (peer offline) or when a call with this peer is already active.
- 5.4 `AuthenticatedLayout.tsx`: instantiate `useCall(presence.userId)`; subscribe to `listIncomingCalls`; render `<IncomingCallToast>` when a doc arrives (Decision D11: hide the toast if `useCall.status !== idle` and auto-reject); render `<CallControls>` as a floating overlay when a call is active (Decision D12); pass `startCallWithPeer` callback to `DMThread`. Ensure the active call is torn down on logout + on the Tauri `onCloseRequested` (extend the existing Phase-3 hook). **Critical teardown ordering**: insert `await useCall.leave()` BEFORE `await presence.goOffline()` in both `handleLogout` and `onCloseRequested` so the PC + `getUserMedia` release before the Convex client tears down.
- 5.5 No OS notification wiring (Decision D6 — in-app toast only for Phase 4). No device picker, no video, no call history UI. No ring tone (mission: pared-down; silent toast for v1).
- **Done:** a user can click call from a DM (gated on peer online), the callee sees the toast (or auto-reject if busy), both see the floating in-call controls, and mute/deafen/leave work; the call tears down on logout + window close.

## 6. Build + merge readiness
- 6.1 `bun run lint` + `bun run typecheck` — clean.
- 6.2 `bun tauri build` → release binary produced.
- 6.3 Walk the manual smokes in `validation.md`: A→B call + accept + two-way audio; mute/deafen round-trip; either-side leave; reject path; coturn TURN fallback across NAT (if a strict-NAT test client is available).
- 6.4 Update **all three** (gap: README/roadmap/AGENTS out of sync): `README.md` Phase 4 notes (`calls` table, the Convex-as-signaling choice, the coturn setup + `VITE_ICE_SERVERS` env, the raw-WebRTC stance, the static-credential v1 limitation from Decision D5, the public-mutation v1 limitation from Decision D7, the deferred OS notifications, the Windows-only platform scope from Decision D9); `specs/roadmap.md` Phase 4 STATUS marker; `AGENTS.md` phase status line (currently stale — says only 0/1 complete). Record a Phase 4 complete marker in `specs/roadmap.md` style with Phase 0/1/2/3's precedent.
- **Done:** all validation in `validation.md` passes; phase ready to merge.

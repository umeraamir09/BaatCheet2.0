# Phase 8 — Post-production 0.1.0 fixes: Requirements

Feature dir: `specs/2026-07-10-post-production-0-1-0-fixes/`
Roadmap phase: **Phase 8 — Post-production 0.1.0 fixes** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` · Stack ref: `specs/tech-stack.md`
Builds on: `specs/2026-07-09-theme-performance-updater/` (Phase 7 — the Discord-derived UI, keybind settings, global-shortcut plugin wiring, and updater work currently present on the Phase 7 implementation tip; Phase 7's manual performance/updater evidence remains separate and is not marked complete by this phase).

## Goal
Phase 8 is a release-blocker hardening pass for the existing 0.1.0 feature set. It fixes five failures seen in normal desktop use: auth restoration that behaves like logout after restart, unreliable voice hotkeys, a cramped default window, missing message actions, and a 1:1 call surface that blocks the rest of the app and omits participant state. The phase is complete only when the installed Windows app demonstrates these behaviors across real restarts, background focus changes, and two-client realtime smokes.

## In scope
- Diagnose the cold-start auth path end to end: OS keychain read, stored-session deserialization/migration, expiry decision, refresh-token exchange, cached-profile restore, frontend `loading`/`success` state, and any close/reopen race. Add safe diagnostics and regression coverage at the boundary that actually fails.
- Preserve a recoverable keychain session across normal window close and process exit. Explicit logout and a confirmed invalid/revoked refresh token may clear the session; transient keychain, network, Discord profile, or Convex failures must surface as retryable restore errors rather than silently becoming logged out (Decision D4).
- Make mute/deafen settings drive one stable native `tauri-plugin-global-shortcut` registration lifecycle. Shortcuts must work while the window is unfocused, minimized, or behind another app/game; re-renders, settings edits, call transitions, and switching between 1:1 and group voice must not randomly unregister them (Decision D5).
- Show actionable shortcut registration/conflict failures in settings and retain a focused-window fallback for development or an explicit native registration failure. A fallback must never be reported as successful background coverage.
- Change the main window default to `1280x800` with a `960x640` minimum, while retaining normal user resizing and maximizing (Decision D6).
- Add author-only hard deletion for DM and lobby messages. Delete the message document, its reaction documents, stored image attachments owned by that message, and associated preview data; update conversation recency/preview state from the newest remaining message where applicable (Decision D1).
- Add author-only text editing during the first 15 minutes after `createdAt`. Preserve attachments, set `editedAt`, regenerate or clear link preview state when the body URL changes, and render an `edited` tag without changing the message's original ordering timestamp (Decision D2).
- When the current conversation composer is empty and not already editing, Up Arrow loads the newest message sent by the current user if it is still inside the 15-minute edit window. Enter saves, Escape cancels, and normal typing/attachment/GIF flows remain unchanged (Decision D2).
- Add Discord-style emoji reactions to DM and lobby messages: any participant can toggle a given emoji once per message and can react with multiple distinct emoji; aggregate counts and reacted-by-me state update reactively for both clients (Decision D3).
- Add message-row hover/focus actions for Edit, Delete, and Add Reaction with accessible names, keyboard reachability, destructive confirmation where appropriate, and clear expired/not-authorized feedback.
- Replace the fixed full-screen 1:1 call overlay with a compact call panel embedded only in the matching peer's DM by default. The call must continue without overlaying or blocking the lobby, other DMs, settings, or messaging (Decision D7).
- Add a local full-screen toggle for the active matching-DM call panel. Entering/leaving full screen changes presentation only, never the underlying WebRTC call, and every new call begins compact (Decision D7).
- Expose and render local/remote speaking state, mute state, and deafen state for 1:1 participants. Speaking rings come from local/remote audio activity; mute/deafen state is synchronized through the existing call document so each client sees accurate participant icons (Decision D8).
- Expand focused automated coverage for auth restore decisions, shortcut registration lifecycle, message mutation rules, reaction toggles, composer Up Arrow editing, and 1:1 call presentation/indicator state. Keep all prior Phase 1-7 tests green.

## Out of scope (deferred — explicitly NOT Phase 8)
- Message moderation, deleting another user's messages, roles/permissions, audit logs, bulk delete, pins, threads, replies, or message history recovery — not in v1.
- Editing attachments, replacing uploaded images/GIFs during an edit, or restoring a hard-deleted message — not in v1.
- Custom reaction management, server emoji, reaction notifications, or a new emoji source — reuse the existing emoji picker/data.
- Persisting or synchronizing compact/full-screen call presentation across devices or calls — presentation state is local and resets to compact for every call.
- Video, screen share, push-to-talk, call recording, or a group-voice layout redesign — not part of this defect phase.
- Production updater hosting/signing completion and Phase 7's formal game-load performance evidence — remain Phase 7 validation work.
- Replacing Discord OAuth, Convex, direct WebRTC, LiveKit, or the trusted-friend-group v1 authorization model.

## Decisions (locked for this phase)
- **D1 — Hard-delete authored messages.** Deletion removes the message instead of leaving a tombstone. Dependent reaction rows, stored image objects, and message-owned preview state are cleaned up, and conversation recency is reconciled so deleted content does not remain as a stale DM preview.
- **D2 — Fifteen-minute text-edit window with Up Arrow recall.** Only the sender may edit the body, and only while `Date.now() <= createdAt + 15 minutes`; the server enforces the window, not only the UI. An empty composer can use Up Arrow to recall the newest eligible sent message in that conversation, matching the requested Discord interaction; `editedAt` drives the visible edited tag.
- **D3 — Discord-style multi-emoji reactions.** A user may toggle one instance of a particular emoji on a message and may add multiple different emoji to that message. The UI aggregates counts, highlights reactions from the current user, and updates reactively in both DMs and the lobby.
- **D4 — Recoverable session failures are not logout.** The OS keychain remains the token authority. Only explicit logout, missing credentials, or a confirmed invalid/revoked refresh token returns the app to login; transient startup/profile/network/Convex errors preserve credentials and offer retry with diagnostic context.
- **D5 — Native global shortcuts with stable ownership.** Mute/deafen bindings are registered through Tauri once per effective preference set and dispatch into the latest active voice callbacks without re-registering on routine React state changes. Native background behavior is an acceptance gate; focused keyboard listeners are only a development/error fallback.
- **D6 — Roomier Windows defaults.** The main window opens at `1280x800` with `960x640` minimum dimensions. These values provide breathing room for the icon rail, presence/DM sidebar, chat, and compact call panel without forcing a maximized window.
- **D7 — Compact matching-DM call view by default.** A 1:1 call is not a global blocking overlay. Its compact controls appear in the matching person's DM, the call continues while the user navigates elsewhere, and the matching DM offers an explicit full-screen presentation toggle that resets to compact for each call.
- **D8 — Measured speaking plus synchronized media-state indicators.** Local and remote speaking rings derive from WebRTC audio activity with smoothing to avoid flicker. Mute/deafen state is added to the call signaling document and updated only on state changes, not at audio-frame frequency.

## Context
- `specs/mission.md` — the product must make the three core loops effortless and remain lightweight beside a game; background voice controls and non-blocking calls are part of making those loops usable in real desktop conditions.
- `specs/tech-stack.md` — Discord PKCE + OS keychain remain the auth/session design; Tauri supplies native global shortcuts/window behavior; Convex supplies reactive messages/reactions/call state; direct WebRTC supplies 1:1 audio.
- `specs/roadmap.md` Phase 7 — introduced the Discord-derived UI and keybind settings, but its spec explicitly deferred global system-wide shortcuts; the current code now includes the plugin and a registration attempt that must be made lifecycle-stable and proven in the background.
- `specs/roadmap.md` Phase 8 DoD: *an installed build survives repeated close/reopen without re-login; mute/deafen shortcuts work repeatedly while the app is in the background; the larger default window opens correctly; two clients can edit/delete/react live with the locked rules; and an active 1:1 call no longer blocks messaging/navigation while compact/full-screen views and participant indicators remain accurate.*
- Current auth state — `src-tauri/src/auth/store.rs` persists access token, refresh token, expiry, client ID, and cached user in the OS keychain; `session.rs::get_current_session` restores/refreshes them; `src/hooks/useAuth.ts` invokes that command on mount. Phase 8 must instrument and fix the actual failing boundary rather than replace this architecture.
- Current shortcut state — `src/hooks/useVoiceKeybinds.ts` registers native shortcuts inside an effect whose dependencies include changing voice callbacks/state and conditionally unregisters them during cleanup. This lifecycle is a prime suspect for intermittent registration loss and must be covered by tests plus real background smokes.
- Current message state — `convex/messages.ts` exposes send/list only, and `convex/schema.ts` has no `editedAt` field or reaction table. Both DM and lobby threads share `useChatThread` and `MessageBubble`, so the new actions must remain shared rather than forked per surface.
- Current call state — `CallControls.tsx` is `fixed inset-0`, so every active 1:1 call blocks the app. `useCall.ts` exposes only local mute/deafen booleans and no speaking values; Phase 8 extends this shared state contract and the Convex `calls` document.
- Current window state — `src-tauri/tauri.conf.json` opens the main window at `800x600`, below the comfortable size of the final multi-pane UI.

## User-performed prerequisites (not agent-executable)
- Two Discord accounts/clients that can exchange DMs, reactions, and 1:1 calls against the same Convex deployment.
- A Windows installed/release build so persistence can be tested across real process exits and native shortcuts can be tested while another foreground application or game owns focus.
- Permission to register the selected global shortcuts in Windows; any conflicting application binding must be available to reproduce and verify conflict feedback.

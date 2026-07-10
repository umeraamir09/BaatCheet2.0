# Phase 8 — Post-production 0.1.0 fixes: Validation

How to know the implementation succeeded and can be merged. Per Decisions D1-D8, merge requires **automated gates green AND installed-build/two-client manual evidence for session persistence, native background shortcuts, message actions, and non-blocking 1:1 calls**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 — inherited.
- [ ] `bun run typecheck` exits 0 — inherited.
- [ ] `bun run test` exits 0 — existing Phase 3-7 coverage plus new auth/shortcut/message/call tests.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 — auth store/session tests included.
- [ ] `bunx convex codegen` exits 0 after the message/call schema changes; `convex/_generated/` remains ignored.
- [ ] `bun tauri build` compiles and bundles a Windows release binary. If updater signing is unavailable, record that external prerequisite separately and do not describe the full signed updater build as green.
- [ ] Auth restore tests prove retryable keychain/network/profile/Convex failures do not clear stored credentials; explicit logout and confirmed invalid/revoked refresh do.
- [ ] Shortcut tests prove effective bindings are not re-registered on routine call/group-voice state changes and are unregistered only on replacement or teardown.
- [ ] Message mutation tests cover author-only edit/delete, the exact 15-minute server boundary, hard-delete reaction/storage cleanup, link-preview reconciliation, and Discord-style reaction toggles.
- [ ] Component tests cover empty-composer Up Arrow recall, Enter save, Escape cancel, edited tag, reaction rendering, default compact call view, full-screen toggle, and cross-navigation call continuity.
- [ ] `git grep -iE "client_secret|clientSecret"` returns nothing; no access token, refresh token, updater private key, or real credential is committed/logged.

## Manual smoke 1 — Installed-build session survives close/reopen (Decision D4)
1. Install/launch the Windows release build, complete Discord OAuth once, and verify the authenticated shell plus avatar.
2. Close the window normally, confirm the process exits, then reopen the app five times. Include one reopen after a Windows sign-out/restart if practical.
3. Verify every reopen restores the same user without opening Discord consent and without flashing a usable login button before restore completes.
4. Disconnect networking before one reopen. Verify the app preserves the stored session, presents a retryable restore state, and restores after networking returns without new consent.
5. Use explicit Logout, close, and reopen. Verify this path alone returns to login.
- [ ] Pass: normal/retryable reopen paths never require re-login or erase credentials; explicit logout does.

## Manual smoke 2 — Native mute/deafen shortcuts remain global (Decision D5)
1. Configure distinct mute and deafen bindings in settings and confirm native registration success is visible.
2. Join a 1:1 call, focus another application/game, and toggle mute/deafen at least 20 times across minimize/restore cycles. Confirm UI/media state follows every press.
3. Leave 1:1, join group voice, keep another application focused, and repeat the 20-toggle/minimize/restore sequence.
4. Edit each keybind in settings, cancel one capture with Escape, save another binding, and repeat background toggles without restarting.
5. Attempt a binding already owned by another application. Verify BaatCheet reports the conflict and does not claim background support; after choosing a free binding, global behavior recovers.
- [ ] Pass: shortcuts work repeatedly while BaatCheet is unfocused/minimized in both voice paths and do not randomly stop after state/settings changes.

## Manual smoke 3 — Default and minimum window geometry (Decision D6)
1. Launch the app with no previously maximized window state influencing startup.
2. Verify the main window opens at `1280x800` on a display that can accommodate it.
3. Resize downward and verify the window stops at `960x640`; maximize/restore and verify the UI remains usable.
- [ ] Pass: the app opens with visibly more breathing room and cannot be resized below the supported three-pane layout.

## Manual smoke 4 — Edit, Up Arrow, hard delete + edited tag (Decisions D1, D2)
1. With two clients in a DM, send several text and rich messages from client A.
2. On A, focus an empty composer and press Up Arrow. Verify the newest eligible message enters edit mode; Escape cancels without changing it.
3. Repeat Up Arrow, change the body, and press Enter. Verify both clients update live, retain original ordering, and show `edited`.
4. Verify Up Arrow does not hijack a non-empty composer or select a message older than 15 minutes. Attempt an edit at/after expiry and verify the server rejects it even if the UI was stale.
5. Delete an authored text message and an authored image message. Confirm both disappear completely on both clients, image storage/reactions are cleaned up, and the DM list preview/recency no longer references deleted content.
6. Confirm client B cannot edit or delete client A's message through visible actions or a direct mutation call using B's real user ID.
7. Repeat edit/delete in the lobby.
- [ ] Pass: author-only editing/deletion follows the 15-minute/hard-delete rules reactively in both conversation types, including Up Arrow behavior and cleanup.

## Manual smoke 5 — Discord-style emoji reactions (Decision D3)
1. In a DM, client A reacts to one message with two different emoji. Verify both counts appear and A's reactions are highlighted.
2. Client B adds one matching emoji and one different emoji. Verify aggregate counts and per-user highlighting update live on both clients.
3. Client A toggles one matching emoji off. Verify only A's instance is removed and the remaining count persists.
4. Reload/reopen both clients and verify reaction state remains accurate.
5. Repeat on a lobby message, then delete that message and verify dependent reaction rows disappear.
- [ ] Pass: users can toggle multiple distinct emoji, duplicates per user+emoji are prevented, aggregates are reactive, and deletion cleans reactions.

## Manual smoke 6 — 1:1 call stays usable during messaging/navigation (Decision D7)
1. Start and accept a 1:1 call from a DM. Verify the call begins in the compact matching-DM view, not a global full-screen overlay.
2. Send/receive messages in the same DM while connected.
3. Navigate to another DM, the lobby, and settings. Verify all are usable, no call overlay blocks them, audio continues, and call controls are not incorrectly embedded in the unrelated surface.
4. Return to the matching DM and verify compact controls/state are still present.
5. Toggle full screen on and off repeatedly. Verify it changes presentation only and never restarts, renegotiates, or detaches audio.
6. End the call from compact and full-screen states in separate runs.
- [ ] Pass: the call continues across navigation, messaging remains available, matching-DM compact UI is the default, and full screen is a safe local toggle.

## Manual smoke 7 — Speaking rings + mute/deafen indicators (Decision D8)
1. Connect a 1:1 call with two clients and keep both initially unmuted/undeafened.
2. Speak from A, then B, then overlap. Verify the corresponding local/remote green rings appear promptly and decay without persistent flicker.
3. Toggle mute on A from UI and then from the background hotkey. Verify A and B both show A's mute icon and A no longer produces a speaking ring.
4. Toggle deafen on each side. Verify the local semantics and remote participant badges remain accurate through compact/full-screen changes and navigation away/back.
5. Leave/reconnect and verify stale speaking/mute/deafen state does not leak into the next call.
- [ ] Pass: both clients see accurate speaking rings and media-state indicators for both participants throughout the call lifecycle.

## Repo hygiene + Phase-8-specific checks
- [ ] Existing user changes in `src-tauri/src/lib.rs` and `src-tauri/tauri.conf.json` are preserved/reconciled intentionally; no unrelated work is discarded.
- [ ] Keychain tokens remain encrypted in the OS credential store; no localStorage/plaintext auth fallback is introduced.
- [ ] Restore diagnostics redact access/refresh tokens and distinguish retryable failure from revoked/no-session outcomes.
- [ ] Native shortcut registration has one clear owner and observable success/error state; focused fallback is not misrepresented as global.
- [ ] Window config contains `width: 1280`, `height: 800`, `minWidth: 960`, and `minHeight: 640` for the main window.
- [ ] `messages.editedAt` is optional/backward-compatible; existing messages still render.
- [ ] Reaction indexes support message aggregation and user+emoji toggle integrity without scans across unrelated conversations.
- [ ] Hard delete cleans reaction rows and stored image attachments; deleted text does not survive in conversation preview state.
- [ ] The edit window is enforced in Convex using `createdAt`, while `editedAt` never reorders history.
- [ ] Up Arrow editing is scoped to an empty composer/current conversation/current user/newest eligible message and does not break normal caret movement.
- [ ] 1:1 call presentation state is local; signaling/media teardown remains owned by `useCall` and is not duplicated by compact/full-screen components.
- [ ] Speaking detection does not write audio activity frames to Convex; only mute/deafen state transitions are synchronized.
- [ ] Existing rich messaging, presence, group voice, updater, and explicit logout behavior remain covered.
- [ ] `counter` and unrelated scaffold remnants are untouched.

## Explicitly NOT validated here (out of scope — later phases)
- ~~Message recovery/tombstones, moderation deletes, audit history, bulk delete, pins, threads, or replies~~ → not in v1.
- ~~Editing/replacing attachments or restoring deleted storage objects~~ → not in v1.
- ~~Custom/server emoji, reaction notifications, or reaction moderation~~ → not in v1.
- ~~Video, screen share, push-to-talk, recording, or group-voice redesign~~ → later roadmap/not in v1.
- ~~Persisted compact/full-screen preference across calls/devices~~ → not in v1.
- ~~Phase 7 production updater handoff and formal game-load performance evidence~~ → remains Phase 7 validation.
- ~~Full hostile-client authorization hardening beyond the existing trusted friend-group model~~ → later security phase if the deployment audience expands.

## Merge criteria
All automated gates green + manual smokes 1-7 passing + repo-hygiene and Phase-8-specific checks box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-8 DoD from `specs/roadmap.md` is satisfied when smoke 1 proves persistent reopen, smoke 2 proves background native shortcuts, smoke 3 proves window geometry, smokes 4-5 prove realtime message actions, and smokes 6-7 prove non-blocking 1:1 call presentation plus accurate participant indicators.

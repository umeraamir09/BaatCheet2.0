# Phase 8 — Post-production 0.1.0 fixes: Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0-7 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regenerate via `bunx convex codegen` after schema/function changes). Branch: `post-production-0.1.0-fixes`, off the current Phase-7 implementation tip with existing user changes preserved.

## 1. Reproduce failures + establish regression seams
- 1.1 Capture the exact cold-start result for keychain load, session deserialization, expiry/refresh, cached-profile restore, frontend auth state, and Convex user upsert without logging tokens or secrets.
- 1.2 Reproduce shortcut failure across initial registration, settings edits, React re-renders, starting/ending each voice mode, minimizing, and foreground-app changes. Record registration conflicts separately from lifecycle unregistration.
- 1.3 Record the current `800x600` startup geometry, blocking `fixed inset-0` call behavior, and absence of remote media-state/speaking data.
- 1.4 Add failing focused tests where practical before changing behavior: session result classification, shortcut registration ownership, message authorization/edit expiry/reaction toggle, composer Up Arrow selection, and call view state.
- **Done:** every reported defect has a concrete failing boundary and a regression seam; no speculative architecture replacement is needed.

## 2. Persistent session restoration (Decision D4)
- 2.1 Refactor the Rust cold-start restore command to return explicit outcomes for restored, no stored session, revoked/invalid refresh, and retryable storage/network/profile failure. Never collapse retryable errors into logged-out state.
- 2.2 Keep the cached verified Discord profile usable when the token is valid or successfully refreshed; do not require Convex or Discord profile availability merely to render the restored authenticated shell.
- 2.3 Preserve keychain credentials on retryable failure. Clear them only on explicit logout or confirmed invalid/revoked authorization, and ensure normal window teardown never invokes logout/clear.
- 2.4 Make frontend auth startup idempotent under React development behavior and event-listener timing. Expose a retry action/error state without opening a second OAuth flow automatically.
- 2.5 Add Rust/frontend tests for legacy stored sessions, valid cached sessions, near-expiry refresh, rotated refresh-token persistence, retryable failure, revoked token, explicit logout, and repeated restore invocation.
- **Done:** closing and reopening the installed app repeatedly restores the same user without consent; recoverable failures retain the session and can retry.

## 3. Native voice shortcuts + startup window geometry (Decisions D5, D6)
- 3.1 Separate global shortcut registration from changing call/group-voice state. Store the latest toggle handlers in refs or a stable dispatch layer so routine renders do not unregister/re-register native bindings.
- 3.2 Register each effective binding exactly once, handle preference changes transactionally, reject duplicates, and unregister only replaced bindings or during actual app teardown.
- 3.3 Surface native registration/conflict status in settings. Keep a focused-window fallback for browser development/explicit failure, but label background support unavailable until native registration succeeds.
- 3.4 Verify shortcut dispatch targets the currently active 1:1 or group voice path and does nothing when no voice path is active. Settings capture must temporarily suspend conflicting dispatch without permanently losing registration.
- 3.5 Change the Tauri main-window defaults to `1280x800`, add `minWidth: 960` and `minHeight: 640`, and verify resize/maximize behavior.
- 3.6 Add unit/integration coverage for stable registration counts, preference replacement, cleanup, capture mode, background event dispatch, and voice-path switching.
- **Done:** mute/deafen work repeatedly with BaatCheet unfocused or minimized, registration failures are visible, and the app opens at the roomier geometry.

## 4. Message action data model + Convex rules (Decisions D1-D3)
- 4.1 Add optional `editedAt` to `messages` and add a `messageReactions` table keyed/indexed for message lookup and unique message+user+emoji toggle semantics.
- 4.2 Implement `editMessage`: validate sender ownership, enforce the 15-minute server-side window, validate the 4000-character/non-empty body contract, patch `editedAt`, and reconcile scheduled/stored link-preview state while preserving attachments and `createdAt`.
- 4.3 Implement `deleteMessage`: validate sender ownership, collect/delete message reactions, delete owned Convex image-storage objects, delete the message, and recompute the conversation's newest-message recency/preview source without exposing deleted content.
- 4.4 Implement reaction toggle/list behavior with normalized emoji keys, one row per user+emoji+message, multiple different emoji per user, aggregate counts, and current-user reacted state.
- 4.5 Return `editedAt` and reaction aggregates from the reactive message query without introducing avoidable per-message scans; use indexes/batched lookup across the current conversation.
- 4.6 Regenerate Convex types and add focused tests/contract checks for ownership, expiry boundary, hard-delete cleanup, duplicate toggle idempotence, aggregation, and DM/lobby parity.
- **Done:** the backend enforces all locked message rules and both clients receive reactive edit/delete/reaction changes.

## 5. Shared message actions + Up Arrow editing UX (Decisions D1-D3)
- 5.1 Extend `useChatThread` with edit, delete, and reaction operations shared by DMs and the lobby; expose pending/error state without duplicating mutations in thread components.
- 5.2 Add accessible hover/focus actions to `MessageBubble`: Edit and Delete only for the author when allowed, Add Reaction for participants, reacted-by-me styling, counts, and a compact emoji picker using the existing emoji data.
- 5.3 Add composer edit mode with original-message context, Save/Cancel affordances, Enter-to-save, Escape-to-cancel, expiry handling, and protection against mixing edits with pending image/GIF attachments.
- 5.4 When the composer is empty and idle, handle Up Arrow by selecting the newest current-user message in the current conversation whose eligibility is still within 15 minutes. Do not hijack Up Arrow while text/caret navigation, picker interaction, or edit mode is active.
- 5.5 Render the `edited` tag from `editedAt`; remove hard-deleted messages immediately through the reactive query and keep grouping/timestamps correct.
- 5.6 Add component/hook tests for keyboard recall, exact 15-minute boundary, Escape, Enter, author visibility, confirmation, expired server rejection, reaction toggle, and rich-message regression.
- **Done:** DM and lobby users can edit/delete/react with the locked rules, and Up Arrow reliably enters edit mode for the newest eligible sent message.

## 6. Non-blocking 1:1 call UI + participant indicators (Decisions D7, D8)
- 6.1 Move call presentation state into `AuthenticatedLayout`: default compact for every new call, embed the panel only when the matching peer DM is active, and render no blocking overlay while another DM/lobby/settings surface is open.
- 6.2 Add a full-screen toggle to the matching-DM call panel. Preserve one audio element/WebRTC session across compact/full-screen changes and navigation so presentation changes cannot restart or detach the call.
- 6.3 Extend the Convex `calls` document and mutations with caller/callee mute and deafen state. Patch only on changes, initialize explicit defaults, and expose the peer state through `useCall`.
- 6.4 Add local and remote Web Audio activity detection around the existing media streams. Apply thresholding/decay to expose stable `localSpeaking` and `remoteSpeaking` values without Convex writes per frame.
- 6.5 Render green speaking rings and mute/deafen badges for both avatars in compact and full-screen modes. Ensure deafen semantics imply local mute and remote clients see the resulting state accurately.
- 6.6 Keep incoming-call toast, leave behavior, background shortcuts, teardown ordering, and group/1:1 mutual exclusivity intact.
- 6.7 Add hook/component tests for default compact state, local full-screen toggle, cross-navigation continuity, matching-DM visibility, media indicators, signaling updates, and audio-element stability.
- **Done:** a 1:1 call never blocks app navigation or messaging; compact/full-screen presentation works locally and both participant indicators are accurate.

## 7. Regression, documentation + release evidence
- 7.1 Run formatting, lint, typecheck, frontend tests, Rust tests, Convex codegen, and release build gates.
- 7.2 Walk the manual smokes in `validation.md`: session reopen, background shortcuts, default window, message actions, call navigation/full-screen, and speaking/media-state indicators.
- 7.3 Re-run Phase 1-7 core regressions: explicit logout, presence, DM/lobby rich messaging, 1:1 signaling/audio, group voice, settings, and updater startup.
- 7.4 Update `README.md` and `AGENTS.md` only after implementation/validation. Mark Phase 8 complete in `specs/roadmap.md` only when all release evidence passes; do not use Phase 8 to mark Phase 7's separate performance/updater evidence complete.
- **Done:** release evidence distinguishes automated results from user-run installed-build/two-client proof and all affected docs match the checkout.

## 8. Build + merge readiness
- 8.1 `bun run format` leaves no unintended formatting diff.
- 8.2 `bun run lint` + `bun run typecheck` — clean.
- 8.3 `bun run test` — existing and new frontend tests pass.
- 8.4 `cargo test --manifest-path src-tauri/Cargo.toml` — Rust auth tests pass.
- 8.5 `bunx convex codegen` succeeds and generated files remain ignored.
- 8.6 `bun tauri build` → signed/release binary produced, or any user-owned updater-signing prerequisite is reported separately with the unsigned compile/bundle boundary recorded honestly.
- 8.7 Walk manual smokes 1-7 in `validation.md` with an installed Windows build and two clients.
- **Done:** all Phase 8 validation passes and the branch is ready for review/merge.

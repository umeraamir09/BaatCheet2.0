# Phase 7 - Theme pass + performance profiling: Requirements

Feature dir: `specs/2026-07-09-theme-performance-updater/`
Roadmap phase: **Phase 7 - Theme pass + performance profiling** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` / Stack ref: `specs/tech-stack.md`
Builds on: `specs/2026-07-09-hangout-lobby-voice-livekit/` (Phase 6 - the full lobby voice/text centerpiece, mutual voice exclusivity, teardown ordering, and the remaining "formal profiling is Phase 7" deferral).

## Goal
Phase 7 turns the completed MVP feature set into something ready to judge as a lightweight desktop app: sensible to use, visually coherent, measured under the mission's gaming-load constraint, and able to receive a test patch through Tauri's updater path. The roadmap DoD is not "more chat features"; it is proof that the Tauri shell choice pays off, voice remains stable while the machine is under game load, and the updater can ship patches without a manual redownload. This phase also upgrades the UI layout from "feature-complete" to "usable daily friend-chat app," using Discord as the interaction reference for message rows, call controls, icon buttons, and voice keybind settings.

## In scope
- Apply a Discord-derived UI/layout redesign across the existing app surfaces (Decision D1): auth shell, icon rail, presence sidebar, DM/lobby threads, composer/rich content, 1:1 call overlay, group voice stage, and settings. Keep the product's pared-down one-group scope, but make the layout more sensible and familiar for what it is.
- Redesign message display to follow Discord-like chat rows: avatar column, display name + timestamp on the header line, message body below, compact spacing between grouped messages, and rich attachments/previews aligned to the message content column.
- Redesign the 1:1 call UI to follow Discord-like call controls: centered participant avatars, bottom control tray, separate mic/deafen controls, icon-only action buttons with tooltips/accessible labels, and a distinct red hang-up button.
- Prefer icons on buttons instead of visible text where the action is familiar: mute, deafen, leave, call, upload image, emoji, GIF, settings, collapse, navigation, and send-adjacent controls. Keep text only where it clarifies unfamiliar or destructive actions.
- Add a settings menu/surface with keybind configuration for mute and deafen (Decision D6), including current binding display, edit mode, clear/delete action, enable/disable toggle, and persistence.
- Replace scattered one-off dark colors with a small shared token set in `src/index.css`, then use those tokens consistently in Tailwind classes (Decision D1).
- Improve layout density, spacing, hover/focus states, selected states, empty/loading/error states, and small-screen resilience without changing the Phase 2-6 feature behavior.
- Add a repeatable Windows performance evidence workflow (Decision D2) that records idle CPU/RAM, voice CPU/RAM, and voice-under-game-load observations in a repo doc.
- Validate voice under load with the existing Phase 4/6 voice paths: 1:1 direct WebRTC and group LiveKit voice must not stutter during the profiling smoke.
- Wire Tauri updater configuration for a local/static test update manifest and document the production handoff boundary (Decision D3).
- Preserve all Phase 1-6 auth, presence, DM, rich messaging, 1:1 voice, lobby text, and group voice behavior. Phase 7 may add settings/keybind UI, but it must not add new chat/voice product capabilities beyond mute/deafen keybind control.

## Out of scope (deferred - explicitly NOT Phase 7)
- New chat capabilities, moderation, roles, channels, bots, video, screen share, push-to-talk, voice recording, or offline push notifications - not in v1 unless already listed elsewhere.
- Production release hosting, production updater key custody, and public distribution automation - documented for handoff, but Phase 7 validates a local/static updater path (Decision D3).
- Cross-platform performance certification - Phase 7 validates Windows/WebView2, matching the current development and smoke-test target.
- Replacing the LiveKit architecture, Convex schema, or Discord OAuth identity model. The app shell may be reorganized for usability, but it must preserve the one-group lobby + DMs product model.
- Automated game benchmarking harnesses or synthetic audio-quality scoring. The game-load condition is user-controlled and is captured through a repeatable manual evidence template (Decision D2).

## Decisions (locked for this phase)
- **D1 - UI/layout redesign for usability, not just color polish.** Phase 7 makes the app feel sensible for daily friend-chat use, using Discord as the reference for chat rows, call controls, voice controls, icon buttons, spacing, and settings affordances. The redesign can reorganize component layout where needed, but it must preserve the one-group lobby + DMs product model and completed Phase 1-6 behavior.
- **D2 - Manual Windows performance evidence doc.** Performance proof is recorded through a repeatable manual workflow using Windows Task Manager/Resource Monitor (or equivalent) plus a game-running voice smoke. This matches the mission's real constraint better than synthetic-only scripts, while keeping the evidence concrete enough to compare later.
- **D3 - Local/static updater smoke, not production release infra.** Phase 7 wires Tauri updater config and proves the update flow against a local or static test manifest. Production signing-key custody, release hosting, and public rollout are documented as handoff items so the DoD can pass without pretending production distribution is complete.
- **D4 - No product data/schema changes.** Theme, profiling evidence, and updater configuration do not require Convex schema changes or new backend tables. Existing Phase 2-6 realtime behavior remains the regression surface.
- **D5 - Windows-only validation.** The current app and previous voice phases are validated on Windows/WebView2. Phase 7 records Windows performance and updater evidence only; macOS/Linux signing, permissions, and updater packaging are deferred.
- **D6 - Settings menu owns mute/deafen keybinds.** Phase 7 adds a settings surface for configurable mute and deafen hotkeys. The UI mirrors the provided keybind reference: action label, current keybind, edit button, clear/delete control, and enable/disable toggle. Keybinds should work for both 1:1 and group voice when the app is focused, persist locally as user preferences, and never store secrets.

## Context
- `specs/mission.md` - the hard constraint is explicit: the app must sit idle at low CPU/RAM while a game is running, and voice must not stutter or spike CPU. Phase 7 is where that is measured and recorded.
- `specs/tech-stack.md` - Tauri was chosen over Electron because shell footprint is the biggest lever for the "do not touch my FPS" requirement. The updater row names Tauri's built-in updater as the patch-delivery mechanism.
- `specs/roadmap.md` Phase 6 - completed the group voice half of the centerpiece and explicitly deferred formal idle CPU/RAM profiling plus under-load audio measurement to Phase 7.
- `specs/roadmap.md` Phase 7 DoD: *idle footprint measured and recorded; no audio stutter under gaming load; updater pushes a test patch successfully.*
- Current codebase state - `src/index.css` contains only a small black/blurple token set; component files already use Tailwind classes across auth, sidebar, chat, call, and voice surfaces. Phase 7 should consolidate the theme there rather than introduce a new styling library.
- Visual references from the user - Discord-like message row with avatar/name/timestamp/body; Discord-like 1:1 call screen with centered avatars and bottom icon control tray; Discord-like keybind settings row with action, keybind field, edit button, delete icon, and toggle.
- Current Tauri state - `src-tauri/tauri.conf.json` has product metadata, build config, bundle icons, and deep-link config, but no updater config yet. Phase 7 adds updater wiring and a local/static update validation path.
- Current tests - hook tests exist for `useCall` and `useGroupVoice`; Phase 7 should keep them green and add focused regression coverage only where behavior changes.

## User-performed prerequisites (not agent-executable)
- A Windows machine that can run the Tauri app, the target game, and at least one second client/account for voice smokes.
- A specific game/load scenario chosen by the user for profiling. The agent can provide the evidence template, but the user controls the real machine load.
- Access to a local/static location for the updater manifest and test artifact. Production release hosting and signing-key custody are handoff items, not Phase 7 completion blockers.

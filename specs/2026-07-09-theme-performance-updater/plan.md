# Phase 7 - Theme pass + performance profiling: Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0/1/2/3/4/5/6 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regen via `bunx convex dev` only after Convex changes). Branch: `phase-7/theme-performance-updater`, off the current Phase-6-complete tip.

## 1. Baseline audit + UI layout redesign map (Decisions D1, D4, D6)
- 1.1 Audit existing surfaces: `App.tsx`, `AuthenticatedLayout`, `IconRail`, `PresenceSidebar`, `DMThread`, `LobbyThread`, `chat/*`, `call/*`, and `voice/VoiceStage`.
- 1.2 Map the new Discord-like target layouts before editing: message row structure, 1:1 call screen/control tray, group voice panel, composer controls, icon rail/sidebar, and settings/keybind surface.
- 1.3 Expand `src/index.css` with a compact Discord-derived token set for background, surface, elevated surface, border, text, muted text, danger, success, warning, focus, and blurple states.
- 1.4 Replace obvious one-off black/gray/white opacity combinations with the shared tokens where it improves consistency. Do not introduce a new CSS framework or component library.
- 1.5 Add or reuse one consistent icon system for action buttons. Prefer icons for familiar controls and ensure every icon-only button has a tooltip/title and accessible label.
- **Done:** shared tokens exist; target layout map is clear; key surfaces are ready to be redesigned without changing the product model.

## 2. Discord-like chat, call, and voice UI redesign (Decision D1)
- 2.1 Auth and loading/error states: align spacing, text hierarchy, button styles, focus states, and app-logo presentation with the final dark theme.
- 2.2 Sidebar and icon rail: tighten selected/hover states, unread/active affordances if already present, collapsed-state polish, and keyboard focus visibility.
- 2.3 Message display: redesign `MessageBubble`/thread rendering into Discord-like rows with avatar on the left, display name + timestamp on the first line, message body beneath, grouped consecutive messages with compact spacing, and rich content aligned with the message column. Preserve image, GIF, emoji, and link preview behavior.
- 2.4 Composer and message actions: convert familiar text buttons to icon-first controls where practical (upload image, emoji, GIF, send-adjacent actions), with clear disabled/loading states and accessible labels.
- 2.5 1:1 call UI: redesign `CallControls` into a Discord-like call screen/overlay with centered participant avatars, a bottom control tray, icon-only mute/deafen/more controls, and a distinct red hang-up button. Keep Phase-4 call state behavior unchanged.
- 2.6 Group voice UI: align `VoiceStage` with the same voice-control language: roster rows, speaking indicator, mute/deafen/leave icons, and consistent control sizes. Keep the side-by-side lobby layout from Phase 6 unless the redesign finds a clearer arrangement that preserves text+voice together.
- 2.7 Responsive resilience: verify the app at the configured 800x600 Tauri window and a wider desktop size. Text must not overlap controls, and fixed-width panes must not crush the composer.
- **Done:** chat rows, 1:1 call UI, group voice UI, and icon-button interactions feel Discord-familiar while preserving completed Phase 1-6 behavior.

## 3. Settings menu + mute/deafen keybinds (Decision D6)
- 3.1 Add a settings entry point to the app shell, preferably an icon button in the user/sidebar area so it is reachable without crowding the chat header.
- 3.2 Create a settings view/modal with a "Keybinds" section. Include rows for "Toggle Mute" and "Toggle Deafen" with action label, current keybind display, edit keybind button, clear/delete icon, and enable/disable toggle.
- 3.3 Persist keybind preferences locally as non-secret user preferences. Use a stable key namespace and clear them on explicit reset/delete, not on logout unless the app already clears comparable UI preferences.
- 3.4 Implement focused-app hotkeys for mute/deafen that apply to whichever voice path is active: 1:1 `useCall` or group `useGroupVoice`. If no voice path is active, the keybind should not create a call or join voice.
- 3.5 Prevent unsafe keybind capture: ignore system-reserved shortcuts, Escape cancels edit mode, Backspace/Delete clears only when the row is in edit mode, and duplicate bindings are rejected or replaced with clear feedback.
- **Done:** users can set, edit, clear, enable, disable, and use mute/deafen keybinds from a settings surface; behavior works for both 1:1 and group voice while the app is focused.

## 4. Performance evidence workflow (Decisions D2, D5)
- 4.1 Add a repo doc under `docs/` for Phase 7 performance evidence with a table for scenario, timestamp, app build, machine notes, game/load used, idle CPU/RAM, voice CPU/RAM, under-load CPU/RAM, audio observations, and pass/fail notes.
- 4.2 Define the exact manual Windows measurement steps: launch release build, wait for idle stabilization, record Task Manager/Resource Monitor values, join 1:1 voice, join group voice, then repeat with the chosen game running.
- 4.3 Include guidance for recording "no audio stutter" evidence: participants, duration, voice path tested, symptoms checked, and whether the strict-NAT/coturn path was exercised.
- 4.4 Keep this as evidence collection, not a synthetic benchmark suite. Optional scripts may be added only if they supplement the manual evidence without replacing it.
- **Done:** a repeatable evidence doc exists and can be filled during manual smokes; it distinguishes idle, voice, and gaming-load observations.

## 5. Tauri updater local/static test path (Decision D3)
- 5.1 Add the Tauri updater plugin dependency/config needed for Tauri 2, following the current `src-tauri/tauri.conf.json` structure and package manager conventions.
- 5.2 Configure a local/static update endpoint or manifest path suitable for a test patch. Use placeholders for production URLs/keys where needed, with comments/docs that identify user-owned production values.
- 5.3 Add the minimal frontend/Rust invocation surface needed to check for and apply a test update, keeping it unobtrusive and developer-oriented if the production UX is not ready.
- 5.4 Document how to produce the test artifact, serve the manifest, run the installed older build, trigger the check, and confirm the patch is offered/applied.
- **Done:** the updater can push a test patch successfully through a local/static manifest path; production release infrastructure remains documented as a handoff item.

## 6. Regression and docs update
- 6.1 Keep `bun run lint`, `bun run typecheck`, and existing Vitest hook tests green.
- 6.2 Run `bun tauri build` and record the release build path plus bundle-size/footprint notes for the Phase 7 evidence doc.
- 6.3 Walk the manual smokes in `validation.md`: visual/layout pass, settings/keybind pass, idle footprint, 1:1 voice under load, group voice under load, updater test patch, and Phase 1-6 no-regression.
- 6.4 Update `README.md` with Phase 7 notes: final UI/layout posture, Discord-like references, settings/keybind behavior, performance evidence location, updater local/static validation, production updater handoff, and known limits.
- 6.5 Update `specs/roadmap.md` with a Phase 7 complete marker only after validation evidence exists. Update `AGENTS.md` status once Phase 7 is actually complete.
- **Done:** all validation in `validation.md` passes; Phase 7 is ready for review/merge.

## 7. Build + merge readiness
- 7.1 `bun run lint` + `bun run typecheck` - clean.
- 7.2 `bun test` - existing hook tests pass.
- 7.3 `bun tauri build` - release binary produced.
- 7.4 Manual smokes in `validation.md` are completed and evidence is recorded.
- 7.5 Confirm no Convex schema changes and no new product data model were introduced.
- **Done:** Phase 7 DoD is satisfied: idle footprint measured and recorded; no audio stutter under gaming load; updater pushes a test patch successfully.

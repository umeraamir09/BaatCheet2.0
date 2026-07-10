# Phase 7 - Theme pass + performance profiling: Validation

How to know the implementation succeeded and can be merged. Per Decisions D1-D6, merge requires **automated gates green AND manual evidence for UI/layout redesign, settings keybinds, performance, voice under load, and updater test patch**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors) - inherited from Phase 0-6.
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`) - inherited from Phase 0-6.
- [ ] `bun test` exits 0 - `useCall`, `useGroupVoice`, and existing infra tests remain green.
- [ ] `bun tauri build` completes and emits a release binary for Windows.
- [ ] No Convex schema change expected (Decision D4): `git diff convex/schema.ts` is empty.
- [ ] No credentials/tokens introduced into the tree: `git grep -iE "client[_-]?secret|refresh[_-]?token|access[_-]?token|LIVEKIT_API_SECRET"` returns only expected code identifiers, placeholders, or server-side env reads; no committed real secret values.
- [ ] No extra Discord scopes requested: `git grep -iE "scope.*email|scope.*guilds|scope.*presence"` returns nothing.
- [ ] Tauri updater config is present only with local/static test values or documented placeholders; no production signing key or private release secret is committed.
- [ ] Icon-only controls have accessible names: grep/review changed buttons for `aria-label`, `title`, or an equivalent tooltip label.
- [ ] Keybind preferences are local UI preferences only; no secret/token storage is introduced.

## Manual smoke 1 - Discord-like UI/layout pass (Decision D1)
1. Launch the app in `bun tauri dev` and complete Discord login.
2. Visit auth, lobby, DMs, collapsed/expanded sidebar, rich composer, image/GIF/emoji/link preview rendering, incoming call toast, 1:1 call controls, group `VoiceStage`, and settings.
3. Confirm messages render like the provided Discord reference: avatar column, display name + timestamp, body text below, compact grouping, and rich content aligned to the message column.
4. Confirm the 1:1 call UI renders like the provided Discord reference: centered participant avatars, bottom icon control tray, separate mic/deafen controls, and red hang-up button.
5. Confirm familiar actions use icons instead of text where appropriate and every icon-only button has a tooltip/accessible label.
6. Check the default 800x600 window and a wider desktop window. Confirm hover, selected, disabled/loading, error, focus, mute/deafen, danger, and success states are visually consistent.
- [ ] Pass: the app reads as one coherent Discord-derived desktop chat app; message display, call controls, and icon buttons match the intended usability reference; no text/control overlap; no feature surface regresses.

## Manual smoke 2 - Settings keybinds for mute/deafen (Decision D6)
1. Open settings from the app shell.
2. In the Keybinds section, edit "Toggle Mute" and assign a new keybind. Confirm the current binding updates visibly.
3. Join a 1:1 call and press the keybind. Confirm mute toggles without clicking the UI. Press again and confirm it restores.
4. Join group voice and press the same keybind. Confirm group mute toggles without joining/leaving voice.
5. Repeat for "Toggle Deafen" in both 1:1 and group voice.
6. Clear/delete a keybind and confirm pressing the old binding no longer affects voice. Disable/re-enable a keybind row and confirm the toggle is respected.
7. Try Escape during edit mode and a duplicate binding. Confirm the UI handles both without corrupting preferences.
- [ ] Pass: mute/deafen keybinds can be set, edited, cleared, enabled, disabled, persisted, and used for both voice paths while the app is focused.

## Manual smoke 3 - Idle footprint measured and recorded (Phase-7 DoD, first clause)
1. Build or run the release app on Windows.
2. Open the app, log in, leave it in the lobby with no active voice, and wait for the evidence doc's stabilization period.
3. Record CPU, RAM, process name, build/version, machine notes, and timestamp in the Phase 7 performance evidence doc.
4. Repeat once in DMs with the app idle.
- [ ] Pass: idle footprint is measured and recorded in the repo evidence doc with enough context to compare later.

## Manual smoke 4 - 1:1 voice under gaming load (Decision D2)
1. Start the chosen game/load scenario and record it in the evidence doc.
2. Start a 1:1 voice call between two Discord accounts.
3. Keep the call active for the evidence doc's required duration while the game is running.
4. Record CPU/RAM and audio observations from both participants.
- [ ] Pass: no audible stutter/dropout is observed in the 1:1 call under gaming load; metrics and observations are recorded.

## Manual smoke 5 - Group voice under gaming load (Decision D2)
1. Start the chosen game/load scenario and record it in the evidence doc.
2. Join group voice with at least two clients; use three clients if available to mirror the Phase 6 DoD.
3. Keep group voice active while the game is running; speak from each participant and observe speaking indicators.
4. Record CPU/RAM and audio observations from participants.
- [ ] Pass: no audible stutter/dropout is observed in group voice under gaming load; metrics and observations are recorded.

## Manual smoke 6 - Updater pushes a test patch (Phase-7 DoD, third clause; Decision D3)
1. Produce an older installed build and a newer test build using the documented updater steps.
2. Serve or expose the local/static update manifest and artifact path.
3. Launch the older build and trigger the update check.
4. Confirm the app detects the newer version, applies/downloads it according to the configured test flow, and relaunches or reports success as documented.
- [ ] Pass: the Tauri updater path successfully offers/applies a test patch through the local/static manifest. Production hosting/signing handoff remains documented.

## Manual smoke 7 - Phase 1-6 no-regression
1. Auth: cold login and restored session still work; no client secret appears in code.
2. Presence: online/offline/status updates still propagate live.
3. DM text/rich messaging: send/receive text, image, URL preview, emoji, and GIF in a DM.
4. Lobby text/rich messaging: send/receive text and rich content in the shared lobby.
5. 1:1 voice: call, accept, mute, deafen, leave, and teardown still work.
6. Group voice: join, leave, mute, deafen, roster, speaking indicators, and side-by-side layout still work.
- [ ] Pass: all completed MVP loops remain functional after theme/updater/performance changes.

## Repo hygiene + Phase-7-specific checks
- [ ] UI redesign stays in existing frontend styling/component boundaries unless a small shared UI helper is justified; no new heavyweight component library.
- [ ] `src/index.css` contains the shared token set; components use those tokens rather than expanding scattered one-off colors.
- [ ] Message display matches Discord-like structure: avatar/name/timestamp/body, compact grouped messages, and rich attachments aligned to the message column.
- [ ] 1:1 call controls match Discord-like structure: centered avatars, bottom icon tray, separate mic/deafen controls, and red hang-up.
- [ ] Familiar action buttons are icon-first with accessible labels/tooltips; visible text is kept only where it improves clarity.
- [ ] Settings/keybind UI includes rows for Toggle Mute and Toggle Deafen with action, current keybind, edit button, clear/delete control, and enable/disable toggle.
- [ ] Mute/deafen keybinds work for both `useCall` and `useGroupVoice` and do not start/join voice when no voice path is active.
- [ ] Performance evidence doc exists under `docs/` and includes at least one completed idle row plus voice-under-load rows before marking Phase 7 complete.
- [ ] Updater docs explain which values are local/static test values and which production values the user must own later.
- [ ] No Convex schema/table/index changes. `convex/_generated/` remains ignored/generated.
- [ ] `counter` table and other scaffold remnants are untouched unless already part of a separate cleanup task.
- [ ] `README.md`, `specs/roadmap.md`, and `AGENTS.md` are updated only after validation evidence exists.

## Explicitly NOT validated here (out of scope - later phases / not in v1)
- ~~Production updater release hosting and signing-key operations~~ -> production handoff after local/static updater smoke.
- ~~macOS/Linux updater validation~~ -> later cross-platform release work.
- ~~Automated FPS/audio-quality benchmark harness~~ -> later hardening if manual evidence is not enough.
- ~~Global system-wide hotkeys while the app is unfocused/minimized~~ -> later native shortcut work if needed. Phase 7 keybinds are focused-app preferences.
- ~~New product features such as video, screen share, channels, roles, bots, moderation, or offline push~~ -> not in v1.
- ~~Convex auth hardening / per-user authorization for existing public actions~~ -> deferred from earlier phases; not part of Phase 7 polish/profiling.

## Merge criteria
All automated gates green + manual smokes 1-7 passing + repo-hygiene checks box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-7 DoD from `specs/roadmap.md` is satisfied when smoke 3 records idle footprint, smokes 4 and 5 record no audio stutter under gaming load, and smoke 6 proves the updater can push a test patch successfully. Smoke 1 and smoke 2 are additional Phase-7 acceptance gates for the user-requested UI/layout redesign and mute/deafen keybind settings.

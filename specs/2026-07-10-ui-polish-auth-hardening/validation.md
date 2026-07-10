# Phase 9 — UI Polish and Authentication Hardening: Validation

How to know the implementation succeeded and can be merged. Per Decisions D1-D8, merge requires **automated gates green AND installed-build/two-client evidence for reference fidelity, persistent protected sessions, OAuth hardening, authenticated authorization, one-click shared voice, and accessibility/responsive behavior**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 — inherited.
- [ ] `bun run typecheck` exits 0 — inherited.
- [ ] `bun run test` exits 0 — existing Phase 3-8 tests plus new design-system, auth-state, provider, lobby/sidebar/member-panel, and authorization coverage.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 — PKCE, callback parser, pending-flow lifecycle, refresh concurrency, DPAPI store/migration, logout, and redaction tests included.
- [ ] `bunx convex codegen` exits 0 and authenticated Convex configuration deploys; `convex/_generated/` remains ignored.
- [ ] `bun tauri build` bundles a Windows release binary. Record unavailable signing/updater credentials separately; do not report a signed production artifact when only unsigned compilation was proven.
- [ ] OAuth tests prove exact redirect/parameter validation, one bounded flow, state expiry/mismatch/replay rejection, duplicate callback idempotence, `identify` only, pinned client ID, S256 PKCE, token validation, finite timeouts, safe retry, and refresh rotation concurrency.
- [ ] Storage tests prove Credential Manager priority, DPAPI CurrentUser confidentiality/integrity, atomic versioned writes, legacy plaintext migration/removal, corruption handling, conflict resolution, logout clearing, and restart persistence.
- [ ] Secret-redaction tests/scans prove no token/JWT/code/raw credential JSON appears in logs, panic files, errors, fixtures, source, build artifacts, or committed env files. `git grep -iE "client_secret|clientSecret"` returns nothing.
- [ ] JWT/Convex tests reject missing, malformed, expired, not-yet-valid, wrong-signature, wrong-issuer, wrong-audience, and unknown-subject identities.
- [ ] Hostile-client tests cover every user-scoped query/mutation/action and prove cross-user conversation/message/reaction/presence/typing/call/ICE/upload/LiveKit access is denied without information leakage or side effects.
- [ ] Input/abuse tests cover Tauri/deep-link strings, IDs, message/status/typing bounds, arrays/counts, URLs, media type/size, upload association, call transitions, and rate limits.
- [ ] Accessibility tests cover names, focus order/return, tooltips, keyboard operation, reduced motion, announcements, non-color-only state, and WCAG AA contrast.
- [ ] Recorded visual snapshots cover `960x640`, `1280x800`, maximized 1920x1080, and 150% Windows scaling for DM, lobby disconnected/connecting/connected, members, auth states, settings, menus, and calls.

## Manual smoke 1 — Screenshot-led DM and lobby layout (Decisions D4, D5)
1. Launch at `1280x800` and compare DMs with `references/discord-dm-reference.png`: rail/sidebar/content hierarchy, panel tones, density, typography, selected/hover/focus states, message rows, header, composer, self controls, and tooltips.
2. Open the lobby and compare with `references/discord-lobby-reference.png`: left context/voice sidebar, central shared text, and far-right members remain distinct and proportionate.
3. Verify every visible navigation/control maps to a working BaatCheet feature. Confirm no Nitro, Shop, Quests, events, server/channel hierarchy, extra voice rooms, roles, boosts, activities, or decorative dead controls were introduced.
4. Exercise loading, empty, retryable error, destructive confirmation, menu/popover, selected, unread, disabled, and keyboard-focus states.
- [ ] Pass: the app follows the references' visual language and layout while every intentional difference follows BaatCheet's real feature set.

## Manual smoke 2 — One-click shared voice + always-visible members (Decision D3)
1. Open the lobby disconnected. Confirm exactly one shared voice item exists in the left sidebar, no top Join Voice button exists, and the far-right Online/Offline member panel is visible.
2. Click the voice item once. Confirm one join starts immediately, microphone permission/connection progress appears inline, duplicate clicks do not duplicate joins, and failure offers retry.
3. Connect three clients. Confirm participants expand below the item with real speaking/mute/deafen state; local connection quality, mute, deafen, settings, and disconnect controls appear lower-left.
4. Confirm the far-right panel updates Online/Offline and in-voice/speaking/media indicators reactively without duplicates or incorrect movement.
5. Exercise shortcuts, leave/rejoin, 1:1/group mutual exclusion, navigation, microphone denial, interruption, logout, and close teardown.
- [ ] Pass: the single item provides reliable one-click inline voice, the top action is absent, and the right panel stays accurate and visible.

## Manual smoke 3 — Protected session restart and offline recovery (Decisions D1, D2, D7)
1. Start clean, complete OAuth once, verify Credential Manager has the primary versioned record, and confirm no plaintext token JSON exists.
2. Close/reopen five times, including Windows sign-out/restart if practical; verify cached identity renders without a login-screen flash and background synchronization reaches authenticated-online without consent.
3. Reopen offline. Verify cached identity plus reconnecting state, preserved navigation, gated remote actions, and automatic authentication when connectivity returns.
4. Simulate Credential Manager unavailability. Verify DPAPI CurrentUser fallback restores for the same user, is unreadable as plaintext, fails after tampering, and cannot be decrypted by a different Windows user/context.
5. Seed a valid legacy plaintext fallback in a controlled test. Verify one-time migration protects it, validates the new copy, removes plaintext, and survives reopen.
6. Trigger transient failures, revoked refresh, and explicit Logout. Verify only revocation/logout returns to login and logout clears primary/fallback/in-memory JWT state without resurrection.
- [ ] Pass: recoverable restarts preserve the session, no plaintext credential survives, offline recovery is clear, and remote authority stays gated until authenticated.

## Manual smoke 4 — OAuth callback, refresh + error hardening
1. Begin login and verify system-browser Authorization Code, S256 PKCE, exact callback, unique state, and `identify` only.
2. Deliver callbacks with wrong/missing/duplicate/oversized `state` or `code`, wrong scheme/host/path, repeated parameters, Discord errors, expired state, and no pending attempt. Verify safe non-sensitive errors.
3. Deliver the valid callback twice through warm and single-instance/cold paths. Verify one exchange/session succeeds and duplicate delivery creates no overwrite, second success event, or secret-bearing error.
4. Start two attempts quickly and verify one effective attempt with clear cancel/restart behavior.
5. Force timeout/5xx/429/malformed token/profile responses and refresh overlap. Verify bounded waits, safe retry/backoff, no blind code re-exchange, atomic newest-token persistence, and no raw logging.
6. Inspect console, Rust logs, panic log, displayed errors, and diagnostics for codes, tokens, JWTs, raw credential JSON, or sensitive callback queries.
- [ ] Pass: legitimate OAuth succeeds once; tampering/replay/duplicates/timeouts fail deterministically without corruption, leakage, or false logout.

## Manual smoke 5 — Convex authorization resists impersonation (Decision D6)
1. With clients A and B authenticated, collect their own test resource IDs without exposing tokens in the report.
2. Call every user-scoped Convex boundary without a JWT and with malformed, expired, wrong-issuer, wrong-audience, and wrong-signature JWTs. Verify uniform unauthorized failure.
3. From A, substitute B's identity and resource IDs wherever an argument remains. Verify A cannot act as B, read non-member data, mutate B's state, or learn sensitive resource existence.
4. Attempt other-user edit/delete, presence/status/typing spoofing, call answer/end/media/ICE as non-participant, upload misuse, and LiveKit minting as another identity. Verify server-side rejection.
5. Run legitimate A↔B DM/call and shared lobby/voice flows. Verify realtime behavior and LiveKit identity matches the authenticated caller only.
6. Expire/rotate the BaatCheet JWT mid-session and logout. Verify single-flight renewal, subscription recovery, loss of remote authority after logout, and no protected call from cached local identity alone.
- [ ] Pass: identity always comes from verified server context, cross-user substitution yields no unauthorized access/token, and legitimate flows remain functional.

## Manual smoke 6 — Responsive, high-DPI + accessible desktop behavior (Decision D8)
1. Test lobby, DM, auth, settings, menus, and voice at `960x640`, `1280x800`, maximized 1920x1080, and 150% Windows scaling.
2. Confirm the lobby right panel stays visible, thread/composer remains usable, left voice controls remain reachable, scrollbars belong to the correct panel, and no page-level horizontal overflow or clipped critical action appears.
3. Navigate entirely by keyboard. Verify logical order, visible focus, Escape/Enter/Space behavior, menu focus trapping/return, composer shortcuts, and no trap.
4. Inspect accessibility semantics for icon names, status announcements, avatar labels, error association, and non-color-only online/speaking/mute/deafen state.
5. Enable reduced motion, increase text/zoom, and inspect normal/hover/selected/disabled/error/success contrast.
- [ ] Pass: supported layouts remain usable and coherent with keyboard, high DPI, zoom, reduced motion, and assistive semantics.

## Manual smoke 7 — Full feature regression in the polished shell
1. Run login/logout, presence/status, DM creation/history/typing, lobby history/typing, rich images/links/emoji/GIFs, edit/delete/reactions, settings, updater startup, and navigation persistence.
2. Run 1:1 incoming/accept/reject/end, compact/full-screen/cross-navigation, speaking/mute/deafen indicators, and background shortcuts.
3. Run three-client group voice join/leave/rejoin, speaking/media state, coturn fallback where available, interruption, logout, close, and 1:1 mutual exclusion.
4. Monitor responsiveness, duplicate subscriptions/events, idle behavior, audio continuity, console/Rust errors, and secret-bearing diagnostics.
- [ ] Pass: redesign and auth-provider migration introduce no Phase 1-8 regression or voice-stability failure.

## Repo hygiene + Phase-9-specific checks
- [ ] The two files under `references/` are the exact supplied visual references; unsupported/blackened areas are exclusions.
- [ ] Lobby has one shared text conversation, exactly one voice item, no top Join Voice button, and an always-visible far-right Online/Offline member panel.
- [ ] No fake/dead Discord features, extra channels/rooms, Nitro/store/boost/activity surfaces, or unsupported badges/actions exist.
- [ ] Design tokens/shared primitives replace avoidable one-off styles; icon-only controls have labels/tooltips and visible focus.
- [ ] Credential Manager is primary; fallback contains only DPAPI CurrentUser-protected versioned data. No plaintext/localStorage credential or `CRYPTPROTECT_LOCAL_MACHINE` use exists.
- [ ] Legacy migration verifies the protected write before deleting plaintext and never logs source contents.
- [ ] Discord refresh tokens never leave native code; BaatCheet JWTs are short-lived/memory-only; signing keys are server-only and absent from source/builds.
- [ ] OAuth uses external browser + Authorization Code + S256 PKCE + `identify` only; client, redirect, flow lifetime, callback multiplicity, token fields, and response bounds are validated.
- [ ] Auth logs/errors/panic output are structured/redacted; no raw Discord/credential/JWT body appears even on parse failure.
- [ ] Convex uses an auth-aware provider and `ctx.auth.getUserIdentity()` for every user-scoped boundary; caller IDs select resources only and never establish identity.
- [ ] Conversation/message/presence/typing/call/upload/LiveKit authorization is server-enforced with consistent non-enumerating failures.
- [ ] URL/media validation prevents unsafe schemes, oversized/unexpected uploads, internal-network link-preview fetches, and unbounded responses.
- [ ] Remote actions are gated during restored-local/offline state and enable without losing UI state after authentication recovers.
- [ ] Logout cannot race with refresh/JWT renewal or allow cleared fallback credentials to repopulate.
- [ ] Phase 8 shortcuts, message actions, compact calls, and minimum geometry remain; Phase 7 performance/updater evidence remains separately truthful.
- [ ] `counter` and unrelated scaffold remnants are untouched unless separately approved.

## Explicitly NOT validated here (out of scope — later phases)
- ~~Servers, guilds, roles, text-channel trees, extra voice channels, Nitro, boosts, shops, quests, activities, events, bots, or moderation UI~~ → not in v1.
- ~~Video, screen share, streaming, recording, stage channels, or push-to-talk~~ → later roadmap/not in this phase.
- ~~Passwords, email login, passkeys, additional identity providers, or Discord account management~~ → not in v1.
- ~~Offline message sending or offline voice~~ → not in v1; cached identity does not grant remote authority.
- ~~macOS/Linux encrypted-fallback certification~~ → later platform hardening; this phase validates Windows DPAPI.
- ~~Independent penetration-test certification or third-party security audit~~ → external release gate; local tests do not substitute for it.
- ~~Phase 7's formal game-load performance and production updater signing/hosting evidence~~ → remains Phase 7 validation.

## Merge criteria
All automated gates green + manual smokes 1-7 passing + repo-hygiene and Phase-9 checks box-checked. Anything in the "Explicitly NOT validated here" list may remain absent. The Phase-9 DoD is satisfied when smoke 1 proves reference-faithful mapping, smoke 2 proves lobby members/voice, smokes 3-4 prove protected persistent OAuth, smoke 5 proves authorization, smoke 6 proves responsive/accessibility behavior, and smoke 7 proves no regression. Independent certification remains external until performed.

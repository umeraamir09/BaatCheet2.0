# Phase 9 — UI Polish and Authentication Hardening: Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0-8 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, frontend tests via `bun run test`, Rust tests via Cargo, and Convex `_generated/` gitignored (regenerate via `bunx convex codegen` after auth/function changes). Branch: `phase-9/ui-polish-auth-hardening`, off the Phase 8 tip.

## 1. Baseline inventory, threat model + visual contract
- 1.1 Capture current DM, lobby, auth, settings, 1:1 call, group voice, and failure states at `960x640`, `1280x800`, maximized 1080p, and 150% Windows scaling.
- 1.2 Map `references/discord-dm-reference.png` and `references/discord-lobby-reference.png`: keep regions that map to real features and mark every blacked-out/unsupported Discord feature as excluded (Decisions D4, D5).
- 1.3 Trace credentials and identity through Discord authorize/callback/refresh, Tauri commands/events, credential stores, React auth state, Convex connections/RPCs, uploads, and LiveKit token minting.
- 1.4 Record abuse cases: forged identity IDs, cross-conversation access, unauthorized signaling/uploads/LiveKit tokens, OAuth replay/tampering, malicious deep links, stale refresh races, credential/log disclosure, and logout during refresh.
- 1.5 Add failing regression tests/fixtures at each confirmed boundary before changing behavior; redact all captured evidence.
- **Done:** every UI region and auth/API trust boundary has an evidence-backed current state, intended mapping, threat, and regression seam.

## 2. Authenticated Convex session + server authorization (Decisions D6, D7)
- 2.1 Implement a server-side auth bridge that accepts current Discord proof, verifies `/users/@me`, maps the immutable Discord subject, and issues short-lived RS256/ES256 JWTs with pinned `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, and `kid`. Expose JWKS and support controlled signing-key rotation.
- 2.2 Configure `convex/auth.config.ts` for the exact custom JWT/OIDC issuer, audience, JWKS, and algorithm. Fail closed on signature, issuer, audience, expiry, not-before, or subject errors.
- 2.3 Add an auth-aware React Convex provider whose access-token callback invokes the native session layer. Keep BaatCheet JWTs memory-only, renew before expiry with single-flight concurrency, and clear them on logout/revocation.
- 2.4 Add one shared Convex identity resolver using `ctx.auth.getUserIdentity()`, validate the Discord subject claim, load exactly one `users` document, and return typed authenticated context or a stable unauthorized error.
- 2.5 Migrate every user-scoped query/mutation/action to authenticated context. Remove identity authority from caller IDs and enforce conversation membership, message ownership, presence ownership, call participation/state, lobby access, typing ownership, upload ownership/association, and LiveKit room identity server-side.
- 2.6 Enforce explicit boundary limits: message/status/typing lengths, array/count limits, storage/media types and sizes, URL schemes/fetch policy, call/ICE transition limits, rate controls, and non-enumerating authorization errors.
- 2.7 Add hostile-client tests using no JWT, malformed/expired/wrong-audience JWTs, another user's resource IDs, and tampered identities; verify no data or side effects cross accounts.
- **Done:** Convex accepts only server-verifiable identities and no caller can gain another user's read/write/call/upload/LiveKit authority by supplying IDs.

## 3. Protected credential storage + migration (Decisions D1, D7)
- 3.1 Refactor `store.rs` behind a versioned credential-store interface with explicit primary, encrypted-fallback, missing, corrupt, unavailable, and migration outcomes.
- 3.2 Keep Windows Credential Manager primary and implement a DPAPI CurrentUser encrypted/integrity-protected fallback with atomic replace, corruption detection, and no `CRYPTPROTECT_LOCAL_MACHINE` use.
- 3.3 Detect legacy plaintext `discord_tokens.json`, parse it without logging contents, migrate once, verify the protected round-trip, then remove/overwrite the plaintext source. Failed migration must not destroy the only valid refresh token.
- 3.4 Keep access/refresh token, cached profile, pinned client ID, expiry, version, and rotation metadata consistent. Resolve primary/fallback version conflicts without resurrecting logged-out credentials.
- 3.5 Make explicit logout clear both stores idempotently and clear in-memory JWT/profile state. Normal close, crash, transient storage error, or failed synchronization must not clear recoverable credentials.
- 3.6 Remove raw JSON/token/body diagnostics and add secret-redaction tests covering normal errors, parse failures, panic logs, OAuth errors, and frontend console paths.
- **Done:** no plaintext credential copy remains, protected restore survives normal restarts, migration is loss-safe, and diagnostics cannot disclose credentials.

## 4. OAuth, refresh + auth-state hardening (Decision D2)
- 4.1 Pin the production Discord client ID natively; accept no arbitrary renderer-selected client. Keep `identify` as the only scope and reject unexpected token type/scope or empty/oversized token fields.
- 4.2 Add creation/expiry/attempt identity to pending login state. Allow one effective attempt, reject expired/replayed callbacks, consume state once, and make duplicate warm/cold deep-link delivery harmless.
- 4.3 Parse only exact `baatcheet://callback` URLs with bounded query size, exactly one `code` and `state`, supported `error` handling, safe character/length limits, and no ambiguous host/path acceptance.
- 4.4 Add finite Discord HTTP connect/request/read timeouts, bounded bodies, safe status classification, and retry/backoff only where safe. Never retry an authorization-code exchange blindly.
- 4.5 Centralize refresh ownership so cold restore, proactive timer, JWT renewal, reactive 401 recovery, logout, and teardown cannot rotate/overwrite tokens concurrently. Persist rotated refresh tokens atomically before exposing success.
- 4.6 Implement the locked restore state machine: render protected cached identity as `restored-local/synchronizing`, authenticate remote services in the background, gate privileged actions until ready, and retain credentials across retryable failure.
- 4.7 Test PKCE constraints, state mismatch/expiry/replay, malicious/duplicate deep links, validation, timeouts, refresh races, offline reopen, revoked refresh, explicit logout, Strict Mode double effects, and listener timing.
- **Done:** OAuth and restore behave deterministically across success, cancellation, tampering, duplication, expiry, offline startup, refresh rotation, and logout without leaks or false logout.

## 5. Design system + desktop shell (Decisions D4, D5)
- 5.1 Consolidate theme variables and shared UI primitives. Define the screenshot-derived dark palette, layered panels, typography, spacing, radii, borders, shadows, status colors, focus rings, motion, and disabled/loading/error treatments.
- 5.2 Standardize icon buttons, tooltips, menus, popovers, inputs, notices, skeletons, avatars/status badges, scrollbars, and accessible states. Remove dead controls and text/icon inconsistencies.
- 5.3 Recompose `AuthenticatedLayout.tsx` with explicit scroll ownership: icon rail, context left sidebar, central content, and lobby-only far-right member panel. Preserve `960x640` without hiding members or adding page-level horizontal scroll.
- 5.4 Redesign the icon rail and self footer around real lobby/DM/settings navigation, current identity/status, mute/deafen, settings, and logout. Do not add server, discovery, commerce, or unsupported navigation.
- 5.5 Add responsive/high-DPI/reduced-motion rules and accessibility tests for keyboard order, focus return, tooltips, contrast, zoom/text growth, screen-reader names, and color-independent status.
- **Done:** the app has one coherent visual/interaction system and the desktop shell matches the reference hierarchy at every supported size.

## 6. Lobby, member panel + shared voice interaction (Decisions D3-D5)
- 6.1 Move group voice presentation from the header Join Voice action and separate `VoiceStage` pane into the lobby left sidebar. Render exactly one shared voice item with hover, selected, connecting, connected, failed, and disabled states.
- 6.2 Make one click join immediately. Show microphone permission, LiveKit progress, recoverable retry, connection quality, and one-click rejoin inline without duplicate calls.
- 6.3 Expand connected participants beneath the item with avatar/name/speaking/mute/deafen state; place local connection controls above the persistent self footer and keep background keybind state synchronized.
- 6.4 Add a far-right `MemberPanel` fed by existing reactive presence, grouped Online/Offline with counts, stable sorting, status text, presence dots, and real in-voice/speaking/media indicators. Keep it visible at minimum width.
- 6.5 Polish lobby header, history, message rows/actions, composer, typing, separators, empty/loading/error states, and unread/scroll behavior using the second screenshot while retaining one shared conversation.
- 6.6 Verify 1:1/group mutual exclusion, permission denial, join/leave/rejoin, navigation, logout/close teardown, shortcuts, audio attachment stability, and no extra room/channel creation.
- **Done:** the lobby is a cohesive Discord-inspired experience with one-click inline voice on the left and always-visible Online/Offline members on the right.

## 7. DM and authentication experience polish
- 7.1 Redesign DM navigation/active rows from the first screenshot: real search/filter if supported by the local list, avatars/presence, previews, selected/hover states, and clean empty/loading/error states. Do not add Nitro, Shop, Quests, group DMs, pins, or unsupported controls.
- 7.2 Polish DM headers, message grouping, rich content, actions, typing, composer, compact/full-screen 1:1 calls, incoming-call toast, and voice indicators without regressing Phase 8.
- 7.3 Replace generic auth UI with branded loading, login, waiting-for-browser, restored/synchronizing, offline/retry, rejected/expired, revoked, and logout-progress surfaces. Keep errors actionable but non-sensitive.
- 7.4 Gate/annotate remote actions while only locally restored; enable them after backend authentication without remounting or losing the selected view.
- 7.5 Add component/integration tests for auth states, double-click suppression, retry, logout failure, accessible announcements, state preservation, and no login-screen flash during valid restore.
- **Done:** DMs and auth feel deliberate across normal, slow, offline, error, call, and recovery states and align with the design system.

## 8. Visual, security, regression + release evidence
- 8.1 Run format, lint, typecheck, frontend/Rust tests, Convex codegen, security scans, and release build. Produce a redacted auth/authorization report and before/after screenshot matrix.
- 8.2 Walk `validation.md`: reference layout, one-click lobby voice, member presence, protected restart/offline recovery, OAuth tamper/replay, cross-user authorization, and accessibility/responsive behavior.
- 8.3 Re-run Phase 1-8 regressions: logout, presence, DM/lobby messaging/actions, rich content, 1:1/group voice, global shortcuts, settings, call navigation, updater startup, and geometry.
- 8.4 Review dependency advisories and production capability/env configuration. Confirm signing/JWKS secrets, Discord tokens, JWTs, updater keys, and real credentials are absent from git/build output.
- 8.5 Update `README.md`, `AGENTS.md`, threat-model/security notes, auth-bridge runbook, and visual QA evidence after implementation. Mark complete only when installed/two-client evidence passes; keep independent security review external until performed.
- **Done:** the phase has reproducible visual/security evidence, no known critical/high authorization defect, and docs accurately distinguish automated, manual, and external validation.

## 9. Build + merge readiness
- 9.1 `bun run format` leaves no unintended formatting diff.
- 9.2 `bun run lint` + `bun run typecheck` — clean.
- 9.3 `bun run test` — existing and new UI/auth/authorization tests pass.
- 9.4 `cargo test --manifest-path src-tauri/Cargo.toml` — OAuth/session/storage/redaction tests pass.
- 9.5 `bunx convex codegen` succeeds; generated files remain ignored; auth configuration deploys to the self-hosted instance.
- 9.6 Dependency/security/secret scans and hostile-client authorization tests have zero unresolved critical/high findings.
- 9.7 `bun tauri build` → release binary produced; unavailable user-owned signing/updater prerequisites are recorded honestly.
- 9.8 Walk manual smokes 1-7 in `validation.md` with an installed Windows build and two accounts.
- 9.9 Record `STATUS: COMPLETE` in `specs/roadmap.md` only after all evidence passes.
- **Done:** all Phase 9 validation passes and the implementation is ready for review/merge without claiming unperformed external certification.

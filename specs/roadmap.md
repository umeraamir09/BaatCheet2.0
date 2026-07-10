# BaatCheet — Roadmap

High-level implementation order, broken into small, independently-reviewable phases. Each phase ends with a definition of done. Earlier README build order preserved, with a Phase 0 scaffold pulled out front.

---

## Phase 0 — Scaffold
> **STATUS: COMPLETE** — Committed and pushed to `main` (commit f044be2).

**Goal:** empty-but-wired app shell and prereqs in place before any feature.
- Tauri + Vite + React + TS + Tailwind bootstrapped and running locally.
- Convex client wired to the self-hosted instance; a trivial reactive query proves the connection.
- Discord OAuth application registered; `baatcheet://callback` scheme noted.
- Repo, git, lint/format, and a build that produces a Tauri dev binary.
- **DoD:** `cargo tauri dev` launches a window showing a live Convex query result. No features yet.

## Phase 1 — Auth (Discord OAuth2 + PKCE)
> **STATUS: COMPLETE** — Implementation complete. 

**Goal:** trickiest infra piece validated before any UI — the README's call to do this first.
- PKCE flow in the bare shell: open system browser → Discord consent → redirect back via `baatcheet://callback`.
- Pull username, global display name, avatar from `/users/@me` on first login.
- Persist refresh token; silent background refresh when the access token nears expiry.
- **DoD:** cold start → "Continue with Discord" → landed back in-app authenticated, avatar visible. Killing and reopening the app restores the session without re-consent.

## Phase 2 — Presence
> **STATUS: COMPLETE** — Implementation complete. Automated gates green (lint, typecheck, `bun tauri build`, Convex schema deploy). Manual smokes (two-client live appear/disappear + status, crash-disconnect TTL, status + logout) pending user run with a second Discord account.
**Goal:** prove the realtime data layer; first sign of "who's around."
- Convex presence doc per user: online/offline, custom status / "now playing" line.
- Real-time updates on presence change — no refresh, no polling.
- Collapsible sidebar listing friends.
- **DoD:** two clients online → each sees the other appear/disappear live, with status text, within a second.

## Phase 3 — 1:1 DM text
> **STATUS: COMPLETE** — Implementation complete. Automated gates green (lint, typecheck, `bun tauri build`, Convex schema deploy). Manual smokes (two-client live send/receive A↔B, reopen-DM-shows-history, typing indicator A→B, DM-list reorder by `lastMessageAt`) pending user run with a second Discord account.
**Goal:** first usable chat — proves persisted realtime messaging.
- 1:1 text chat backed by Convex; history persisted (forever for v1).
- Reuses the realtime subscription pattern from Phase 2.
- **DoD:** send a message from client A → appears on client B live; reopening the DM shows full history.

## Phase 4 — 1:1 voice (direct WebRTC)
> **STATUS: COMPLETE** — Implementation complete. Automated gates green (lint, typecheck, `bun tauri build`, Convex schema deploy). Manual smokes (two-client live call A→B with toast + accept + two-way audio, mute/deafen round-trip, either-side leave, reject path, busy/offline handling, coturn TURN fallback across NAT) pending user run with a second Discord account.
**Goal:** smaller surface area than group voice — good place to learn the WebRTC API.
- Peer-to-peer WebRTC call between two friends; coturn as TURN fallback.
- Call UI: incoming call toast, accept/decline, mute, deafen, leave.
- **DoD:** A calls B → B sees toast → accept → two-way audio works → either side can mute/deafen/leave cleanly.

## Phase 5 — Hangout lobby (text half)
> **STATUS: COMPLETE** — Implementation complete. Automated gates green (lint, typecheck, `bun tauri build`, Convex codegen). `git diff convex/schema.ts` is empty (Decision D1 — zero schema change). Manual smokes (post-to-lobby-live, history-persists, multi-person typing, navigation round-trip + view-mode persistence, no-regression in Phase 2/3/4) pending user run with a second Discord account.
**Goal:** the group text half of the centerpiece, cheaply — reuses DM components.
- Single shared "room" (not per-channel) for the whole group.
- DM chat components from Phase 3 retargeted at the shared room.
- Always-on, persisted history.
- **DoD:** any group member posts to the lobby → all members see it live; history persists across restarts.

## Rich messaging (images, links, emojis, GIFs)
> **STATUS: COMPLETE** — Implementation complete. Automated gates green (lint, typecheck, `bun tauri build`, Convex schema deploy). Manual smokes (image send/receive, link preview cards, emoji picker, GIF picker, no-regression) pending user run with a second Discord account.

**Goal:** extend text chat with standard messaging features — image uploads, clickable links with OG preview cards, Apple-style emoji picker, GIPHY-powered GIF picker.
- Image uploads via Convex file storage (`generateUploadUrl` + direct POST).
- Link previews fetched server-side via Convex action (OG metadata), rendered as Discord-style cards.
- Apple-style emoji picker via `@emoji-mart/react` with `set="apple"`.
- GIF picker via raw GIPHY API calls (no SDK dependency).
- All features work in both DM and lobby threads.
- **DoD:** send an image → renders in bubble; send a URL → preview card appears; use emoji picker → emoji inserted; search + send a GIF → GIF renders in bubble.

## Phase 6 — Hangout lobby (group voice via LiveKit)
> **STATUS: COMPLETE** — Implementation complete. Automated gates green (lint, typecheck, `bun tauri build`, Convex codegen, 13 useGroupVoice tests pass). Manual smokes (3+ join/leave freely + audio stable, mute/deafen round-trip, one-click rejoin, side-by-side layout + roster + speaking indicators, mutual exclusivity with 1:1, coturn fallback across NAT, teardown on logout/close, no-regression in Phase 2/3/4/5) pending user run with a second Discord account.
**Goal:** the infra-heavy half of the centerpiece; saved for when the rest already works.
- LiveKit SFU deployed on Coolify; group voice room always "open."
- Single-click join drops you into the in-progress call.
- Reuse mute/deafen/leave controls from Phase 4.
- **DoD:** 3+ members join/leave freely; audio stays stable; leaving and rejoining is one click with no call teardown dance.

## Phase 7 — Theme pass + performance profiling
**Goal:** the whole point of the shell choice — prove it.
- Discord-derived dark theme applied end-to-end; pared-down panel layout.
- Measure idle CPU/RAM **with a game running**; voice under load must not stutter or spike CPU.
- Tauri updater wired so patches ship without manual redownload.
- **DoD:** idle footprint measured and recorded; no audio stutter under gaming load; updater pushes a test patch successfully.

## Phase 8 — Post-production 0.1.0 fixes
**Goal:** remove the release-blocking defects found after the 0.1.0 feature pass and make the core auth, voice, window, messaging, and 1:1 call flows dependable for daily use.
- Restore the Discord session from the OS keychain on every app reopen; transient startup/network failures must not behave like logout or erase a recoverable session.
- Make configurable mute/deafen shortcuts true native global shortcuts that remain reliable while BaatCheet is unfocused, minimized, or behind a game.
- Open the desktop window at a roomier default size with a practical minimum size for the final three-pane UI.
- Add author-only hard deletion, author-only text editing for 15 minutes (including Up Arrow to edit the newest eligible sent message), an `edited` tag, and Discord-style emoji reactions in DMs and the lobby.
- Replace the blocking full-screen 1:1 call overlay with a compact call view embedded in the matching DM by default, plus a local full-screen toggle; keep the call alive during navigation and show speaking rings plus mute/deafen indicators for both participants.
- **DoD:** an installed build survives repeated close/reopen without re-login; mute/deafen shortcuts work repeatedly while the app is in the background; the larger default window opens correctly; two clients can edit/delete/react live with the locked rules; and an active 1:1 call no longer blocks messaging/navigation while compact/full-screen views and participant indicators remain accurate.

## Phase 9 — UI Polish and Authentication Hardening
**Goal:** completely redesign and polish the desktop interface using the supplied Discord screenshots as the primary visual reference, while hardening Discord OAuth, persistent sessions, and every authenticated API boundary for production use.
- Rebuild the shell around Discord's desktop visual language: dark layered panels, compact hierarchy, consistent spacing and typography, icon-first controls, tooltips, hover/focus/selected states, status indicators, menus, loading/empty/error states, and accessible keyboard behavior.
- Use `specs/2026-07-10-ui-polish-auth-hardening/references/discord-dm-reference.png` for DM composition and `references/discord-lobby-reference.png` as the primary lobby reference; blacked-out/unsupported Discord features are exclusion markers, not implementation targets.
- Give the lobby an always-visible online/offline member panel on the far right and a single shared voice-channel item in the left sidebar. Remove the top-level Join Voice button; one click on the sidebar item joins voice and expands inline participant/connection controls.
- Keep BaatCheet's actual product boundaries: one lobby, one shared voice room, DMs, presence, settings, and existing messaging/call features. Do not add servers, text channels, extra voice channels, Nitro, boosts, roles, shops, quests, or other Discord-only surfaces.
- Keep Windows Credential Manager as the primary Discord-token store and replace the plaintext JSON fallback with a CurrentUser DPAPI-encrypted fallback. Restore the cached verified identity immediately, then refresh and synchronize safely in the background without turning transient failures into logout.
- Harden OAuth and native command inputs: exact redirect validation, bounded single-use PKCE/state flows, strict client/scope/token validation, request timeouts, sanitized errors, secret-redacted diagnostics, refresh rotation/concurrency safety, and deterministic logout/revocation behavior.
- Authenticate Convex connections/RPCs with short-lived, server-verifiable BaatCheet JWTs derived from a freshly verified Discord identity. All user-scoped queries, mutations, actions, uploads, messaging, presence, calls, and LiveKit minting must derive identity from `ctx.auth`, enforce authorization server-side, and stop trusting caller-supplied identity IDs.
- **DoD:** the installed Windows build matches the supplied references across supported lobby/DM/auth states without unsupported Discord features; the lobby retains its right member panel and one-click sidebar voice flow; repeated close/reopen and offline/online recovery preserve the session without plaintext credentials; OAuth replay/tampering and malformed inputs fail safely; and two-client hostile-call tests prove users cannot read, write, signal, upload, or mint tokens as another user.

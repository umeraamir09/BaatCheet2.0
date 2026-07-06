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
> **STATUS: COMPLETE** — Implementation complete. Manual smoke tests pending (see `specs/2026-07-06-auth-discord-oauth2-pkce/validation.md`).

**Goal:** trickiest infra piece validated before any UI — the README's call to do this first.
- PKCE flow in the bare shell: open system browser → Discord consent → redirect back via `baatcheet://callback`.
- Pull username, global display name, avatar from `/users/@me` on first login.
- Persist refresh token; silent background refresh when the access token nears expiry.
- **DoD:** cold start → "Continue with Discord" → landed back in-app authenticated, avatar visible. Killing and reopening the app restores the session without re-consent.

## Phase 2 — Presence
**Goal:** prove the realtime data layer; first sign of "who's around."
- Convex presence doc per user: online/offline, custom status / "now playing" line.
- Real-time updates on presence change — no refresh, no polling.
- Collapsible sidebar listing friends.
- **DoD:** two clients online → each sees the other appear/disappear live, with status text, within a second.

## Phase 3 — 1:1 DM text
**Goal:** first usable chat — proves persisted realtime messaging.
- 1:1 text chat backed by Convex; history persisted (forever for v1).
- Reuses the realtime subscription pattern from Phase 2.
- **DoD:** send a message from client A → appears on client B live; reopening the DM shows full history.

## Phase 4 — 1:1 voice (direct WebRTC)
**Goal:** smaller surface area than group voice — good place to learn the WebRTC API.
- Peer-to-peer WebRTC call between two friends; coturn as TURN fallback.
- Call UI: incoming call toast, accept/decline, mute, deafen, leave.
- **DoD:** A calls B → B sees toast → accept → two-way audio works → either side can mute/deafen/leave cleanly.

## Phase 5 — Hangout lobby (text half)
**Goal:** the group text half of the centerpiece, cheaply — reuses DM components.
- Single shared "room" (not per-channel) for the whole group.
- DM chat components from Phase 3 retargeted at the shared room.
- Always-on, persisted history.
- **DoD:** any group member posts to the lobby → all members see it live; history persists across restarts.

## Phase 6 — Hangout lobby (group voice via LiveKit)
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

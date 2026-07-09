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

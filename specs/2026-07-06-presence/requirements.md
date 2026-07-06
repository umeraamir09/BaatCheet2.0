# Phase 2 — Presence: Requirements

Feature dir: `specs/2026-07-06-presence/`
Roadmap phase: **Phase 2 — Presence** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` · Stack ref: `specs/tech-stack.md`
Builds on: `specs/2026-07-06-auth-discord-oauth2-pkce/` (Phase 1 — the Convex `users` doc written there is the foundation Phase 2 attaches presence to).

## Goal
Prove the realtime data layer and give the first sign of "who's around": each online client maintains a live presence doc in Convex; everyone else sees appear/disappear + status text in a collapsible sidebar, with no refresh and no polling. This is the roadmap's Phase 2 and the first piece of real UI chrome beyond the Phase-1 bare auth screen.

## In scope
- **Presence doc per user**, in a new Convex `presence` table (Decision D1) keyed by `userId` (reference to `users`):
  - `online: boolean` (Online/Offline — Decision D2, binary), `status: string` (self-set free-text "now playing"/custom line, `""` if none), `lastSeen: number` (ms heartbeat timestamp).
  - Created/owned by the authenticated client; one doc per user.
- **Online/offline lifecycle (Decision D3):**
  - On login / session restore, mark self `online: true` and start a heartbeat that writes `lastSeen` to Convex every ~10s.
  - Graceful close (Tauri window close / app quit / log out) sets `online: false` immediately and stops the heartbeat.
  - A Convex scheduled function (cron) sweeps every ~5s and flips any presence doc whose `lastSeen` is older than ~30s to `online: false` — covers crashed/killed clients that can't write the graceful-close patch.
- **Self-set status text (Decision D2):** a small input on the sidebar (or a profile popover) where the user types their "now playing"/custom line; writes `status` on the presence doc. The text persists across sessions (retained on the doc); only the `online` flag flips on log out. Status is self-set in BaatCheet — Discord's `identify` scope (Phase 1 D4) cannot expose rich presence, so no "now playing" pulled from Discord in v1.
- **Realtime presence list (Decision D6):** a Convex reactive query subscription returning all `presence` docs joined with their `users` profile (avatar, displayName, username). The subscription is live — appear/disappear and status edits propagate with no refresh, no polling. Reuses the Phase-0-proven reactive subscription pattern.
- **Collapsible friends sidebar (Decisions D4 + D5):**
  - Every doc in `users` is a friend (single ≤10-person group, no friend-request flow per `specs/mission.md`).
  - Left sidebar rail; entries grouped **online first** (alpha-sorted by displayName/username), **then offline** (alpha-sorted); each row shows avatar, name, status text (if any), and an online/offline indicator.
  - Collapsible (collapse to a narrow icon rail or hide entirely; expand restores the full list).
  - The sidebar is the **only new chrome** in Phase 2 — the main area stays the Phase-1 single-screen post-auth content; no 3-pane shell yet (that arrives with Phase 3 chat).
- **Log out / session-end presence update:** Phase 1's log-out path is extended to set `online: false` + stop the heartbeat before clearing tokens (Phase 1 D3 cleared tokens only; Phase 2 adds the presence-offline write as a clean teardown step).

## Out of scope (deferred — explicitly NOT Phase 2)
- **1:1 DM text or any chat** → Phase 3 (the sidebar built here is the housing for it).
- **Typing indicators** → Phase 3 (not pulled forward; Decision D3 keeps Phase 2 scope tight).
- **Voice (1:1 or group)** → Phases 4, 6.
- **Idle / Do-Not-Disturb states** → not in v1 (Decision D2 — binary Online/Offline only). Revisit if the group asks.
- **"Now playing" pulled from Discord rich presence** → not feasible with `identify` only; status is self-set. Adding Discord presence scopes is out of scope for v1.
- **Friend requests / blocking / relationship management** → not on the v1 roadmap (`specs/mission.md` — one pre-existing friend group, everyone in `users` is a friend).
- **Offline push notifications** → out of scope for v1 (`specs/mission.md`); in-app + OS notifications while running only, and Phase 2 doesn't add notifications at all.
- **3-pane app shell (narrow rail | main | members)** → Phase 3+ (Decision D5 — only the sidebar rail lands now).
- **Convex auth / per-user write authorization** → Phase 1 D-impl-3 deliberately skipped Convex auth; Phase 2 inherits (see Decision D7 — public mutations, known v1 limitation).
- **Full Discord-derived theme** → Phase 7 (Phase 2 sidebar is functional, lightly styled; the polished dark theme is later).
- **Idle CPU/RAM profiling** → Phase 7 (Phase 2's heartbeat must be light — one small Convex write every 10s — but is not profiled here).

## Decisions (locked for this phase)
- **D1 — Presence storage: a separate `presence` table keyed by `userId`, not fields on the `users` doc.** The `users` doc (Phase 1) holds profile fields that change rarely; presence changes constantly (heartbeat every ~10s). Keeping them in separate docs avoids thrashing the profile doc and keeps write patterns clean. The `presence` table references `users` via `userId: v.id("users")`. The frontend learns its own `users._id` once after login via a reactive `getMyUser(byDiscordId)` query (Phase 1 surfaces the discordId; Phase 2 adds the lookup), then heartbeats patch its presence doc by `userId`.
- **D2 — Presence model: binary Online/Offline + a self-set free-text `status` line.** No Idle/DND in v1. Status is self-set in BaatCheet (Discord `identify` can't read rich presence — Phase 1 D4). Status text persists on the presence doc across sessions; on log out only `online` flips to `false`, the `status` string is retained so the user doesn't retype it on next login. Matches the roadmap's "online/offline, custom status / now playing line" literally; smallest surface.
- **D3 — Offline detection: heartbeat + Convex TTL sweep.** The client writes `lastSeen` every ~10s. A Convex cron/scheduled function sweeps every ~5s and marks any presence doc with `lastSeen` older than ~30s as `online: false`. Graceful close sets `online: false` immediately. Result: **online appears within ~1s** (reactive subscription), **crash-disconnect resolves within ~30–35s** (30s staleness + up to 5s until the next sweep). This satisfies the roadmap DoD ("appear/disappear live, within a second" for the online direction and normal close) and degrades gracefully on crash. Typing indicators are NOT pulled forward (scope stays tight).
- **D4 — Friends list: every `users` doc is a friend; no requests.** Per `specs/mission.md` (one pre-existing ≤10-person group, no relationship management). The sidebar lists all users; online first (alpha by displayName, fall back to username), then offline (alpha). No blocking, no friending, no "add friend" UI.
- **D5 — App shell scope: the collapsible left sidebar rail is the only new chrome.** The main area remains the Phase-1 single-screen post-auth content. The 3-pane shell (narrow rail | main | members) is deferred to Phase 3 when chat lands — Phase 2 only introduces the persistent sidebar wrapper around the existing post-auth screen.
- **D6 — Realtime via Convex reactive subscription; no polling, no manual websocket.** The presence list is a live `query` subscription (the Phase-0-proven reactive pattern). Appear/disappear and status edits propagate automatically. The heartbeat is a periodic mutation (write), not a poll (read) — the only reads are reactive subscriptions.
- **D7 — No Convex auth in v1; public presence mutations, keyed by `userId`/`discordId`.** Inherits Phase 1 D-impl-3. The `presence` mutations (`setOnline`, `heartbeat`, `setStatus`, `setOffline`) are public (no Convex auth middleware); the client passes its own `userId`/`discordId`. **Known v1 limitation:** a misbehaving client could spoof another user's presence. Acceptable for v1 dev posture (≤10 trusted friends, single group, Convex Cloud per Phase 0 D1); hardening (Convex auth or signed writes) is deferred. Flagged in `validation.md`.
- **D8 — Validation: automated gates green + three manual smokes.** Lint, typecheck, and `cargo tauri build` must pass (inherited). Plus manual smokes for (i) two clients see each other appear/disappear live with status within ~1s, (ii) crash-disconnect → offline within ~30–35s, (iii) status set on A → visible on B live. See `validation.md`.

## Context
- `specs/mission.md` — "See who's around" is one of the three loops. The app must stay idle-light while gaming; Phase 2's heartbeat is one small Convex write every 10s (light), but is not formally profiled until Phase 7. No offline push in v1 — presence is only meaningful while the app runs.
- `specs/tech-stack.md` — Realtime row: **Convex (self-hosted for prod, Convex Cloud for v1 dev per Phase 0 D1)** reactive subscriptions → live presence with no manual websocket/polling. Native notifications row exists in the stack but Phase 2 doesn't wire notifications (no incoming-call/DM alerts yet).
- `specs/roadmap.md` Phase 1 — already writes/upserts the Convex `users` doc on login and session restore. Phase 2 reads those docs for the sidebar and attaches a `presence` doc to each. Phase 2 does **not** change what Phase 1 stores in `users` (profile only); presence is a separate table (Decision D1).
- `specs/roadmap.md` Phase 2 DoD: *two clients online → each sees the other appear/disappear live, with status text, within a second.*
- `convex/schema.ts` (current) — declares `users` (discordId, username, displayName, avatarUrl, updatedAt, indexed byDiscordId) and a `counter` table (Phase-0 scaffold remnant). Phase 2 adds the `presence` table; `counter` is untouched (cleanup deferred).
- `convex/users.ts` (current) — `upsertUser` mutation, public, keyed by discordId. Phase 2 adds a `getMyUser` query (by discordId → returns `_id` + profile) and the presence mutations in a new `convex/presence.ts`; `users.ts` is extended, not rewritten.

## User-performed prerequisites (not agent-executable)
- Phase 1 must be landed (merged or present on the working branch) so the `users` table + authenticated profile are available. Phase 2 branches from the Phase-1 tip.
- The Convex dev backend (`bunx convex dev`) must be running (or re-run after schema changes) so `_generated/` is regenerated for the new `presence` table + cron. The agent runs this; if the Convex deployment is unreachable, the user must confirm the dev backend / credentials.
- Two Discord test accounts (for the two-client smoke) — the user must have (or create) a second Discord account to validate the live appear/disappear DoD. The agent cannot create Discord accounts.

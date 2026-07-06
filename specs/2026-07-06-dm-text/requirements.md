# Phase 3 — 1:1 DM text: Requirements

Feature dir: `specs/2026-07-06-dm-text/`
Roadmap phase: **Phase 3 — 1:1 DM text** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` · Stack ref: `specs/tech-stack.md`
Builds on: `specs/2026-07-06-presence/` (Phase 2 — the collapsible friends sidebar is the housing for DMs; the reactive Convex subscription pattern + the `users`/`presence` tables established there are the foundation Phase 3 attaches chat to).

## Goal
First usable chat: prove persisted realtime messaging. A 1:1 text conversation between two friends backed by Convex — messages sent from client A appear on client B live (no refresh, no polling), and reopening the DM shows full history. This is the roadmap's Phase 3 and the first piece of the "Talk to one friend" loop (`specs/mission.md`). It lands the 2-pane app shell (friends/DM sidebar | DM thread) that Phase 5 retargets at the group lobby.

## In scope
- **Generic conversation + message tables (Decision D1):**
  - A new `conversations` table: `type: v.string()` ("dm" now; "group" lands Phase 5), `participantIds: v.array(v.id("users"))` (for a DM, exactly 2, stored sorted for canonical lookup), `key: v.string()` (canonical `"userIdA__userIdB"` sorted — unique upsert key), `createdAt: v.number()`, `lastMessageAt: v.number()` (DM-list ordering). Indexed by `byKey` on `["key"]` (unique lookup) and `byLastMessage` on `["lastMessageAt"]`.
  - A new `messages` table: `conversationId: v.id("conversations")` (FK), `senderId: v.id("users")` (FK), `body: v.string()` (max length enforced server-side), `createdAt: v.number()`. Indexed by `byConversation` on `["conversationId", "createdAt"]` for ordered history.
  - Designed so Phase 5's group lobby is just a `conversations` doc with `type: "group"` reusing the same `messages` table — true retargeting, no second table.
- **DM lifecycle:**
  - Clicking a friend in the Phase-2 sidebar opens (or creates) the 1:1 `conversations` doc via the canonical `key`; subscribes to its `messages` ordered by `createdAt`.
  - The sidebar entries become DM-launchable rows (Decision D2) — selecting a friend swaps the main pane to that DM thread.
  - Sending a message: `sendMessage(conversationId, senderId, body)` mutation inserts a `messages` doc and patches `conversations.lastMessageAt` (so the DM list reorders live).
  - History: a reactive `listMessages(conversationId)` query returns the full ordered history; subscribed live (Decision D5).
- **Typing indicators (Decision D3):** a `typing` table (`conversationId`, `userId`, `lastTyped: number`); `setTyping(conversationId, userId)` upserts `lastTyped` on keystroke (debounced ~300ms client-side); `listTyping(conversationId)` returns docs with `lastTyped > now - 3000`. The DM thread shows "… is typing" for the peer. Stale docs are invisible by recency filter (no cron required for v1; ≤10 group keeps the table tiny).
- **2-pane app shell (Decision D2):** the Phase-2 collapsible sidebar becomes DM-selectable; the main pane swaps from the Phase-1 post-auth placeholder to the active DM thread (or an empty state when no DM is selected). No Discord-style narrow icon rail — there is only one place to chat in Phase 3; the icon rail defers to Phase 5 when DM-vs-group becomes a real switch.
- **Message input + thread UI:** a composer (text input + send button / Enter to send) at the bottom of the DM thread; a scrollable message list above showing bubbles (own messages right-aligned, peer's left-aligned, with sender avatar/name). Light Tailwind styling (Phase 7 owns the polished theme).
- **Live delivery + history persistence:** reuses the Phase-0-proven reactive subscription pattern (Phase 2 D6). No polling, no manual websocket. Messages persist forever (mission v1 decision); reopening a DM restores full history.

## Out of scope (deferred — explicitly NOT Phase 3)
- **Group text / hangout lobby** → Phase 5 (the `conversations`/`messages` model built here retargets to it — Decision D1).
- **Voice (1:1 or group)** → Phases 4, 6.
- **Narrow icon rail / DM-vs-group switcher** → Phase 5 (Decision D2 — only one chat surface exists in Phase 3).
- **Message editing / deletion / reactions / attachments** → not in v1 (mission: pared-down; text only for v1). Reactions/edits may be revisited if the group asks.
- **Read receipts / "seen" indicators** → not in v1.
- **Message search / full-text query** → not in v1 (≤10 group, history is browsable by scroll).
- **Pagination / lazy-loading of history** → not in v1 (mission YAGNI stance — "revisit only if it becomes a problem"; ≤10 group keeps any single conversation small). The reactive subscription returns full history per conversation.
- **Offline push notifications for DMs** → out of scope for v1 (`specs/mission.md`); in-app + OS notifications while running only. Phase 3 does not wire OS notifications (a later polish phase may add Tauri notifications for incoming DMs while the app runs).
- **Convex auth / per-user write authorization** → deferred (Decision D4 — public mutations are a known v1 limitation).
- **Full Discord-derived theme** → Phase 7 (Phase 3 chat is functional, lightly styled).
- **Idle CPU/RAM profiling** → Phase 7.

## Decisions (locked for this phase)
- **D1 — Message & conversation data model: generic `conversations` + `messages` tables, not a 1:1-only `dmMessages` table.** The roadmap explicitly says Phase 5 "retargets DM chat components at the shared room." A shared model — a `conversations` doc (1:1 now via `type: "dm"` + canonical sorted-participant `key`, group later via `type: "group"`) referenced by a `messages` table keyed on `conversationId` — makes that retargeting a UI retarget, not a schema migration. Costs one extra table + a join now; saves a migration and a second message table later. The canonical `key` (sorted `"userIdA__userIdB"`) gives a single upsert/lookup path so both participants resolve to the same conversation doc.
- **D2 — App shell scope: 2-pane (friends/DM sidebar | DM thread), no narrow icon rail.** Phase 2 D5 deferred the 3-pane shell to "Phase 3+." Phase 3 introduces the 2-pane shell: the existing collapsible sidebar becomes DM-selectable (click a friend → open that DM in the main pane), and the main pane renders the active DM thread (or an empty state). The Discord-style leftmost icon rail (the DM-vs-server switcher) is deferred to Phase 5 — in Phase 3 there is only one place to chat (1:1 DMs), so a switcher has nothing to switch between and would be premature chrome. Phase 5 adds the icon rail when the group lobby becomes the second surface.
- **D3 — Typing indicators: included in Phase 3.** A small `typing` table (`conversationId`, `userId`, `lastTyped`) + a debounced `setTyping` mutation on keystroke + a recency-filtered `listTyping` query powers a "… is typing" line in the DM thread. Stale docs (older than ~3s) are invisible by query filter; no cron is required for v1 (≤10 group keeps the table tiny; a sweep can be added if it grows). This delivers a more alive first-chat feel; it is beyond the literal DoD but in-scope for the phase.
- **D4 — No Convex auth in v1; public message/typing mutations, keyed by `conversationId`/`userId`/`senderId`.** Inherits Phase 2 D7 / Phase 1 D-impl-3. `sendMessage`, `setTyping`, and the conversation upsert are public (no Convex auth middleware); the client passes its own `userId`/`senderId`. **Known v1 limitation:** a misbehaving client could spoof another user's messages or typing. Acceptable for v1 (≤10 trusted friends, Convex Cloud dev backend); hardening deferred. Flagged in `validation.md`.
- **D5 — History: retained forever, delivered via a reactive subscription to the full conversation history (no pagination in v1).** Per `specs/mission.md` ("retained forever for v1… revisit only if it becomes a problem"), a single reactive `listMessages(conversationId)` query subscribes to all messages in the conversation ordered by `createdAt`. For a ≤10-person group, any single 1:1 conversation stays small enough that an unbounded subscription is fine. Lazy-loading/pagination is explicitly deferred (YAGNI); revisit only if storage or subscription size becomes a problem. Reuses the Phase-0-proven reactive pattern (Phase 2 D6) — no polling, no manual websocket.
- **D6 — Validation: automated gates green + manual smokes.** Lint, typecheck, and `bun tauri build` must pass (inherited). Plus manual smokes for (i) send A→B live + B→A live, (ii) reopen DM shows full history, (iii) typing indicator A→B live, (iv) DM list reorders by `lastMessageAt` on new message. See `validation.md`.

## Context
- `specs/mission.md` — "Talk to one friend" is loop 1 of the three. History retained forever for v1 (no GC). No offline push in v1. Discord-derived look but pared down. ≤10-person group — any single conversation stays small (informs D5's no-pagination stance).
- `specs/tech-stack.md` — Realtime row: Convex reactive subscriptions → live DM delivery with no manual websocket/polling. Native notifications row exists but Phase 3 doesn't wire OS notifications (deferred).
- `specs/roadmap.md` Phase 2 — established the collapsible friends sidebar (the DM housing), the `users` + `presence` tables, the `getMyUser` query (the client knows its own `users._id`), and the reactive subscription + public-mutation patterns. Phase 3 reuses all of these and adds `conversations` + `messages` + `typing`.
- `specs/roadmap.md` Phase 3 DoD: *send a message from client A → appears on client B live; reopening the DM shows full history.*
- `convex/schema.ts` (current) — declares `users`, `presence`, and the `counter` scaffold remnant. Phase 3 adds `conversations`, `messages`, `typing`; `counter` is untouched (cleanup deferred).
- `src/components/AuthenticatedLayout.tsx` (current) — Phase-2 2-pane layout (sidebar + main). Phase 3 extends the main pane to render the active DM thread and makes the sidebar entries DM-selectable; the icon-rail deferral (D2) means no third column is added.
- `src/hooks/usePresence.ts` + `convex/presence.ts` (current) — the reactive-query + public-mutation + graceful-close patterns Phase 3 mirrors for chat (`useDMThread` / `convex/conversations.ts` / `convex/messages.ts`).

## User-performed prerequisites (not agent-executable)
- Phase 2 must be landed (present on the working branch) so the `users`/`presence` tables, the `getMyUser` query, and the collapsible sidebar are available. Phase 3 branches from the Phase-2 tip.
- The Convex dev backend (`bunx convex dev`) must be running (or re-run after schema changes) so `_generated/` is regenerated for the new `conversations`/`messages`/`typing` tables. The agent runs this; if the Convex deployment is unreachable, the user must confirm the dev backend / credentials.
- Two Discord test accounts (for the two-client live-delivery smoke) — the user must have (or create) a second Discord account to validate the live send/receive DoD. The agent cannot create Discord accounts.

# Phase 3 — 1:1 DM text: Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0/1/2 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regen via `bunx convex dev`). Branch: `phase-3/dm-text`, off the Phase-2 tip.

## 1. Prereqs check + schema additions
- 1.1 Confirm Phase 2 is present on the branch: the collapsible sidebar renders, `usePresence` works, `convex/presence.ts` exposes `getMyUser`/`listPresence`, and `convex/schema.ts` declares `users` + `presence`.
- 1.2 In `convex/schema.ts`, add three tables (Decision D1 + D3):
  - `conversations`: `type: v.string()` ("dm" now), `participantIds: v.array(v.id("users"))` (exactly 2 for a DM, stored sorted), `key: v.string()` (canonical sorted `"userIdA__userIdB"`), `createdAt: v.number()`, `lastMessageAt: v.number()`. Indexes: `byKey` on `["key"]` (unique lookup), `byLastMessage` on `["lastMessageAt"]`.
  - `messages`: `conversationId: v.id("conversations")`, `senderId: v.id("users")`, `body: v.string()`, `createdAt: v.number()`. Index: `byConversation` on `["conversationId", "createdAt"]`.
  - `typing`: `conversationId: v.id("conversations")`, `userId: v.id("users")`, `lastTyped: v.number()`. Index: `byConversation` on `["conversationId"]`.
  - Leave `users`, `presence`, and `counter` untouched.
- 1.3 Run `bunx convex dev` (or `bunx convex codegen`) to regenerate `_generated/` for the new tables; confirm imports resolve.
- **Done:** `conversations`, `messages`, `typing` declared + indexed; `_generated/` regenerated; lint/typecheck still clean.

## 2. Convex conversation + message functions (`convex/conversations.ts`, `convex/messages.ts`)
- 2.1 `getOrCreateDM(userIdA, userIdB)` mutation (in `conversations.ts`): compute the canonical `key` (sort the two ids, join with `"__"`); look up by `byKey`; if missing, insert `{ type: "dm", participantIds: [a,b] sorted, key, createdAt: now, lastMessageAt: now }`; if present, return its `_id`. Returns the `conversationId` for the caller to subscribe to. Public (Decision D4).
- 2.2 `listMyDMs(userId)` query: return all `conversations` where `participantIds` contains `userId`, joined with the peer's `users` profile + the last message (for preview/ordering), sorted by `lastMessageAt` desc. (Scan + filter — ≤10 group keeps this trivial; an array-membership index is not needed for v1.)
- 2.3 `sendMessage(conversationId, senderId, body)` mutation (in `messages.ts`): validate `body` (non-empty after trim, max length e.g. 4000 chars); insert `{ conversationId, senderId, body, createdAt: now }`; patch the parent `conversations.lastMessageAt = now` so the DM list reorders. Public (Decision D4).
- 2.4 `listMessages(conversationId)` query (in `messages.ts`): return all messages in the conversation ordered by `createdAt` asc, joined with each sender's profile (avatar, displayName/username). Reactive — the live feed for the DM thread (Decision D5). Full history, no pagination in v1.
- 2.5 All mutations public; document the v1 spoofing limitation in a comment matching `presence.ts`'s D7 note (Decision D4).
- **Done:** `conversations.ts` exposes `getOrCreateDM` + `listMyDMs`; `messages.ts` exposes `sendMessage` + `listMessages`; all public; lint/typecheck clean.

## 3. Convex typing functions (`convex/typing.ts`) (Decision D3)
- 3.1 `setTyping(conversationId, userId)` mutation: upsert the `typing` doc for `(conversationId, userId)` — set `lastTyped = now`. Called on keystroke (debounced ~300ms client-side).
- 3.2 `listTyping(conversationId)` query: return `typing` docs for the conversation joined with each user's profile, filtered to `lastTyped > now - 3000` (recency filter — stale docs are invisible, no cron needed for v1). Exclude the caller's own doc (the UI shows the peer typing, not self).
- 3.3 Public; document the v1 limitation (Decision D4).
- **Done:** `typing.ts` exposes `setTyping` + `listTyping`; "… is typing" is deliverable live.

## 4. Frontend — DM thread hook + composer
- 4.1 New `src/hooks/useDMThread.ts`: given a `conversationId` (or a peer `userId` → call `getOrCreateDM` first), subscribe to `listMessages` (reactive) and `listTyping` (reactive). Expose `messages`, `typingPeers`, and `send(body)` (calls `sendMessage`). Reuse the `getMyUser`-derived `users._id` from Phase 2 as `senderId`.
- 4.2 Composer: text input + send button; Enter sends (Shift+Enter newline); `body` validated client-side (non-empty, max length); on send, clear input and let `setTyping` go stale (or clear it). Wire `setTyping` on keystroke debounced ~300ms.
- 4.3 Message list: scrollable; bubbles own-right / peer-left; avatar + name header per peer message; auto-scroll to bottom on new message (and on initial history load).
- 4.4 Empty state: when no DM is selected, the main pane shows a "Select a friend to start chatting" placeholder (Decision D2).
- **Done:** an authenticated user can open a DM, see full history live, send a message that appears live, and see the peer's typing indicator.

## 5. Frontend — sidebar DM selection + 2-pane shell (Decision D2)
- 5.1 Extend `PresenceSidebar` (or a new `DMSidebar` wrapper): clicking a friend row calls `getOrCreateDM(myUserId, peerUserId)` → sets the active `conversationId` (lifted to `AuthenticatedLayout` state); the active DM is highlighted in the sidebar.
- 5.2 `AuthenticatedLayout`: replace the Phase-1 post-auth placeholder main content with the DM thread (task group 4) driven by the active `conversationId`; keep the sidebar + the Phase-2 presence/heartbeat/logout wiring intact.
- 5.3 Persist the last-opened `conversationId` locally (localStorage UI pref — not a credential) so reopening the app lands on the same DM.
- 5.4 No narrow icon rail (Decision D2) — the sidebar is the leftmost element; Phase 5 adds the icon rail when the group lobby lands.
- 5.5 Light Tailwind styling only (Phase 7 owns the polished theme).
- **Done:** the 2-pane shell works — sidebar selects a DM, main pane renders the thread live; Phase-2 presence/heartbeat/logout behavior is preserved.

## 6. Build + merge readiness
- 6.1 `bun run lint` + `bun run typecheck` — clean.
- 6.2 `bun tauri build` → release binary produced.
- 6.3 Walk the four manual smokes in `validation.md`: send A→B live; send B→A live; reopen DM shows full history; typing indicator A→B live; DM list reorders by `lastMessageAt`.
- 6.4 Update `README.md` Phase 3 notes (`conversations`/`messages`/`typing` tables, the generic model + Phase-5 retargeting note, the 2-pane shell, the public-mutation v1 limitation from Decision D4). Record a Phase 3 complete marker in `specs/roadmap.md` style with Phase 0/1/2's precedent.
- **Done:** all validation in `validation.md` passes; phase ready to merge.

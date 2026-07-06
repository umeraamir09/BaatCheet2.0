# Phase 3 — 1:1 DM text: Validation

How to know the implementation succeeded and can be merged. Per Decision D6, merge requires **automated gates green AND manual smokes**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors) — inherited from Phase 0/1/2.
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`) — inherited from Phase 0/1/2.
- [ ] `bun tauri build` completes and emits a release binary for the current platform — inherited from Phase 0/1/2.
- [ ] Convex schema deploys cleanly: `bunx convex dev` (or `codegen`) regenerates `_generated/` for the new `conversations`, `messages`, `typing` tables with no schema errors; `convex/schema.ts` declares all three with their indexes (Decision D1 + D3).
- [ ] No credentials/tokens introduced into the tree (Phase 1 D1 still holds): `git grep -iE "refresh[_-]?token|access[_-]?token"` returns nothing outside code identifiers; message bodies are not credentials.

## Manual smoke 1 — Send A→B live + B→A live (the Phase-3 DoD, first half)
1. Two machines (or two OS user profiles) running `bun tauri dev`, each logged in as a different Discord account (both in `users` via Phase 1 upsert; both appear in each other's sidebar via Phase 2). Requires the user's second Discord test account.
2. A clicks B in the sidebar → the 1:1 DM thread opens (a `conversations` doc with `type: "dm"` and the canonical sorted `key` is created; both A and B resolve to the same doc).
3. A types "hello" and sends → B's open DM thread (if B has it open) shows "hello" live within ~1s; if B hasn't opened it, B's sidebar shows the DM reorder to the top by `lastMessageAt`.
4. B replies "yo" → A sees "yo" live within ~1s. Confirm via DevTools that the message feed is a single live subscription (no polling).
- [ ] Pass: messages propagate live in both directions within ~1s; no manual refresh; both clients resolve to the same `conversations` doc.

## Manual smoke 2 — Reopening the DM shows full history (the Phase-3 DoD, second half)
1. A and B exchange several messages (smoke 1). A closes the DM (selects another friend or collapses) then reopens B's DM → the full ordered history is shown immediately (reactive `listMessages`).
2. A fully quits the app (graceful close) and relaunches → A lands on the last-opened DM (localStorage pref — task 5.3) with full history intact; Phase-2 presence/heartbeat still work (A reappears online to B).
3. Confirm history persists across relaunch with no truncation (no pagination in v1 — Decision D5); a brand-new message appends to the existing thread live.
- [ ] Pass: full history is restored on DM reopen and on app relaunch; no messages lost; the reactive subscription is unbounded (no lazy-loading in v1).

## Manual smoke 3 — Typing indicator A→B live (Decision D3)
1. A opens B's DM. B opens A's DM.
2. A starts typing in the composer → B sees "A is typing…" appear live within ~1s (debounced `setTyping` + recency-filtered `listTyping`).
3. A stops typing for >3s → B sees the indicator disappear (stale `lastTyped` filtered out by recency — no cron needed).
4. A sends the message → the indicator clears and the message appears on B (smoke 1).
- [ ] Pass: typing indicator appears/disappears live on B within ~1s and ~3s respectively; no stray "typing" after the message is sent.

## Manual smoke 4 — DM list reorders by lastMessageAt; sidebar selection round-trips
1. A has DMs open with B and with a third test user C. The sidebar lists A's DMs sorted by `lastMessageAt` desc (most recent first).
2. C sends A a message → A's sidebar reorders C's DM to the top live (the `sendMessage` mutation patched `conversations.lastMessageAt`).
3. A selects B, then C, then B again → the main pane swaps threads each time; the active DM is highlighted; the last selection (B) persists across app relaunch (localStorage pref).
- [ ] Pass: the DM list reorders live on new message; sidebar selection round-trips and persists; the 2-pane shell (Decision D2) behaves without an icon rail.

## Repo hygiene + Phase-3-specific checks
- [ ] The `conversations` + `messages` tables are **generic** (Decision D1): `conversations.type` is `"dm"` for 1:1 now and the same `messages` table backs all conversation types; Phase 5's group lobby will reuse both without a new message table. Confirm `conversations.key` is the canonical sorted `"userIdA__userIdB"` so both participants resolve to the same doc.
- [ ] The 2-pane shell (Decision D2) has **no narrow icon rail**: the sidebar is the leftmost element; the main pane swaps between DM threads (and the empty state). Confirm no third layout column was added (deferred to Phase 5).
- [ ] **Typing is included** (Decision D3): a `typing` table exists; `setTyping` upserts `lastTyped`; `listTyping` filters by recency (`lastTyped > now - 3000`); stale docs are invisible without a cron. Confirm no per-keystroke mutation (debounced ~300ms).
- [ ] History is delivered via a **single reactive subscription per conversation**, no pagination (Decision D5): confirm via DevTools that `listMessages` is one live query returning full history; no `take(N)`/load-more wiring in v1.
- [ ] Foreign-key integrity: `messages.conversationId` is `v.id("conversations")` and `messages.senderId`/`typing.userId` are `v.id("users")`; no message/typing doc exists without its parent.
- [ ] `sendMessage` patches `conversations.lastMessageAt` (so the DM list reorders — smoke 4); confirm the mutation does both the insert and the patch in one transaction.
- [ ] Phase-2 behavior is **preserved**: presence/heartbeat still work; the sidebar still shows online/offline + status; graceful close + log-out still fire `goOffline`; the sidebar is still collapsible. No regression in Phase-2 smokes.
- [ ] No extra Discord scopes requested (Phase 1 D4 `identify`-only still holds — re-verify `git grep -iE "scope.*email|scope.*guilds|scope.*presence"` returns nothing).
- [ ] **Known v1 limitation documented** (Decision D4): message/typing mutations are public (no Convex auth); a comment in `convex/messages.ts`/`convex/typing.ts`/`convex/conversations.ts` notes the spoofing risk and that hardening is deferred. README Phase 3 section records it.
- [ ] `counter` table (Phase-0 remnant) is untouched — not removed in Phase 3 (cleanup deferred).
- [ ] README Phase 3 section present: `conversations`/`messages`/`typing` tables, the generic model + Phase-5 retargeting note, the 2-pane shell (no icon rail), typing design, the public-mutation v1 limitation.

## Explicitly NOT validated here (out of scope — later phases)
- ~~Group text / hangout lobby~~ → Phase 5 (Decision D1 — the model retargets).
- ~~Narrow icon rail / DM-vs-group switcher~~ → Phase 5 (Decision D2).
- ~~Voice (1:1 or group)~~ → Phases 4, 6.
- ~~Message editing / deletion / reactions / attachments~~ → not in v1 (mission: pared-down; text only).
- ~~Read receipts / "seen" indicators~~ → not in v1.
- ~~Message search / full-text query~~ → not in v1.
- ~~Pagination / lazy-loading of history~~ → not in v1 (Decision D5 — revisit only if it becomes a problem).
- ~~Offline push notifications for DMs~~ → out of scope for v1 (`specs/mission.md`); Phase 3 wires no OS notifications.
- ~~Convex auth / per-user write authorization~~ → deferred (Decision D4 — public mutations are a known v1 limitation, not a validation failure).
- ~~Full Discord-derived theme~~ → Phase 7 (Phase 3 chat is functional, lightly styled).
- ~~Idle CPU/RAM profiling under gaming load~~ → Phase 7.

## Merge criteria
All automated gates green + manual smokes 1–4 passing + repo-hygiene + Phase-3-specific checks box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-3 DoD from `specs/roadmap.md` is satisfied when smokes 1 + 2 pass: *send a message from client A → appears on client B live; reopening the DM shows full history.* Smokes 3 + 4 validate Decision D3 (typing) and the DM-list ordering/shell behavior beyond the literal DoD.

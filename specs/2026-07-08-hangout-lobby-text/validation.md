# Phase 5 — Hangout lobby (text half): Validation

How to know the implementation succeeded and can be merged. Per Decision D9, merge requires **automated gates green AND manual smokes**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors) — inherited from Phase 0/1/2/3/4.
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`) — inherited from Phase 0/1/2/3/4.
- [ ] `bun tauri build` completes and emits a release binary for the current platform — inherited from Phase 0/1/2/3/4.
- [ ] Convex functions register cleanly: `bunx convex dev` (or `codegen`) regenerates `_generated/` for the new `lobby.ts` functions with no errors; `api.lobby.getOrCreateLobby` + `api.lobby.getLobby` resolve in the frontend. **No schema change expected** (Decision D1) — `convex/schema.ts` is untouched; the lobby is a `type:"group"` conversation reusing existing tables.
- [ ] No credentials/tokens introduced into the tree (Phase 1 D1 still holds): `git grep -iE "client[_-]?secret|refresh[_-]?token|access[_-]?token"` returns nothing outside code identifiers.
- [ ] No extra Discord scopes requested (Phase 1 D4 `identify`-only still holds): `git grep -iE "scope.*email|scope.*guilds|scope.*presence"` returns nothing.
- [ ] No schema file change (Decision D1): `git diff convex/schema.ts` shows no changes — the `conversations`/`messages`/`typing` tables are reused as-is. If the schema WAS changed, it must be justified (it shouldn't be — Phase 3 D1 designed for this).
- [ ] No new external dependencies: `package.json` does not gain any new dependency (the lobby reuses existing React + Convex + Tailwind; no new library).

## Manual smoke 1 — Post to lobby → all members see it live (the Phase-5 DoD, first half)
1. Two+ machines (or two OS user profiles) running `bun tauri dev`, each logged in as a different Discord account (both in `users` via Phase 1; both appear in each other's sidebar via Phase 2; both have `conversations`/`messages` via Phase 3). Requires the user's second Discord test account.
2. On client A, click the "Lobby" icon in the icon rail. The main pane switches to the `LobbyThread` (group text thread with a "Lobby" header). The lobby auto-creates on login (Decision D6) — if this is the first user, the `getOrCreateLobby` mutation creates the doc; if another user already created it, `getLobby` returns it reactively.
3. A types a message and sends it (Enter or Send button).
4. On client B (also viewing the lobby, or switching to the lobby after A sends), the message appears live within ~1s (reactive `listMessages` subscription — confirm via DevTools it is a live query, no polling). The message shows A's avatar + name (left-aligned, surface bubble) on B's client.
5. B sends a reply → A sees it live (right-aligned, blurple bubble on A's client since it's B's message from A's perspective). Confirm the round-trip is bidirectional and live.
- [ ] Pass: any group member posts to the lobby → all members viewing the lobby see it live within ~1s; messages show the correct sender avatar + name; no manual refresh.

## Manual smoke 2 — History persists across restarts (the Phase-5 DoD, second half)
1. Send a few messages to the lobby from multiple clients (smoke 1 setup). Note the last few messages.
2. Close the app on client A (fully quit, not just minimize). Reopen `bun tauri dev`.
3. A logs back in (session restore — no re-consent). Click the "Lobby" icon.
4. The full lobby history is present — all messages from step 1 are visible, in order, with correct sender avatars + names. No truncation (no pagination in v1 — Decision D1, inheriting Phase 3 D5).
5. Send a new message → it appears after the restored history; other clients see it live (smoke 1 path).
- [ ] Pass: lobby history is fully restored on app restart; no data loss; new messages append to the persisted history.

## Manual smoke 3 — Typing indicator in group context (multi-person)
1. Three clients (A, B, C) all viewing the lobby. (If only two accounts are available, this smoke validates the single-typer path; the multi-typer format is validated by code review.)
2. A starts typing in the lobby composer. B and C see "A is typing…" within ~1s (reactive `listTyping` subscription, debounced ~300ms on the sender side).
3. A stops typing → B and C see the indicator disappear within ~3s (recency filter — `lastTyped > now - 3000`, no cron).
4. A and B both start typing simultaneously → C sees "A and B are typing…" (2-typer format — Decision D5). If a third typer is available: A, B, and C all type → each sees "X, Y and 1 other is typing…" (3+ typer format).
5. The typing indicator is self-excluded (A does not see "A is typing" on A's own client).
- [ ] Pass: the typing indicator appears/disappears live in the group context; the multi-person format renders correctly (1, 2, and 3+ typers); self is excluded.

## Manual smoke 4 — Navigation round-trip: lobby ↔ DMs, view-mode persistence (Decisions D3, D10)
1. On client A, click the "Lobby" icon → main pane shows the `LobbyThread`. Click the "DMs" icon → main pane shows the previously selected DM (or `EmptyDMState` if none was selected). Click "Lobby" again → back to the lobby. Confirm the icon rail highlights the active destination.
2. While in "Lobby" mode, click a friend row in the sidebar → the view switches to "DMs" mode AND opens that friend's DM (cross-navigation — Decision D3). Confirm the icon rail highlight moves to "DMs".
3. While in "DMs" mode with a DM open, click the "Lobby" icon → the view switches to "Lobby" mode AND the main pane shows the `LobbyThread`. The previously-opened DM is still highlighted in the sidebar (the active-DM state is preserved; only the view mode changed).
4. Close the app while in "Lobby" mode. Reopen → the app lands in "Lobby" mode (view-mode persistence — Decision D10). Switch to "DMs" mode, close, reopen → lands in "DMs" mode. Confirm the `baatcheet.viewmode` localStorage key is set/cleared correctly.
5. Log out → log back in → the app lands in "Lobby" mode (default on fresh login — Decision D10; the persisted key was cleared on logout). Confirm `baatcheet.viewmode` is cleared in `handleLogout`.
- [ ] Pass: the icon rail switches between lobby and DMs; cross-navigation from sidebar to DMs works; view mode persists across relaunch and is cleared on logout; fresh login defaults to "lobby".

## Manual smoke 5 — No regression in Phase 2/3/4
1. **Phase 2 (presence):** the sidebar still shows all friends with online/offline dots + status text. Appear/disappear still works live. The status input still works. The sidebar is still collapsible (collapse toggle is on the sidebar, not the icon rail — confirm the icon rail stays visible when the sidebar is collapsed).
2. **Phase 3 (DM text):** switch to "DMs" mode. Open a DM. Send a message → the peer sees it live. Reopen the DM → full history. Typing indicator works in the DM. The DM list reorders by `lastMessageAt`. The last-opened DM persists across relaunch.
3. **Phase 4 (1:1 voice):** switch to "DMs" mode. Open a DM. Click the call button → the call flow works (toast, accept, two-way audio, mute/deafen, leave). While on a call, switch to "Lobby" mode → the floating call overlay persists (the call bar stays visible over the lobby thread — Decision D8). Switch back to "DMs" → the call is still active. Leave the call → overlay disappears from both views.
- [ ] Pass: no regression in presence, DM text, or 1:1 voice; the floating call overlay persists across view-mode switches; the sidebar collapse still works alongside the icon rail.

## Repo hygiene + Phase-5-specific checks
- [ ] **No schema change** (Decision D1): `git diff convex/schema.ts` is empty. The lobby is a `type:"group"` conversation doc reusing the existing `messages` + `typing` tables. This validates Phase 3 D1's forward-looking generic design.
- [ ] **Single lobby doc** (Decision D2): `getOrCreateLobby` uses the `byKey` index with `key === "group:lobby"` — there is exactly one lobby conversation. Confirm via Convex dashboard (or a query) that only one `type:"group"` doc exists after multiple users log in.
- [ ] **Lobby is excluded from the DM list**: `listMyDMs` filters `type === "dm"` — the lobby (`type:"group"`) does NOT appear in the sidebar's "Direct Messages" section. The lobby is accessed only via the icon rail.
- [ ] **Icon rail is the leftmost element** (Decision D3): the render order is `IconRail` → `PresenceSidebar` → `main`. The icon rail is ~56px wide, always visible (not collapsible). The sidebar collapse toggle is on the sidebar, not the icon rail.
- [ ] **`useChatThread` is the shared hook** (Decision D4): both `DMThread` and `LobbyThread` import `useChatThread` from `src/hooks/useChatThread.ts`. The old `useDMThread.ts` file is removed (not left as a dead duplicate). `git grep "useDMThread"` returns nothing.
- [ ] **LobbyThread has no call button** (Decision D8): the `LobbyThread` header shows a "Lobby" title + group icon only — no phone/call button. Group voice is Phase 6.
- [ ] **Auto-creation on login** (Decision D6): `AuthenticatedLayout` calls `getOrCreateLobby` once per session (ref-guarded) when `presence.userId` becomes available. Confirm the lobby doc is created on first login even if the user never clicks the lobby icon (check Convex dashboard after a fresh login).
- [ ] **View mode persistence** (Decision D10): the `baatcheet.viewmode` localStorage key is set on view-mode change, read on mount (defaulting to "lobby"), and cleared on logout. No cross-user leakage (cleared in `handleLogout` alongside `ACTIVE_DM_KEY`).
- [ ] **Floating call overlay persists across view modes** (Decision D8): the `CallControls` + `IncomingCallToast` render in `AuthenticatedLayout` OUTSIDE the view-mode conditional — they stay visible regardless of whether the user is viewing the lobby or a DM. A 1:1 call is independent of the active view.
- [ ] Foreign-key integrity: `messages.conversationId` and `typing.conversationId` for lobby messages reference the single `type:"group"` conversation doc. No orphaned lobby messages.
- [ ] **Public lobby mutations** (Decision D7): `getOrCreateLobby` is public (no Convex auth middleware), keyed by `userId`. The v1 spoofing limitation is documented in a comment in `convex/lobby.ts`. `sendMessage` + `setTyping` are already public (Phase 3 D4) — the lobby reuses them unchanged.
- [ ] `counter` table (Phase-0 remnant) is untouched — not removed in Phase 5 (cleanup deferred).
- [ ] **All three docs updated**: `README.md` Phase 5 section present (`## 3.5 Phase 5 — Hangout lobby (text half)`); `specs/roadmap.md` Phase 5 STATUS marker added; `AGENTS.md` phase status line updated to include Phase 5. The Phase 5 section records: the lobby conversation model (`type:"group"`, `key:"group:lobby"`), the no-schema-change retarget (D1), the icon rail (D3), the `useChatThread` generalization (D4), the auto-creation-on-login (D6), the view-mode persistence (D10), the public-mutation v1 limitation (D7), the deferred group voice (D8).

## Explicitly NOT validated here (out of scope — later phases)
- ~~Group voice / LiveKit SFU~~ → Phase 6 (Decision D8 — Phase 5 is text-only).
- ~~Side-by-side lobby layout (voice left, text right)~~ → Phase 6 (lands with group voice).
- ~~Multiple channels / rooms~~ → not in v1 (mission: one shared space).
- ~~Message editing / deletion / reactions / attachments~~ → not in v1.
- ~~Read receipts / "seen" indicators~~ → not in v1.
- ~~Message search / full-text query~~ → not in v1.
- ~~Pagination / lazy-loading of lobby history~~ → not in v1 (inheriting Phase 3 D5's YAGNI stance).
- ~~Lobby member roster panel~~ → deferred (presence sidebar covers who's online).
- ~~Offline push notifications for lobby messages~~ → out of scope for v1 (`specs/mission.md`).
- ~~Convex auth / per-user write authorization~~ → deferred (Decision D7 — public mutations are a known v1 limitation, not a validation failure).
- ~~Full Discord-derived theme polish~~ → Phase 7 (Phase 5 lobby UI is functional, lightly styled).
- ~~Idle CPU/RAM profiling under gaming load~~ → Phase 7.

## Merge criteria
All automated gates green + manual smokes 1–5 passing + repo-hygiene + Phase-5-specific checks box-checked. The Phase-5 DoD from `specs/roadmap.md` is satisfied when smokes 1 + 2 pass: *any group member posts to the lobby → all members see it live; history persists across restarts.* Smokes 3 + 4 + 5 validate the multi-person typing indicator (Decision D5), the navigation round-trip + view-mode persistence (Decisions D3, D10), and no-regression in Phase 2/3/4. Anything in the "NOT validated here" list is explicitly allowed to be absent. The key Phase-5 validation is **Decision D1 — no schema change**: the lobby is a pure UI retarget of the Phase-3 generic data model, and the automated gate `git diff convex/schema.ts` is empty proves it.

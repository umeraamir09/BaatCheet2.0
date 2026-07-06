# Phase 2 — Presence: Validation

How to know the implementation succeeded and can be merged. Per Decision D8, merge requires **automated gates green AND three manual smokes**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 (ESLint, no errors) — inherited from Phase 0/1.
- [ ] `bun run typecheck` exits 0 (`tsc --noEmit`) — inherited from Phase 0/1.
- [ ] `bun tauri build` completes and emits a release binary for the current platform — inherited from Phase 0/1.
- [ ] Convex schema deploys cleanly: `bunx convex dev` (or `codegen`) regenerates `_generated/` for the new `presence` table + cron with no schema errors; `convex/schema.ts` declares `presence` with `byUser` + `byDiscordId` indexes (Decision D1).
- [ ] No credentials/tokens introduced into the tree (Phase 1 D1 still holds): `git grep -iE "refresh[_-]?token|access[_-]?token"` returns nothing outside code identifiers; status text is not a credential.

## Manual smoke 1 — Two clients see each other appear/disappear live, with status, within ~1s (the Phase-2 DoD)
1. Two machines (or two OS user profiles) running `bun tauri dev`, each logged in as a different Discord account (both in the `users` table via Phase 1 upsert). Requires the user's second Discord test account.
2. Client A launches → A's sidebar shows A online; B (already running) sees **A appear online within ~1s** (reactive subscription — no refresh, no polling).
3. A sets a status text ("playing Helldivers 2") in the sidebar status input → B sees A's status line appear live (within ~1s).
4. A closes the window gracefully → B sees **A disappear (flip to offline) within ~1s** and A moves to the offline group (alpha-sorted).
5. Relaunch A → B sees A reappear online within ~1s; A's previously-set status text is still present (Decision D2 — status persists across sessions).
- [ ] Pass: appear/disappear + status propagate live within ~1s in both directions; no manual refresh; status persists across relaunch.

## Manual smoke 2 — Crash-disconnect → offline within ~30–35s (Decision D3 TTL path)
1. Client A is online (B sees A online). Force-kill A's process (Task Manager / `kill -9` equivalent / force-quit) so the graceful-close `setOffline` does **not** fire.
2. Confirm B still sees A online immediately after the kill (the sweep hasn't run yet).
3. Within ~30–35s (30s staleness + up to 5s until the next sweep), B sees A flip to **offline** automatically — no relaunch of B, no manual action.
4. Verify the Convex cron `sweepOffline` is registered and running (`bunx convex dashboard` or logs); confirm A's presence doc shows `online: false` after the sweep.
- [ ] Pass: a crashed client is marked offline by the TTL sweep within ~30–35s, with no user action; the graceful-close path is not required for this.

## Manual smoke 3 — Status set on A → visible on B live; log-out flips offline
1. A and B both online. A clears their status (empty string) → B sees A's status line disappear live.
2. A types a new status ("in a meeting") → B sees it live within ~1s (debounced write — confirm no per-keystroke fl).
3. A clicks "Log out" (Phase 1's log-out, now extended per task group 6): B sees A flip to **offline** within ~1s (graceful `setOffline`); A's heartbeat interval is stopped (no stray writes — confirm via Convex logs that no `heartbeat` mutations for A occur after log-out).
4. A logs back in → A reappears online on B; A's status text ("in a meeting") is retained (Decision D2 — status persists; only `online` flipped on log-out).
- [ ] Pass: status edits propagate live both directions; log-out cleanly flips offline and stops the heartbeat; status survives log-out/re-login.

## Repo hygiene + Phase-2-specific checks
- [ ] The `presence` table is **separate** from `users` (Decision D1): `convex/schema.ts` has both; heartbeats patch `presence`, not `users`. Confirm `users.ts` is unchanged in its profile-write behavior (Phase 1 upsert still works).
- [ ] The frontend learns its own `users._id` via `getMyUser(byDiscordId)` (task group 4.1); heartbeats write by `userId` — no presence doc is created without a matching `users` doc (foreign key integrity via `v.id("users")`).
- [ ] The sidebar groups **online first, then offline**, alpha-sorted within each group (Decision D4); every `users` doc appears (no friend-request gating — confirm a brand-new third user shows up for everyone once they've logged in once and have a `users` doc).
- [ ] The sidebar is **collapsible** (Decision D5); collapse state persists across relaunch (localStorage UI-pref is acceptable — it is not a credential).
- [ ] Presence updates are **reactive only**: no `setInterval`-driven re-reads of the list, no polling. The only periodic write is the ~10s heartbeat (a mutation, not a read). Confirm via DevTools/network that the list query is a single live subscription.
- [ ] The cron `sweepOffline` is registered in `convex/cron.ts` and runs every ~5s with a 30s staleness threshold (Decision D3); confirm via Convex dashboard/logs.
- [ ] Graceful close fires `setOffline`: closing the Tauri window (not force-kill) flips the user offline within ~1s (smoke 1 step 4 covers this); confirm the Tauri close-requested listener is wired (task group 4.3).
- [ ] No Idle/DND states exist (Decision D2 — binary only); the only status field is the free-text `status` string. No extra Discord scopes were requested (Phase 1 D4 `identify`-only still holds — re-verify `git grep -iE "scope.*email|scope.*guilds|scope.*presence"` returns nothing).
- [ ] **Known v1 limitation documented** (Decision D7): presence mutations are public (no Convex auth); a comment in `convex/presence.ts` notes the spoofing risk and that hardening is deferred. README Phase 2 section records it.
- [ ] `counter` table (Phase-0 remnant) is untouched — not removed in Phase 2 (cleanup deferred).
- [ ] README Phase 2 section present: `presence` table, heartbeat + TTL sweep design, sidebar, status-persistence behavior, the public-mutation v1 limitation.

## Explicitly NOT validated here (out of scope — later phases)
- ~~1:1 DM text or any chat~~ → Phase 3 (the sidebar built here is the housing).
- ~~Typing indicators~~ → Phase 3 (not pulled forward — Decision D3).
- ~~Voice (1:1 or group)~~ → Phases 4, 6.
- ~~Idle / Do-Not-Disturb states~~ → not in v1 (Decision D2).
- ~~"Now playing" pulled from Discord rich presence~~ → not feasible with `identify`; self-set status only (Decision D2).
- ~~Friend requests / blocking~~ → not on the v1 roadmap (`specs/mission.md`).
- ~~3-pane app shell~~ → Phase 3+ (Decision D5 — only the sidebar rail lands now).
- ~~Convex auth / per-user write authorization~~ → deferred (Decision D7 — public mutations are a known v1 limitation, not a validation failure).
- ~~Offline push notifications~~ → out of scope for v1 (`specs/mission.md`); Phase 2 adds no notifications.
- ~~Full Discord-derived theme~~ → Phase 7 (Phase 2 sidebar is functional, lightly styled).
- ~~Idle CPU/RAM profiling under gaming load~~ → Phase 7 (Phase 2's heartbeat is one small write every 10s but is not profiled here).

## Merge criteria
All automated gates green + manual smokes 1–3 passing + repo-hygiene + Phase-2-specific checks box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-2 DoD from `specs/roadmap.md` is satisfied when smokes 1 + 3 pass: *two clients online → each sees the other appear/disappear live, with status text, within a second.* Smoke 2 validates the crash-resilience path (Decision D3) beyond the literal DoD.

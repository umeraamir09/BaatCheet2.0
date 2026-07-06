# Phase 2 — Presence: Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0/1 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regen via `bunx convex dev`). Branch: `phase-2/presence`, off the Phase-1 tip.

## 1. Prereqs check + schema additions
- 1.1 Confirm Phase 1 is present on the branch: authenticated state surfaces the user (discordId, username, displayName, avatarUrl) in `useAuth`/`App.tsx`; `convex/users.ts` `upsertUser` works; the `users` table exists in `convex/schema.ts`.
- 1.2 In `convex/schema.ts`, add the `presence` table (Decision D1):
  - Fields: `userId: v.id("users")`, `discordId: v.string()` (denormalized for client matching), `status: v.string()` (default `""`), `online: v.boolean()`, `lastSeen: v.number()`.
  - Indexes: `byUser` on `["userId"]`, `byDiscordId` on `["discordId"]`.
  - Leave `users` and `counter` tables untouched.
- 1.3 Run `bunx convex dev` (or `bunx convex codegen`) to regenerate `_generated/` for the new table; confirm imports resolve.
- **Done:** `presence` table declared + indexed; `_generated/` regenerated; lint/typecheck still clean.

## 2. Convex presence functions (`convex/presence.ts`)
- 2.1 `getMyUser(discordId)` query: returns the caller's `users` doc (`_id`, profile fields) by `byDiscordId` index. The frontend uses this to learn its `users._id` for heartbeat writes (Decision D1). Returns `null` if not found (Phase 1 upsert should have created it; if null, frontend calls `upsertUser` first).
- 2.2 `listPresence()` query: returns all presence docs joined with their `users` profile — `{ _id, userId, discordId, status, online, lastSeen, user: { displayName, username, avatarUrl } }`. This is the reactive feed for the sidebar (Decision D6). Sort: `online` true first, then by displayName/username alpha.
- 2.3 `setOnline(userId, discordId)` mutation: upsert the presence doc for this user — if missing, insert `{ userId, discordId, status: "", online: true, lastSeen: now }`; if present, patch `{ online: true, lastSeen: now }` (preserve existing `status`). Called on login / session restore.
- 2.4 `heartbeat(userId)` mutation: patch `{ lastSeen: now }` on the presence doc (and leave `online: true`). Called every ~10s by the frontend. Light write (Decision D3).
- 2.5 `setStatus(userId, status)` mutation: patch `{ status }` on the presence doc (max length enforced server-side, e.g. 128 chars). Called when the user edits their status line.
- 2.6 `setOffline(userId)` mutation: patch `{ online: false, lastSeen: now }` (preserve `status`). Called on graceful close / log out / explicit "go offline."
- 2.7 All mutations are public (no Convex auth — Decision D7); document the v1 spoofing limitation in a comment matching `users.ts`'s D-impl-3 note.
- **Done:** `presence.ts` exposes `getMyUser`, `listPresence`, `setOnline`, `heartbeat`, `setStatus`, `setOffline`; all public; lint/typecheck clean.

## 3. Convex cron — offline TTL sweep (Decision D3)
- 3.1 Create `convex/cron.ts` (or extend if present) registering a `sweepOffline` scheduled function to run every ~5s.
- 3.2 `sweepOffline` internal mutation/function: query all `presence` docs where `online === true`; for each with `lastSeen < now - 30_000`, patch `{ online: false }`. (30s staleness threshold; 5s sweep → crash-disconnect resolves within ~30–35s.)
- 3.3 Keep it cheap: indexed query, small table (≤10 docs), one sweep pass. No per-doc reads beyond the scan.
- **Done:** a crashed/killed client is flipped to offline by the sweep within ~30–35s; a graceful close is offline immediately (task group 6).

## 4. Frontend — learn own `users._id` + presence state hook
- 4.1 After Phase-1 auth success (fresh login or session restore), call `getMyUser(discordId)` (reactive query) to get the user's Convex `_id`. If `null`, call `upsertUser` first then re-query.
- 4.2 New `src/hooks/usePresence.ts`:
  - On mount (when authenticated + `users._id` known): call `setOnline(userId, discordId)`, then start a heartbeat interval (`setInterval` ~10_000ms → `heartbeat(userId)`). Store the interval handle.
  - On unmount / log out / `beforeunload` / Tauri window close: clear the interval and call `setOffline(userId)`.
  - Expose `setStatus(text)` to the status input.
- 4.3 Handle Tauri lifecycle events for graceful-close: listen to the Tauri window `close-requested` / `onCloseRequested` event (and app quit) to fire `setOffline` before the process exits. Use a `fetch` keepalive-equivalent / Tauri command if needed so the write isn't dropped on exit.
- 4.4 Guard against duplicate heartbeats across React strict-mode double-mount (dev) — single instance via a ref/flag.
- **Done:** an authenticated client has a `users._id`, is `online` in Convex, heartbeats every ~10s, and goes `offline` on close/logout/unmount.

## 5. Frontend — sidebar + presence list UI (Decisions D4 + D5)
- 5.1 New `src/components/PresenceSidebar.tsx` (or under `src/sidebar/`): a collapsible left rail.
  - Subscribes to `listPresence()` (reactive — Decision D6); re-renders live on any presence change.
  - Renders rows grouped **online first** (alpha by displayName, fallback username), **then offline** (alpha). Each row: avatar, name, status text (if non-empty), online/offline dot.
  - Collapse control: toggle between full list and a narrow icon rail (or hidden); state persisted locally (localStorage is fine for UI prefs — this is not a credential).
- 5.2 A small status input (e.g. a text field at the top of the sidebar or a profile popover) bound to `setStatus`; debounced (~300ms) to avoid a write per keystroke; max 128 chars.
- 5.3 Wrap the Phase-1 post-auth screen in a layout: `<PresenceSidebar />` + the existing main content. No other chrome (Decision D5 — sidebar is the only new chrome; main area unchanged).
- 5.4 Light styling only (Tailwind, dark-ish); the polished Discord-derived theme is Phase 7. Functional first.
- **Done:** authenticated user sees a collapsible sidebar listing all friends with live online/offline + status; editing own status updates it for everyone.

## 6. Log-out / teardown integration
- 6.1 Extend the Phase-1 log-out path (`src/auth.ts` / `useAuth`): before clearing tokens, clear the heartbeat interval and call `setOffline(userId)` (best-effort; don't block token clear on the write).
- 6.2 Confirm `online` flips to `false` for the logging-out user and that other clients see it live (covered in smoke 3).
- **Done:** log out leaves the user offline in Convex; the heartbeat is stopped; Phase-1 token-clear behavior is preserved.

## 7. Build + merge readiness
- 7.1 `bun run lint` + `bun run typecheck` — clean.
- 7.2 `bun tauri build` → release binary produced.
- 7.3 Walk the three manual smokes in `validation.md`: two-client live appear/disappear with status (~1s); crash-disconnect → offline (~30–35s); status set on A → visible on B live.
- 7.4 Update `README.md` Phase 2 notes (presence table, heartbeat/TTL design, sidebar, the public-mutation v1 limitation from Decision D7). Record a Phase 2 complete marker in `specs/roadmap.md` style with Phase 0/1's precedent.
- **Done:** all validation in `validation.md` passes; phase ready to merge.

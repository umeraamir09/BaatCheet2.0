# Phase 5 — Hangout lobby (text half): Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0/1/2/3/4 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regen via `bunx convex dev`). Branch: `phase-5/hangout-lobby-text`, off the Phase-4 tip.

## 1. Prereqs check + lobby Convex functions (Decisions D1, D2, D6, D7)
- 1.1 Confirm Phase 4 is present on the branch: the 2-pane shell renders, `useDMThread` + `usePresence` + `useCall` work, `convex/schema.ts` declares `users`/`presence`/`conversations`/`messages`/`typing`/`calls`, `AuthenticatedLayout` owns the active-DM state + floating call overlay + Tauri close-requested teardown, and the DM thread has the Phase-4 call button.
- 1.2 Confirm NO schema change is needed (Decision D1): `conversations.type` is already `v.string()` (can hold `"group"`), `participantIds` is already `v.array(v.id("users"))` (can hold >2), `key` is already `v.string()` (can hold `"group:lobby"`), and `messages`/`typing` are already keyed on `conversationId` with no DM-specific coupling. Verify `listMyDMs` filters `type === "dm"` so the lobby is excluded from the DM list.
- 1.3 Create `convex/lobby.ts` with two functions (Decision D2):
  - `getOrCreateLobby(userId)` mutation: look up `conversations` by `key === "group:lobby"` via `byKey` index (`.unique()`); if found, check if `userId` is in `participantIds` — if not, patch to append it; if missing, insert `{ type: "group", participantIds: [userId], key: "group:lobby", createdAt: Date.now(), lastMessageAt: Date.now() }`; return the `conversationId` (`Id<"conversations">`). Public (Decision D7). Document the v1 spoofing limitation in a comment matching `conversations.ts`/`messages.ts`.
  - `getLobby` query (reactive, no args): return the single `conversations` doc where `key === "group:lobby"` via `byKey` index (`.unique()`), or `null` if it doesn't exist yet. Powers the reactive lobby-id subscription.
- 1.4 Run `bunx convex dev` (or `bunx convex codegen`) to register the new `lobby.ts` functions in `_generated/`; confirm `api.lobby.getOrCreateLobby` + `api.lobby.getLobby` resolve.
- **Done:** `lobby.ts` exposes the 1 mutation + 1 query; all public; the v1 spoofing limitation is documented; `_generated/` regenerated; lint/typecheck clean. No schema file change (D1).

## 2. Chat hook generalization (Decision D4 — mechanical rename)
- 2.1 Rename `src/hooks/useDMThread.ts` → `src/hooks/useChatThread.ts` (git mv or delete + create).
- 2.2 Rename the export `useDMThread` → `useChatThread` and the interface `UseDMThreadResult` → `UseChatThreadResult`. Update the JSDoc comment to note the hook is shared by DMThread + LobbyThread (generic — keyed on `conversationId`, not DM-specific).
- 2.3 Update `src/components/DMThread.tsx` import: `import { useDMThread } from "../hooks/useDMThread"` → `import { useChatThread } from "../hooks/useChatThread"`. Update the call site `useDMThread(conversationId, myUserId)` → `useChatThread(conversationId, myUserId)`. Update the destructured type if referenced.
- 2.4 Confirm no other files import `useDMThread` (grep `useDMThread` — should only be `DMThread.tsx` + the old file). The `useCall.test.ts` file does not import it.
- **Done:** the hook is honestly named `useChatThread`; `DMThread` uses the renamed hook; lint/typecheck clean; no behavior change (pure rename).

## 3. LobbyThread component (`src/components/LobbyThread.tsx`, Decision D5)
- 3.1 Create `src/components/LobbyThread.tsx`. Props: `conversationId: Id<"conversations">`, `myUserId: Id<"users">`. (No peer profile, no peer online, no call button — Decision D8.)
- 3.2 Use `useChatThread(conversationId, myUserId)` for `messages`, `typingPeers`, `send`, `notifyTyping` — same as `DMThread`.
- 3.3 Header: a group/hash icon + "Lobby" title + a subtitle "The whole group" (or a live online-count from the presence list if easily available — optional; the count is a nice-to-have, not a DoD requirement). No call button (Decision D8).
- 3.4 Message list: reuse the same bubble rendering as `DMThread` — own messages right-aligned (blurple bubble, no name), others left-aligned (surface bubble, sender avatar + display name/username). If `MessageBubble` + `Composer` are extracted to a shared module (e.g. `src/components/chat/`), import from there; otherwise duplicate the small sub-components in `LobbyThread` (they're ~30 lines each — duplication is acceptable for v1; extraction is a D5 judgment call, not a requirement). Auto-scroll to bottom on new message + on mount (same `bottomRef` + `useEffect` pattern as `DMThread`).
- 3.5 Typing indicator — multi-person format (Decision D5):
  - 0 typers: no text.
  - 1 typer: "X is typing…".
  - 2 typers: "X and Y are typing…".
  - 3+ typers: "X, Y and N others are typing…" (where N = `typingPeers.length - 2`).
  - Names: `displayName ?? username` from the `listTyping` join (same as `DMThread`).
- 3.6 Composer: identical to `DMThread`'s (textarea + Send button; Enter sends, Shift+Enter newline; `notifyTyping` on keystroke; `MAX_MESSAGE_LEN` cap). If extracted, import the shared `Composer`; otherwise duplicate.
- 3.7 Empty state: "No messages yet. This is the group lobby — say hi to everyone!" (group-flavored vs. the DM's "Say hi!").
- 3.8 Light Tailwind styling only (Phase 7 owns polish). Reuse the existing `discord-bg`/`discord-surface`/`discord-blurple` theme tokens.
- **Done:** `LobbyThread` renders a group text thread with multi-person typing + composer; reuses `useChatThread`; no call button; lint/typecheck clean.

## 4. Icon rail (`src/components/IconRail.tsx`, Decision D3)
- 4.1 Create `src/components/IconRail.tsx`. Props: `viewMode: "lobby" | "dms"`, `onSelect: (mode: "lobby" | "dms") => void`.
- 4.2 Render a narrow (~56px / `w-14`) vertical bar, full height, `bg-discord-surface` with a right border. Two icon buttons stacked at the top:
  - "Lobby" button: a group/hash icon (SVG). Active state: left border accent + brighter icon. Title tooltip: "Group Lobby".
  - "Direct Messages" button: a person/direct-message icon (SVG). Active state: left border accent + brighter icon. Title tooltip: "Direct Messages".
- 4.3 The icon rail is NOT collapsible (Decision D3 — it's the persistent navigation spine). The existing sidebar collapse toggle stays on the `PresenceSidebar`.
- 4.4 Active indicator: a small white pill or left-border accent on the selected icon (Discord-style). Inactive icons: `text-white/50 hover:text-white`. Active icons: `text-white` + a 2-4px left accent bar (`bg-white` or `bg-discord-blurple`).
- 4.5 Light Tailwind styling only (Phase 7 owns polish).
- **Done:** the icon rail renders two navigable destinations with active-state highlighting; lint/typecheck clean.

## 5. AuthenticatedLayout integration (Decisions D3, D6, D8, D10)
- 5.1 Add view-mode state: `const [viewMode, setViewMode] = useState<"lobby" | "dms">(() => { try { return (localStorage.getItem(VIEW_MODE_KEY) as "lobby" | "dms") ?? "lobby"; } catch { return "lobby"; } });` (Decision D10 — default "lobby" on fresh login). Add `const VIEW_MODE_KEY = "baatcheet.viewmode";` constant.
- 5.2 Persist view mode on change: a `useEffect` or inline in the setter that writes `localStorage.setItem(VIEW_MODE_KEY, mode)` (same pattern as `collapsed` + `ACTIVE_DM_KEY`). Clear on logout (`localStorage.removeItem(VIEW_MODE_KEY)` in `handleLogout`).
- 5.3 Lobby auto-creation (Decision D6): add a `useMutation(api.lobby.getOrCreateLobby)` + a reactive `useQuery(api.lobby.getLobby, {})`. Add a `useEffect` that fires `getOrCreateLobby({ userId: presence.userId })` once when `presence.userId` becomes available — ref-guarded (`lobbyCreatedRef`) so it runs once per session. The `getLobby` query reactively provides the `conversationId` once the doc lands.
- 5.4 Render the icon rail as the leftmost element (before `PresenceSidebar`): `<IconRail viewMode={viewMode} onSelect={setViewModePersisted} />`.
- 5.5 Main pane conditional rendering (Decision D3):
  - If `viewMode === "lobby"` AND `getLobby` returned a conversation AND `presence.userId`: render `<LobbyThread conversationId={lobby._id} myUserId={presence.userId} />`.
  - If `viewMode === "lobby"` AND `getLobby` is still loading/null: render a loading/empty state ("Loading lobby…" or the empty state — the auto-creation mutation should land within ~1s).
  - If `viewMode === "dms"`: render the existing `DMThread` / `EmptyDMState` (unchanged from Phase 4).
- 5.6 Cross-navigation (Decision D3): in `selectPeer` + `selectDM`, add `setViewMode("dms")` (and persist) so clicking a friend/DM while in "Lobby" mode switches to "DMs" mode + opens that DM. No change to the `PresenceSidebar` component itself — the callbacks flow through `AuthenticatedLayout`.
- 5.7 The floating call overlay (`CallControls` + `IncomingCallToast`) persists across view-mode switches (Decision D8 — a 1:1 call is independent of the active view). No change to the call rendering logic; it stays in `AuthenticatedLayout` outside the view-mode conditional.
- 5.8 Logout: clear `VIEW_MODE_KEY` alongside `ACTIVE_DM_KEY` in `handleLogout` (no cross-user leakage — Decision D10). The existing call teardown + `goOffline` ordering is unchanged.
- 5.9 The Tauri `onCloseRequested` teardown is unchanged — the lobby has no teardown needs (it's a persisted conversation, not a live call or presence heartbeat). The existing `call.leave()` + `goOffline()` sequence is preserved.
- **Done:** the icon rail switches the main pane between lobby and DMs; the lobby auto-creates on login; view mode persists + clears on logout; the floating call overlay persists across modes; DM selection cross-navigates to "dms" mode; lint/typecheck clean.

## 6. Build + merge readiness
- 6.1 `bun run lint` + `bun run typecheck` — clean.
- 6.2 `bun tauri build` → release binary produced.
- 6.3 Walk the manual smokes in `validation.md`: post to lobby → all see live; history persists across restarts; typing indicator in group context; navigation round-trip (lobby ↔ DMs, view-mode persistence); no regression in Phase 2/3/4.
- 6.4 Update **all three** docs (inherited gap-prevention): `README.md` Phase 5 section (`## 3.5 Phase 5 — Hangout lobby (text half)` — the lobby conversation model, the no-schema-change retarget, the icon rail, the `useChatThread` generalization, the auto-creation-on-login, the view-mode persistence, the public-mutation v1 limitation from Decision D7, the deferred group voice from Decision D8); `specs/roadmap.md` Phase 5 STATUS marker; `AGENTS.md` phase status line (add Phase 5 to the status list). Record a Phase 5 complete marker in `specs/roadmap.md` style with Phase 0–4's precedent.
- **Done:** all validation in `validation.md` passes; phase ready to merge.

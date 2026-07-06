import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import type { UsePresenceResult } from "../hooks/usePresence";
import type { User } from "../auth";
import type { PeerProfile } from "./DMThread";

const MAX_STATUS_LEN = 128;

/** A single entry from the reactive `listPresence` query. */
type PresenceEntry = NonNullable<FunctionReturnType<typeof api.presence.listPresence>>[number];

/** A single entry from the reactive `listMyDMs` query. */
type DMEntry = NonNullable<FunctionReturnType<typeof api.conversations.listMyDMs>>[number];

interface PresenceSidebarProps {
  presence: UsePresenceResult;
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: User;
  onLogout: () => Promise<void> | void;
  /** Active conversation id (highlight + restore). */
  activeConversationId: Id<"conversations"> | null;
  /** Active peer user id (for highlighting a friend row before the conv resolves). */
  activePeerUserId: Id<"users"> | null;
  /** Click a friend row → open/create a DM with that peer. */
  onSelectPeer: (peerUserId: Id<"users">, peerProfile: PeerProfile | null) => void;
  /** Click a DM row → select an existing conversation. */
  onSelectDM: (
    conversationId: Id<"conversations">,
    peerUserId: Id<"users">,
    peerProfile: PeerProfile | null,
  ) => void;
}

/**
 * Collapsible left sidebar rail (Phase 2 — D4/D5; extended Phase 3 — D2).
 *
 * Phase 3 adds two things on top of the Phase-2 presence list (both
 * preserved — no icon rail, D2):
 *  - a "Direct Messages" section subscribing to `listMyDMs` (reorderable by
 *    `lastMessageAt`, with last-message preview — smoke 4);
 *  - clickable rows: friend row → `onSelectPeer` (open/create DM); DM row →
 *    `onSelectDM` (select existing). Active row highlighted.
 *
 * The sidebar remains the leftmost element (D2 — no narrow icon rail; that
 * defers to Phase 5). A self/logout footer replaces the Phase-1 logout button
 * that used to live in the main pane (the main pane is now the DM thread).
 */
export function PresenceSidebar({
  presence,
  collapsed,
  onToggleCollapse,
  user,
  onLogout,
  activeConversationId,
  activePeerUserId,
  onSelectPeer,
  onSelectDM,
}: PresenceSidebarProps) {
  const presenceList = useQuery(api.presence.listPresence, {}) ?? [];
  const myDMs =
    useQuery(api.conversations.listMyDMs, presence.userId ? { userId: presence.userId } : "skip") ??
    [];

  // Self is excluded from the friends list (you don't DM yourself).
  const friends = presenceList.filter((p) => p.discordId !== user.id);

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 flex-col items-center gap-3 border-r border-gray-800 bg-gray-950 py-3">
        <button
          onClick={onToggleCollapse}
          title="Expand sidebar"
          className="text-gray-400 hover:text-white"
        >
          <ChevronIcon direction="right" />
        </button>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {friends.map((p) => (
            <button
              key={p._id}
              onClick={() => onSelectPeer(p.userId, p.user)}
              title={p.user?.displayName ?? p.user?.username ?? ""}
              className="relative rounded"
            >
              <img src={p.user?.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
              <span
                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-gray-950 ${
                  p.online ? "bg-green-500" : "bg-gray-600"
                }`}
              />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-800 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">BaatCheet</h2>
        <button
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          className="text-gray-400 hover:text-white"
        >
          <ChevronIcon direction="left" />
        </button>
      </div>

      <StatusInput
        value={presence.myStatus}
        onChange={presence.setStatus}
        disabled={!presence.userId}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Direct Messages (Phase 3 — smoke 4 reorderable list) */}
        {myDMs.length > 0 && (
          <div className="border-b border-gray-800 px-1 py-1">
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Direct Messages
            </p>
            {myDMs.map((dm) => (
              <DMRow
                key={dm._id}
                dm={dm}
                active={dm.conversationId === activeConversationId}
                onSelect={() => {
                  // A DM always has a peer; guard for TS (peerUserId is nullable
                  // in the query return shape).
                  if (dm.peerUserId) {
                    onSelectDM(dm.conversationId, dm.peerUserId, dm.peer);
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* All friends (Phase 2 list, preserved — now DM-launchable) */}
        <div className="px-1 py-1">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Friends
          </p>
          {friends.length === 0 && (
            <p className="px-2 py-2 text-sm text-gray-500">No friends yet.</p>
          )}
          {friends.map((p) => (
            <PresenceRow
              key={p._id}
              entry={p}
              active={p.userId === activePeerUserId}
              onSelect={() => onSelectPeer(p.userId, p.user)}
            />
          ))}
        </div>
      </div>

      {/* Self + log out footer (replaces the Phase-1 main-pane logout button) */}
      <footer className="flex items-center gap-2 border-t border-gray-800 bg-gray-950 px-2 py-2">
        <img
          src={user.avatarUrl}
          alt={`${user.username} avatar`}
          className="h-8 w-8 rounded-full"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {user.displayName ?? user.username}
          </p>
          <p className="truncate text-xs text-gray-400">@{user.username}</p>
        </div>
        <button
          onClick={onLogout}
          title="Log out"
          className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          <LogoutIcon />
        </button>
      </footer>
    </aside>
  );
}

/** A DM row: avatar, name, last-message preview. Reorderable by lastMessageAt. */
function DMRow({ dm, active, onSelect }: { dm: DMEntry; active: boolean; onSelect: () => void }) {
  const name = dm.peer?.displayName ?? dm.peer?.username ?? "Unknown";
  const preview = dm.lastMessage?.body ?? "";
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-900 ${
        active ? "bg-gray-800" : ""
      }`}
    >
      <img
        src={dm.peer?.avatarUrl}
        alt={`${name} avatar`}
        className="h-8 w-8 shrink-0 rounded-full"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-100">{name}</p>
        {preview && <p className="truncate text-xs text-gray-500">{preview}</p>}
      </div>
    </button>
  );
}

/** A presence row: avatar, name, status text, online/offline dot. Clickable. */
function PresenceRow({
  entry,
  active,
  onSelect,
}: {
  entry: PresenceEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const name = entry.user?.displayName ?? entry.user?.username ?? "Unknown";
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-gray-900 ${
        active ? "bg-gray-800" : ""
      }`}
    >
      <div className="relative shrink-0">
        <img src={entry.user?.avatarUrl} alt={`${name} avatar`} className="h-9 w-9 rounded-full" />
        <span
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-gray-950 ${
            entry.online ? "bg-green-500" : "bg-gray-600"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${
            entry.online ? "text-white" : "text-gray-500"
          }`}
        >
          {name}
        </p>
        {entry.status && <p className="truncate text-xs text-gray-400">{entry.status}</p>}
      </div>
    </button>
  );
}

/** Self-set status input (Decision D2). Debounced in the hook (~300ms). */
function StatusInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="border-b border-gray-800 px-3 py-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={MAX_STATUS_LEN}
        placeholder={disabled ? "Connecting…" : "Set a status…"}
        className="w-full rounded bg-gray-900 px-2 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-700 disabled:opacity-50"
      />
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={direction === "right" ? "" : "rotate-180"}
    >
      <path
        d="M10 4L6 8L10 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

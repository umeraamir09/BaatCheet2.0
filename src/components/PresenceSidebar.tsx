import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { UsePresenceResult } from "../hooks/usePresence";

const MAX_STATUS_LEN = 128;

/** A single entry from the reactive `listPresence` query. */
type PresenceEntry = NonNullable<FunctionReturnType<typeof api.presence.listPresence>>[number];

interface PresenceSidebarProps {
  presence: UsePresenceResult;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * Collapsible left sidebar rail (Phase 2 — Decisions D4 + D5).
 *
 * Subscribes to `listPresence` (reactive — D6); re-renders live on any presence
 * change. Renders rows grouped online-first (alpha by displayName, fallback
 * username), then offline (alpha). Each row: avatar, name, status text (if any),
 * online/offline dot. A status input at the top binds to `usePresence.setStatus`.
 *
 * The sidebar is the ONLY new chrome in Phase 2 (D5) — the main area stays the
 * Phase-1 post-auth screen.
 */
export function PresenceSidebar({ presence, collapsed, onToggleCollapse }: PresenceSidebarProps) {
  const presenceList = useQuery(api.presence.listPresence, {}) ?? [];
  console.log("[PresenceSidebar] render — collapsed:", collapsed, "presenceList length:", presenceList.length, "list:", presenceList);

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
        <div className="flex flex-col gap-2 overflow-y-auto">
          {presenceList.map((p) => (
            <div key={p._id} className="relative" title={p.user?.displayName ?? p.user?.username}>
              <img
                src={p.user?.avatarUrl}
                alt=""
                className="h-8 w-8 rounded-full"
              />
              <span
                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-gray-950 ${
                  p.online ? "bg-green-500" : "bg-gray-600"
                }`}
              />
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-800 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Friends
        </h2>
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

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {presenceList.length === 0 && (
          <p className="px-2 py-4 text-sm text-gray-500">No friends yet.</p>
        )}
        {presenceList.map((p) => (
          <PresenceRow key={p._id} entry={p} />
        ))}
      </div>
    </aside>
  );
}

/** A single presence row: avatar, name, status text, online/offline dot. */
function PresenceRow({ entry }: { entry: PresenceEntry }) {
  const name = entry.user?.displayName ?? entry.user?.username ?? "Unknown";
  return (
    <div className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-gray-900">
      <div className="relative">
        <img
          src={entry.user?.avatarUrl}
          alt={`${name} avatar`}
          className="h-9 w-9 rounded-full"
        />
        <span
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-gray-950 ${
            entry.online ? "bg-green-500" : "bg-gray-600"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${entry.online ? "text-white" : "text-gray-500"}`}>
          {name}
        </p>
        {entry.status && (
          <p className="truncate text-xs text-gray-400">{entry.status}</p>
        )}
      </div>
    </div>
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

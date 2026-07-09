/**
 * Phase 5 — Icon rail (Decision D3).
 *
 * Narrow (~56px) leftmost vertical rail with "Lobby" and "Direct Messages"
 * icons. The deferred Phase-3 D2 navigation surface. Always visible (not
 * collapsible — it's the persistent navigation spine). Active destination
 * highlighted with a white left accent bar.
 */

interface IconRailProps {
  viewMode: "lobby" | "dms";
  onSelect: (mode: "lobby" | "dms") => void;
}

export function IconRail({ viewMode, onSelect }: IconRailProps) {
  return (
    <nav className="flex h-full w-14 flex-col items-center gap-2 border-r border-white/10 bg-discord-surface py-3">
      <RailButton
        active={viewMode === "lobby"}
        onClick={() => onSelect("lobby")}
        title="Group Lobby"
      >
        <HashIcon />
      </RailButton>
      <RailButton
        active={viewMode === "dms"}
        onClick={() => onSelect("dms")}
        title="Direct Messages"
      >
        <PersonIcon />
      </RailButton>
    </nav>
  );
}

function RailButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
        active ? "text-white" : "text-white/50 hover:text-white"
      }`}
    >
      {active && <span className="absolute -left-3 h-6 w-1 rounded-r bg-white" />}
      {children}
    </button>
  );
}

/** Hash/group icon for the lobby destination. */
function HashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

/** Person icon for the DMs destination. */
function PersonIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

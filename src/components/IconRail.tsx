import { Hash, MessageCircle } from "lucide-react";

interface IconRailProps {
  viewMode: "lobby" | "dms";
  onSelect: (mode: "lobby" | "dms") => void;
}

export function IconRail({ viewMode, onSelect }: IconRailProps) {
  return (
    <nav className="flex h-full w-14 flex-col items-center gap-2 border-r border-discord-border bg-discord-elevated py-3">
      <RailButton
        active={viewMode === "lobby"}
        onClick={() => onSelect("lobby")}
        title="Group Lobby"
      >
        <Hash size={20} />
      </RailButton>
      <RailButton
        active={viewMode === "dms"}
        onClick={() => onSelect("dms")}
        title="Direct Messages"
      >
        <MessageCircle size={20} />
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
      aria-label={title}
      title={title}
      className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord-focus ${
        active
          ? "bg-discord-blurple text-white"
          : "text-discord-muted hover:bg-discord-control hover:text-discord-text"
      }`}
    >
      {active && <span className="absolute -left-2.5 h-6 w-1 rounded-r bg-white" />}
      {children}
    </button>
  );
}

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PeerProfile } from "./DMThread";

interface MemberPanelProps {
  currentUserId: Id<"users"> | null;
  onSelectPeer: (userId: Id<"users">, peer: PeerProfile | null) => void;
}

/** The lobby roster stays visible while chat remains the central task. */
export function MemberPanel({ currentUserId, onSelectPeer }: MemberPanelProps) {
  const members = useQuery(api.presence.listPresence, {}) ?? [];
  return (
    <aside className="hidden w-56 shrink-0 border-l border-discord-border bg-discord-member p-3 xl:block" aria-label="Members">
      <MemberGroup title={`Online — ${members.filter((member) => member.online).length}`} members={members.filter((member) => member.online)} currentUserId={currentUserId} onSelectPeer={onSelectPeer} />
      <MemberGroup title={`Offline — ${members.filter((member) => !member.online).length}`} members={members.filter((member) => !member.online)} currentUserId={currentUserId} onSelectPeer={onSelectPeer} />
    </aside>
  );
}

function MemberGroup({ title, members, currentUserId, onSelectPeer }: { title: string; members: { _id: string; userId: Id<"users">; online: boolean; user: PeerProfile | null }[]; currentUserId: Id<"users"> | null; onSelectPeer: MemberPanelProps["onSelectPeer"] }) {
  return <section className="mb-5"><h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-discord-muted">{title}</h2><div className="space-y-1">{members.map((member) => { const name = member.user?.displayName ?? member.user?.username ?? "Unknown"; const self = member.userId === currentUserId; return <button key={member._id} disabled={self} onClick={() => onSelectPeer(member.userId, member.user)} className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-discord-control disabled:cursor-default disabled:hover:bg-transparent"><span className="relative"><img src={member.user?.avatarUrl} alt="" className="h-8 w-8 rounded-full"/><span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-discord-member ${member.online ? "bg-discord-success" : "bg-discord-subtle"}`}/></span><span className={`truncate text-sm ${member.online ? "text-discord-text" : "text-discord-muted"}`}>{name}{self ? " (you)" : ""}</span></button>; })}</div></section>;
}

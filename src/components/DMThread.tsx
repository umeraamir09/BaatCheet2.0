import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useDMThread } from "../hooks/useDMThread";

/** A single message from the reactive `listMessages` query. */
type MessageEntry = NonNullable<FunctionReturnType<typeof api.messages.listMessages>>[number];

/** Peer profile shape (matches `listMyDMs` join). Passed in from the layout. */
export interface PeerProfile {
  displayName: string | null;
  username: string;
  avatarUrl: string;
}

interface DMThreadProps {
  conversationId: Id<"conversations">;
  myUserId: Id<"users">;
  peerProfile: PeerProfile | null;
  peerUserId: Id<"users"> | null;
  peerOnline: boolean;
  startCallWithPeer: (peerUserId: Id<"users">, peerProfile: PeerProfile) => void;
  callActiveWithPeer: boolean;
}

const MAX_MESSAGE_LEN = 4000;

/**
 * The DM thread pane (Phase 3 — Decisions D2, D3, D5, D6).
 *
 * Reactive `listMessages` (full history, no pagination — D5) + `listTyping`
 * (recency-filtered, self-excluded — D3) via `useDMThread`. Own messages
 * right-aligned, peer's left-aligned with avatar + name. Auto-scrolls to
 * bottom on new message and on conversation switch (initial history load).
 * Composer: Enter sends, Shift+Enter newline; `setTyping` debounced in the
 * hook (~300ms). Light Tailwind styling only (Phase 7 owns the theme).
 */
export function DMThread({
  conversationId,
  myUserId,
  peerProfile,
  peerUserId,
  peerOnline,
  startCallWithPeer,
  callActiveWithPeer,
}: DMThreadProps) {
  const { messages, typingPeers, send, notifyTyping } = useDMThread(conversationId, myUserId);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message + on conversation switch (history load).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversationId]);

  const peerName = peerProfile?.displayName ?? peerProfile?.username ?? "Unknown";

  const handleSend = async () => {
    const body = input;
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await send(body);
      setInput("");
    } catch (e) {
      console.error("sendMessage failed:", e);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const typingText =
    typingPeers.length > 0
      ? `${typingPeers[0].user?.displayName ?? typingPeers[0].user?.username ?? "Someone"} is typing…`
      : null;

  return (
    <div className="flex h-full flex-1 flex-col bg-discord-bg">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <img
          src={peerProfile?.avatarUrl}
          alt={`${peerName} avatar`}
          className="h-8 w-8 rounded-full"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{peerName}</p>
          <p className="truncate text-xs text-white/60">@{peerProfile?.username ?? "…"}</p>
        </div>
        {/* Phase 4 — Call button (Decision D11: disabled if peer offline or call active) */}
        {peerUserId && peerProfile && (
          <button
            onClick={() => startCallWithPeer(peerUserId, peerProfile)}
            disabled={!peerOnline || callActiveWithPeer}
            className="rounded bg-discord-blurple p-2 text-white hover:bg-discord-blurple-hover disabled:cursor-not-allowed disabled:opacity-40"
            title={!peerOnline ? "Peer is offline" : callActiveWithPeer ? "Call in progress" : "Start voice call"}
          >
            <PhoneIcon />
          </button>
        )}
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <EmptyThread />}
        {messages.map((m) => (
          <MessageBubble key={m._id} message={m} mine={m.senderId === myUserId} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      <div className="h-5 px-4 text-xs text-white/60">{typingText ?? ""}</div>

      {/* Composer */}
      <Composer
        value={input}
        onChange={(v) => {
          setInput(v);
          notifyTyping();
        }}
        onKeyDown={onKeyDown}
        onSend={handleSend}
        disabled={sending}
      />
    </div>
  );
}

/** A single message bubble — own right-aligned, peer left-aligned. */
function MessageBubble({ message, mine }: { message: MessageEntry; mine: boolean }) {
  const name = message.sender?.displayName ?? message.sender?.username ?? "Unknown";
  if (mine) {
    return (
      <div className="mb-2 flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-discord-blurple px-3 py-2 text-white">
          <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-2 flex items-end gap-2">
      <img
        src={message.sender?.avatarUrl}
        alt={`${name} avatar`}
        className="h-8 w-8 shrink-0 rounded-full"
      />
      <div className="max-w-[70%]">
        <p className="mb-0.5 text-xs font-medium text-white/80">{name}</p>
        <div className="rounded-2xl rounded-bl-sm bg-discord-surface px-3 py-2 text-white">
          <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
        </div>
      </div>
    </div>
  );
}

/** Empty conversation (no messages yet). */
function EmptyThread() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-white/45">No messages yet. Say hi!</p>
    </div>
  );
}

/** Message composer — Enter sends, Shift+Enter newline. */
function Composer({
  value,
  onChange,
  onKeyDown,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-end gap-2 border-t border-white/8 px-4 py-3">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_LEN))}
        onKeyDown={onKeyDown}
        placeholder="Type a message…"
        rows={1}
        className="max-h-32 flex-1 resize-none rounded bg-discord-surface px-3 py-2 text-sm text-white/90 placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-discord-blurple"
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="rounded bg-discord-blurple px-4 py-2 text-sm font-medium text-white hover:bg-discord-blurple-hover disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}

/** Phone icon for the call button (Phase 4). */
function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/** Empty state when no DM is selected (Decision D2). */
export function EmptyDMState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-discord-bg text-white/60">
      <p className="text-lg font-medium text-white/80">No conversation selected</p>
      <p className="text-sm">Select a friend to start chatting.</p>
    </div>
  );
}

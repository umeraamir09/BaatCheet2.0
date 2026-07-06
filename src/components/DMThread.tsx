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
export function DMThread({ conversationId, myUserId, peerProfile }: DMThreadProps) {
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
    <div className="flex h-full flex-1 flex-col bg-gray-950">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
        <img
          src={peerProfile?.avatarUrl}
          alt={`${peerName} avatar`}
          className="h-8 w-8 rounded-full"
        />
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{peerName}</p>
          <p className="truncate text-xs text-gray-400">@{peerProfile?.username ?? "…"}</p>
        </div>
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
      <div className="h-5 px-4 text-xs text-gray-400">{typingText ?? ""}</div>

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
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white">
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
        <p className="mb-0.5 text-xs font-medium text-gray-300">{name}</p>
        <div className="rounded-2xl rounded-bl-sm bg-gray-800 px-3 py-2 text-white">
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
      <p className="text-sm text-gray-500">No messages yet. Say hi!</p>
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
    <div className="flex items-end gap-2 border-t border-gray-800 px-4 py-3">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_LEN))}
        onKeyDown={onKeyDown}
        placeholder="Type a message…"
        rows={1}
        className="max-h-32 flex-1 resize-none rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-700"
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}

/** Empty state when no DM is selected (Decision D2). */
export function EmptyDMState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-gray-950 text-gray-400">
      <p className="text-lg font-medium text-gray-300">No conversation selected</p>
      <p className="text-sm">Select a friend to start chatting.</p>
    </div>
  );
}

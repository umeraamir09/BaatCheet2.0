import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useChatThread } from "../hooks/useChatThread";
import { MessageBubble } from "./chat/MessageBubble";
import { Composer } from "./chat/Composer";
import { useComposerState } from "../hooks/useComposerState";

/** A single typing entry from the reactive `listTyping` query. */
type TypingEntry = NonNullable<FunctionReturnType<typeof api.typing.listTyping>>[number];

interface LobbyThreadProps {
  conversationId: Id<"conversations">;
  myUserId: Id<"users">;
  onlineCount: number;
  // Phase 6 — Group voice (Decision D5).
  voiceStatus: "disconnected" | "connecting" | "connected";
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
}

/**
 * The group lobby text thread (Phase 5 + Rich messaging + Phase 6 voice button).
 *
 * Reuses `useChatThread` + shared `MessageBubble`/`Composer`. Group-specific
 * UI: "Lobby" header with group icon + online count, multi-person typing
 * indicator, group-flavored empty state. Phase 6 adds the "Join Voice" /
 * "Leave Voice" button in the header (Decision D5 — single-click join).
 *
 * Composer supports text, images (Convex file storage), GIFs (GIPHY CDN),
 * emoji picker, and link preview cards.
 */
export function LobbyThread({
  conversationId,
  myUserId,
  onlineCount,
  voiceStatus,
  onJoinVoice,
  onLeaveVoice,
}: LobbyThreadProps) {
  const { messages, typingPeers, send, notifyTyping } = useChatThread(conversationId, myUserId);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composer = useComposerState(textareaRef);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversationId]);

  const handleSend = async () => {
    const hasText = input.trim();
    const attachments = composer.buildAttachments();
    if ((!hasText && !attachments) || sending) return;
    setSending(true);
    try {
      await send(input, attachments);
      setInput("");
      composer.clearAttachments();
    } catch (e) {
      console.error("lobby sendMessage failed:", e);
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

  const typingText = formatGroupTyping(typingPeers);

  return (
    <div className="flex h-full flex-1 flex-col bg-discord-bg">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <GroupIcon />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">Lobby</p>
          <p className="truncate text-xs text-white/60">{onlineCount} online</p>
        </div>
        {/* Phase 6 — Join/Leave voice button (Decision D5). */}
        <button
          onClick={() => (voiceStatus === "connected" ? onLeaveVoice() : onJoinVoice())}
          disabled={voiceStatus === "connecting"}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            voiceStatus === "connected"
              ? "bg-green-600 text-white hover:bg-green-700"
              : voiceStatus === "connecting"
                ? "cursor-not-allowed bg-white/10 text-white/40"
                : "bg-discord-blurple text-white hover:bg-discord-blurple-hover"
          }`}
          title={
            voiceStatus === "connected"
              ? "Leave group voice"
              : voiceStatus === "connecting"
                ? "Connecting…"
                : "Join group voice"
          }
        >
          {voiceStatus === "connected"
            ? "Leave Voice"
            : voiceStatus === "connecting"
              ? "Connecting…"
              : "Join Voice"}
        </button>
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <EmptyLobby />}
        {messages.map((m) => (
          <MessageBubble key={m._id} message={m} mine={m.senderId === myUserId} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      <div className="h-5 px-4 text-xs text-white/60">{typingText ?? ""}</div>

      {/* Composer */}
      <Composer
        ref={textareaRef}
        value={input}
        onChange={(v) => {
          setInput(v);
          notifyTyping();
        }}
        onKeyDown={onKeyDown}
        onSend={handleSend}
        disabled={sending}
        placeholder="Message the lobby…"
        onEmojiInsert={composer.handleEmojiInsert}
        onGifSelect={composer.handleGifSelect}
        onImageSelect={composer.handleImageSelect}
        pendingImage={composer.pendingImage}
        pendingImagePreview={composer.pendingImagePreview}
        onClearImage={composer.handleClearImage}
        pendingGif={composer.pendingGif}
        onClearGif={composer.handleClearGif}
      />
    </div>
  );
}

/** Multi-person typing indicator format (Decision D5). */
function formatGroupTyping(typingPeers: TypingEntry[]): string | null {
  if (typingPeers.length === 0) return null;
  const name = (t: TypingEntry) => t.user?.displayName ?? t.user?.username ?? "Someone";
  if (typingPeers.length === 1) return `${name(typingPeers[0])} is typing…`;
  if (typingPeers.length === 2)
    return `${name(typingPeers[0])} and ${name(typingPeers[1])} are typing…`;
  const others = typingPeers.length - 2;
  return `${name(typingPeers[0])}, ${name(typingPeers[1])} and ${others} other${others > 1 ? "s" : ""} are typing…`;
}

/** Empty lobby state. */
function EmptyLobby() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-white/45">
        No messages yet. This is the group lobby — say hi to everyone!
      </p>
    </div>
  );
}

/** Group/hash icon for the lobby header. */
function GroupIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white/60"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

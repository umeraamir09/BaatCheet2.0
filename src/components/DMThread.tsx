import { useEffect, useRef, useState } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { useChatThread } from "../hooks/useChatThread";
import { MessageBubble } from "./chat/MessageBubble";
import { Composer } from "./chat/Composer";
import { useComposerState } from "../hooks/useComposerState";

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

/**
 * The DM thread pane (Phase 3 + Rich messaging).
 *
 * Reactive `listMessages` (full history, no pagination) + `listTyping`
 * (recency-filtered, self-excluded) via `useChatThread`. Own messages
 * right-aligned, peer's left-aligned with avatar + name. Auto-scrolls to
 * bottom on new message and on conversation switch.
 *
 * Composer supports text, images (Convex file storage), GIFs (GIPHY CDN),
 * emoji picker, and link preview cards.
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
  const { messages, typingPeers, send, notifyTyping } = useChatThread(conversationId, myUserId);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composer = useComposerState(textareaRef);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversationId]);

  const peerName = peerProfile?.displayName ?? peerProfile?.username ?? "Unknown";

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
            title={
              !peerOnline
                ? "Peer is offline"
                : callActiveWithPeer
                  ? "Call in progress"
                  : "Start voice call"
            }
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
        ref={textareaRef}
        value={input}
        onChange={(v) => {
          setInput(v);
          notifyTyping();
        }}
        onKeyDown={onKeyDown}
        onSend={handleSend}
        disabled={sending}
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

/** Empty conversation (no messages yet). */
function EmptyThread() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-white/45">No messages yet. Say hi!</p>
    </div>
  );
}

/** Phone icon for the call button (Phase 4). */
function PhoneIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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

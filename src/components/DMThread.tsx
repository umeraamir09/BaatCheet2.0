import { useEffect, useRef, useState, type ReactNode } from "react";
import { Phone } from "lucide-react";
import { Id } from "../../convex/_generated/dataModel";
import { useChatThread } from "../hooks/useChatThread";
import { MessageBubble, type MessageEntry } from "./chat/MessageBubble";
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
  callPanel?: ReactNode;
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
  callPanel,
}: DMThreadProps) {
  const { messages, typingPeers, send, edit, remove, toggleReaction, notifyTyping } = useChatThread(
    conversationId,
    myUserId,
  );

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editingMessage, setEditingMessage] = useState<MessageEntry | null>(null);
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
      if (editingMessage) {
        await edit(editingMessage._id, input);
        setEditingMessage(null);
      } else {
        await send(input, attachments);
        composer.clearAttachments();
      }
      setInput("");
    } catch (e) {
      console.error("sendMessage failed:", e);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === "ArrowUp" &&
      !input &&
      !editingMessage &&
      !composer.pendingImage &&
      !composer.pendingGif
    ) {
      const newest = [...messages]
        .reverse()
        .find(
          (message) =>
            message.senderId === myUserId && Date.now() <= message.createdAt + 15 * 60 * 1000,
        );
      if (newest) {
        e.preventDefault();
        setEditingMessage(newest);
        setInput(newest.body);
      }
      return;
    }
    if (e.key === "Escape" && editingMessage) {
      e.preventDefault();
      setEditingMessage(null);
      setInput("");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const startEditing = (message: MessageEntry) => {
    setEditingMessage(message);
    setInput(message.body);
    textareaRef.current?.focus();
  };

  const deleteMessage = (message: MessageEntry) => {
    if (window.confirm("Delete this message permanently?")) {
      void remove(message._id).catch((error) => console.error("deleteMessage failed:", error));
    }
  };

  const typingText =
    typingPeers.length > 0
      ? `${typingPeers[0].user?.displayName ?? typingPeers[0].user?.username ?? "Someone"} is typing…`
      : null;

  return (
    <div className="flex h-full flex-1 flex-col bg-discord-bg">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-discord-border bg-discord-bg px-4 py-3">
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
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-discord-blurple text-white transition-colors hover:bg-discord-blurple-hover disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={
              !peerOnline
                ? "Peer is offline"
                : callActiveWithPeer
                  ? "Call in progress"
                  : "Start voice call"
            }
            title={
              !peerOnline
                ? "Peer is offline"
                : callActiveWithPeer
                  ? "Call in progress"
                  : "Start voice call"
            }
          >
            <Phone size={18} />
          </button>
        )}
      </header>

      {callPanel}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto py-3">
        {messages.length === 0 && <EmptyThread />}
        {messages.map((m, index) => (
          <MessageBubble
            key={m._id}
            message={m}
            previousMessage={index > 0 ? messages[index - 1] : null}
            myUserId={myUserId}
            onEdit={startEditing}
            onDelete={deleteMessage}
            onReact={(message, emoji) =>
              void toggleReaction(message._id, emoji).catch((error) =>
                console.error("toggleReaction failed:", error),
              )
            }
          />
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
        editingMessage={Boolean(editingMessage)}
        onCancelEdit={() => {
          setEditingMessage(null);
          setInput("");
        }}
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

/** Empty state when no DM is selected (Decision D2). */
export function EmptyDMState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-discord-bg text-white/60">
      <p className="text-lg font-medium text-white/80">No conversation selected</p>
      <p className="text-sm">Select a friend to start chatting.</p>
    </div>
  );
}

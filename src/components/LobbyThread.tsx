import { useEffect, useRef, useState } from "react";
import { Hash } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useChatThread } from "../hooks/useChatThread";
import { MessageBubble, type MessageEntry } from "./chat/MessageBubble";
import { Composer } from "./chat/Composer";
import { useComposerState } from "../hooks/useComposerState";

/** A single typing entry from the reactive `listTyping` query. */
type TypingEntry = NonNullable<FunctionReturnType<typeof api.typing.listTyping>>[number];

interface LobbyThreadProps {
  conversationId: Id<"conversations">;
  myUserId: Id<"users">;
  onlineCount: number;
}

/** The shared lobby text thread with Discord-style rows and icon voice controls. */
export function LobbyThread({
  conversationId,
  myUserId,
  onlineCount,
}: LobbyThreadProps) {
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
      console.error("lobby sendMessage failed:", e);
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

  const typingText = formatGroupTyping(typingPeers);
  return (
    <div className="flex h-full flex-1 flex-col bg-discord-bg">
      <header className="flex items-center gap-3 border-b border-discord-border bg-discord-bg px-4 py-3">
        <Hash size={22} className="text-discord-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-discord-text">Lobby</p>
          <p className="truncate text-xs text-discord-muted">{onlineCount} online</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto py-3">
        {messages.length === 0 && <EmptyLobby />}
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

      <div className="h-5 px-4 text-xs text-discord-muted">{typingText ?? ""}</div>

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
        placeholder="Message the lobby"
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

function formatGroupTyping(typingPeers: TypingEntry[]): string | null {
  if (typingPeers.length === 0) return null;
  const name = (t: TypingEntry) => t.user?.displayName ?? t.user?.username ?? "Someone";
  if (typingPeers.length === 1) return `${name(typingPeers[0])} is typing...`;
  if (typingPeers.length === 2)
    return `${name(typingPeers[0])} and ${name(typingPeers[1])} are typing...`;
  const others = typingPeers.length - 2;
  return `${name(typingPeers[0])}, ${name(typingPeers[1])} and ${others} other${others > 1 ? "s" : ""} are typing...`;
}

function EmptyLobby() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-discord-muted">
        No messages yet. This is the group lobby. Say hi to everyone!
      </p>
    </div>
  );
}

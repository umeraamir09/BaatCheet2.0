import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

/** Max message body length — must match convex/messages.ts. */
const MAX_MESSAGE_LEN = 4000;
/** Debounce window for typing writes (ms). Not per-keystroke (validation.md:41). */
const TYPING_DEBOUNCE_MS = 300;

/** Attachment input for sending — images are uploaded, GIFs are referenced by URL. */
export type SendAttachment =
  | { kind: "image"; file: File; width?: number; height?: number }
  | { kind: "gif"; url: string; width?: number; height?: number; alt?: string | null };

export interface UseChatThreadResult {
  /** Reactive message history (full, ordered asc). `[]` while loading. */
  messages: NonNullable<FunctionReturnType<typeof api.messages.listMessages>>;
  /** Reactive typing peers (excludes self; recency-filtered server-side). */
  typingPeers: NonNullable<FunctionReturnType<typeof api.typing.listTyping>>;
  /** Send a message with optional attachments. Clears nothing — caller clears input. */
  send: (body: string, attachments?: SendAttachment[]) => Promise<void>;
  /** Notify that the caller is typing (debounced ~300ms). Called on composer keystroke. */
  notifyTyping: () => void;
}

/**
 * Chat thread lifecycle hook (Phase 3 + Rich messaging).
 *
 * Shared by DMThread + LobbyThread. Subscribes reactively to `listMessages`
 * (full history, no pagination) and `listTyping` (recency-filtered, self-excluded)
 * for one conversation. Exposes `send(body, attachments?)` and `notifyTyping()`.
 *
 * Image attachments are uploaded to Convex file storage before sending.
 * GIF attachments are referenced by GIPHY CDN URL (no upload needed).
 *
 * All queries `"skip"` until both `conversationId` and `myUserId` are known.
 */
export function useChatThread(
  conversationId: Id<"conversations"> | null,
  myUserId: Id<"users"> | null,
): UseChatThreadResult {
  const sendMessage = useMutation(api.messages.sendMessage);
  const setTyping = useMutation(api.typing.setTyping);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  const ready = conversationId !== null && myUserId !== null;

  const messages = useQuery(
    api.messages.listMessages,
    ready ? { conversationId: conversationId! } : "skip",
  );
  const typingPeers = useQuery(
    api.typing.listTyping,
    ready ? { conversationId: conversationId!, selfUserId: myUserId! } : "skip",
  );

  // Debounced typing-write timer.
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyTyping = useCallback(() => {
    if (!ready) return;
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
    }
    typingDebounceRef.current = setTimeout(() => {
      setTyping({ conversationId: conversationId!, userId: myUserId! }).catch((e) =>
        console.error("typing setTyping failed:", e),
      );
    }, TYPING_DEBOUNCE_MS);
  }, [ready, conversationId, myUserId, setTyping]);

  const send = useCallback(
    async (body: string, attachments?: SendAttachment[]) => {
      if (!ready) return;
      const trimmed = body.trim().slice(0, MAX_MESSAGE_LEN);
      const processedAttachments = attachments?.length
        ? await Promise.all(
            attachments.map(async (att) => {
              if (att.kind === "image") {
                // Upload image to Convex file storage
                const postUrl = await generateUploadUrl();
                const result = await fetch(postUrl, {
                  method: "POST",
                  headers: { "Content-Type": att.file.type },
                  body: att.file,
                });
                if (!result.ok) throw new Error("Image upload failed");
                const { storageId } = await result.json();
                return {
                  kind: "image" as const,
                  storageId: storageId as Id<"_storage">,
                  contentType: att.file.type,
                  width: att.width ?? null,
                  height: att.height ?? null,
                };
              }
              return {
                kind: "gif" as const,
                url: att.url,
                width: att.width ?? null,
                height: att.height ?? null,
                alt: att.alt ?? null,
              };
            }),
          )
        : undefined;

      if (!trimmed && (!processedAttachments || processedAttachments.length === 0)) return;

      // Stop the pending typing write — it goes stale via recency within ~3s.
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      await sendMessage({
        conversationId: conversationId!,
        senderId: myUserId!,
        body: trimmed,
        attachments: processedAttachments,
      });
    },
    [ready, conversationId, myUserId, sendMessage, generateUploadUrl],
  );

  // Clear the typing debounce timer on unmount / conversation switch.
  useEffect(() => {
    return () => {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
    };
  }, [conversationId]);

  return {
    messages: messages ?? [],
    typingPeers: typingPeers ?? [],
    send,
    notifyTyping,
  };
}

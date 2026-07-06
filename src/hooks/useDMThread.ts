import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

/** Max message body length — must match convex/messages.ts. */
const MAX_MESSAGE_LEN = 4000;
/** Debounce window for typing writes (ms). Not per-keystroke (validation.md:41). */
const TYPING_DEBOUNCE_MS = 300;

export interface UseDMThreadResult {
  /** Reactive message history (full, ordered asc — Decision D5). `[]` while loading. */
  messages: NonNullable<FunctionReturnType<typeof api.messages.listMessages>>;
  /** Reactive typing peers (excludes self; recency-filtered server-side). */
  typingPeers: NonNullable<FunctionReturnType<typeof api.typing.listTyping>>;
  /** Send a message (validates client-side; throws on Convex error). Clears nothing — caller clears input. */
  send: (body: string) => Promise<void>;
  /** Notify that the caller is typing (debounced ~300ms). Called on composer keystroke. */
  notifyTyping: () => void;
}

/**
 * DM thread lifecycle hook (Phase 3 — Decisions D3, D5, D6).
 *
 * Subscribes reactively to `listMessages` (full history, no pagination — D5)
 * and `listTyping` (recency-filtered, self-excluded — D3) for one
 * conversation. Exposes `send(body)` (calls `sendMessage`) and
 * `notifyTyping()` (debounced `setTyping`).
 *
 * All queries `"skip"` until both `conversationId` and `myUserId` are known
 * (mirrors `usePresence`'s gating on `userId`), so the thread renders
 * empty/loading briefly on cold start then fills live once the id lands.
 */
export function useDMThread(
  conversationId: Id<"conversations"> | null,
  myUserId: Id<"users"> | null,
): UseDMThreadResult {
  const sendMessage = useMutation(api.messages.sendMessage);
  const setTyping = useMutation(api.typing.setTyping);

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
    async (body: string) => {
      if (!ready) return;
      const trimmed = body.trim().slice(0, MAX_MESSAGE_LEN);
      if (!trimmed) return;
      // Stop the pending typing write — it goes stale via recency within ~3s.
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      await sendMessage({
        conversationId: conversationId!,
        senderId: myUserId!,
        body: trimmed,
      });
    },
    [ready, conversationId, myUserId, sendMessage],
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

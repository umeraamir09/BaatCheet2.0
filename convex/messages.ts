/**
 * Phase 3 — Message functions (Decisions D1, D4, D5, D6).
 *
 * Message mutations are PUBLIC (no Convex auth middleware), keyed by
 * conversationId + senderId. v1 LIMITATION (Decision D4): a misbehaving
 * client could spoof another user's messages by passing that user's
 * senderId. Acceptable for v1 (≤10 trusted friends, Convex Cloud dev
 * backend). Hardening (Convex auth or signed writes) is deferred. Inherits
 * Phase 1 D-impl-3 / Phase 2 D7 posture.
 *
 * History (D5): retained forever for v1; `listMessages` is a single reactive
 * subscription returning the FULL conversation history (no pagination, no
 * `take(N)`/load-more — YAGNI for a ≤10-person group; revisit only if
 * subscription size becomes a problem). Reuses the Phase-0/2-proven reactive
 * subscription pattern — no polling, no manual websocket.
 */
import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";

/** Max message body length (server-enforced). Must match useDMThread client cap. */
const MAX_MESSAGE_LEN = 4000;

/**
 * Send a message (Task 2.3).
 *
 * Validates `body` server-side (non-empty after trim, ≤4000 chars — the
 * authoritative check; the client also validates), inserts the `messages`
 * doc, AND patches the parent `conversations.lastMessageAt = now` in the SAME
 * transaction so the DM list reorders live (smoke 4). One mutation = insert +
 * patch, atomic.
 *
 * Public (Decision D4).
 */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.body.trim();
    if (!trimmed) {
      throw new ConvexError("Message body is empty");
    }
    if (trimmed.length > MAX_MESSAGE_LEN) {
      throw new ConvexError(`Message exceeds ${MAX_MESSAGE_LEN} characters`);
    }

    const now = Date.now();
    // Insert the message doc.
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: args.senderId,
      body: trimmed,
      createdAt: now,
    });
    // Patch the parent's lastMessageAt so the DM list reorders (same tx).
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });
  },
});

/**
 * Reactive message feed for a conversation (Task 2.4) — the live DM thread.
 *
 * Returns ALL messages in the conversation ordered by `createdAt` asc, each
 * joined with the sender's profile (avatar, name) for bubble rendering. Full
 * history, no pagination in v1 (Decision D5). Subscribed live — messages from
 * the peer propagate within ~1s with no manual refresh (smoke 1).
 *
 * Public (Decision D4).
 */
export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("messages")
      .withIndex("byConversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .collect();

    // Join each message with its sender profile (≤10 group → small N).
    return await Promise.all(
      docs.map(async (m) => {
        const sender = await ctx.db.get(m.senderId);
        return {
          _id: m._id,
          senderId: m.senderId,
          body: m.body,
          createdAt: m.createdAt,
          sender: sender
            ? {
                displayName: sender.displayName,
                username: sender.username,
                avatarUrl: sender.avatarUrl,
              }
            : null,
        };
      }),
    );
  },
});

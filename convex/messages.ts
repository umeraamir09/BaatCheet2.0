/**
 * Message functions (Phase 3 + Rich messaging).
 *
 * Message mutations are PUBLIC (no Convex auth middleware), keyed by
 * conversationId + senderId. v1 LIMITATION: a misbehaving client could spoof
 * another user's messages by passing that user's senderId. Acceptable for v1
 * (≤10 trusted friends, Convex Cloud dev backend). Hardening deferred.
 *
 * History: retained forever for v1; `listMessages` is a single reactive
 * subscription returning the FULL conversation history (no pagination).
 *
 * Rich messaging: `sendMessage` accepts optional `attachments` (images stored
 * in Convex file storage, GIFs referenced by GIPHY CDN URL). When a URL is
 * detected in the message body, a link preview fetch is scheduled asynchronously.
 */
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";

/** Max message body length (server-enforced). Must match Composer client cap. */
const MAX_MESSAGE_LEN = 4000;
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Simple URL regex for detecting links to preview. */
const URL_REGEX = /https?:\/\/[^\s<>"']+/i;

const attachmentValidator = v.array(
  v.union(
    v.object({
      kind: v.literal("image"),
      storageId: v.id("_storage"),
      contentType: v.string(),
      width: v.union(v.number(), v.null()),
      height: v.union(v.number(), v.null()),
    }),
    v.object({
      kind: v.literal("gif"),
      url: v.string(),
      width: v.union(v.number(), v.null()),
      height: v.union(v.number(), v.null()),
      alt: v.union(v.string(), v.null()),
    }),
  ),
);

/**
 * Send a message (text, images, GIFs, or any combination).
 *
 * Validates body server-side (non-empty after trim OR has attachments, ≤4000
 * chars). Inserts the message doc, patches `conversations.lastMessageAt` for
 * DM-list ordering, and schedules a link preview fetch if a URL is detected.
 *
 * Returns the message ID (used by the link preview scheduler).
 *
 * Public (no Convex auth — v1 limitation).
 */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    body: v.string(),
    attachments: v.optional(attachmentValidator),
  },
  handler: async (ctx, args): Promise<Id<"messages">> => {
    const trimmed = args.body.trim();
    const hasAttachments = args.attachments && args.attachments.length > 0;
    if (!trimmed && !hasAttachments) {
      throw new ConvexError("Message is empty (no text and no attachments)");
    }
    if (trimmed.length > MAX_MESSAGE_LEN) {
      throw new ConvexError(`Message exceeds ${MAX_MESSAGE_LEN} characters`);
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: args.senderId,
      body: trimmed,
      attachments: args.attachments,
      createdAt: now,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });

    // Schedule link preview fetch if the body contains a URL.
    if (trimmed) {
      const urlMatch = trimmed.match(URL_REGEX);
      if (urlMatch) {
        await ctx.scheduler.runAfter(0, internal.linkPreviews.fetchLinkPreview, {
          messageId,
          url: urlMatch[0],
        });
      }
    }

    return messageId;
  },
});

/** Edit an authored message body without changing its original ordering. */
export const editMessage = mutation({
  args: {
    messageId: v.id("messages"),
    userId: v.id("users"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new ConvexError("Message not found");
    if (message.senderId !== args.userId) {
      throw new ConvexError("Only the message author can edit it");
    }
    if (Date.now() > message.createdAt + MESSAGE_EDIT_WINDOW_MS) {
      throw new ConvexError("The 15-minute edit window has expired");
    }

    const trimmed = args.body.trim();
    const hasAttachments = (message.attachments?.length ?? 0) > 0;
    if (!trimmed && !hasAttachments) throw new ConvexError("Message is empty");
    if (trimmed.length > MAX_MESSAGE_LEN) {
      throw new ConvexError(`Message exceeds ${MAX_MESSAGE_LEN} characters`);
    }

    await ctx.db.patch(args.messageId, {
      body: trimmed,
      editedAt: Date.now(),
      linkPreview: null,
    });

    const urlMatch = trimmed.match(URL_REGEX);
    if (urlMatch) {
      await ctx.scheduler.runAfter(0, internal.linkPreviews.fetchLinkPreview, {
        messageId: args.messageId,
        url: urlMatch[0],
      });
    }
  },
});

/** Permanently delete an authored message and its dependent data. */
export const deleteMessage = mutation({
  args: {
    messageId: v.id("messages"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return;
    if (message.senderId !== args.userId) {
      throw new ConvexError("Only the message author can delete it");
    }

    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("byMessage", (q) => q.eq("messageId", args.messageId))
      .collect();
    await Promise.all(reactions.map((reaction) => ctx.db.delete(reaction._id)));

    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image") {
        await ctx.storage.delete(attachment.storageId);
      }
    }

    await ctx.db.delete(args.messageId);
    const conversation = await ctx.db.get(message.conversationId);
    if (conversation) {
      const latest = await ctx.db
        .query("messages")
        .withIndex("byConversation", (q) => q.eq("conversationId", message.conversationId))
        .order("desc")
        .first();
      await ctx.db.patch(message.conversationId, {
        lastMessageAt: latest?.createdAt ?? conversation.createdAt,
      });
    }
  },
});

/** Toggle one user's one-emoji reaction while allowing other emoji reactions. */
export const toggleReaction = mutation({
  args: {
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new ConvexError("Message not found");
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation) throw new ConvexError("Conversation not found");
    if (!conversation.participantIds.includes(args.userId)) {
      throw new ConvexError("Join the conversation before reacting");
    }

    const emoji = args.emoji.trim();
    if (!emoji || emoji.length > 64) throw new ConvexError("Invalid emoji reaction");
    const key = `${args.messageId}:${args.userId}:${emoji}`;
    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("byKey", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { active: false };
    }

    await ctx.db.insert("messageReactions", {
      conversationId: message.conversationId,
      messageId: args.messageId,
      userId: args.userId,
      emoji,
      key,
      createdAt: Date.now(),
    });
    return { active: true };
  },
});

/**
 * Reactive message feed for a conversation — the live thread.
 *
 * Returns ALL messages ordered by `createdAt` asc. Each message is joined with
 * the sender's profile and has image attachment URLs resolved via
 * `ctx.storage.getUrl()`. Full history, no pagination in v1.
 *
 * Public (no Convex auth — v1 limitation).
 */
export const listMessages = query({
  args: {
    conversationId: v.id("conversations"),
    viewerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("messages")
      .withIndex("byConversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .collect();

    const reactionDocs = await ctx.db
      .query("messageReactions")
      .withIndex("byConversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    const reactionsByMessage = new Map<
      string,
      Map<string, { emoji: string; count: number; reactedByMe: boolean; createdAt: number }>
    >();
    for (const reaction of reactionDocs) {
      let byEmoji = reactionsByMessage.get(reaction.messageId);
      if (!byEmoji) {
        byEmoji = new Map();
        reactionsByMessage.set(reaction.messageId, byEmoji);
      }
      const aggregate = byEmoji.get(reaction.emoji) ?? {
        emoji: reaction.emoji,
        count: 0,
        reactedByMe: false,
        createdAt: reaction.createdAt,
      };
      aggregate.count += 1;
      aggregate.reactedByMe ||= reaction.userId === args.viewerId;
      aggregate.createdAt = Math.min(aggregate.createdAt, reaction.createdAt);
      byEmoji.set(reaction.emoji, aggregate);
    }

    return await Promise.all(
      docs.map(async (m) => {
        const sender = await ctx.db.get(m.senderId);

        // Resolve image attachment URLs from storage IDs.
        const attachments = await Promise.all(
          (m.attachments ?? []).map(async (att) => {
            if (att.kind === "image") {
              const url = await ctx.storage.getUrl(att.storageId);
              return { ...att, url: url ?? null };
            }
            return att; // GIFs already have a URL
          }),
        );

        return {
          _id: m._id,
          senderId: m.senderId,
          body: m.body,
          createdAt: m.createdAt,
          editedAt: m.editedAt ?? null,
          attachments,
          linkPreview: m.linkPreview ?? null,
          reactions: [...(reactionsByMessage.get(m._id)?.values() ?? [])]
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(({ emoji, count, reactedByMe }) => ({ emoji, count, reactedByMe })),
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

/**
 * Phase 5 — Lobby functions (Decisions D1, D2, D6, D7).
 *
 * Lobby mutations are PUBLIC (no Convex auth middleware), keyed by userId.
 * v1 LIMITATION (Decision D7): a misbehaving client could create a rogue
 * lobby or add/remove participants. Acceptable for v1 (≤10 trusted friends,
 * Convex Cloud dev backend). Hardening (Convex auth or signed writes) is
 * deferred. Inherits Phase 3 D4 / Phase 2 D7 / Phase 1 D-impl-3 posture.
 *
 * The lobby is a single `conversations` doc with `type: "group"`,
 * `key: "group:lobby"`. No schema change — Phase 3 D1 designed the generic
 * `conversations`/`messages`/`typing` tables to support this.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

/**
 * Open (or create) the single shared lobby conversation (Decision D2).
 *
 * Looks up by `key === "group:lobby"` via the existing `byKey` index. If
 * missing, inserts a new `conversations` doc (`type: "group"`,
 * `participantIds: [userId]`, `key: "group:lobby"`, `createdAt = lastMessageAt = now`).
 * If found and `userId` not in `participantIds`, patches to append it
 * (opportunistic roster — NOT an access gate; membership is implicit).
 * Returns the conversation `_id`. Idempotent — safe to call repeatedly.
 *
 * Public (Decision D7).
 */
export const getOrCreateLobby = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<Id<"conversations">> => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("byKey", (q) => q.eq("key", "group:lobby"))
      .unique();

    if (existing) {
      if (!existing.participantIds.includes(args.userId)) {
        await ctx.db.patch(existing._id, {
          participantIds: [...existing.participantIds, args.userId],
        });
      }
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("conversations", {
      type: "group",
      participantIds: [args.userId],
      key: "group:lobby",
      createdAt: now,
      lastMessageAt: now,
    });
  },
});

/**
 * Reactive lobby lookup (Decision D2).
 *
 * Returns the single `conversations` doc where `key === "group:lobby"`
 * (via `byKey` index), or `null` if it doesn't exist yet. Reactive — the
 * lobby appears as soon as the doc lands (no polling).
 *
 * Public (Decision D7).
 */
export const getLobby = query({
  args: {},
  handler: async (ctx): Promise<Doc<"conversations"> | null> => {
    return await ctx.db
      .query("conversations")
      .withIndex("byKey", (q) => q.eq("key", "group:lobby"))
      .unique();
  },
});

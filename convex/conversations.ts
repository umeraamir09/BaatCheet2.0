/**
 * Phase 3 — Conversation functions (Decisions D1, D4, D6).
 *
 * Conversation mutations are PUBLIC (no Convex auth middleware), keyed by
 * userId. v1 LIMITATION (Decision D4): a misbehaving client could spoof
 * another user's conversations by passing that user's userId. Acceptable for
 * v1 (≤10 trusted friends, Convex Cloud dev backend). Hardening (Convex auth
 * or signed writes) is deferred. Inherits Phase 1 D-impl-3 / Phase 2 D7
 * posture.
 *
 * Generic model (D1): a `conversations` doc carries `type` ("dm" now, "group"
 * lands Phase 5) + a canonical sorted `key` ("userIdA__userIdB") so both DM
 * participants resolve to the SAME doc. Phase 5's group lobby is a
 * `type:"group"` doc reusing the same `messages` table — a UI retarget, not a
 * schema migration.
 *
 * NOTE: Convex has no declarative unique constraint — `key` uniqueness is
 * enforced by `getOrCreateDM`'s check-then-insert. A concurrent double-open
 * of the same pair has a tiny insert-race window; acceptable for v1 (≤10
 * clients). If it ever matters, a cleanup can dedupe by `key`.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

/** Compute the canonical sorted key for a DM between two users. */
function dmKey(a: Id<"users">, b: Id<"users">): string {
  return [a, b].sort().join("__");
}

/**
 * Open (or create) the 1:1 DM between two users (Task 2.1).
 *
 * Computes the canonical sorted `key`, looks up by `byKey`; if missing,
 * inserts a new `conversations` doc (`type:"dm"`, sorted `participantIds`,
 * `lastMessageAt = createdAt = now` so a fresh DM sorts at the top until a
 * message lands). Returns the conversation `_id` for the caller to subscribe
 * to. Idempotent — safe to call repeatedly; returns the same doc.
 *
 * Public (Decision D4).
 */
export const getOrCreateDM = mutation({
  args: {
    userIdA: v.id("users"),
    userIdB: v.id("users"),
  },
  handler: async (ctx, args): Promise<Id<"conversations">> => {
    // A user can't open a DM with themselves.
    if (args.userIdA === args.userIdB) {
      throw new Error("Cannot open a DM with yourself");
    }

    const key = dmKey(args.userIdA, args.userIdB);
    const existing = await ctx.db
      .query("conversations")
      .withIndex("byKey", (q) => q.eq("key", key))
      .unique();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    // Store participantIds sorted to match the canonical key.
    const participantIds = [args.userIdA, args.userIdB].sort() as [Id<"users">, Id<"users">];
    return await ctx.db.insert("conversations", {
      type: "dm",
      participantIds,
      key,
      createdAt: now,
      lastMessageAt: now,
    });
  },
});

/**
 * Reactive DM list for the sidebar (Task 2.2) — the reorderable feed that
 * smoke 4 validates.
 *
 * Scans all `conversations` and filters to `type === "dm"` docs whose
 * `participantIds` include `userId` (D1 — no array-membership index needed
 * for v1; ≤10 group keeps the scan trivial). For each DM: resolves the peer's
 * `users` profile and the last message (for preview), then sorts by
 * `lastMessageAt` desc so the most-recently-active DM is on top. Reorders
 * live when `sendMessage` patches `lastMessageAt`.
 *
 * Public (Decision D4).
 */
export const listMyDMs = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("conversations").collect();
    const mine = all.filter((c) => c.type === "dm" && c.participantIds.includes(args.userId));

    const joined = await Promise.all(
      mine.map(async (c) => {
        const peerId = c.participantIds.find((id) => id !== args.userId);
        const peerUser = peerId ? await ctx.db.get(peerId) : null;
        // Last message in the conversation (ordered desc → first()).
        const lastMessage = await ctx.db
          .query("messages")
          .withIndex("byConversation", (q) => q.eq("conversationId", c._id))
          .order("desc")
          .first();

        return {
          _id: c._id,
          conversationId: c._id,
          peerUserId: peerId ?? null,
          peer: peerUser
            ? {
                displayName: peerUser.displayName,
                username: peerUser.username,
                avatarUrl: peerUser.avatarUrl,
              }
            : null,
          lastMessage: lastMessage
            ? {
                body: lastMessage.body,
                createdAt: lastMessage.createdAt,
                senderId: lastMessage.senderId,
              }
            : null,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
        };
      }),
    );

    // Most recently active first.
    return joined.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});
